import { Component, type ReactNode } from "react";
import { useProjectStore } from "../stores/projectStore";
import {
  createProjectBackup,
  downloadProjectFile,
} from "../persistence/backup";

interface Props {
  children: ReactNode;
  onError?: () => void;
}
interface State {
  failed: boolean;
  message: string;
  busy: boolean;
}
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, message: "", busy: false };
  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }
  componentDidCatch() {
    try {
      this.props.onError?.();
    } catch {
      /* Keep the recovery surface available. */
    }
  }
  private backup = async (complete: boolean) => {
    this.setState({ busy: true, message: "" });
    try {
      const project = structuredClone(useProjectStore.getState().project);
      const blob = complete
        ? await createProjectBackup(project)
        : new Blob([JSON.stringify(project, null, 2)], {
            type: "application/json",
          });
      downloadProjectFile(
        blob,
        complete ? "STUDIO-recovery.studio" : "STUDIO-recovery.studio.json",
      );
      this.setState({
        message: complete
          ? "Complete recovery backup downloaded."
          : "Recovery JSON downloaded. Audio bytes are not included in JSON.",
      });
    } catch {
      this.setState({
        message: complete
          ? "Complete backup is unavailable. Try the recovery JSON to keep the notes and settings still in memory."
          : "Could not download a recovery copy. Previously saved projects remain in this browser.",
      });
    } finally {
      this.setState({ busy: false });
    }
  };
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main
        className="empty-state"
        role="alert"
        style={{
          minHeight: "100vh",
          padding: "40px 24px",
          maxWidth: 760,
          margin: "auto",
        }}
      >
        <h1>Let's keep your session safe.</h1>
        <p>
          STUDIO could not display this screen. Download a recovery copy of the
          open project before reloading; unsaved work may otherwise be lost.
        </p>
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <button
            className="button"
            disabled={this.state.busy}
            onClick={() => void this.backup(true)}
          >
            Download complete recovery
          </button>
          <button
            className="button"
            disabled={this.state.busy}
            onClick={() => void this.backup(false)}
          >
            Download recovery JSON
          </button>
          <button className="button" onClick={() => location.reload()}>
            Reload STUDIO
          </button>
        </div>
        <p role="status">{this.state.message}</p>
      </main>
    );
  }
}
