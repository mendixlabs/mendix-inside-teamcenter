import { mendixCleanupAll } from './mendixEmbeddedService';

export const MENDIX_LOGOUT_CONTRIBUTION_KEY = 'preLogoutPipeline';
export const MENDIX_LOGOUT_STEP_NAME = 'mendixLogout';

const mendixUrls = new Set();

/**
 * Remembers a Mendix application that has a session, so that it can be logged out before
 * Active Workspace ends the Teamcenter session.
 */
export const registerMendixLogout = ( url ) => {
    mendixUrls.add( url );
};

/**
 * Cleans up every mounted Mendix application and then logs out of every registered Mendix
 * application. Failures are logged, never rejected.
 *
 * @returns {Promise<void>} Settles when every logout request has finished.
 */
export const logoutFromMendix = async() => {
    mendixCleanupAll();

    const urls = Array.from( mendixUrls );
    mendixUrls.clear();

    await Promise.all( urls.map( logout ) );
};

/**
 * Logs out of a single Mendix application by sending a POST request to its logout endpoint.
 * Logs failures instead of rejecting, because the logout is not awaited by the pipeline step.
 *
 * @param {string} url The base URL of the Mendix application to log out from.
 * @returns {Promise<void>} Settles when the logout request has finished.
 */
const logout = async( url ) => {
    try {
        const response = await fetch( new URL( 'rest/tcsso/v1/logout', url ), {
            method: 'POST',
            mode: 'cors',
            credentials: 'include',
            // Lets the request complete if Active Workspace reloads the page during logout.
            keepalive: true
        } );

        if ( !response.ok ) {
            console.error( `Mendix logout at ${url} failed with status ${response.status}.` );
        }
    } catch ( error ) {
        console.error( `Mendix logout at ${url} failed.`, error );
    }
};

/**
 * Contributes the pre-logout pipeline step. The step starts the Mendix logouts and continues the
 * pipeline immediately, relying on keepalive to complete the requests. This way Mendix applications
 * without a logout endpoint, or that respond slowly, never delay the Teamcenter logout.
 */
export default ( _, deferred ) => {
    deferred.resolve( {
        getPipelineStepDefinition: () => ( {
            name: MENDIX_LOGOUT_STEP_NAME,
            active: true,
            workFunction: ( _, stepDeferred ) => {
                logoutFromMendix();
                stepDeferred.resolve();
            }
        } )
    } );
};
