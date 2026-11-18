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
  const [
    { useProjectStore },
    { engine },
    { useMathLabStore },
    { usePerformanceStore },
  ] = await Promise.all([
    import("./stores/projectStore"),
    import("./audio/engine"),
    import("./stores/mathLabStore"),
    import("./stores/performanceStore"),
  ]);
  Object.defineProperty(window, "__studioTest", {
    configurable: true,
    value: {
      getProject: () => structuredClone(useProjectStore.getState().project),
      getLab: () => JSON.parse(JSON.stringify(useMathLabStore.getState())),
      getPerformance: () => ({ ...usePerformanceStore.getState() }),
      getTrackLevel: (id: string) => engine.getTrackLevel(id),
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
