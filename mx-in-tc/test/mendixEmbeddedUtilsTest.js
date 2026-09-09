/* eslint-env jest, node */
import { waitFor } from '@testing-library/react';
import {
    ensureHasValidSession,
    getMendixContextPaths,
    getResolvedMendixConfiguration,
    MendixEmbeddedError
} from '../src/js/mendixEmbeddedUtils';

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
            expect( () => getResolvedMendixConfiguration( config, {} ) )
                .toThrow( expect.objectContaining( {
                    name: 'MendixEmbeddedError',
                    code: expectedCode
                } ) );
        } );

        it( 'rejects a circular model object before serializing parameters', () => {
            const selected = { uid: 'A' };
            selected.self = selected;
            expect( () => getResolvedMendixConfiguration( 'https://apps.example.com/?item={selected}', { selected } ) )
                .toThrow( expect.objectContaining( { code: 'INVALID_PARAMETER' } ) );
        } );

        it( 'preserves missing fields and quoted string literals', () => {
            const result = getResolvedMendixConfiguration(
                'https://apps.example.com/?uid={selected.uid}&text=%22true%22', {}
            );
            expect( result.parameters ).toEqual( { uid: undefined, text: 'true' } );
        } );
    } );

    describe( 'getMendixContextPaths', () => {
        it( 'returns unique context paths and excludes literal values', () => {
            const paths = getMendixContextPaths( 'https://apps.example.com/?first={selection.uid}&second={selection.uid}&mode=edit' );

            expect( paths ).toEqual( [ 'selection.uid' ] );
        } );
    } );

    describe( 'ensureHasValidSession', () => {
        it( 'does not open a popup when the session is already valid', async() => {
            global.fetch = jest.fn().mockResolvedValue( {
                ok: true,
                status: 200,
                json: jest.fn().mockResolvedValue( true )
            } );
            window.open = jest.fn();

            await ensureHasValidSession( 'https://apps.example.com/' );

            expect( global.fetch ).toHaveBeenCalledTimes( 1 );
            expect( window.open ).not.toHaveBeenCalled();
        } );

        it.each( [ 404, 500, 502, 503 ] )( 'reports an unavailable runtime on HTTP %s without starting SSO', async( status ) => {
            global.fetch = jest.fn().mockResolvedValue( {
                ok: false,
                status
            } );
            window.open = jest.fn();

            await expect( ensureHasValidSession( 'https://apps.example.com/' ) )
                .rejects.toEqual( expect.objectContaining( {
                    code: 'MENDIX_NOT_FOUND'
                } ) );
            expect( global.fetch ).toHaveBeenCalledTimes( 1 );
            expect( window.open ).not.toHaveBeenCalled();
        } );

        it( 'reports an unavailable runtime on a network failure without starting SSO', async() => {
            global.fetch = jest.fn().mockRejectedValue( new TypeError( 'Failed to fetch' ) );
            window.open = jest.fn();

            await expect( ensureHasValidSession( 'https://apps.example.com/' ) )
                .rejects.toMatchObject( { code: 'MENDIX_NOT_FOUND' } );
            expect( global.fetch ).toHaveBeenCalledTimes( 1 );
            expect( window.open ).not.toHaveBeenCalled();
        } );

        it( 'reports an unavailable validation endpoint when the response is not JSON', async() => {
            global.fetch = jest.fn().mockResolvedValue( {
                ok: true,
                status: 200,
                json: jest.fn().mockRejectedValue( new SyntaxError( 'Unexpected HTML response' ) )
            } );
            window.open = jest.fn();

            await expect( ensureHasValidSession( 'https://apps.example.com/' ) )
                .rejects.toMatchObject( { code: 'MENDIX_NOT_FOUND' } );
            expect( global.fetch ).toHaveBeenCalledTimes( 1 );
            expect( window.open ).not.toHaveBeenCalled();
        } );

        it.each( [ null, {}, 'false' ] )( 'rejects an unexpected validation payload: %p', async( payload ) => {
            global.fetch = jest.fn().mockResolvedValue( {
                ok: true,
                status: 200,
                json: async() => payload
            } );
            window.open = jest.fn();

            await expect( ensureHasValidSession( 'https://apps.example.com/' ) )
                .rejects.toMatchObject( { code: 'MENDIX_NOT_FOUND' } );
            expect( global.fetch ).toHaveBeenCalledTimes( 1 );
            expect( window.open ).not.toHaveBeenCalled();
        } );

        it.each( [ 401, 403 ] )( 'starts SSO for HTTP %s authentication failures', async( status ) => {
            global.fetch = jest.fn()
                .mockResolvedValueOnce( { ok: false, status } )
                .mockResolvedValueOnce( { ok: true, text: async() => 'test-discriminator' } );
            jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
            window.open = jest.fn().mockReturnValue( null );

            await expect( ensureHasValidSession( 'https://apps.example.com/' ) )
                .rejects.toMatchObject( { code: 'POPUP_BLOCKED' } );
            expect( global.fetch ).toHaveBeenCalledTimes( 2 );
            expect( window.open ).toHaveBeenCalledTimes( 1 );
        } );

        it( 'reports a blocked login popup', async() => {
            global.fetch = jest.fn()
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

            await expect( ensureHasValidSession( 'https://apps.example.com/' ) )
                .rejects.toEqual( expect.objectContaining( {
                    code: 'POPUP_BLOCKED'
                } ) );
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
            const sessionResponse = valid => ( { ok: true, status: 200, json: async() => valid } );

            beforeEach( () => {
                jest.useFakeTimers();
                jest.spyOn( document, 'hasFocus' ).mockReturnValue( true );
                popup = { closed: false, close: jest.fn() };
                window.open = jest.fn().mockReturnValue( popup );
                global.fetch = jest.fn()
                    .mockResolvedValueOnce( sessionResponse( false ) )
                    .mockResolvedValueOnce( { ok: true, text: async() => 'test-discriminator' } )
                    .mockResolvedValue( sessionResponse( false ) );
            } );

            it( 'polls once per second and stops immediately after a valid session', async() => {
                global.fetch.mockResolvedValueOnce( sessionResponse( false ) )
                    .mockResolvedValueOnce( sessionResponse( true ) );
                const pending = ensureHasValidSession( 'https://apps.example.com/' );
                await waitFor( () => expect( global.fetch ).toHaveBeenCalledTimes( 3 ) );
                await jest.advanceTimersByTimeAsync( 500 );
                expect( global.fetch ).toHaveBeenCalledTimes( 3 );
                await jest.advanceTimersByTimeAsync( 500 );
                await pending;
                expect( global.fetch ).toHaveBeenCalledTimes( 4 );
                expect( popup.close ).not.toHaveBeenCalled();
                expect( jest.getTimerCount() ).toBe( 0 );
            } );

            it( 'cancels polling and propagates the abort signal without controlling the popup', async() => {
                const controller = new AbortController();
                const pending = ensureHasValidSession( 'https://apps.example.com/', controller.signal );
                const rejected = expect( pending ).rejects.toMatchObject( { name: 'AbortError' } );
                await waitFor( () => expect( global.fetch ).toHaveBeenCalledTimes( 3 ) );
                controller.abort();
                await rejected;
                expect( popup.close ).not.toHaveBeenCalled();
                expect( global.fetch.mock.calls.every( ( [ , options ] ) => options.signal === controller.signal ) ).toBe( true );
                expect( jest.getTimerCount() ).toBe( 0 );
            } );

            it( 'removes a pending focus listener when cancelled', async() => {
                document.hasFocus.mockReturnValue( false );
                const addListener = jest.spyOn( window, 'addEventListener' );
                const removeListener = jest.spyOn( window, 'removeEventListener' );
                const controller = new AbortController();
                const pending = ensureHasValidSession( 'https://apps.example.com/', controller.signal );
                const rejected = expect( pending ).rejects.toMatchObject( { name: 'AbortError' } );
                await waitFor( () => expect( addListener ).toHaveBeenCalledWith( 'focus', expect.any( Function ), { once: true } ) );
                controller.abort();
                await rejected;
                const listener = addListener.mock.calls.find( ( [ event ] ) => event === 'focus' )[1];
                expect( removeListener ).toHaveBeenCalledWith( 'focus', listener );
                window.dispatchEvent( new Event( 'focus' ) );
                expect( window.open ).not.toHaveBeenCalled();
            } );

            it( 'stops polling on timeout without controlling the popup', async() => {
                const pending = ensureHasValidSession( 'https://apps.example.com/' );
                const rejected = expect( pending ).rejects.toMatchObject( { code: 'POPUP_TIMEOUT' } );
                await waitFor( () => expect( window.open ).toHaveBeenCalledTimes( 1 ) );
                await jest.advanceTimersByTimeAsync( 30000 );
                await rejected;
                expect( popup.close ).not.toHaveBeenCalled();
                expect( jest.getTimerCount() ).toBe( 0 );
            } );

            it( 'stops polling when the validation endpoint becomes unavailable', async() => {
                global.fetch.mockResolvedValueOnce( sessionResponse( false ) )
                    .mockRejectedValueOnce( new TypeError( 'Failed to fetch' ) );
                const pending = ensureHasValidSession( 'https://apps.example.com/' );
                const rejected = expect( pending ).rejects.toMatchObject( { code: 'MENDIX_NOT_FOUND' } );
                await waitFor( () => expect( global.fetch ).toHaveBeenCalledTimes( 3 ) );
                await jest.advanceTimersByTimeAsync( 1000 );
                await rejected;
                expect( global.fetch ).toHaveBeenCalledTimes( 4 );
                expect( jest.getTimerCount() ).toBe( 0 );
                expect( popup.close ).not.toHaveBeenCalled();
            } );

            it( 'completes through session polling when COOP makes the popup appear closed', async() => {
                popup.closed = true;
                global.fetch.mockResolvedValueOnce( sessionResponse( false ) )
                    .mockResolvedValueOnce( sessionResponse( true ) );
                const pending = ensureHasValidSession( 'https://apps.example.com/' );
                await waitFor( () => expect( global.fetch ).toHaveBeenCalledTimes( 3 ) );
                await jest.advanceTimersByTimeAsync( 1000 );
                await pending;
                expect( global.fetch ).toHaveBeenCalledTimes( 4 );
                expect( popup.close ).not.toHaveBeenCalled();
                expect( jest.getTimerCount() ).toBe( 0 );
            } );

            it( 'does not turn an aborted validation request into a new login flow', async() => {
                const controller = new AbortController();
                global.fetch.mockReset().mockImplementation( ( _url, { signal } ) => new Promise( ( _resolve, reject ) => {
                    signal.addEventListener( 'abort', () => reject( new DOMException( 'Aborted', 'AbortError' ) ), { once: true } );
                } ) );
                const pending = ensureHasValidSession( 'https://apps.example.com/', controller.signal );
                controller.abort();
                await expect( pending ).rejects.toMatchObject( { name: 'AbortError' } );
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
