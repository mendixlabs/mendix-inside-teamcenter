import { DerivedStateResult } from 'js/derivedContextService';
import { getMendixContextPaths } from './mendixEmbeddedUtils';

export const getMendixContextDerivedState = ( _viewModel, props ) => {
    let ctxParameters = [];

    try {
        ctxParameters = getMendixContextPaths( props.config || props.subPanelContext?.declarativeKeyContext );
    } catch {
        // loadMendix reports configuration errors through the component error state.
    }

    return [
        new DerivedStateResult( {
            ctxParameters,
            compute: ( { ctx } ) => ctx
        } )
    ];
};
