/* eslint-env jest, node */
import './setupAbortSignal';
import { openLoginPopup } from '../src/js/mendixEmbeddedLoginPopup';

const APP_URL = 'https://apps.example.com/my-app/';

describe( 'mendixEmbeddedLoginPopup', () => {
    const originalWindowOpen = window.open;
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
    } );

    afterEach( () => {
        window.open = originalWindowOpen;
        jest.restoreAllMocks();
        jest.useRealTimers();
    } );

    describe( 'openLoginPopup', () => {
        it( 'opens the SSO login page with the discriminator', () => {
            openLoginPopup( APP_URL, 'session/1+2' );

            expect( window.open ).toHaveBeenCalledWith(
                expect.any( URL ),
                'mxInTcSso',
                'width=200,height=300'
            );
            expect( window.open.mock.calls[0][0].toString() ).toBe(
                'https://apps.example.com/my-app/rest/tcsso/v1/login?discriminator=session%2F1%2B2'
            );
            expect( popup.focus ).toHaveBeenCalled();
        } );

        it( 'reports a blocked popup', async() => {
            window.open.mockReturnValue( null );

            await expect( openLoginPopup( APP_URL, '' ) ).rejects.toMatchObject( {
                code: 'POPUP_BLOCKED'
            } );
            expect( jest.getTimerCount() ).toBe( 0 );
        } );

        it( 'resolves once the popup is closed and stops polling', async() => {
            let resolved = false;
            const pending = openLoginPopup( APP_URL, '' ).then( () => {
                resolved = true;
            } );

            await jest.advanceTimersByTimeAsync( 1000 );
            expect( resolved ).toBe( false );

            closePopupByUser();
            await jest.advanceTimersByTimeAsync( 200 );
            await pending;
            expect( popup.close ).not.toHaveBeenCalled();
            expect( jest.getTimerCount() ).toBe( 0 );
        } );

        it( 'closes the popup and stops polling on timeout', async() => {
            const rejected = expect( openLoginPopup( APP_URL, '' ) ).rejects.toMatchObject( {
                code: 'POPUP_TIMEOUT'
            } );

            await jest.advanceTimersByTimeAsync( 2 * 60 * 1000 - 1 );
            expect( popup.close ).not.toHaveBeenCalled();
            await jest.advanceTimersByTimeAsync( 1 );
            await rejected;
            expect( popup.close ).toHaveBeenCalledTimes( 1 );
            expect( jest.getTimerCount() ).toBe( 0 );
        } );

        it( 'closes the popup and propagates the abort reason when cancelled', async() => {
            const controller = new AbortController();
            const pending = openLoginPopup( APP_URL, '', controller.signal );

            controller.abort();

            await expect( pending ).rejects.toBe( controller.signal.reason );
            expect( popup.close ).toHaveBeenCalledTimes( 1 );
            expect( jest.getTimerCount() ).toBe( 0 );
        } );

        it( 'does not open the popup for an already cancelled load', async() => {
            const controller = new AbortController();
            controller.abort();

            await expect(
                openLoginPopup( APP_URL, '', controller.signal )
            ).rejects.toBe( controller.signal.reason );
            expect( window.open ).not.toHaveBeenCalled();
        } );

        it( 'opens the popup once the window regains focus', async() => {
            document.hasFocus.mockReturnValue( false );
            const addListener = jest.spyOn( window, 'addEventListener' );
            const pending = openLoginPopup( APP_URL, '' );

            expect( addListener ).toHaveBeenCalledWith(
                'focus',
                expect.any( Function ),
                { once: true }
            );
            expect( window.open ).not.toHaveBeenCalled();

            window.dispatchEvent( new Event( 'focus' ) );
            expect( window.open ).toHaveBeenCalledTimes( 1 );
            closePopupByUser();
            await jest.advanceTimersByTimeAsync( 200 );
            await pending;
        } );

        it( 'removes a pending focus listener when cancelled', async() => {
            document.hasFocus.mockReturnValue( false );
            const addListener = jest.spyOn( window, 'addEventListener' );
            const removeListener = jest.spyOn( window, 'removeEventListener' );
            const controller = new AbortController();
            const pending = openLoginPopup( APP_URL, '', controller.signal );

            controller.abort();

            await expect( pending ).rejects.toBe( controller.signal.reason );
            const listener = addListener.mock.calls.find(
                ( [ event ] ) => event === 'focus'
            )[1];
            expect( removeListener ).toHaveBeenCalledWith( 'focus', listener );
            window.dispatchEvent( new Event( 'focus' ) );
            expect( window.open ).not.toHaveBeenCalled();
        } );
    } );
} );
