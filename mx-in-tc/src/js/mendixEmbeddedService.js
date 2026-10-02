import PopupBlockedErrorPanel from 'viewmodel/PopupBlockedErrorPanelViewModel';
import GeneralErrorPanel from 'viewmodel/GeneralErrorPanelViewModel';
import { ensureHasValidSession } from './mendixEmbeddedAuthentication';
import {
    getResolvedMendixConfiguration,
    MendixEmbeddedError
} from './mendixEmbeddedUtils';

const RELOAD_EVENT = 'embedded-app-reload';

const loadByContainerRef = new WeakMap();

export const mendixEmbeddedRenderFunction = ( { elementRefList, viewModel, actions } ) => {
    const { errorCode } = viewModel.data;

    return <>
        <div ref={elementRefList.get( 'mendixContainer' )}></div>

        {errorCode === 'POPUP_BLOCKED' && <PopupBlockedErrorPanel retry={() => actions.loadMendix( { elementRefList } )} />}

        {errorCode && errorCode !== 'POPUP_BLOCKED' &&
            <GeneralErrorPanel errorCode={errorCode} reload={actions.reload} />}
    </>;
};

export const mountMendix = async( elementRefList, config, context, reloadAction ) => {
    const containerRef = elementRefList.get( 'mendixContainer' );
    let signal;

    try {
        const { url, parameters, configurationKey } = getResolvedMendixConfiguration( config, context );

        if ( loadByContainerRef.get( containerRef )?.configurationKey === configurationKey ) {
            return;
        }

        mendixCleanupFunction( elementRefList );

        const controller = new AbortController();
        signal = controller.signal;

        loadByContainerRef.set( containerRef, { configurationKey, controller } );

        await ensureHasValidSession( url, signal );

        if ( signal.aborted ) {
            return;
        }

        const embeddedAppUrl = new URL( 'dist/embedded-index.js', url ).toString();
        const app = await import( /* webpackIgnore: true */ embeddedAppUrl );
        if ( signal.aborted ) {
            return;
        }

        if ( !containerRef.current ) {
            throw new MendixEmbeddedError( 'CONTAINER_NOT_FOUND' );
        }

        await renderMendixApp( app, containerRef.current, url, parameters, signal, () => {
            mendixCleanupFunction( elementRefList );
            reloadAction( { elementRefList } );
        } );

        if ( !signal.aborted ) {
            return { errorCode: null };
        }
    } catch ( error ) {
        if ( signal?.aborted ) {
            return;
        }

        mendixCleanupFunction( elementRefList );

        return { errorCode: error?.code ?? 'UNEXPECTED_ERROR' };
    }
};

const renderMendixApp = async( app, container, url, parameters, signal, onReload ) => {
    const appContainer = document.createElement( 'div' );
    container.appendChild( appContainer );

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

export const mendixCleanupFunction = ( elementRefList ) => {
    const containerRef = elementRefList.get( 'mendixContainer' );
    const load = loadByContainerRef.get( containerRef );

    loadByContainerRef.delete( containerRef );
    load?.controller.abort();
};

export const reloadPage = () => window.location.reload();
