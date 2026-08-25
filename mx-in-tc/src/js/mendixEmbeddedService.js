import {
  ensureHasValidSession,
  getMendixConfiguration,
  getMendixParameters,
  MendixEmbeddedError,
} from "./mendixEmbeddedUtils";

const RELOAD_EVENT = "embedded-app-reload";
const CLEAR_ERROR_RESULT = { errorCode: "", errorMessage: "" };

const stateByContainerRef = new WeakMap();
const hasConfigurationChanged = (containerRef, configurationKey) =>
  stateByContainerRef.get(containerRef)?.configurationKey !== configurationKey;
const isCurrentLoad = (containerRef, state) =>
  stateByContainerRef.get(containerRef) === state;

export const loadMendix = async (
  containerRef,
  config,
  subPanelContext,
  context,
  reloadAction,
) => {
  let state;

  try {
    const { url, parameters: parameterMappings } = getMendixConfiguration({
      config,
      subPanelContext,
    });
    const parameters = getMendixParameters(context, parameterMappings);

    const configurationKey = JSON.stringify({ url, parameters });
    if (!hasConfigurationChanged(containerRef, configurationKey)) {
      return;
    }

    mendixCleanupFunction(containerRef);

    state = { configurationKey };
    stateByContainerRef.set(containerRef, state);

    await ensureHasValidSession(url);

    const app = await import(
      /* webpackIgnore: true */ `${url}dist/embedded-index.js`
    );

    if (!isCurrentLoad(containerRef, state)) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      throw new MendixEmbeddedError(
        "Unable to find the Mendix application container.",
        "CONTAINER_NOT_FOUND",
      );
    }

    const unmount = await app.render(container, {
      remoteUrl: url,
      minHeight: "100vh",
      parameters,
    });

    if (!isCurrentLoad(containerRef, state)) {
      unmount?.();
      return;
    }

    const onReload = () => {
      mendixCleanupFunction(containerRef);
      reloadAction();
    };
    container.addEventListener(RELOAD_EVENT, onReload, { once: true });

    state.cleanup = () => {
      container.removeEventListener(RELOAD_EVENT, onReload);
      unmount?.();
    };

    return CLEAR_ERROR_RESULT;
  } catch (error) {
    // A superseded load must not overwrite the outcome of the load that replaced it.
    if (state && !isCurrentLoad(containerRef, state)) {
      return;
    }

    mendixCleanupFunction(containerRef);
    return {
      errorCode: error?.code ?? "UNEXPECTED_ERROR",
      errorMessage: error?.message ?? "An unexpected error occurred.",
    };
  }
};

export const mendixCleanupFunction = (containerRef) => {
  const state = stateByContainerRef.get(containerRef);
  stateByContainerRef.delete(containerRef);
  state?.cleanup?.();
};
