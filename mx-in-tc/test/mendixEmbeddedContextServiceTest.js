/* eslint-env jest */
import { DerivedStateResult } from 'js/derivedContextService';
import { getMendixContextDerivedState } from '../src/js/mendixEmbeddedContextService';

jest.mock( 'js/derivedContextService', () => ( {
    DerivedStateResult: jest.fn().mockImplementation( ( options ) => options )
} ) );

describe( 'mendixEmbeddedContextService', () => {
    beforeEach( () => {
        DerivedStateResult.mockClear();
    } );

    it( 'subscribes to context paths used by the Mendix configuration', () => {
        const [ result ] = getMendixContextDerivedState( null, {
            config: 'https://apps.example.com/?uid={selection.uid}&type={selection.type}&mode=edit'
        } );

        // SWF supplies only the declared context dependencies to compute.
        const ctx = {
            selection: { uid: 'UID-123', type: 'ItemRevision' }
        };

        expect( DerivedStateResult ).toHaveBeenCalledWith( {
            ctxParameters: [ 'selection.uid', 'selection.type' ],
            compute: expect.any( Function )
        } );
        expect( result.compute( { ctx } ) ).toBe( ctx );
    } );

    it( 'uses an empty subscription when configuration is invalid', () => {
        getMendixContextDerivedState( null, { config: 'invalid URL' } );

        expect( DerivedStateResult ).toHaveBeenCalledWith( {
            ctxParameters: [],
            compute: expect.any( Function )
        } );
    } );
} );
