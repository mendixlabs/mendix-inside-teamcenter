/* eslint-env jest, node */
import './setupAbortSignal';
import soaService from 'soa/kernel/soaService';
import {
    exchangeAccessToken,
    fetchUserAccessToken
} from '../src/js/mendixEmbeddedTokenExchange';

jest.mock( 'soa/kernel/soaService', () => ( { post: jest.fn() } ) );

const APP_URL = 'https://apps.example.com/my-app/';
const TOKEN = 'test-access-token';

const exchangeResponse = ( status, body = '' ) => ( {
    ok: status === 200,
    status,
    text: async() => body
} );

describe( 'mendixEmbeddedTokenExchange', () => {
    const originalFetch = global.fetch;

    afterEach( () => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    } );

    describe( 'fetchUserAccessToken', () => {
        beforeEach( () => {
            soaService.post.mockReset();
        } );

        it( 'returns the trimmed token of the default client', async() => {
            soaService.post.mockResolvedValue( {
                clientUserAccessTokens: [
                    { clientID: 'another-client', token: 'wrong-client-token' },
                    { clientID: '', token: ` ${ TOKEN } ` }
                ]
            } );

            await expect( fetchUserAccessToken() ).resolves.toBe( TOKEN );
            expect( soaService.post ).toHaveBeenCalledWith(
                'Internal-Core-2026-12-Session',
                'getUserAccessTokens',
                {},
                {}
            );
        } );

        it.each( [
            undefined,
            {},
            { clientUserAccessTokens: [] },
            { clientUserAccessTokens: {} },
            {
                clientUserAccessTokens: [
                    { clientID: 'other', token: 'wrong-client-token' }
                ]
            },
            { clientUserAccessTokens: [ { clientID: '', token: 42 } ] },
            {
                serviceData: {
                    partialErrors: [ { clientId: '', errorValues: [ { code: 515361 } ] } ]
                }
            }
        ] )( 'returns no token for an unusable response: %p', async( response ) => {
            soaService.post.mockResolvedValue( response );

            await expect( fetchUserAccessToken() ).resolves.toBeUndefined();
        } );

        it( 'returns an empty token for a whitespace-only token', async() => {
            soaService.post.mockResolvedValue( {
                clientUserAccessTokens: [ { clientID: '', token: ' ' } ]
            } );

            await expect( fetchUserAccessToken() ).resolves.toBe( '' );
        } );

        it( 'returns no token when the SOA call fails', async() => {
            soaService.post.mockRejectedValue( new Error( 'Token service unavailable' ) );

            await expect( fetchUserAccessToken() ).resolves.toBeUndefined();
        } );
    } );

    describe( 'exchangeAccessToken', () => {
        it( 'posts the token in the body and the discriminator in the query', async() => {
            const controller = new AbortController();
            const token = 'test/token+with?special=&characters';
            global.fetch = jest.fn().mockResolvedValue( exchangeResponse( 200 ) );

            await expect(
                exchangeAccessToken( APP_URL, token, 'session/1+2', controller.signal )
            ).resolves.toBe( true );

            const [ tokenUrl, options ] = global.fetch.mock.calls[0];
            expect( tokenUrl.toString() ).toBe(
                'https://apps.example.com/my-app/rest/mx-in-aw/v1/token-login?discriminator=session%2F1%2B2'
            );
            expect( tokenUrl.searchParams.has( 'token' ) ).toBe( false );
            expect( options ).toEqual( {
                method: 'POST',
                headers: { Accept: 'text/plain', 'Content-Type': 'application/json' },
                body: JSON.stringify( { token } ),
                mode: 'cors',
                credentials: 'include',
                signal: controller.signal
            } );
        } );

        it.each( [
            [ 'HTTP 500', () => Promise.resolve( exchangeResponse( 500, 'Invalid token' ) ) ],
            [ 'HTTP 401', () => Promise.resolve( exchangeResponse( 401 ) ) ],
            [ 'a network error', () => Promise.reject( new TypeError( 'Failed to fetch' ) ) ]
        ] )( 'reports no session when the exchange returns %s', async( _description, response ) => {
            global.fetch = jest.fn().mockImplementation( response );

            await expect(
                exchangeAccessToken( APP_URL, TOKEN, '' )
            ).resolves.toBe( false );
        } );

        it( 'propagates the abort reason', async() => {
            const controller = new AbortController();
            global.fetch = jest.fn().mockImplementation(
                ( _url, { signal } ) =>
                    new Promise( ( _resolve, reject ) => {
                        signal.addEventListener(
                            'abort',
                            () => reject( new DOMException( 'Aborted', 'AbortError' ) ),
                            { once: true }
                        );
                    } )
            );
            const pending = exchangeAccessToken(
                APP_URL,
                TOKEN,
                '',
                controller.signal
            );

            controller.abort();

            await expect( pending ).rejects.toBe( controller.signal.reason );
        } );
    } );
} );
