import { useCallback, useState } from 'react';

import PopupBlockedView from '../viewmodel/PopupBlockedViewModel';
import GeneralErrorViewModel from '../viewmodel/GeneralErrorViewModel';
import { ensureHasValidSession, getMendixConfiguration, getMendixParameters } from './mendixEmbeddedUtils';

const RELOAD_EVENT = 'embedded-app-reload';

let currentMendixCleanup;

export const mendixRenderFunction = (props) => {
    const [error, setError] = useState(undefined);

    const { url: mendixUrl, parameters: parameterMappings } = getMendixConfiguration(props);
    const parameters = getMendixParameters(props.ctx, parameterMappings);
    const parameterValues = parameterMappings.map(([target]) => parameters[target]);

    const retryError = () => {
        setError(undefined);
    };


    const load = useCallback(async (container) => {
        mendixCleanupFunction();

        if (!container) {
            return;
        }

        try {
            await ensureHasValidSession(mendixUrl);

            const app = await import(/* webpackIgnore: true */ `${mendixUrl}dist/embedded-index.js`);
            const cleanup = await app.render(container, { remoteUrl: mendixUrl, minHeight: '100vh', parameters });

            const onReload = () => load(container);
            container.addEventListener(RELOAD_EVENT, onReload, { once: true });

            currentMendixCleanup = () => {
                container.removeEventListener(RELOAD_EVENT, onReload);
                cleanup?.();
            };
        } catch (error) {
            setError(error);
        }
    }, [mendixUrl, ...parameterValues]);


    if (error) {
        if (error.code === 'POPUP_BLOCKED') {
            return <PopupBlockedView subPanelContext={{ retry: retryError }} />;
        }

        return <GeneralErrorViewModel subPanelContext={{ errorMessage: error.message ?? 'An unexpected error occurred.', retry: retryError }} />;
    }


    return <div ref={load} style={{ width: '100%', height: '100vh' }} />;
};

export const mendixCleanupFunction = () => {
    const cleanup = currentMendixCleanup;
    currentMendixCleanup = undefined;
    cleanup?.();
};
