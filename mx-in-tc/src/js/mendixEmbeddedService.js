import {
  ensureHasValidSession,
  getResolvedMendixConfiguration,
  MendixEmbeddedError,
} from "./mendixEmbeddedUtils";

const RELOAD_EVENT = "embedded-app-reload";

const stateByContainerRef = new WeakMap();

export const loadMendix = async (
  containerRef,
  config,
  subPanelContext,
  context,
  reloadAction,
  dispatch,
) => {
  let state;
  const isCurrentLoad = () => stateByContainerRef.get(containerRef) === state;

  try {
    const { url, parameters, configurationKey } =
      getResolvedMendixConfiguration({ config, subPanelContext }, context);
    if (
      stateByContainerRef.get(containerRef)?.configurationKey ===
      configurationKey
    ) {
      return;
    }

    mendixCleanupFunction(containerRef);

    state = { configurationKey };
    stateByContainerRef.set(containerRef, state);
    dispatch({ path: "data.error", value: null });

    await ensureHasValidSession(url);

    const embeddedAppUrl = new URL("dist/embedded-index.js", url).toString();
    const app = await import(/* webpackIgnore: true */ embeddedAppUrl);

    if (!isCurrentLoad()) {
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

    if (!isCurrentLoad()) {
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
  } catch (error) {
    if (state && !isCurrentLoad()) {
      return;
    }

    mendixCleanupFunction(containerRef);
    dispatch({
      path: "data.error",
      value: {
        code: error?.code ?? "UNEXPECTED_ERROR",
        message: error?.message ?? "An unexpected error occurred.",
      },
    });
  }
};

export const mendixCleanupFunction = (containerRef) => {
  const state = stateByContainerRef.get(containerRef);
  stateByContainerRef.delete(containerRef);
  state?.cleanup?.();
};

export const reloadPage = () => window.location.reload();
