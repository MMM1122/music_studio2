import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { engine } from "./audio/engine";
import { App } from "./app/App";
import "./themes/tokens.css";
import "./themes/app.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary onError={() => engine.stop()}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
// Read-only development hooks let browser tests inspect the same live store as React.
if (import.meta.env.DEV) {
  const [{ useProjectStore }, { engine }, { useMathLabStore }] =
    await Promise.all([
      import("./stores/projectStore"),
      import("./audio/engine"),
      import("./stores/mathLabStore"),
    ]);
  Object.defineProperty(window, "__studioTest", {
    configurable: true,
    value: {
      getProject: () => structuredClone(useProjectStore.getState().project),
      getLab: () => JSON.parse(JSON.stringify(useMathLabStore.getState())),
      getAudioState: () => ({
        level: engine.getLevel(),
        previewing: engine.isPreviewing(),
        playing: engine.isPlaying(),
        tick: engine.getTick(),
        previewTick: engine.getPreviewTick(),
        live: engine.isLivePreviewing(),
        referenceMode: engine.getReferenceMode(),
      }),
      hasAsset: (id: string) => engine.hasAsset(id),
    },
  });
}
