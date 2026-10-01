import soaService from 'soa/kernel/soaService';
import { MendixEmbeddedError } from './mendixEmbeddedUtils';

const POPUP_TIMEOUT = 30000;
const SESSION_POLL_INTERVAL = 1000;

export const ensureHasValidSession = async( url, signal ) => {
    signal?.throwIfAborted();

    if ( await hasValidSession( url, signal ) ) {
        return;
    }

    await authenticateWithAccessToken( url, signal );
    
    if ( await hasValidSession( url, signal ) ) {
        return;
    }

    await authenticateWithPopup( url, signal );
};

const authenticateWithAccessToken = async( url, signal ) => {
    const [ token, discriminator ] = await Promise.all( [
        fetchUserAccessToken(),
        fetchSessionDiscriminator( signal )
    ] );

    signal?.throwIfAborted();

    if ( !token ) {
        return;
    }

    const tokenUrl = new URL( 'rest/tcsso/v1/login/token', url );
    tokenUrl.searchParams.set( 'discriminator', discriminator );
    tokenUrl.searchParams.set( 'token', token );

    try {
        await fetch( tokenUrl, {
            method: 'GET',
            headers: { Accept: '*/*' },
            mode: 'cors',
            credentials: 'include',
            signal
        } );
    } catch {
        // The session is revalidated afterwards, so a failed exchange falls back to popup SSO.
        signal?.throwIfAborted();
    }
};

const fetchUserAccessToken = async() => {
    try {
        const response = await soaService.post(
            'Internal-Core-2026-12-Session',
            'getUserAccessTokens',
            {},
            {}
        );
        const entries = response?.clientUserAccessTokens;
        const token = Array.isArray( entries ) ?
            entries.find( ( entry ) => entry?.clientID === '' )?.token :
            undefined;

        return typeof token === 'string' ? token.trim() : undefined;
    } catch {
        // Token authentication is optional; popup SSO remains available.
        return undefined;
    }
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
