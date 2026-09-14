const POPUP_TIMEOUT = 30000;
const SESSION_POLL_INTERVAL = 1000;

export class MendixEmbeddedError extends Error {
    constructor( code ) {
        super( code );
        this.name = 'MendixEmbeddedError';
        this.code = code;
    }
}

const getMendixConfiguration = ( config ) => {
    if ( !config ) {
        throw new MendixEmbeddedError( 'MISSING_CONFIGURATION' );
    }

    let url;
    try {
        url = new URL( config );
        if ( url.protocol !== 'http:' && url.protocol !== 'https:' ) {
            throw new Error();
        }
    } catch {
        throw new MendixEmbeddedError( 'INVALID_URL' );
    }

    const parameterMappings = Array.from( url.searchParams );

    url.search = '';
    url.hash = '';
    if ( !url.pathname.endsWith( '/' ) ) {
        url.pathname += '/';
    }

    return {
        url: url.toString(),
        parameterMappings
    };
};

export const getResolvedMendixConfiguration = ( config, context ) => {
    const { url, parameterMappings } = getMendixConfiguration( config );
    const parameters = Object.fromEntries(
        parameterMappings.map( ( [ target, value ] ) => [
            target,
            resolveParameterValue( context, value )
        ] )
    );

    if ( Object.values( parameters ).some( value =>
        value !== undefined && ![ 'string', 'number', 'boolean' ].includes( typeof value ) ) ) {
        throw new MendixEmbeddedError( 'INVALID_PARAMETER' );
    }

    return {
        url,
        parameters,
        configurationKey: JSON.stringify( { url, parameters } )
    };
};

export const getMendixContextPaths = ( config ) => {
    const { parameterMappings } = getMendixConfiguration( config );
    return Array.from(
        new Set(
            parameterMappings
                .map( ( [ , value ] ) => getContextPath( value ) )
                .filter( Boolean )
        )
    );
};

const getContextPath = ( value ) =>
    value.startsWith( '{' ) && value.endsWith( '}' ) ? value.slice( 1, -1 ) : null;

const resolveParameterValue = ( context, value ) => {
    const contextPath = getContextPath( value );
    if ( contextPath !== null ) {
        return contextPath
            .split( '.' )
            .reduce( ( resolved, key ) => resolved?.[key], context );
    }

    try {
        const parsedValue = JSON.parse( value );
        if (
            typeof parsedValue === 'string' ||
            typeof parsedValue === 'number' ||
            typeof parsedValue === 'boolean'
        ) {
            return parsedValue;
        }
    } catch {
        // Values that are not valid JSON primitives are plain string literals.
    }

    return value;
};

export const ensureHasValidSession = async( url, signal ) => {
    if ( await hasValidSession( url, signal ) ) {
        return;
    }

    const discriminator = await fetchSessionDiscriminator( signal );
    const ssoUrl = new URL( 'rest/tcsso/v1/login', url );
    ssoUrl.searchParams.set( 'discriminator', discriminator );
    await openPopup( ssoUrl, () => hasValidSession( url, signal ), signal );
};

const fetchSessionDiscriminator = async( signal ) => {
    try {
        const response = await fetch( '/getSessionDiscriminator', {
            signal,
            headers: {
                Accept: 'text/plain'
            }
        } );

        if ( !response.ok ) {
            throw new Error();
        }

        return await response.text();
    } catch ( error ) {
        if ( signal?.aborted ) {
            throw error;
        }
        throw new MendixEmbeddedError( 'SESSION_DISCRIMINATOR_ERROR' );
    }
};

const hasValidSession = async( url, signal ) => {
    try {
        const response = await fetch(
            new URL( 'rest/tcsso/v1/validate-session', url ),
            { credentials: 'include', signal }
        );

        if ( response.status === 401 || response.status === 403 ) {
            return false;
        }

        if ( !response.ok ) {
            throw new Error();
        }

        const valid = await response.json();
        if ( typeof valid !== 'boolean' ) {
            throw new Error();
        }
        return valid;
    } catch ( error ) {
        if ( signal?.aborted ) {
            throw error;
        }

        throw new MendixEmbeddedError( 'MENDIX_NOT_FOUND' );
    }
};

const openPopup = ( url, isComplete, signal ) => {
    return new Promise( ( resolve, reject ) => {
        let settled = false;
        let pollTimeoutId;
        let popupTimeoutId;

        const settle = ( error ) => {
            if ( settled ) {
                return;
            }

            settled = true;
            window.clearTimeout( pollTimeoutId );
            window.clearTimeout( popupTimeoutId );
            window.removeEventListener( 'focus', open );
            signal?.removeEventListener( 'abort', onAbort );
            if ( error ) {
                reject( error );
            } else {
                resolve();
            }
        };

        const onAbort = () => settle( new DOMException( 'Sign-in cancelled.', 'AbortError' ) );

        const pollForCompletion = async() => {
            try {
                if ( await isComplete() ) {
                    settle();
                    return;
                }
            } catch ( error ) {
                settle( error );
                return;
            }

            if ( !settled ) {
                pollTimeoutId = window.setTimeout( pollForCompletion, SESSION_POLL_INTERVAL );
            }
        };

        const open = () => {
            const popup = window.open( url, '_blank', 'width=200,height=300' );
            if ( !popup ) {
                settle( new MendixEmbeddedError( 'POPUP_BLOCKED' ) );
                return;
            }
            popupTimeoutId = window.setTimeout( () => {
                settle( new MendixEmbeddedError( 'POPUP_TIMEOUT' ) );
            }, POPUP_TIMEOUT );
            pollForCompletion();
        };

        if ( signal?.aborted ) {
            onAbort();
            return;
        }
        signal?.addEventListener( 'abort', onAbort, { once: true } );
        if ( document.hasFocus() ) {
            open();
        } else {
            window.addEventListener( 'focus', open, { once: true } );
        }
    } );
};
