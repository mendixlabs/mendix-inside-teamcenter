/* eslint-env jest, node */
import { act, fireEvent, waitFor } from '@testing-library/react';
import { renderWithCtx } from '@swf/core/test/testUtils';
import localizationService from 'js/awDuiLocalizationService';
import MendixEmbedded from 'viewmodel/MendixEmbeddedViewModel';
import { ensureHasValidSession } from '../src/js/mendixEmbeddedUtils';
import { render as renderApp } from 'https://apps.example.com/dist/embedded-index.js';

jest.mock( '../src/js/mendixEmbeddedUtils', () => ( {
    ...jest.requireActual( '../src/js/mendixEmbeddedUtils' ),
    ensureHasValidSession: jest.fn()
} ) );

jest.mock( 'https://apps.example.com/dist/embedded-index.js', () => ( {
    render: jest.fn()
} ), { virtual: true } );

describe( 'mendixEmbedded integration', () => {
    const originalFetch = global.fetch;
    beforeEach( () => {
        jest.clearAllMocks();
        ensureHasValidSession.mockResolvedValue();
    } );

    afterEach( () => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    } );

    it( 'mounts a remote app through SWF and cleans up when removed', async() => {
        const cleanup = jest.fn();
        renderApp.mockReturnValue( cleanup );
        const view = renderWithCtx( <MendixEmbedded config='https://apps.example.com/' /> );
        await waitFor( () => expect( renderApp ).toHaveBeenCalledTimes( 1 ) );
        expect( view.container.contains( renderApp.mock.calls[0][0] ) ).toBe( true );
        act( () => renderApp.mock.calls[0][0].dispatchEvent( new Event( 'embedded-app-reload' ) ) );
        await waitFor( () => expect( renderApp ).toHaveBeenCalledTimes( 2 ) );
        await act( async() => view.unmount() );
        expect( cleanup ).toHaveBeenCalledTimes( 2 );
        expect( ensureHasValidSession.mock.calls[1][1].aborted ).toBe( true );
    } );

    it( 'renders the popup error and retries only the embedded app', async() => {
        ensureHasValidSession.mockRejectedValueOnce( { code: 'POPUP_BLOCKED' } );
        renderApp.mockReturnValue( jest.fn() );
        const view = renderWithCtx( <MendixEmbedded config='https://apps.example.com/' /> );
        const retry = await view.findByRole( 'button', { name: 'Continue' } );
        fireEvent.click( retry );
        await waitFor( () => {
            expect( renderApp ).toHaveBeenCalledTimes( 1 );
            expect( view.queryByRole( 'button', { name: 'Continue' } ) ).toBeNull();
        } );
    } );

    it( 'keeps an initial configuration error while the error panel loads translations', async() => {
        const populateI18nMap = localizationService.populateI18nMap.bind( localizationService );
        let pendingTranslations;
        jest.spyOn( localizationService, 'populateI18nMap' ).mockImplementation( ( ...args ) => {
            if ( args[0].INVALID_URL ) {
                return new Promise( resolve => { pendingTranslations = { resolve, args }; } );
            }
            return populateI18nMap( ...args );
        } );
        const view = renderWithCtx( <MendixEmbedded config='invalid URL' /> );
        await waitFor( () => expect( pendingTranslations ).toBeDefined() );
        await act( async() => pendingTranslations.resolve( await populateI18nMap( ...pendingTranslations.args ) ) );
        await view.findByText( 'The Mendix application URL is invalid.' );
        expect( ensureHasValidSession ).not.toHaveBeenCalled();
        expect( renderApp ).not.toHaveBeenCalled();
    } );

    it( 'uses XRT configuration and resolves mapped context values', async() => {
        renderApp.mockReturnValue( jest.fn() );
        renderWithCtx( <MendixEmbedded subPanelContext={{
            declarativeKeyContext: 'https://apps.example.com/?uid={selected.uid}&mode=edit'
        }} />, { initialState: { selected: { uid: 'UID-456' } } } );
        await waitFor( () => expect( renderApp ).toHaveBeenCalledWith(
            expect.any( HTMLElement ), expect.objectContaining( {
                remoteUrl: 'https://apps.example.com/', parameters: { uid: 'UID-456', mode: 'edit' }
            } )
        ) );
    } );

    it( 'falls back to the generic localized message for unknown error codes', async() => {
        ensureHasValidSession.mockRejectedValueOnce( { code: 'UNKNOWN_CODE' } );
        const view = renderWithCtx( <MendixEmbedded config='https://apps.example.com/' /> );
        expect( await view.findByText( 'An unexpected error occurred.' ) ).toBeTruthy();
    } );

    it( 'reports unsupported object parameters without starting authentication', async() => {
        const view = renderWithCtx( <MendixEmbedded config='https://apps.example.com/?item={selected}' />, {
            initialState: { selected: { uid: 'UID-456' } }
        } );
        await view.findByText( 'Mendix parameters must resolve to strings, numbers, or booleans.' );
        expect( ensureHasValidSession ).not.toHaveBeenCalled();
        expect( renderApp ).not.toHaveBeenCalled();
    } );

    it( 'shows the localized runtime URL error when session validation cannot be reached', async() => {
        ensureHasValidSession.mockImplementation( jest.requireActual( '../src/js/mendixEmbeddedUtils' ).ensureHasValidSession );
        global.fetch = jest.fn().mockRejectedValue( new TypeError( 'Failed to fetch' ) );
        const openPopup = jest.spyOn( window, 'open' ).mockReturnValue( null );
        const view = renderWithCtx( <MendixEmbedded config='https://apps.example.com/' /> );

        await view.findByText( 'Cannot reach the Mendix runtime at the configured URL. Check that the URL is correct and the runtime is running.' );
        expect( global.fetch ).toHaveBeenCalledTimes( 1 );
        expect( openPopup ).not.toHaveBeenCalled();
        expect( renderApp ).not.toHaveBeenCalled();
        expect( view.queryByText( 'Allow Popups to Continue' ) ).toBeNull();
    } );
} );
