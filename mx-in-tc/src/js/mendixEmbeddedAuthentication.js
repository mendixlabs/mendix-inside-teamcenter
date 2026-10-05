import soaService from 'soa/kernel/soaService';
import { MendixEmbeddedError } from './mendixEmbeddedUtils';

const POPUP_TIMEOUT = 2 * 60 * 1000;
const POPUP_POLL_INTERVAL = 200;
const POPUP_NAME = 'mxInTcSso';
const TOKEN_EXCHANGE_MIN_TC_RELEASE = 2612;

export const ensureHasValidSession = async( url, tcServerVersion, signal ) => {
    signal?.throwIfAborted();

    if ( await hasValidSession( url, signal ) ) {
        return;
    }

    if ( requiresPopup( tcServerVersion ) ) {
        await authenticateWithPopup( url, signal );
    } else {
        await authenticateWithAccessToken( url, signal );
    }
};

/**
 * Teamcenter releases before 2612 cannot issue user access tokens. The release is the number
 * after the prefix letter of the server version, for example 2612 in 'P2612.2026082800'.
 * Unknown versions use the token exchange.
 */
const requiresPopup = ( tcServerVersion ) =>
    Number.parseInt( tcServerVersion?.slice( 1 ), 10 ) < TOKEN_EXCHANGE_MIN_TC_RELEASE;

const authenticateWithAccessToken = async( url, signal ) => {
    const [ token, discriminator ] = await Promise.all( [
        fetchUserAccessToken(),
        fetchSessionDiscriminator( signal )
    ] );

    signal?.throwIfAborted();

    if ( !token || !await exchangeAccessToken( url, token, discriminator, signal ) ) {
        throw new MendixEmbeddedError( 'LOGIN_FAILED' );
    }
};

/**
 * Exchanges the access token for a Mendix session. The endpoint responds with a boolean that
 * tells whether the session was created, so the session does not need to be revalidated.
 */
const exchangeAccessToken = async( url, token, discriminator, signal ) => {
    const tokenUrl = new URL( 'rest/tcsso/v1/login/token', url );
    tokenUrl.searchParams.set( 'discriminator', discriminator );

    try {
        const response = await fetch( tokenUrl, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify( { token } ),
            mode: 'cors',
            credentials: 'include',
            signal
        } );

        return response.ok && await response.json() === true;
    } catch {
        signal?.throwIfAborted();
        return false;
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
        // A missing token is reported as a failed login.
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

    await openPopup( ssoUrl, signal );

    if ( !await hasValidSession( url, signal ) ) {
        throw new MendixEmbeddedError( 'LOGIN_FAILED' );
    }
};

/**
 * Opens the SSO popup and resolves once the user (or the SSO page) closes it.
 * The popup is closed by us when the sign-in times out or the load is cancelled.
 */
const openPopup = ( url, signal ) => {
    return new Promise( ( resolve, reject ) => {
        let settled = false;
        let popup;
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

            if ( error === undefined ) {
                resolve();
                return;
            }

            if ( popup && !popup.closed ) {
                popup.close();
            }
            reject( error );
        };

        const onAbort = () => settle( signal.reason );

        const pollForClose = () => {
            if ( popup.closed ) {
                settle();
                return;
            }

            pollTimeoutId = window.setTimeout( pollForClose, POPUP_POLL_INTERVAL );
        };

        const open = () => {
            popup = window.open( url, POPUP_NAME, 'width=200,height=300' );
            if ( !popup ) {
                settle( new MendixEmbeddedError( 'POPUP_BLOCKED' ) );
                return;
            }

            popup.focus?.();
            popupTimeoutId = window.setTimeout( () => {
                settle( new MendixEmbeddedError( 'POPUP_TIMEOUT' ) );
            }, POPUP_TIMEOUT );
            pollForClose();
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
