/* eslint-env jest, node */
import { readFileSync } from 'fs';
import path from 'path';
import mendixLogoutContribution, {
    logoutFromMendix,
    MENDIX_LOGOUT_CONTRIBUTION_KEY,
    MENDIX_LOGOUT_STEP_NAME,
    registerMendixLogout
} from '../src/js/mendixEmbeddedLogout';

describe( 'mendixEmbeddedLogout', () => {
    const originalFetch = global.fetch;

    beforeEach( async() => {
        global.fetch = jest.fn().mockResolvedValue( { ok: true, status: 200 } );
        jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
        // Start every test without registered applications.
        await logoutFromMendix();
        global.fetch.mockClear();
    } );

    afterEach( () => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
        jest.useRealTimers();
    } );

    it( 'resolves without requests when no Mendix application is registered', async() => {
        await expect( logoutFromMendix() ).resolves.toBe( true );
        expect( global.fetch ).not.toHaveBeenCalled();
    } );

    it( 'logs out of each registered application once', async() => {
        registerMendixLogout( 'https://apps.example.com/' );
        registerMendixLogout( 'https://apps.example.com/' );
        registerMendixLogout( 'https://other.example.com/' );

        await expect( logoutFromMendix() ).resolves.toBe( true );

        expect( global.fetch.mock.calls.map( ( [ url ] ) => url.toString() ) ).toEqual( [
            'https://apps.example.com/rest/tcsso/v1/logout',
            'https://other.example.com/rest/tcsso/v1/logout'
        ] );
        expect( global.fetch.mock.calls[0][1] ).toEqual( expect.objectContaining( {
            method: 'POST',
            mode: 'cors',
            credentials: 'include',
            keepalive: true
        } ) );

        await logoutFromMendix();
        expect( global.fetch ).toHaveBeenCalledTimes( 2 );
    } );

    it.each( [
        [ 'rejected', () => Promise.reject( new Error( 'network' ) ) ],
        [ 'unsuccessful', () => Promise.resolve( { ok: false, status: 500 } ) ],
        [ 'unavailable', () => Promise.resolve( { ok: false, status: 404 } ) ]
    ] )( 'reports a %s Mendix logout without rejecting', async( _, response ) => {
        global.fetch.mockImplementation( response );
        registerMendixLogout( 'https://apps.example.com/' );

        await expect( logoutFromMendix() ).resolves.toBe( false );
        expect( console.warn ).toHaveBeenCalled();
    } );

    it( 'reports a failed Mendix logout without rejecting when fetch is not available', async() => {
        delete global.fetch;
        registerMendixLogout( 'https://apps.example.com/' );

        await expect( logoutFromMendix() ).resolves.toBe( false );
    } );

    it( 'reports a failed Mendix logout without rejecting when AbortController is not available', async() => {
        const originalAbortController = global.AbortController;
        delete global.AbortController;
        registerMendixLogout( 'https://apps.example.com/' );

        try {
            await expect( logoutFromMendix() ).resolves.toBe( false );
        } finally {
            global.AbortController = originalAbortController;
        }
    } );

    it( 'stops waiting for a Mendix logout that does not respond', async() => {
        jest.useFakeTimers();
        global.fetch.mockImplementation( ( _, { signal } ) => new Promise( ( _resolve, reject ) => {
            signal.addEventListener( 'abort', () => reject( new Error( 'aborted' ) ) );
        } ) );
        registerMendixLogout( 'https://apps.example.com/' );

        const pending = logoutFromMendix();
        await jest.advanceTimersByTimeAsync( 5000 );

        await expect( pending ).resolves.toBe( false );
    } );

    describe( 'pre-logout pipeline contribution', () => {
        const createDeferred = () => {
            const deferred = {};
            deferred.promise = new Promise( ( resolve, reject ) => {
                deferred.resolve = resolve;
                deferred.reject = reject;
            } );
            return deferred;
        };

        const loadStep = async() => {
            const deferred = createDeferred();
            mendixLogoutContribution( MENDIX_LOGOUT_CONTRIBUTION_KEY, deferred );
            const contribution = await deferred.promise;
            return contribution.getPipelineStepDefinition();
        };

        it( 'is registered in contributions.json under the pre-logout pipeline key', () => {
            const contributions = JSON.parse( readFileSync( path.join( __dirname, '../contributions.json' ), 'utf8' ) );

            expect( MENDIX_LOGOUT_CONTRIBUTION_KEY ).toBe( 'preLogoutPipeline' );
            expect( contributions[MENDIX_LOGOUT_CONTRIBUTION_KEY] ).toEqual( [ 'js/mendixEmbeddedLogout' ] );
        } );

        it( 'contributes an active step without logging out yet', async() => {
            registerMendixLogout( 'https://apps.example.com/' );

            const step = await loadStep();

            expect( step ).toEqual( expect.objectContaining( { name: MENDIX_LOGOUT_STEP_NAME, active: true } ) );
            expect( global.fetch ).not.toHaveBeenCalled();
        } );

        it( 'continues the pipeline once the Mendix logout has finished', async() => {
            let finishLogout;
            global.fetch.mockImplementation( () => new Promise( resolve => { finishLogout = resolve; } ) );
            registerMendixLogout( 'https://apps.example.com/' );
            const step = await loadStep();
            const stepDeferred = createDeferred();
            const continued = jest.fn();
            stepDeferred.promise.then( continued );

            step.workFunction( step, stepDeferred );
            await Promise.resolve();

            expect( global.fetch ).toHaveBeenCalledTimes( 1 );
            expect( continued ).not.toHaveBeenCalled();

            finishLogout( { ok: true, status: 200 } );
            await expect( stepDeferred.promise ).resolves.toBeUndefined();
        } );

        it( 'continues the pipeline when the Mendix logout fails', async() => {
            global.fetch.mockRejectedValue( new Error( 'network' ) );
            registerMendixLogout( 'https://apps.example.com/' );
            const step = await loadStep();
            const stepDeferred = createDeferred();

            step.workFunction( step, stepDeferred );

            await expect( stepDeferred.promise ).resolves.toBeUndefined();
        } );

        it( 'continues the pipeline when the Mendix logout endpoint is not available', async() => {
            global.fetch.mockResolvedValue( { ok: false, status: 404 } );
            registerMendixLogout( 'https://apps.example.com/' );
            const step = await loadStep();
            const stepDeferred = createDeferred();

            step.workFunction( step, stepDeferred );

            await expect( stepDeferred.promise ).resolves.toBeUndefined();
        } );

        it( 'continues the pipeline when the Mendix logout does not respond', async() => {
            jest.useFakeTimers();
            global.fetch.mockImplementation( ( _, { signal } ) => new Promise( ( _resolve, reject ) => {
                signal.addEventListener( 'abort', () => reject( new Error( 'aborted' ) ) );
            } ) );
            registerMendixLogout( 'https://apps.example.com/' );
            const step = await loadStep();
            const stepDeferred = createDeferred();

            step.workFunction( step, stepDeferred );
            await jest.advanceTimersByTimeAsync( 5000 );

            await expect( stepDeferred.promise ).resolves.toBeUndefined();
        } );
    } );
} );
