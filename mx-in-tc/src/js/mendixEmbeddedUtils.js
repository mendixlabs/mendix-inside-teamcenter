const POPUP_TIMEOUT = 30000;

export class MendixEmbeddedError extends Error {
    constructor( message, code ) {
        super( message );
        this.name = 'MendixEmbeddedError';
        this.code = code;
    }
}

const getMendixConfiguration = ( props ) => {
    const config = props.config || props.subPanelContext?.declarativeKeyContext;
    if ( !config ) {
        throw new MendixEmbeddedError(
            'A Mendix application URL is required.',
            'MISSING_CONFIGURATION'
        );
    }

    let url;
    try {
        url = new URL( config );
    } catch {
        throw new MendixEmbeddedError(
            'The Mendix application URL is invalid.',
            'INVALID_URL'
        );
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

export const getResolvedMendixConfiguration = ( props, context ) => {
    const { url, parameterMappings } = getMendixConfiguration( props );
    const parameters = Object.fromEntries(
        parameterMappings.map( ( [ target, value ] ) => [
            target,
            resolveParameterValue( context, value )
        ] )
    );

    return {
        url,
        parameters,
        configurationKey: JSON.stringify( { url, parameters } )
    };
};

export const getMendixContextPaths = ( props ) => {
    const { parameterMappings } = getMendixConfiguration( props );
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
    // Values that are not valid JSON primitives are treated as plain string literals.
        return value;
    }

    return value;
};

export const ensureHasValidSession = async( url ) => {
    if ( await hasValidSession( url ) ) {
        return;
    }

    const discriminator = await fetchSessionDiscriminator();
    const ssoUrl = new URL( 'rest/tcsso/v1/login', url );
    ssoUrl.searchParams.set( 'discriminator', discriminator );
    await openPopup( ssoUrl, () => hasValidSession( url ) );

    if ( !await hasValidSession( url ) ) {
        throw new MendixEmbeddedError(
            'Unable to login to the Mendix application.',
            'LOGIN_FAILED'
        );
    }
};

const fetchSessionDiscriminator = async() => {
    try {
        const response = await fetch( '/getSessionDiscriminator', {
            headers: {
                Accept: 'text/plain'
            }
        } );

        if ( !response.ok ) {
            throw new Error();
        }

        return await response.text();
    } catch {
        throw new MendixEmbeddedError(
            'Failed to retrieve session discriminator.',
            'SESSION_DISCRIMINATOR_ERROR'
        );
    }
};

const hasValidSession = async( url ) => {
    try {
        const response = await fetch(
            new URL( 'rest/tcsso/v1/validate-session', url ),
            { credentials: 'include' }
        );

        if ( response.status === 404 ) {
            throw new MendixEmbeddedError(
                `Cannot reach the Mendix application at ${url}`,
                'MENDIX_NOT_FOUND'
            );
        }

        if ( !response.ok ) {
            return false;
        }

        return Boolean( await response.json() );
    } catch ( error ) {
        if ( error.code === 'POPUP_BLOCKED' || error.code === 'MENDIX_NOT_FOUND' ) {
            throw error;
        }

        return false;
    }
};

const openPopup = async( url, isComplete ) => {
    if ( !document.hasFocus?.() ) {
        await new Promise( ( resolve ) => {
            window.addEventListener( 'focus', resolve, { once: true } );
        } );
    }

    const popup = window.open( url, 'Teamcenter SSO', 'width=200,height=300' );
    if ( !popup ) {
        throw new MendixEmbeddedError( 'Popup blocked.', 'POPUP_BLOCKED' );
    }

    return new Promise( ( resolve, reject ) => {
        let settled = false;
        let pollTimeoutId;
        let popupTimeoutId;

        const settle = ( callback ) => {
            if ( settled ) {
                return;
            }

            settled = true;
            window.clearTimeout( pollTimeoutId );
            window.clearTimeout( popupTimeoutId );
            callback();
        };

        const pollForCompletion = async() => {
            try {
                if ( await isComplete() ) {
                    settle( resolve );
                    return;
                }
            } catch ( error ) {
                settle( () => reject( error ) );
                return;
            }

            if ( !settled ) {
                pollTimeoutId = window.setTimeout( pollForCompletion, 200 );
            }
        };

        popupTimeoutId = window.setTimeout( () => {
            settle( () =>
                reject(
                    new MendixEmbeddedError( 'The sign-in timed out.', 'POPUP_TIMEOUT' )
                )
            );
        }, POPUP_TIMEOUT );

        pollForCompletion();
    } );
};
