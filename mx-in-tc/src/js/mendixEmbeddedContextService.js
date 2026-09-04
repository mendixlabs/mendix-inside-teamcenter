import { DerivedStateResult } from 'js/derivedContextService';
import { getMendixContextPaths } from './mendixEmbeddedUtils';

const getContextSnapshot = ( { ctx } ) => ctx;

export const getMendixContextDerivedState = ( _viewModel, props ) => {
    let ctxParameters = [];

    try {
        ctxParameters = getMendixContextPaths( props );
    } catch {
    // loadMendix reports configuration errors through the component error state.
    }

    return [
        new DerivedStateResult( {
            ctxParameters,
            compute: getContextSnapshot
        } )
    ];
};
