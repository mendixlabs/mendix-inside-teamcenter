/* eslint-env jest, node */
import './setupAbortSignal';
import { waitFor } from '@testing-library/react';
import soaService from 'soa/kernel/soaService';
import {
    ensureHasValidSession,
    getMendixContextPaths,
    getResolvedMendixConfiguration,
    MendixEmbeddedError
} from '../src/js/mendixEmbeddedUtils';

jest.mock( 'soa/kernel/soaService', () => ( { post: jest.fn() } ) );

describe( 'mendixEmbeddedUtils', () => {
    const originalFetch = global.fetch;
    const originalWindowOpen = window.open;

    afterEach( () => {
        global.fetch = originalFetch;
        window.open = originalWindowOpen;
        jest.restoreAllMocks();
        jest.useRealTimers();
    } );

    describe( 'getResolvedMendixConfiguration', () => {
        it( 'normalizes the URL and resolves mapped parameter values', () => {
            const result = getResolvedMendixConfiguration(
                'https://apps.example.com/my-app?uid={selection.uid}&count=5&enabled=true&label=plain#section',
                { selection: { uid: 'UID-123' } }
            );

            expect( result ).toEqual( {
                url: 'https://apps.example.com/my-app/',
                parameters: {
                    uid: 'UID-123',
                    count: 5,
                    enabled: true,
                    label: 'plain'
                },
                configurationKey: JSON.stringify( {
                    url: 'https://apps.example.com/my-app/',
                    parameters: {
                        uid: 'UID-123',
                        count: 5,
                        enabled: true,
                        label: 'plain'
                    }
                } )
            } );
        } );

        it.each( [
            [ undefined, 'MISSING_CONFIGURATION' ],
            [ 'not a URL', 'INVALID_URL' ],
            [ 'file:///app', 'INVALID_URL' ],
            // eslint-disable-next-line no-script-url -- Verify that executable URLs are rejected.
            [ 'javascript:alert(1)', 'INVALID_URL' ]
        ] )( 'reports invalid configuration', ( config, expectedCode ) => {
            expect( () => getResolvedMendixConfiguration( config, {} ) ).toThrow(
                expect.objectContaining( {
                    name: 'MendixEmbeddedError',
                    code: expectedCode
                } )
            );
        } );

        it( 'rejects a circular model object before serializing parameters', () => {
            const selected = { uid: 'A' };
            selected.self = selected;
            expect( () =>
                getResolvedMendixConfiguration(
                    'https://apps.example.com/?item={selected}',
                    { selected }
                )
            ).toThrow( expect.objectContaining( { code: 'INVALID_PARAMETER' } ) );
        } );

        it( 'preserves missing fields and quoted string literals', () => {
            const result = getResolvedMendixConfiguration(
                'https://apps.example.com/?uid={selected.uid}&text=%22true%22',
                {}
            );
            expect( result.parameters ).toEqual( { uid: undefined, text: 'true' } );
        } );
    } );

    describe( 'getMendixContextPaths', () => {
        it( 'returns unique context paths and excludes literal values', () => {
            const paths = getMendixContextPaths(
                'https://apps.example.com/?first={selection.uid}&second={selection.uid}&mode=edit'
            );

            expect( paths ).toEqual( [ 'selection.uid' ] );
        } );
    } );

    describe( 'ensureHasValidSession', () => {
        beforeEach( () => {
            soaService.post
                .mockReset()
                .mockRejectedValue( new Error( 'Token service unavailable' ) );
        } );

        describe( 'access-token authentication', () => {
            const sessionResponse = ( valid ) => ( {
                ok: true,
                status: 200,
                json: async() => valid
            } );

            beforeEach( () => {
                soaService.post.mockResolvedValue( {
                    clientUserAccessTokens: [
                        { clientID: '', token: 'test-access-token' }
                    ]
                } );
                window.open = jest.fn();
            } );

            it( 'fetches the token and discriminator concurrently before exchanging and revalidating', async() => {
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
                    )
                    .mockResolvedValueOnce( sessionResponse( true ) );
                const controller = new AbortController();
                const pending = ensureHasValidSession(
                    'https://apps.example.com/my-app/',
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
                    'https://apps.example.com/my-app/rest/tcsso/v1/login/token?discriminator=session%2F1%2B2&token=test%2Ftoken%2Bwith%3Fspecial%3D%26characters'
                );
                expect( options ).toEqual( {
                    method: 'GET',
                    headers: { Accept: '*/*' },
                    mode: 'cors',
                    credentials: 'include',
                    signal: controller.signal
                } );
                finishExchange( { ok: true, status: 204 } );
                await pending;

                expect( global.fetch.mock.calls.map( ( [ url ] ) => url.toString() ) ).toEqual( [
                    'https://apps.example.com/my-app/rest/tcsso/v1/validate-session',
                    '/getSessionDiscriminator',
                    tokenUrl.toString(),
                    'https://apps.example.com/my-app/rest/tcsso/v1/validate-session'
                ] );
                expect( global.fetch.mock.calls[3][1] ).toEqual( {
                    credentials: 'include',
                    signal: controller.signal
                } );
                expect( window.open ).not.toHaveBeenCalled();
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
                { clientUserAccessTokens: [ { clientID: '', token: ' ' } ] },
                { clientUserAccessTokens: [ { clientID: '', token: 42 } ] },
                {
                    serviceData: {
                        partialErrors: [ { clientId: '', errorValues: [ { code: 515361 } ] } ]
                    }
                }
            ] )(
                'validates the existing session without exchanging an unusable token: %p',
                async( response ) => {
                    soaService.post.mockResolvedValue( response );
                    global.fetch = jest
                        .fn()
                        .mockResolvedValueOnce( sessionResponse( false ) )
                        .mockResolvedValueOnce( {
                            ok: true,
                            text: async() => 'current-session'
                        } )
                        .mockResolvedValueOnce( sessionResponse( true ) );

                    await ensureHasValidSession( 'https://apps.example.com/' );

                    expect( soaService.post ).toHaveBeenCalledTimes( 1 );
                    expect(
                        global.fetch.mock.calls.map( ( [ url ] ) => url.pathname || url )
                    ).toEqual( [
                        '/rest/tcsso/v1/validate-session',
                        '/getSessionDiscriminator',
                        '/rest/tcsso/v1/validate-session'
                    ] );
                    expect( window.open ).not.toHaveBeenCalled();
                }
            );

            it.each( [ 200, 401, 500, 'network-error' ] )(
                'retains popup SSO when the exchange (%s) does not establish a session',
                async( status ) => {
                    const discriminatorResponse = {
                        ok: true,
                        text: async() => 'current-session'
                    };
                    global.fetch = jest
                        .fn()
                        .mockResolvedValueOnce( sessionResponse( false ) )
                        .mockResolvedValueOnce( discriminatorResponse );
                    if ( status === 'network-error' ) {
                        global.fetch.mockRejectedValueOnce(
                            new TypeError( 'Failed to fetch' )
                        );
                    } else {
                        global.fetch.mockResolvedValueOnce( { ok: status === 200, status } );
                    }
                    global.fetch
                        .mockResolvedValueOnce( sessionResponse( false ) )
                        .mockResolvedValueOnce( discriminatorResponse )
                        .mockResolvedValueOnce( sessionResponse( true ) );
                    jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
                    window.open.mockReturnValue( {} );

                    await ensureHasValidSession( 'https://apps.example.com/' );

                    expect( window.open ).toHaveBeenCalledTimes( 1 );
                    expect( window.open.mock.calls[0][0].toString() ).toBe(
                        'https://apps.example.com/rest/tcsso/v1/login?discriminator=current-session'
                    );
                    expect( global.fetch ).toHaveBeenCalledTimes( 6 );
                }
            );

            it( 'does not start authentication for an already cancelled load', async() => {
                const controller = new AbortController();
                controller.abort();
                global.fetch = jest.fn();

                await expect(
                    ensureHasValidSession( 'https://apps.example.com/', controller.signal )
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
                'continues token exchange and popup SSO with an empty discriminator on %s',
                async( failure ) => {
                    const warn = jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
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
                        return sessionResponse( window.open.mock.calls.length > 0 );
                    } );
                    jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
                    window.open.mockReturnValue( {} );

                    await ensureHasValidSession( 'https://apps.example.com/' );

                    const tokenUrl = global.fetch.mock.calls.find(
                        ( [ url ] ) => url.pathname === '/rest/tcsso/v1/login/token'
                    )[0];
                    expect( tokenUrl.searchParams.get( 'discriminator' ) ).toBe( '' );
                    expect( tokenUrl.searchParams.get( 'token' ) ).toBe( 'test-access-token' );
                    expect(
                        window.open.mock.calls[0][0].searchParams.get( 'discriminator' )
                    ).toBe( '' );
                    expect( warn ).toHaveBeenCalledTimes( 2 );
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

        it( 'skips token authentication and popup SSO when the session is already valid', async() => {
            global.fetch = jest.fn().mockResolvedValue( {
                ok: true,
                status: 200,
                json: jest.fn().mockResolvedValue( true )
            } );
            window.open = jest.fn();

            await ensureHasValidSession( 'https://apps.example.com/' );

            expect( global.fetch ).toHaveBeenCalledTimes( 1 );
            expect( global.fetch.mock.calls[0][0].pathname ).toBe(
                '/rest/tcsso/v1/validate-session'
            );
            expect( soaService.post ).not.toHaveBeenCalled();
            expect( window.open ).not.toHaveBeenCalled();
        } );

        it.each( [ 404, 500, 502, 503 ] )(
            'reports an unavailable runtime on HTTP %s without starting SSO',
            async( status ) => {
                global.fetch = jest.fn().mockResolvedValue( {
                    ok: false,
                    status
                } );
                window.open = jest.fn();

                await expect(
                    ensureHasValidSession( 'https://apps.example.com/' )
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
                ensureHasValidSession( 'https://apps.example.com/' )
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
                ensureHasValidSession( 'https://apps.example.com/' )
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
                    ensureHasValidSession( 'https://apps.example.com/' )
                ).rejects.toMatchObject( { code: 'MENDIX_NOT_FOUND' } );
                expect( global.fetch ).toHaveBeenCalledTimes( 1 );
                expect( window.open ).not.toHaveBeenCalled();
            }
        );

        it.each( [ 401, 403 ] )(
            'starts SSO for HTTP %s authentication failures',
            async( status ) => {
                global.fetch = jest
                    .fn()
                    .mockResolvedValueOnce( { ok: false, status } )
                    .mockResolvedValueOnce( {
                        ok: true,
                        text: async() => 'test-discriminator'
                    } )
                    .mockResolvedValueOnce( { ok: false, status } )
                    .mockResolvedValueOnce( {
                        ok: true,
                        text: async() => 'test-discriminator'
                    } );
                jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
                window.open = jest.fn().mockReturnValue( null );

                await expect(
                    ensureHasValidSession( 'https://apps.example.com/' )
                ).rejects.toMatchObject( { code: 'POPUP_BLOCKED' } );
                expect( soaService.post ).toHaveBeenCalledTimes( 1 );
                expect( global.fetch ).toHaveBeenCalledTimes( 4 );
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
                } )
                .mockResolvedValueOnce( {
                    ok: true,
                    status: 200,
                    json: jest.fn().mockResolvedValue( false )
                } )
                .mockResolvedValueOnce( {
                    ok: true,
                    text: jest.fn().mockResolvedValue( 'session-discriminator' )
                } );
            jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
            window.open = jest.fn().mockReturnValue( null );

            await expect(
                ensureHasValidSession( 'https://apps.example.com/' )
            ).rejects.toEqual(
                expect.objectContaining( {
                    code: 'POPUP_BLOCKED'
                } )
            );
            expect( window.open ).toHaveBeenCalledWith(
                expect.any( URL ),
                '_blank',
                'width=200,height=300'
            );
            expect( window.open.mock.calls[0][0].toString() ).toBe(
                'https://apps.example.com/rest/tcsso/v1/login?discriminator=session-discriminator'
            );
        } );

        describe( 'sign-in lifecycle', () => {
            let popup;
            const sessionResponse = ( valid ) => ( {
                ok: true,
                status: 200,
                json: async() => valid
            } );

            beforeEach( () => {
                jest.useFakeTimers();
                jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
                popup = { closed: false, close: jest.fn() };
                window.open = jest.fn().mockReturnValue( popup );
                global.fetch = jest
                    .fn()
                    .mockResolvedValueOnce( sessionResponse( false ) )
                    .mockResolvedValueOnce( {
                        ok: true,
                        text: async() => 'test-discriminator'
                    } )
                    .mockResolvedValueOnce( sessionResponse( false ) )
                    .mockResolvedValueOnce( {
                        ok: true,
                        text: async() => 'test-discriminator'
                    } )
                    .mockResolvedValue( sessionResponse( false ) );
            } );

            it( 'polls once per second and stops immediately after a valid session', async() => {
                global.fetch
                    .mockResolvedValueOnce( sessionResponse( false ) )
                    .mockResolvedValueOnce( sessionResponse( true ) );
                const pending = ensureHasValidSession( 'https://apps.example.com/' );
                await waitFor( () => expect( global.fetch ).toHaveBeenCalledTimes( 5 ) );
                await jest.advanceTimersByTimeAsync( 500 );
                expect( global.fetch ).toHaveBeenCalledTimes( 5 );
                await jest.advanceTimersByTimeAsync( 500 );
                await pending;
                expect( global.fetch ).toHaveBeenCalledTimes( 6 );
                expect( popup.close ).not.toHaveBeenCalled();
                expect( jest.getTimerCount() ).toBe( 0 );
            } );

            it( 'cancels polling and propagates the abort signal without controlling the popup', async() => {
                const controller = new AbortController();
                const pending = ensureHasValidSession(
                    'https://apps.example.com/',
                    controller.signal
                );
                const rejected = expect( pending ).rejects.toMatchObject( {
                    name: 'AbortError'
                } );
                await waitFor( () => expect( global.fetch ).toHaveBeenCalledTimes( 5 ) );
                controller.abort();
                await rejected;
                expect( popup.close ).not.toHaveBeenCalled();
                expect(
                    global.fetch.mock.calls.every(
                        ( [ , options ] ) => options.signal.aborted
                    )
                ).toBe( true );
                expect( jest.getTimerCount() ).toBe( 0 );
            } );

            it( 'removes a pending focus listener when cancelled', async() => {
                document.hasFocus.mockReturnValue( false );
                const addListener = jest.spyOn( window, 'addEventListener' );
                const removeListener = jest.spyOn( window, 'removeEventListener' );
                const controller = new AbortController();
                const pending = ensureHasValidSession(
                    'https://apps.example.com/',
                    controller.signal
                );
                const rejected = expect( pending ).rejects.toMatchObject( {
                    name: 'AbortError'
                } );
                await waitFor( () =>
                    expect( addListener ).toHaveBeenCalledWith(
                        'focus',
                        expect.any( Function ),
                        { once: true }
                    )
                );
                controller.abort();
                await rejected;
                const listener = addListener.mock.calls.find(
                    ( [ event ] ) => event === 'focus'
                )[1];
                expect( removeListener ).toHaveBeenCalledWith( 'focus', listener );
                window.dispatchEvent( new Event( 'focus' ) );
                expect( window.open ).not.toHaveBeenCalled();
            } );

            it( 'stops polling on timeout without controlling the popup', async() => {
                const pending = ensureHasValidSession( 'https://apps.example.com/' );
                const rejected = expect( pending ).rejects.toMatchObject( {
                    code: 'POPUP_TIMEOUT'
                } );
                await waitFor( () => expect( window.open ).toHaveBeenCalledTimes( 1 ) );
                await jest.advanceTimersByTimeAsync( 30000 );
                await rejected;
                expect( popup.close ).not.toHaveBeenCalled();
                expect( jest.getTimerCount() ).toBe( 0 );
            } );

            it( 'stops polling when the validation endpoint becomes unavailable', async() => {
                global.fetch
                    .mockResolvedValueOnce( sessionResponse( false ) )
                    .mockRejectedValueOnce( new TypeError( 'Failed to fetch' ) );
                const pending = ensureHasValidSession( 'https://apps.example.com/' );
                const rejected = expect( pending ).rejects.toMatchObject( {
                    code: 'MENDIX_NOT_FOUND'
                } );
                await waitFor( () => expect( global.fetch ).toHaveBeenCalledTimes( 5 ) );
                await jest.advanceTimersByTimeAsync( 1000 );
                await rejected;
                expect( global.fetch ).toHaveBeenCalledTimes( 6 );
                expect( jest.getTimerCount() ).toBe( 0 );
                expect( popup.close ).not.toHaveBeenCalled();
            } );

            it( 'completes through session polling when COOP makes the popup appear closed', async() => {
                popup.closed = true;
                global.fetch
                    .mockResolvedValueOnce( sessionResponse( false ) )
                    .mockResolvedValueOnce( sessionResponse( true ) );
                const pending = ensureHasValidSession( 'https://apps.example.com/' );
                await waitFor( () => expect( global.fetch ).toHaveBeenCalledTimes( 5 ) );
                await jest.advanceTimersByTimeAsync( 1000 );
                await pending;
                expect( global.fetch ).toHaveBeenCalledTimes( 6 );
                expect( popup.close ).not.toHaveBeenCalled();
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

    it( 'creates errors with a stable name and code', () => {
        const error = new MendixEmbeddedError( 'CODE' );

        expect( error ).toBeInstanceOf( Error );
        expect( error.name ).toBe( 'MendixEmbeddedError' );
        expect( error.code ).toBe( 'CODE' );
    } );
} );
