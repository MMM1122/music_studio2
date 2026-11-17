import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import type { Project } from "../domain/models";
import {
  createProjectBackup,
  downloadProjectFile,
  restoreProjectBackup,
} from "../persistence/backup";

export function ProjectBackup({
  project,
  onOpen,
  notify,
}: {
  project: Project;
  onOpen: (project: Project) => Promise<void> | void;
  notify: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  async function exportComplete() {
    setBusy(true);
    setStatus("Packing project and audio…");
    try {
      const backup = await createProjectBackup(project);
      downloadProjectFile(
        backup,
        `${project.name.replace(/[^a-z0-9 _-]/gi, "").trim() || "Studio"}.studio`,
      );
      setStatus("Complete backup downloaded, including imported audio.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Could not export the complete project.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function importComplete(file: File) {
    setBusy(true);
    setStatus("Checking backup and audio integrity…");
    try {
      const restored = await restoreProjectBackup(file);
      setStatus("Backup restored as a separate project.");
      notify(
        "Complete backup restored as a separate project. Original projects are unchanged.",
      );
      await onOpen(restored);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Could not restore the complete project.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Complete project backup">
      <h4>Take your whole session with you.</h4>
      <p className="library-footnote">
        A single .studio file includes notes, settings, track sounds, and all
        imported audio. Imports create a separate project. Up to 256 MB.
      </p>
      <div className="project-tools">
        <button
          className="button small"
          disabled={busy}
          onClick={() => void exportComplete()}
        >
          <Download size={13} />
          Export complete project
        </button>
        <button
          className="button small"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Upload size={13} />
          Import complete project
        </button>
        <input
          hidden
          ref={input}
          aria-label="Complete project backup file"
          type="file"
          accept=".studio,application/octet-stream"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importComplete(file);
          }}
        />
      </div>
      <p className="library-footnote" role="status">
        {status}
      </p>
    </section>
  );
}
