/* eslint-env jest */
import { waitFor } from '@testing-library/react';
import {
    ensureHasValidSession,
    getResolvedMendixConfiguration
} from '../src/js/mendixEmbeddedUtils';
import {
    mendixCleanupFunction,
    mountMendix
} from '../src/js/mendixEmbeddedService';
import { render as renderApp } from 'https://apps.example.com/dist/embedded-index.js';

jest.mock( '../src/js/mendixEmbeddedUtils', () => ( {
    ...jest.requireActual( '../src/js/mendixEmbeddedUtils' ),
    ensureHasValidSession: jest.fn(),
    getResolvedMendixConfiguration: jest.fn()
} ) );

jest.mock( 'https://apps.example.com/dist/embedded-index.js', () => ( {
    render: jest.fn()
} ), { virtual: true } );

describe( 'mendixEmbeddedService', () => {
    const refs = containerRef => new Map( [ [ 'mendixContainer', containerRef ] ] );

    beforeEach( () => {
        jest.clearAllMocks();
    } );

    afterEach( () => {
        jest.restoreAllMocks();
    } );

    it( 'maps known configuration errors to component error state', async() => {
        getResolvedMendixConfiguration.mockImplementation( () => {
            throw { code: 'MISSING_CONFIGURATION' };
        } );

        const result = await mountMendix(
            refs( { current: document.createElement( 'div' ) } ),
            null,
            {},
            jest.fn()
        );

        expect( result ).toEqual( { errorCode: 'MISSING_CONFIGURATION' } );
    } );

    it( 'maps session failures after resolving the configuration', async() => {
        getResolvedMendixConfiguration.mockReturnValue( {
            url: 'https://apps.example.com/',
            parameters: { uid: 'UID-123' },
            configurationKey: 'configuration-key'
        } );
        ensureHasValidSession.mockRejectedValue( { code: 'SESSION_ERROR' } );

        const result = await mountMendix(
            refs( { current: document.createElement( 'div' ) } ),
            'https://apps.example.com/?uid={uid}',
            { uid: 'UID-123' },
            jest.fn()
        );

        expect( getResolvedMendixConfiguration ).toHaveBeenCalledWith(
            'https://apps.example.com/?uid={uid}', { uid: 'UID-123' }
        );
        expect( ensureHasValidSession ).toHaveBeenCalledWith( 'https://apps.example.com/', expect.any( AbortSignal ) );
        expect( result ).toEqual( { errorCode: 'SESSION_ERROR' } );
    } );

    it( 'uses the unexpected error code for unrecognized failures', async() => {
        getResolvedMendixConfiguration.mockImplementation( () => {
            throw new Error( 'failure' );
        } );

        const result = await mountMendix(
            refs( { current: document.createElement( 'div' ) } ),
            null,
            {},
            jest.fn()
        );

        expect( result ).toEqual( { errorCode: 'UNEXPECTED_ERROR' } );
    } );

    it( 'allows cleanup before any application has mounted', () => {
        expect( () => mendixCleanupFunction( refs( {} ) ) ).not.toThrow();
    } );

    describe( 'application lifecycle', () => {
        let containerRef;
        let reload;
        let onUnmountError;
        const mount = () => mountMendix( refs( containerRef ), null, {}, reload );

        beforeEach( () => {
            containerRef = { current: document.createElement( 'div' ) };
            reload = jest.fn();
            getResolvedMendixConfiguration.mockReturnValue( {
                url: 'https://apps.example.com/', parameters: { uid: 'A' }, configurationKey: 'A'
            } );
            ensureHasValidSession.mockResolvedValue();
            renderApp.mockReset();
            onUnmountError = undefined;
        } );

        afterEach( () => {
            mendixCleanupFunction( refs( containerRef ) );
            if ( onUnmountError ) {
                window.removeEventListener( 'error', onUnmountError );
            }
        } );

        it( 'deduplicates unchanged configuration and cleans up a mounted app', async() => {
            const unmount = jest.fn();
            renderApp.mockReturnValue( unmount );
            await mount();
            await mount();
            expect( renderApp ).toHaveBeenCalledTimes( 1 );
            expect( ensureHasValidSession ).toHaveBeenCalledTimes( 1 );
            mendixCleanupFunction( refs( containerRef ) );
            mendixCleanupFunction( refs( containerRef ) );
            expect( unmount ).toHaveBeenCalledTimes( 1 );
        } );

        it( 'aborts authentication when the component is unmounted', async() => {
            let finishSession;
            ensureHasValidSession.mockImplementation( () => new Promise( resolve => { finishSession = resolve; } ) );
            const pending = mount();
            const signal = ensureHasValidSession.mock.calls[0][1];
            mendixCleanupFunction( refs( containerRef ) );
            finishSession();
            await pending;
            expect( signal?.aborted ).toBe( true );
            expect( renderApp ).not.toHaveBeenCalled();
        } );

        it( 'detaches the app and its reload listener even if unmount throws', async() => {
            const error = new Error( 'Unmount failed' );
            const unmount = jest.fn( () => { throw error; } );
            renderApp.mockReturnValue( unmount );
            await mount();
            const appContainer = renderApp.mock.calls[0][0];
            // Exceptions in DOM event listeners are reported on window, not by abort().
            onUnmountError = event => {
                if ( event.error === error ) {
                    event.preventDefault();
                }
            };
            window.addEventListener( 'error', onUnmountError );
            mendixCleanupFunction( refs( containerRef ) );
            expect( containerRef.current.childElementCount ).toBe( 0 );
            appContainer.dispatchEvent( new Event( 'embedded-app-reload' ) );
            expect( reload ).not.toHaveBeenCalled();
            mendixCleanupFunction( refs( containerRef ) );
            expect( unmount ).toHaveBeenCalledTimes( 1 );
        } );

        it( 'isolates a slow old render from the next application', async() => {
            let finishRender;
            renderApp.mockImplementationOnce( () => new Promise( resolve => { finishRender = resolve; } ) );
            const first = mount();
            // Wait for the mocked remote module to be imported and render to start.
            await waitFor( () => expect( renderApp ).toHaveBeenCalledTimes( 1 ) );
            const oldContainer = renderApp.mock.calls[0][0];
            getResolvedMendixConfiguration.mockReturnValue( {
                url: 'https://apps.example.com/', parameters: { uid: 'B' }, configurationKey: 'B'
            } );
            renderApp.mockImplementationOnce( container => { container.textContent = 'New app'; } );
            await mount();
            const newContainer = renderApp.mock.calls[1][0];
            finishRender( () => { oldContainer.textContent = ''; } );
            await first;
            expect( newContainer ).not.toBe( oldContainer );
            expect( containerRef.current.textContent ).toBe( 'New app' );
        } );

        it( 'removes a failed render and allows another load', async() => {
            renderApp.mockImplementationOnce( container => {
                container.textContent = 'Partial app';
                throw new Error( 'Render failed' );
            } );
            const result = await mount();
            expect( result.errorCode ).toBe( 'UNEXPECTED_ERROR' );
            expect( containerRef.current.childElementCount ).toBe( 0 );

            renderApp.mockImplementationOnce( container => { container.textContent = 'Retry succeeded'; } );
            await mount();
            expect( containerRef.current.textContent ).toBe( 'Retry succeeded' );
        } );

        it( 'ignores an old render failure after a new app has mounted', async() => {
            let rejectRender;
            renderApp.mockImplementationOnce( () => new Promise( ( _resolve, reject ) => { rejectRender = reject; } ) );
            const first = mount();
            await waitFor( () => expect( renderApp ).toHaveBeenCalledTimes( 1 ) );
            getResolvedMendixConfiguration.mockReturnValue( {
                url: 'https://apps.example.com/', parameters: { uid: 'B' }, configurationKey: 'B'
            } );
            const unmount = jest.fn();
            renderApp.mockImplementationOnce( container => {
                container.textContent = 'New app';
                return unmount;
            } );
            await mount();
            rejectRender( new Error( 'Old render failed' ) );
            expect( await first ).toBeUndefined();
            expect( containerRef.current.textContent ).toBe( 'New app' );
            expect( unmount ).not.toHaveBeenCalled();
        } );

        it( 'handles reload once and removes the listener during cleanup', async() => {
            const unmount = jest.fn();
            renderApp.mockReturnValue( unmount );
            await mount();
            const appContainer = renderApp.mock.calls[0][0];
            appContainer.dispatchEvent( new Event( 'embedded-app-reload' ) );
            appContainer.dispatchEvent( new Event( 'embedded-app-reload' ) );
            expect( reload ).toHaveBeenCalledTimes( 1 );
            expect( unmount ).toHaveBeenCalledTimes( 1 );
        } );
    } );
} );
