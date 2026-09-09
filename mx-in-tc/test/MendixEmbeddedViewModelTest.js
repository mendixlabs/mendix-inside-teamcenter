/* eslint-env jest */
import { act, waitFor } from '@testing-library/react';
import { renderWithCtx } from '@swf/core/test/testUtils';
import { createStore } from 'redux';
import { _dispatchCtx } from 'js/reactAppCtx';
import MendixEmbedded from 'viewmodel/MendixEmbeddedViewModel';
import { mountMendix } from '../src/js/mendixEmbeddedService';

jest.mock( '../src/js/mendixEmbeddedService', () => ( {
    ...jest.requireActual( '../src/js/mendixEmbeddedService' ),
    mountMendix: jest.fn().mockResolvedValue( undefined )
} ) );

describe( 'mendixEmbedded SWF lifecycle', () => {
    beforeEach( () => {
        jest.clearAllMocks();
        mountMendix.mockResolvedValue( undefined );
    } );

    it( 'loads a fixed configuration without context mappings', async() => {
        renderWithCtx( <MendixEmbedded config='https://apps.example.com/?mode=view' /> );
        await waitFor( () => expect( mountMendix ).toHaveBeenCalledWith(
            expect.any( Map ), 'https://apps.example.com/?mode=view',
            {}, expect.any( Function )
        ) );
    } );

    it( 'reloads on a mapped field change but ignores unrelated context changes', async() => {
        const unrelated = {};
        unrelated.circularReference = unrelated;
        const store = createStore( _dispatchCtx, { selected: { uid: 'A', other: 'ignored' }, unrelated } );
        renderWithCtx( <MendixEmbedded config='https://apps.example.com/?uid={selected.uid}' />, { store } );
        await waitFor( () => expect( mountMendix ).toHaveBeenCalledWith(
            expect.any( Map ), expect.any( String ),
            { selected: { uid: 'A' } }, expect.any( Function )
        ) );
        mountMendix.mockClear();
        await act( async() => { store.dispatch( { type: 'update', path: 'unrelated', value: 2 } ); } );
        expect( mountMendix ).not.toHaveBeenCalled();
        act( () => { store.dispatch( { type: 'update', path: 'selected.uid', value: 'B' } ); } );
        await waitFor( () => expect( mountMendix ).toHaveBeenCalledWith(
            expect.any( Map ), expect.any( String ),
            { selected: { uid: 'B' } }, expect.any( Function )
        ) );
    } );
} );
