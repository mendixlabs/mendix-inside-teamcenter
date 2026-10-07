import soaService from 'soa/kernel/soaService';

/**
 * Returns the Teamcenter user access token for the current Teamcenter SSO session. This access token can be
 * exchanged for a Teamcenter session for the Mendix runtime. Returns undefined when the access token is unavailable.
 */
export const fetchUserAccessToken = async() => {
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

/**
 * Exchanges a Teamcenter user access token for a Mendix session, without any UI. Used for
 * Teamcenter 2612 and later.
 *
 * Flow:
 * 1. The caller gets the user access token (`fetchUserAccessToken`) and the session
 *    discriminator from Teamcenter.
 * 2. The token is POSTed in the JSON body to the Mendix endpoint `rest/tcsso/v1/login/token`,
 *    with the discriminator as a query parameter.
 * 3. The Mendix runtime exchanges the token with Teamcenter for the user information and a
 *    session key.
 * 4. The runtime retrieves the Mendix user that matches the user information, or provisions
 *    one if it does not exist yet.
 * 5. The runtime uses the session key and user ID to create a Teamcenter session for that
 *    Mendix user, and stores it with the user.
 * 6. The runtime creates the Mendix session and responds with `true`.
 *
 * Because the response already says whether the Mendix session was created, it does not need
 * to be validated again. Resolves to false for any response other than `true`, including HTTP
 * and network errors. Only a cancellation rejects.
 *
 * @param {string} url - Base URL of the Mendix application.
 * @param {string} token - Teamcenter user access token.
 * @param {string} discriminator - Teamcenter session discriminator.
 * @param {AbortSignal} [signal] - Cancels the request.
 * @returns {Promise<boolean>} Whether the Mendix session was created.
 */
export const exchangeAccessToken = async( url, token, discriminator, signal ) => {
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
