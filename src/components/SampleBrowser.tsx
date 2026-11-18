import { useShallow } from "zustand/react/shallow";
import { useEffect, useRef, useState } from "react";
import { Search, Upload, Play, Square, Plus, AudioLines } from "lucide-react";
import { type AudioAsset, type AudioClip, uid } from "../domain/models";
import { createTrack } from "../domain/factories";
import { secondsToTicks } from "../domain/timing";
import { createReferenceTrack } from "../domain/reference";
import { useProjectStore } from "../stores/projectStore";
import { saveAsset, getAsset, deleteAsset } from "../persistence/database";
import { engine } from "../audio/engine";
const STARTERS: (AudioAsset & { url: string })[] = [
  {
    id: "starter-felt-kick",
    name: "Felt kick",
    duration: 0.55,
    mimeType: "audio/wav",
    category: "Drums",
    url: "samples/felt-kick.wav",
  },
  {
    id: "starter-soft-clap",
    name: "Soft clap",
    duration: 0.35,
    mimeType: "audio/wav",
    category: "Drums",
    url: "samples/soft-clap.wav",
  },
  {
    id: "starter-dusty-shaker",
    name: "Dusty shaker",
    duration: 0.22,
    mimeType: "audio/wav",
    category: "Percussion",
    url: "samples/dusty-shaker.wav",
  },
  {
    id: "starter-velvet-key",
    name: "Velvet chord · Cm7",
    duration: 2.5,
    mimeType: "audio/wav",
    category: "Keys",
    url: "samples/velvet-key.wav",
  },
  {
    id: "starter-air-texture",
    name: "Air texture · Cmaj7",
    duration: 3,
    mimeType: "audio/wav",
    category: "Synth",
    url: "samples/air-texture.wav",
  },
  {
    id: "starter-round-bass",
    name: "Round bass · C2",
    duration: 1.3,
    mimeType: "audio/wav",
    category: "Bass",
    url: "samples/round-bass.wav",
  },
];
export function SampleBrowser({
  onMessage,
  onInserted,
}: {
  onMessage: (s: string) => void;
  onInserted?: (reference: boolean) => void;
}) {
  const { projectAssets, update, selectClip } = useProjectStore(
    useShallow((state) => ({
      projectAssets: state.project.assets,
      update: state.update,
      selectClip: state.selectClip,
    })),
  );
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("All"),
    [preview, setPreview] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null),
    previewUrl = useRef("");
  const fileRef = useRef<HTMLInputElement>(null);
  const importRole = useRef<"sample" | "reference">("sample");
  const alive = useRef(true);
  const previewRequest = useRef(0);
  const [importError, setImportError] = useState("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      previewRequest.current++;
      player.current?.pause();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, []);
  async function blobFor(asset: AudioAsset) {
    const stored = await getAsset(asset.id);
    if (stored) return stored;
    const starter = STARTERS.find((a) => a.id === asset.id);
    if (starter) {
      // Starter sounds ship in /public; BASE_URL keeps the path right under any deploy folder.
      const response = await fetch(import.meta.env.BASE_URL + starter.url);
      if (!response.ok) throw new Error("Could not load the starter sample.");
      return response.blob();
    }
    throw new Error(
      "This audio file is missing from local storage. Please import it again.",
    );
  }
  async function play(asset: AudioAsset) {
    const request = ++previewRequest.current;
    try {
      player.current?.pause();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      if (preview === asset.id) {
        setPreview(null);
        return;
      }
      const blob = await blobFor(asset);
      if (!alive.current || request !== previewRequest.current) return;
      previewUrl.current = URL.createObjectURL(blob);
      const audio = new Audio(previewUrl.current);
      player.current = audio;
      audio.onended = () => setPreview(null);
      await audio.play();
      if (!alive.current || request !== previewRequest.current) {
        audio.pause();
        return;
      }
      setPreview(asset.id);
    } catch (e) {
      if (alive.current && request === previewRequest.current)
        onMessage(e instanceof Error ? e.message : "Preview failed.");
    }
  }
  async function insert(
    asset: AudioAsset,
    source?: Blob,
    reference = false,
    projectId = useProjectStore.getState().project.id,
  ) {
    const blob = source ?? (await blobFor(asset));
    const wasStored = !!(await getAsset(asset.id));
    try {
      if (!engine.hasAsset(asset.id))
        await engine.loadAsset(asset.id, await blob.arrayBuffer());
      await saveAsset(asset.id, blob);
      // Both decode and disk writes are asynchronous: never insert into a different session.
      const { project, selectedTrackId } = useProjectStore.getState();
      if (!alive.current || project.id !== projectId)
        throw new Error(
          "Import cancelled because the session or Samples window changed. Open Samples and import again.",
        );
      const selected = reference
        ? undefined
        : project.tracks.find(
            (t) =>
              t.id === selectedTrackId &&
              t.type === "audio" &&
              t.role !== "reference",
          );
      if (!selected && project.tracks.length >= 128)
        throw new Error(
          "This session already has 128 tracks. Remove a track before importing.",
        );
      const track = reference
        ? createReferenceTrack(asset, project.transport.bpm)
        : (selected ?? createTrack("audio"));
      if (!selected) track.name = asset.name.slice(0, 300);
      const clip: AudioClip = reference
        ? (track.clips[0] as AudioClip)
        : {
            id: uid(),
            type: "audio",
            name: asset.name.slice(0, 300),
            assetId: asset.id,
            startTick: Math.max(0, Math.round(engine.getTick() / 480) * 480),
            durationTicks: Math.max(
              1,
              secondsToTicks(asset.duration, project.transport.bpm),
            ),
            loop: false,
            gain: 1,
            offsetSeconds: 0,
          };
      update(reference ? "Import reference track" : "Add audio sample", (p) => {
        if (!p.assets.some((a) => a.id === asset.id))
          p.assets.push({ ...asset });
        if (reference) {
          p.tracks.unshift(track);
          p.transport.loop = false;
        } else if (selected)
          p.tracks.find((t) => t.id === selected.id)!.clips.push(clip);
        else p.tracks.push({ ...track, clips: [clip] });
      });
      selectClip(track.id, clip.id);
      onMessage(
        reference
          ? `${asset.name} imported as a reference. Arrangement looping is off; your BPM is unchanged.`
          : `${asset.name} added to the arrangement.`,
      );
      onInserted?.(reference);
    } catch (error) {
      if (!wasStored) {
        await deleteAsset(asset.id).catch(() => {});
        engine.unloadAsset(asset.id);
      }
      throw error;
    }
  }
  async function addSample(asset: AudioAsset) {
    setBusy(true);
    setImportError("");
    try {
      await insert(asset);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not add audio.";
      setImportError(message);
      onMessage(message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function importFile(file: File) {
    setImportError("");
    const reject = (message: string) => {
      setImportError(message);
      onMessage(message);
    };
    if (!file.size) {
      reject(
        "This file is empty. Choose an MP3, WAV or another browser-supported audio file.",
      );
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      reject(
        "Choose an audio file smaller than 50 MB. Export a shorter or more compressed copy first.",
      );
      return;
    }
    setBusy(true);
    const id = uid(),
      reference = importRole.current === "reference",
      projectId = useProjectStore.getState().project.id;
    try {
      // The engine owns the only decoded copy; analysis and playback share this PCM.
      const buffer = await engine.loadAsset(id, await file.arrayBuffer());
      const asset: AudioAsset = {
        id,
        name:
          file.name.replace(/\.[^.]+$/, "").slice(0, 300) || "Imported audio",
        duration: buffer.duration,
        mimeType: file.type || "audio/wav",
        category: reference ? "Reference" : "Imported",
      };
      await insert(asset, file, reference, projectId);
    } catch (error) {
      engine.unloadAsset(id);
      const message =
        error instanceof Error
          ? error.message
          : "This file could not be decoded. Export a WAV or MP3 copy and import it again.";
      if (alive.current) reject(message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const assets = [
    ...STARTERS,
    ...projectAssets.filter((a) => !STARTERS.some((s) => s.id === a.id)),
  ].filter(
    (a) =>
      a.name.toLowerCase().includes(query.toLowerCase()) &&
      (category === "All" ||
        (category === "One-shots" ? a.duration < 1 : a.category === category)),
  );
  return (
    <div className="sample-browser">
      <div className="library-search">
        <Search size={16} />
        <input
          aria-label="Search samples"
          placeholder="Find your next sound…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            importRole.current = "sample";
            fileRef.current?.click();
          }}
        >
          <Upload />
          Import audio
        </button>
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            importRole.current = "reference";
            fileRef.current?.click();
          }}
        >
          <Upload />
          Import Reference
        </button>
        <input
          aria-label="Audio import file"
          ref={fileRef}
          type="file"
          accept="audio/*,.wav,.mp3"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = "";
          }}
        />
      </div>
      {busy && (
        <p className="library-footnote" role="status">
          Decoding and saving locally… Long recordings may take a moment.
        </p>
      )}
      {importError && (
        <p className="import-audio-error" role="alert">
          {importError}
        </p>
      )}
      <p className="library-footnote">
        Import Reference adds a full song at 0:00 above your tracks and switches
        off arrangement looping. Its original speed and pitch are preserved;
        your project BPM stays unchanged. Audio is processed locally. Maximum 50
        MB per file.
      </p>
      <div className="filter-tabs">
        {[
          "All",
          "Drums",
          "Percussion",
          "Bass",
          "Keys",
          "Synth",
          "Melodic Loops",
          "One-shots",
          "Imported",
          "Reference",
        ].map((c) => (
          <button
            className={category === c ? "active" : ""}
            key={c}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="library-caption">
        <span>AUDIO SAMPLES</span>
        <span>{assets.length} sounds</span>
      </div>
      <div className="sample-list">
        {assets.map((a) => (
          <div className="sample-item" key={a.id}>
            <button
              className="sample-play"
              aria-label={`Preview ${a.name}`}
              onClick={() => void play(a)}
            >
              {preview === a.id ? <Square size={13} /> : <Play size={13} />}
            </button>
            <div>
              <strong>{a.name}</strong>
              <span>
                {a.category} <i>·</i> {a.duration.toFixed(2)} sec <i>·</i> Audio
              </span>
            </div>
            <AudioLines className="sample-wave" size={42} />
            <button
              className="button small"
              disabled={busy}
              aria-label={`Add ${a.name}`}
              onClick={() => void addSample(a)}
            >
              <Plus />
              Add
            </button>
          </div>
        ))}
        {!assets.length && (
          <div className="empty-state">
            <p>
              No sounds here yet. Import an audio file to build your collection.
            </p>
          </div>
        )}
      </div>
      <p className="library-footnote">
        Six original, freely reusable sounds. Imported audio stays in this
        browser. Audio clips play at their original speed; trimming and looping
        are available in the inspector.
      </p>
    </div>
  );
}
