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
 * Logs out of every registered Mendix application.
 *
 * @returns {Promise<boolean>} Resolves with true when every logout succeeded. Never rejects.
 */
export const logoutFromMendix = async() => {
    const urls = Array.from( mendixUrls );
    mendixUrls.clear();

    const results = await Promise.all( urls.map( logout ) );
    return results.every( Boolean );
};

/**
 * Logs out of a single Mendix application by sending a POST request to its logout endpoint.
 * 
 * @param {string} url The base URL of the Mendix application to log out from.
 * @returns {Promise<boolean>} Resolves with true if the logout succeeded, false otherwise.
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
        return response.ok;
    } catch ( error ) {
        console.error( `Mendix logout at ${url} failed.`, error );
        return false;
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
