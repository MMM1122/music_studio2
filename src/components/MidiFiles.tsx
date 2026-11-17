import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import type { Project } from "../domain/models";
import { exportMidi, MAX_MIDI_BYTES, readMidi } from "../midi/files";

export function MidiFiles({
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
  const [notice, setNotice] = useState("");
  const fail = (error: unknown) => {
    const text =
      error instanceof Error ? error.message : "MIDI operation failed.";
    setNotice(text);
    notify(text);
  };
  async function load(file: File) {
    setBusy(true);
    setNotice("");
    try {
      if (file.size > MAX_MIDI_BYTES)
        throw new Error("MIDI import is limited to 10 MB.");
      const result = readMidi(await file.arrayBuffer(), file.name);
      await onOpen(result.project);
      const text = `Imported ${result.project.tracks.length} MIDI track(s) at ${result.project.transport.bpm} BPM. ${result.warnings.join(" ")}`;
      setNotice(text);
      notify(text);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }
  function save() {
    try {
      const bytes = exportMidi(project);
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes).buffer], { type: "audio/midi" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${project.name.replace(/[\\/:*?"<>|]/g, "").trim() || "Session"}.mid`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const text =
        "MIDI exported: audible note tracks, clip timing and tempo. Audio and custom instrument sounds are not embedded.";
      setNotice(text);
      notify(text);
    } catch (error) {
      fail(error);
    }
  }
  return (
    <section className="midi-file-tools" aria-label="MIDI file tools">
      <div className="project-tools">
        <button
          className="button small"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Upload size={14} />
          {busy ? "Importing MIDI…" : "Import MIDI"}
        </button>
        <button className="button small" disabled={busy} onClick={save}>
          <Download size={14} />
          Export MIDI
        </button>
        <input
          hidden
          ref={input}
          aria-label="MIDI file"
          type="file"
          accept=".mid,.midi,audio/midi,audio/x-midi"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void load(file);
          }}
        />
      </div>
      <p className="library-footnote">
        Import creates a new project. MIDI carries notes and tempo, not audio
        recordings or your custom sound. Format 0/1, musical timing, one tempo
        and a 4/4 editing grid; additional tempo changes and unsupported
        controls are reported.
      </p>
      {notice && (
        <p className="library-footnote" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
