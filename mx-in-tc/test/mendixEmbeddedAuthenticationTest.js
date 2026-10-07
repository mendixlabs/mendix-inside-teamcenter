/* eslint-env jest, node */
import './setupAbortSignal';
import { waitFor } from '@testing-library/react';
import soaService from 'soa/kernel/soaService';
import { ensureHasValidSession } from '../src/js/mendixEmbeddedAuthentication';

jest.mock( 'soa/kernel/soaService', () => ( { post: jest.fn() } ) );

const TOKEN_EXCHANGE_VERSION = 'P2612.2026082800';
const POPUP_VERSION = 'P2512.2025082800';

const sessionResponse = ( valid ) => ( {
    ok: true,
    status: 200,
    json: async() => valid
} );

describe( 'mendixEmbeddedAuthentication', () => {
    const originalFetch = global.fetch;
    const originalWindowOpen = window.open;

    afterEach( () => {
        global.fetch = originalFetch;
        window.open = originalWindowOpen;
        jest.restoreAllMocks();
        jest.useRealTimers();
    } );

    describe( 'ensureHasValidSession', () => {
        beforeEach( () => {
            soaService.post
                .mockReset()
                .mockRejectedValue( new Error( 'Token service unavailable' ) );
        } );

        describe( 'authentication method selection', () => {
            beforeEach( () => {
                soaService.post.mockResolvedValue( {
                    clientUserAccessTokens: [ { clientID: '', token: 'test-access-token' } ]
                } );
                jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
                window.open = jest.fn().mockReturnValue( { closed: true } );
                global.fetch = jest.fn().mockImplementation( async( url ) => {
                    if ( url === '/getSessionDiscriminator' ) {
                        return { ok: true, text: async() => 'current-session' };
                    }
                    if ( url.pathname === '/rest/tcsso/v1/login/token' ) {
                        return sessionResponse( true );
                    }
                    return sessionResponse( global.fetch.mock.calls.length > 1 );
                } );
            } );

            it.each( [
                'P2612.2026082800',
                'P2612.0',
                'P2701.2027010100',
                'V3012.2030120100',
                'unknown',
                'P',
                '',
                undefined
            ] )( 'uses only the token exchange for Teamcenter %p', async( version ) => {
                await ensureHasValidSession( 'https://apps.example.com/', version );

                expect( soaService.post ).toHaveBeenCalledTimes( 1 );
                expect(
                    global.fetch.mock.calls.map( ( [ url ] ) => url.pathname || url )
                ).toEqual( [
                    '/rest/tcsso/v1/validate-session',
                    '/getSessionDiscriminator',
                    '/rest/tcsso/v1/login/token'
                ] );
                expect( window.open ).not.toHaveBeenCalled();
            } );

            it.each( [
                'P2512.2025082800',
                'P2611.2026072800',
                'P2312.2023120100'
            ] )( 'uses only popup SSO for Teamcenter %s', async( version ) => {
                await ensureHasValidSession( 'https://apps.example.com/', version );

                expect( soaService.post ).not.toHaveBeenCalled();
                expect(
                    global.fetch.mock.calls.map( ( [ url ] ) => url.pathname || url )
                ).toEqual( [
                    '/rest/tcsso/v1/validate-session',
                    '/getSessionDiscriminator',
                    '/rest/tcsso/v1/validate-session'
                ] );
                expect( window.open ).toHaveBeenCalledTimes( 1 );
            } );
        } );

        describe( 'access-token authentication', () => {
            beforeEach( () => {
                soaService.post.mockResolvedValue( {
                    clientUserAccessTokens: [
                        { clientID: '', token: 'test-access-token' }
                    ]
                } );
                window.open = jest.fn();
            } );

            it( 'fetches the token and discriminator concurrently and trusts the exchange result', async() => {
                let finishInitialValidation;
                let finishSoa;
                let finishDiscriminator;
                let finishExchange;
                soaService.post.mockImplementation(
                    () =>
                        new Promise( ( resolve ) => {
                            finishSoa = resolve;
                        } )
                );
                global.fetch = jest
                    .fn()
                    .mockImplementationOnce(
                        () =>
                            new Promise( ( resolve ) => {
                                finishInitialValidation = resolve;
                            } )
                    )
                    .mockImplementationOnce(
                        () =>
                            new Promise( ( resolve ) => {
                                finishDiscriminator = resolve;
                            } )
                    )
                    .mockImplementationOnce(
                        () =>
                            new Promise( ( resolve ) => {
                                finishExchange = resolve;
                            } )
                    );
                const controller = new AbortController();
                const pending = ensureHasValidSession(
                    'https://apps.example.com/my-app/',
                    TOKEN_EXCHANGE_VERSION,
                    controller.signal
                );

                expect( soaService.post ).not.toHaveBeenCalled();
                expect( global.fetch.mock.calls[0][0].pathname ).toBe(
                    '/my-app/rest/tcsso/v1/validate-session'
                );
                finishInitialValidation( sessionResponse( false ) );
                await waitFor( () =>
                    expect( soaService.post ).toHaveBeenCalledWith(
                        'Internal-Core-2026-12-Session',
                        'getUserAccessTokens',
                        {},
                        {}
                    )
                );
                expect( global.fetch ).toHaveBeenCalledTimes( 2 );
                expect( global.fetch.mock.calls[1] ).toEqual( [
                    '/getSessionDiscriminator',
                    { signal: controller.signal, headers: { Accept: 'text/plain' } }
                ] );
                const token = 'test/token+with?special=&characters';
                finishSoa( {
                    clientUserAccessTokens: [
                        { clientID: 'another-client', token: 'wrong-client-token' },
                        { clientID: '', token }
                    ]
                } );
                await Promise.resolve();
                expect( global.fetch ).toHaveBeenCalledTimes( 2 );
                finishDiscriminator( { ok: true, text: async() => 'session/1+2' } );
                await waitFor( () => expect( global.fetch ).toHaveBeenCalledTimes( 3 ) );

                const [ tokenUrl, options ] = global.fetch.mock.calls[2];
                expect( tokenUrl.toString() ).toBe(
                    'https://apps.example.com/my-app/rest/tcsso/v1/login/token?discriminator=session%2F1%2B2'
                );
                expect( options ).toEqual( {
                    method: 'POST',
                    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                    body: JSON.stringify( { token } ),
                    mode: 'cors',
                    credentials: 'include',
                    signal: controller.signal
                } );
                finishExchange( sessionResponse( true ) );
                await pending;

                expect( global.fetch.mock.calls.map( ( [ url ] ) => url.toString() ) ).toEqual( [
                    'https://apps.example.com/my-app/rest/tcsso/v1/validate-session',
                    '/getSessionDiscriminator',
                    tokenUrl.toString()
                ] );
                expect( window.open ).not.toHaveBeenCalled();
            } );

            it.each( [
                [ 'no token', () => Promise.resolve( { clientUserAccessTokens: [] } ) ],
                [ 'a failed SOA call', () => Promise.reject( new Error( 'Unavailable' ) ) ]
            ] )(
                'reports a failed login without exchanging when the token service returns %s',
                async( _description, tokenResponse ) => {
                    soaService.post.mockImplementation( tokenResponse );
                    global.fetch = jest
                        .fn()
                        .mockResolvedValueOnce( sessionResponse( false ) )
                        .mockResolvedValueOnce( {
                            ok: true,
                            text: async() => 'current-session'
                        } );

                    await expect(
                        ensureHasValidSession( 'https://apps.example.com/', TOKEN_EXCHANGE_VERSION )
                    ).rejects.toMatchObject( { code: 'LOGIN_FAILED' } );

                    expect( soaService.post ).toHaveBeenCalledTimes( 1 );
                    expect(
                        global.fetch.mock.calls.map( ( [ url ] ) => url.pathname || url )
                    ).toEqual( [
                        '/rest/tcsso/v1/validate-session',
                        '/getSessionDiscriminator'
                    ] );
                    expect( window.open ).not.toHaveBeenCalled();
                }
            );

            it.each( [
                [ 'false', () => Promise.resolve( sessionResponse( false ) ) ],
                [ 'a network error', () => Promise.reject( new TypeError( 'Failed to fetch' ) ) ]
            ] )(
                'reports a failed login without revalidating or popup SSO when the exchange returns %s',
                async( _description, exchangeResponse ) => {
                    global.fetch = jest
                        .fn()
                        .mockResolvedValueOnce( sessionResponse( false ) )
                        .mockResolvedValueOnce( {
                            ok: true,
                            text: async() => 'current-session'
                        } )
                        .mockImplementationOnce( exchangeResponse );

                    await expect(
                        ensureHasValidSession( 'https://apps.example.com/', TOKEN_EXCHANGE_VERSION )
                    ).rejects.toMatchObject( { code: 'LOGIN_FAILED' } );

                    expect( window.open ).not.toHaveBeenCalled();
                    expect( global.fetch ).toHaveBeenCalledTimes( 3 );
                    expect( global.fetch.mock.calls[2][0].pathname ).toBe(
                        '/rest/tcsso/v1/login/token'
                    );
                }
            );

            it( 'does not start authentication for an already cancelled load', async() => {
                const controller = new AbortController();
                controller.abort();
                global.fetch = jest.fn();

                await expect(
                    ensureHasValidSession(
                        'https://apps.example.com/',
                        TOKEN_EXCHANGE_VERSION,
                        controller.signal
                    )
                ).rejects.toBe( controller.signal.reason );

                expect( soaService.post ).not.toHaveBeenCalled();
                expect( global.fetch ).not.toHaveBeenCalled();
                expect( window.open ).not.toHaveBeenCalled();
            } );

            it( 'ignores a token returned after the load is cancelled', async() => {
                let finishSoa;
                soaService.post.mockImplementation(
                    () =>
                        new Promise( ( resolve ) => {
                            finishSoa = resolve;
                        } )
                );
                const controller = new AbortController();
                global.fetch = jest
                    .fn()
                    .mockResolvedValueOnce( sessionResponse( false ) )
                    .mockResolvedValueOnce( {
                        ok: true,
                        text: async() => 'current-session'
                    } );
                const pending = ensureHasValidSession(
                    'https://apps.example.com/',
                    TOKEN_EXCHANGE_VERSION,
                    controller.signal
                );
                await waitFor( () => expect( finishSoa ).toBeDefined() );
                controller.abort();
                finishSoa( {
                    clientUserAccessTokens: [ { clientID: '', token: 'late-token' } ]
                } );

                await expect( pending ).rejects.toBe( controller.signal.reason );
                expect( global.fetch ).toHaveBeenCalledTimes( 2 );
                expect( window.open ).not.toHaveBeenCalled();
            } );

            it.each( [
                'http-error',
                'network-error',
                'body-error',
                'empty',
                'whitespace'
            ] )(
                'continues the token exchange with an empty discriminator on %s',
                async( failure ) => {
                    const warn = jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
                    const isTokenExchange = ( [ url ] ) =>
                        url.pathname === '/rest/tcsso/v1/login/token';
                    global.fetch = jest.fn().mockImplementation( async( url ) => {
                        if ( url === '/getSessionDiscriminator' ) {
                            if ( failure === 'network-error' ) {
                                throw new TypeError( 'Failed to fetch' );
                            }
                            return {
                                ok: failure !== 'http-error',
                                text: async() => {
                                    if ( failure === 'body-error' ) {
                                        throw new Error( 'Could not read response' );
                                    }
                                    return failure === 'whitespace' ? '  ' : '';
                                }
                            };
                        }
                        return sessionResponse( global.fetch.mock.calls.some( isTokenExchange ) );
                    } );

                    await ensureHasValidSession( 'https://apps.example.com/', TOKEN_EXCHANGE_VERSION );

                    expect( global.fetch ).toHaveBeenCalledTimes( 3 );
                    const [ tokenUrl, tokenOptions ] = global.fetch.mock.calls.find( isTokenExchange );
                    expect( tokenUrl.searchParams.get( 'discriminator' ) ).toBe( '' );
                    expect( tokenUrl.searchParams.has( 'token' ) ).toBe( false );
                    expect( JSON.parse( tokenOptions.body ) ).toEqual( {
                        token: 'test-access-token'
                    } );
                    expect( window.open ).not.toHaveBeenCalled();
                    expect( warn ).toHaveBeenCalledTimes( 1 );
                    expect( warn ).toHaveBeenCalledWith(
                        expect.stringContaining( 'Session discriminator is unavailable' )
                    );
                }
            );

            it( 'propagates discriminator cancellation while the SOA call is pending', async() => {
                soaService.post.mockImplementation( () => new Promise( () => {} ) );
                const warn = jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
                global.fetch = jest
                    .fn()
                    .mockResolvedValueOnce( sessionResponse( false ) )
                    .mockImplementationOnce(
                        ( _url, { signal } ) =>
                            new Promise( ( _resolve, reject ) => {
                                signal.addEventListener(
                                    'abort',
                                    () => reject( new DOMException( 'Aborted', 'AbortError' ) ),
                                    { once: true }
                                );
                            } )
                    );
                const controller = new AbortController();
                const pending = ensureHasValidSession(
                    'https://apps.example.com/',
                    TOKEN_EXCHANGE_VERSION,
                    controller.signal
                );
                const rejected = expect( pending ).rejects.toMatchObject( {
                    name: 'AbortError'
                } );
                await waitFor( () => expect( global.fetch ).toHaveBeenCalledTimes( 2 ) );
                controller.abort();

                await rejected;
                expect( global.fetch ).toHaveBeenCalledTimes( 2 );
                expect( window.open ).not.toHaveBeenCalled();
                expect( warn ).not.toHaveBeenCalled();
            } );

            it( 'aborts an in-flight token exchange without revalidating or opening a popup', async() => {
                global.fetch = jest
                    .fn()
                    .mockResolvedValueOnce( sessionResponse( false ) )
                    .mockResolvedValueOnce( {
                        ok: true,
                        text: async() => 'current-session'
                    } )
                    .mockImplementationOnce(
                        ( _url, { signal } ) =>
                            new Promise( ( _resolve, reject ) => {
                                signal.addEventListener(
                                    'abort',
                                    () => reject( new DOMException( 'Aborted', 'AbortError' ) ),
                                    { once: true }
                                );
                            } )
                    );
                const controller = new AbortController();
                const pending = ensureHasValidSession(
                    'https://apps.example.com/',
                    TOKEN_EXCHANGE_VERSION,
                    controller.signal
                );
                const rejected = expect( pending ).rejects.toMatchObject( {
                    name: 'AbortError'
                } );
                await waitFor( () => expect( global.fetch ).toHaveBeenCalledTimes( 3 ) );
                controller.abort();

                await rejected;
                expect( global.fetch ).toHaveBeenCalledTimes( 3 );
                expect( window.open ).not.toHaveBeenCalled();
            } );
        } );

        it.each( [ TOKEN_EXCHANGE_VERSION, POPUP_VERSION ] )(
            'skips authentication on Teamcenter %s when the session is already valid',
            async( version ) => {
                global.fetch = jest.fn().mockResolvedValue( {
                    ok: true,
                    status: 200,
                    json: jest.fn().mockResolvedValue( true )
                } );
                window.open = jest.fn();

                await ensureHasValidSession( 'https://apps.example.com/', version );

                expect( global.fetch ).toHaveBeenCalledTimes( 1 );
                expect( global.fetch.mock.calls[0][0].pathname ).toBe(
                    '/rest/tcsso/v1/validate-session'
                );
                expect( soaService.post ).not.toHaveBeenCalled();
                expect( window.open ).not.toHaveBeenCalled();
            }
        );

        it.each( [ 404, 500, 502, 503 ] )(
            'reports an unavailable runtime on HTTP %s without starting SSO',
            async( status ) => {
                global.fetch = jest.fn().mockResolvedValue( {
                    ok: false,
                    status
                } );
                window.open = jest.fn();

                await expect(
                    ensureHasValidSession( 'https://apps.example.com/', POPUP_VERSION )
                ).rejects.toEqual(
                    expect.objectContaining( {
                        code: 'MENDIX_NOT_FOUND'
                    } )
                );
                expect( global.fetch ).toHaveBeenCalledTimes( 1 );
                expect( soaService.post ).not.toHaveBeenCalled();
                expect( window.open ).not.toHaveBeenCalled();
            }
        );

        it( 'reports an unavailable runtime on a network failure without starting SSO', async() => {
            global.fetch = jest
                .fn()
                .mockRejectedValue( new TypeError( 'Failed to fetch' ) );
            window.open = jest.fn();

            await expect(
                ensureHasValidSession( 'https://apps.example.com/', POPUP_VERSION )
            ).rejects.toMatchObject( { code: 'MENDIX_NOT_FOUND' } );
            expect( global.fetch ).toHaveBeenCalledTimes( 1 );
            expect( soaService.post ).not.toHaveBeenCalled();
            expect( window.open ).not.toHaveBeenCalled();
        } );

        it( 'reports an unavailable validation endpoint when the response is not JSON', async() => {
            global.fetch = jest.fn().mockResolvedValue( {
                ok: true,
                status: 200,
                json: jest
                    .fn()
                    .mockRejectedValue( new SyntaxError( 'Unexpected HTML response' ) )
            } );
            window.open = jest.fn();

            await expect(
                ensureHasValidSession( 'https://apps.example.com/', POPUP_VERSION )
            ).rejects.toMatchObject( { code: 'MENDIX_NOT_FOUND' } );
            expect( global.fetch ).toHaveBeenCalledTimes( 1 );
            expect( window.open ).not.toHaveBeenCalled();
        } );

        it.each( [ null, {}, 'false' ] )(
            'rejects an unexpected validation payload: %p',
            async( payload ) => {
                global.fetch = jest.fn().mockResolvedValue( {
                    ok: true,
                    status: 200,
                    json: async() => payload
                } );
                window.open = jest.fn();

                await expect(
                    ensureHasValidSession( 'https://apps.example.com/', POPUP_VERSION )
                ).rejects.toMatchObject( { code: 'MENDIX_NOT_FOUND' } );
                expect( global.fetch ).toHaveBeenCalledTimes( 1 );
                expect( window.open ).not.toHaveBeenCalled();
            }
        );

        it.each( [ 401, 403 ] )(
            'starts popup SSO for HTTP %s authentication failures',
            async( status ) => {
                global.fetch = jest
                    .fn()
                    .mockResolvedValueOnce( { ok: false, status } )
                    .mockResolvedValueOnce( {
                        ok: true,
                        text: async() => 'test-discriminator'
                    } );
                jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
                window.open = jest.fn().mockReturnValue( null );

                await expect(
                    ensureHasValidSession( 'https://apps.example.com/', POPUP_VERSION )
                ).rejects.toMatchObject( { code: 'POPUP_BLOCKED' } );
                expect( soaService.post ).not.toHaveBeenCalled();
                expect( global.fetch ).toHaveBeenCalledTimes( 2 );
                expect( window.open ).toHaveBeenCalledTimes( 1 );
            }
        );

        it( 'reports a blocked login popup', async() => {
            global.fetch = jest
                .fn()
                .mockResolvedValueOnce( {
                    ok: true,
                    status: 200,
                    json: async() => false
                } )
                .mockResolvedValueOnce( {
                    ok: true,
                    text: async() => 'session-discriminator'
                } );
            jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
            window.open = jest.fn().mockReturnValue( null );

            await expect(
                ensureHasValidSession( 'https://apps.example.com/', POPUP_VERSION )
            ).rejects.toEqual(
                expect.objectContaining( {
                    code: 'POPUP_BLOCKED'
                } )
            );
            expect( window.open ).toHaveBeenCalledWith(
                expect.any( URL ),
                'mxInTcSso',
                'width=200,height=300'
            );
            expect( window.open.mock.calls[0][0].toString() ).toBe(
                'https://apps.example.com/rest/tcsso/v1/login?discriminator=session-discriminator'
            );
        } );

        it( 'opens popup SSO with an empty discriminator when it is unavailable', async() => {
            const warn = jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
            global.fetch = jest
                .fn()
                .mockResolvedValueOnce( { ok: true, status: 200, json: async() => false } )
                .mockResolvedValueOnce( { ok: false } )
                .mockResolvedValueOnce( { ok: true, status: 200, json: async() => true } );
            jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
            window.open = jest.fn().mockReturnValue( { closed: true } );

            await ensureHasValidSession( 'https://apps.example.com/', POPUP_VERSION );

            expect(
                window.open.mock.calls[0][0].searchParams.get( 'discriminator' )
            ).toBe( '' );
            expect( warn ).toHaveBeenCalledTimes( 1 );
        } );

        describe( 'sign-in lifecycle', () => {
            let popup;
            const closePopupByUser = () => {
                popup.closed = true;
            };

            beforeEach( () => {
                jest.useFakeTimers();
                jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
                popup = { closed: false, close: jest.fn(), focus: jest.fn() };
                popup.close.mockImplementation( closePopupByUser );
                window.open = jest.fn().mockReturnValue( popup );
                global.fetch = jest
                    .fn()
                    .mockResolvedValueOnce( sessionResponse( false ) )
                    .mockResolvedValueOnce( {
                        ok: true,
                        text: async() => 'test-discriminator'
                    } );
            } );

            it( 'focuses the popup and validates the session once after it closes', async() => {
                global.fetch.mockResolvedValueOnce( sessionResponse( true ) );
                const pending = ensureHasValidSession( 'https://apps.example.com/', POPUP_VERSION );
                await waitFor( () => expect( window.open ).toHaveBeenCalledTimes( 1 ) );
                expect( popup.focus ).toHaveBeenCalled();

                await jest.advanceTimersByTimeAsync( 1000 );
                expect( global.fetch ).toHaveBeenCalledTimes( 2 );

                closePopupByUser();
                await jest.advanceTimersByTimeAsync( 200 );
                await pending;
                expect( global.fetch ).toHaveBeenCalledTimes( 3 );
                expect( global.fetch.mock.calls[2][0].pathname ).toBe(
                    '/rest/tcsso/v1/validate-session'
                );
                expect( popup.close ).not.toHaveBeenCalled();
                expect( jest.getTimerCount() ).toBe( 0 );
            } );

            it( 'reports a failed login when the popup closes without a valid session', async() => {
                global.fetch.mockResolvedValueOnce( sessionResponse( false ) );
                const pending = ensureHasValidSession( 'https://apps.example.com/', POPUP_VERSION );
                const rejected = expect( pending ).rejects.toMatchObject( {
                    code: 'LOGIN_FAILED'
                } );
                await waitFor( () => expect( window.open ).toHaveBeenCalledTimes( 1 ) );
                closePopupByUser();
                await jest.advanceTimersByTimeAsync( 200 );
                await rejected;
                expect( global.fetch ).toHaveBeenCalledTimes( 3 );
                expect( jest.getTimerCount() ).toBe( 0 );
            } );

            it( 'reports a popup timeout without revalidating the session', async() => {
                const pending = ensureHasValidSession( 'https://apps.example.com/', POPUP_VERSION );
                const rejected = expect( pending ).rejects.toMatchObject( {
                    code: 'POPUP_TIMEOUT'
                } );
                await waitFor( () => expect( window.open ).toHaveBeenCalledTimes( 1 ) );
                await jest.advanceTimersByTimeAsync( 2 * 60 * 1000 );
                await rejected;
                expect( global.fetch ).toHaveBeenCalledTimes( 2 );
            } );

            it( 'closes the popup and propagates the abort signal when cancelled', async() => {
                const controller = new AbortController();
                const pending = ensureHasValidSession(
                    'https://apps.example.com/',
                    POPUP_VERSION,
                    controller.signal
                );
                const rejected = expect( pending ).rejects.toMatchObject( {
                    name: 'AbortError'
                } );
                await waitFor( () => expect( window.open ).toHaveBeenCalledTimes( 1 ) );
                controller.abort();
                await rejected;
                expect( popup.close ).toHaveBeenCalledTimes( 1 );
                expect( global.fetch ).toHaveBeenCalledTimes( 2 );
                expect( jest.getTimerCount() ).toBe( 0 );
            } );

            it( 'does not turn an aborted validation request into a new login flow', async() => {
                const controller = new AbortController();
                global.fetch.mockReset().mockImplementation(
                    ( _url, { signal } ) =>
                        new Promise( ( _resolve, reject ) => {
                            signal.addEventListener(
                                'abort',
                                () => reject( new DOMException( 'Aborted', 'AbortError' ) ),
                                { once: true }
                            );
                        } )
                );
                const pending = ensureHasValidSession(
                    'https://apps.example.com/',
                    POPUP_VERSION,
                    controller.signal
                );
                await waitFor( () => expect( global.fetch ).toHaveBeenCalledTimes( 1 ) );
                controller.abort();
                await expect( pending ).rejects.toBe( controller.signal.reason );
                expect( global.fetch ).toHaveBeenCalledTimes( 1 );
                expect( window.open ).not.toHaveBeenCalled();
            } );
        } );
    } );
} );
