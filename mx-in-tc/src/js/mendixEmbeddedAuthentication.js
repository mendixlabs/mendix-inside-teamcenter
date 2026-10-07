import { MendixEmbeddedError } from './mendixEmbeddedUtils';
import { openLoginPopup } from './mendixEmbeddedLoginPopup';
import { exchangeAccessToken, fetchUserAccessToken } from './mendixEmbeddedTokenExchange';

const TOKEN_EXCHANGE_MIN_TC_RELEASE = 2612;

export const ensureHasValidSession = async( url, tcServerVersion, signal ) => {
    signal?.throwIfAborted();

    if ( await hasValidSession( url, signal ) ) {
        return;
    }

    if ( requiresPopup( tcServerVersion ) ) {
        await authenticateWithPopup( url, signal );
    } else {
        await authenticateWithTokenExchange( url, signal );
    }
};

/**
 * Teamcenter releases before 2612 cannot issue user access tokens. The release is the number
 * after the prefix letter of the server version, for example 2612 in 'P2612.2026082800'.
 * Unknown versions use the token exchange.
 *
 * @param {string} [tcServerVersion] - Teamcenter server version.
 * @returns {boolean} Whether the release requires popup SSO.
 */
const requiresPopup = ( tcServerVersion ) =>
    Number.parseInt( tcServerVersion?.slice( 1 ), 10 ) < TOKEN_EXCHANGE_MIN_TC_RELEASE;

const authenticateWithPopup = async( url, signal ) => {
    const discriminator = await fetchSessionDiscriminator( signal );

    await openLoginPopup( url, discriminator, signal );

    if ( !await hasValidSession( url, signal ) ) {
        throw new MendixEmbeddedError( 'LOGIN_FAILED' );
    }
};

/**
 * The exchange responds with whether the session was created, so the session does not need
 * to be revalidated afterwards.
 *
 * @param {string} url - Base URL of the Mendix application.
 * @param {AbortSignal} [signal] - Cancels the sign-in.
 */
const authenticateWithTokenExchange = async( url, signal ) => {
    const [ token, discriminator ] = await Promise.all( [
        fetchUserAccessToken(),
        fetchSessionDiscriminator( signal )
    ] );

    signal?.throwIfAborted();

    if ( !token || !await exchangeAccessToken( url, token, discriminator, signal ) ) {
        throw new MendixEmbeddedError( 'LOGIN_FAILED' );
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

/**
 * Returns the session discriminator of the current Teamcenter session. Both sign-in flows send
 * it to the Mendix runtime as the `discriminator` query parameter.
 *
 * Teamcenter uses the combination of username and session discriminator to pick the server
 * instance for a client: a client whose combination matches an existing instance is assigned
 * to that instance, otherwise a new one is used. By creating its Teamcenter session with the
 * same discriminator, the Mendix runtime shares the server instance of this Active Workspace
 * session.
 *
 * When the discriminator is unavailable (an HTTP or network error, or an empty response),
 * a warning is logged and sign-in continues with an empty discriminator. The Mendix runtime
 * then shares a server instance with the user's other clients that use an empty
 * discriminator, instead of the instance of this Active Workspace session. Only a cancellation
 * rejects.
 *
 * @param {AbortSignal} [signal] - Cancels the request.
 * @returns {Promise<string>} The discriminator, or an empty string when it is unavailable.
 */
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
        // eslint-disable-next-line no-console -- Sign-in continues, so only warn.
        console.warn(
            'Session discriminator is unavailable; continuing with an empty discriminator.'
        );
        return '';
    }
};
