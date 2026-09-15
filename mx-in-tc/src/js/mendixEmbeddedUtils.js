import soaService from 'soa/kernel/soaService';

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

    if (
        Object.values( parameters ).some(
            ( value ) =>
                value !== undefined &&
                ![ 'string', 'number', 'boolean' ].includes( typeof value )
        )
    ) {
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
    signal?.throwIfAborted();

    if ( await hasValidSession( url, signal ) ) {
        return;
    }

    if ( await authenticateWithAccessToken( url, signal ) ) {
        return;
    }

    return false;
};

const authenticateWithAccessToken = async( url, signal ) => {
    signal?.throwIfAborted();

    const [ userAccessTokens, discriminator ] = await Promise.all( [
        soaService.post(
            'Internal-Core-2026-12-Session',
            'getUserAccessTokens',
            {},
            {}
        ),
        fetchSessionDiscriminator( signal )
    ] );

    signal?.throwIfAborted();

    const token = userAccessTokens?.clientUserAccessTokens
        ?.find( ( entry ) => entry?.clientID === '' )
        ?.token?.trim();

    if ( !token ) {
        return false;
    }

    const tokenUrl = new URL( 'rest/tcsso/v1/login/token', url );
    tokenUrl.searchParams.set( 'discriminator', discriminator );
    tokenUrl.searchParams.set( 'token', token );

    const response = await fetch( tokenUrl, {
        method: 'GET',
        headers: { Accept: '*/*' },
        mode: 'cors',
        credentials: 'include',
        signal
    } );

    signal?.throwIfAborted();

    return response.json();
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

        const discriminator = await response.text();
        if ( !discriminator.trim() ) {
            throw new Error();
        }
        return discriminator;
    } catch {
        signal?.throwIfAborted();
        console.warn(
            'Session discriminator is unavailable; continuing with an empty discriminator.'
        );
        return '';
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
    } catch {
        signal?.throwIfAborted();

        throw new MendixEmbeddedError( 'MENDIX_NOT_FOUND' );
    }
};

const authenticateWithPopup = async( url, signal ) => {
    const discriminator = await fetchSessionDiscriminator( signal );
    const ssoUrl = new URL( 'rest/tcsso/v1/login', url );
    ssoUrl.searchParams.set( 'discriminator', discriminator );

    await openPopup( ssoUrl, () => hasValidSession( url, signal ), signal );
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
            if ( error !== undefined ) {
                reject( error );
            } else {
                resolve();
            }
        };

        const onAbort = () => settle( signal.reason );

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
                pollTimeoutId = window.setTimeout(
                    pollForCompletion,
                    SESSION_POLL_INTERVAL
                );
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
