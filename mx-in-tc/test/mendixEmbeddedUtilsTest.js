/* eslint-env jest */
import {
    getMendixContextPaths,
    getResolvedMendixConfiguration,
    MendixEmbeddedError
} from '../src/js/mendixEmbeddedUtils';

describe( 'mendixEmbeddedUtils', () => {
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

    it( 'creates errors with a stable name and code', () => {
        const error = new MendixEmbeddedError( 'CODE' );

        expect( error ).toBeInstanceOf( Error );
        expect( error.name ).toBe( 'MendixEmbeddedError' );
        expect( error.code ).toBe( 'CODE' );
    } );
} );
