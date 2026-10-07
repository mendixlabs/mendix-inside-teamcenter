import { MendixEmbeddedError } from './mendixEmbeddedUtils';

const POPUP_TIMEOUT = 2 * 60 * 1000;
const POPUP_POLL_INTERVAL = 200;
const POPUP_NAME = 'mxInTcSso';

/**
 * Signs in to Mendix through Teamcenter SSO in a popup. Used for Teamcenter releases that
 * cannot issue user access tokens.
 *
 * Flow:
 * 1. Open the Mendix SSO endpoint (`rest/tcsso/v1/login`) in a named popup, passing the
 *    Teamcenter session discriminator. If the window does not have focus, the popup is opened
 *    when it regains focus.
 * 2. The popup goes through Teamcenter SSO, after which the Mendix runtime sets its session
 *    cookie, and the SSO page closes the popup.
 * 3. The popup is on another origin, so its result cannot be read. Instead, `popup.closed` is
 *    polled, and the promise resolves once the popup is closed, whether by the SSO page or by
 *    the user.
 *
 * Resolving does not mean the sign-in succeeded, so the caller must validate the session
 * afterwards. Rejects with POPUP_BLOCKED when the popup cannot be opened, or with POPUP_TIMEOUT
 * when it is still open after two minutes. On a timeout or cancellation, the popup is closed.
 *
 * @param {string} url - Base URL of the Mendix application.
 * @param {string} discriminator - Teamcenter session discriminator.
 * @param {AbortSignal} [signal] - Cancels the sign-in and closes the popup.
 * @returns {Promise<void>} Resolves once the popup is closed.
 */
export const openLoginPopup = ( url, discriminator, signal ) => {
    const loginUrl = new URL( 'rest/tcsso/v1/login', url );
    loginUrl.searchParams.set( 'discriminator', discriminator );

    return openPopup( loginUrl, signal );
};

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
