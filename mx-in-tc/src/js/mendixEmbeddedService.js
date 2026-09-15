import PopupBlockedErrorPanel from 'viewmodel/PopupBlockedErrorPanelViewModel';
import GeneralErrorPanel from 'viewmodel/GeneralErrorPanelViewModel';
import {
    ensureHasValidSession,
    getResolvedMendixConfiguration,
    MendixEmbeddedError
} from './mendixEmbeddedUtils';

const RELOAD_EVENT = 'embedded-app-reload';

const stateByContainerRef = new WeakMap();

export const mendixEmbeddedRenderFunction = ( { elementRefList, viewModel, actions } ) => {
    const { errorCode } = viewModel.data;
    return <div className='aw-layout-flexColumn'>
        <div ref={elementRefList.get( 'mendixContainer' )} className='aw-layout-flexColumn'></div>
        {errorCode === 'POPUP_BLOCKED' && <PopupBlockedErrorPanel retry={() => actions.loadMendix( { elementRefList } )} />}
        {errorCode && errorCode !== 'POPUP_BLOCKED' &&
            <GeneralErrorPanel errorCode={errorCode} reload={actions.reload} />}
    </div>;
};

export const mountMendix = async( elementRefList, config, context, reloadAction ) => {
    const containerRef = elementRefList.get( 'mendixContainer' );
    let controller;

    try {
        const configuration = getResolvedMendixConfiguration( config, context );
        const { url, configurationKey } = configuration;
        if ( stateByContainerRef.get( containerRef )?.configurationKey === configurationKey ) {
            return;
        }

        mendixCleanupFunction( elementRefList );
        controller = new AbortController();
        stateByContainerRef.set( containerRef, { configurationKey, controller } );

        await ensureHasValidSession( url, controller.signal );
        if ( controller.signal.aborted ) {
            return;
        }

        const embeddedAppUrl = new URL( 'dist/embedded-index.js', url ).toString();
        const app = await import( /* webpackIgnore: true */ embeddedAppUrl );
        await renderMendixApp( app, containerRef.current, configuration, controller.signal, () => {
            mendixCleanupFunction( elementRefList );
            reloadAction( { elementRefList } );
        } );
        if ( !controller.signal.aborted ) {
            return { errorCode: null };
        }
    } catch ( error ) {
        if ( controller?.signal.aborted ) {
            return;
        }

        mendixCleanupFunction( elementRefList );
        return { errorCode: error?.code ?? 'UNEXPECTED_ERROR' };
    }
};

const renderMendixApp = async( app, container, { url, parameters }, signal, onReload ) => {
    if ( signal.aborted ) {
        return;
    }
    if ( !container ) {
        throw new MendixEmbeddedError( 'CONTAINER_NOT_FOUND' );
    }

    const appContainer = createAppContainer( container );
    appContainer.addEventListener( RELOAD_EVENT, onReload, { once: true, signal } );

    let unmount;
    signal.addEventListener( 'abort', () => {
        try {
            unmount?.();
        } finally {
            appContainer.remove();
        }
    }, { once: true } );

    unmount = await app.render( appContainer, { remoteUrl: url, minHeight: '100vh', parameters } );
    if ( signal.aborted ) {
        unmount?.();
    }
};

const createAppContainer = ( container ) => {
    // Isolate renders so stale cleanup cannot remove a newer app.
    const appContainer = document.createElement( 'div' );
    appContainer.className = 'aw-layout-flexColumn';
    container.appendChild( appContainer );
    return appContainer;
};

export const mendixCleanupFunction = ( elementRefList ) => {
    const containerRef = elementRefList.get( 'mendixContainer' );
    const state = stateByContainerRef.get( containerRef );
    stateByContainerRef.delete( containerRef );
    state?.controller.abort();
};

export const reloadPage = () => window.location.reload();
