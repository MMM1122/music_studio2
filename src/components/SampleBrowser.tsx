import { useEffect, useRef, useState } from "react";
import { Search, Upload, Play, Square, Plus, AudioLines } from "lucide-react";
import { type AudioAsset, type AudioClip, uid } from "../domain/models";
import { createTrack } from "../domain/factories";
import { secondsToTicks } from "../domain/timing";
import { useProjectStore } from "../stores/projectStore";
import { saveAsset, getAsset } from "../persistence/database";
import { engine } from "../audio/engine";
const STARTERS: (AudioAsset & { url: string })[] = [
  {
    id: "starter-felt-kick",
    name: "Felt kick",
    duration: 0.55,
    mimeType: "audio/wav",
    category: "Drums",
    url: "/samples/felt-kick.wav",
  },
  {
    id: "starter-soft-clap",
    name: "Soft clap",
    duration: 0.35,
    mimeType: "audio/wav",
    category: "Drums",
    url: "/samples/soft-clap.wav",
  },
  {
    id: "starter-dusty-shaker",
    name: "Dusty shaker",
    duration: 0.22,
    mimeType: "audio/wav",
    category: "Percussion",
    url: "/samples/dusty-shaker.wav",
  },
  {
    id: "starter-velvet-key",
    name: "Velvet chord · Cm7",
    duration: 2.5,
    mimeType: "audio/wav",
    category: "Keys",
    url: "/samples/velvet-key.wav",
  },
  {
    id: "starter-air-texture",
    name: "Air texture · Cmaj7",
    duration: 3,
    mimeType: "audio/wav",
    category: "Synth",
    url: "/samples/air-texture.wav",
  },
  {
    id: "starter-round-bass",
    name: "Round bass · C2",
    duration: 1.3,
    mimeType: "audio/wav",
    category: "Bass",
    url: "/samples/round-bass.wav",
  },
];
export function SampleBrowser({
  onMessage,
  tick,
}: {
  onMessage: (s: string) => void;
  tick: number;
}) {
  const { project, selectedTrackId, update, selectClip } = useProjectStore();
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("All"),
    [preview, setPreview] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null),
    previewUrl = useRef("");
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      player.current?.pause();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );
  async function blobFor(asset: AudioAsset) {
    const stored = await getAsset(asset.id);
    if (stored) return stored;
    const starter = STARTERS.find((a) => a.id === asset.id);
    if (starter) {
      const response = await fetch(starter.url);
      if (!response.ok) throw new Error("Could not load the starter sample.");
      return response.blob();
    }
    throw new Error(
      "This audio file is missing from local storage. Please import it again.",
    );
  }
  async function play(asset: AudioAsset) {
    try {
      player.current?.pause();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      if (preview === asset.id) {
        setPreview(null);
        return;
      }
      const blob = await blobFor(asset);
      previewUrl.current = URL.createObjectURL(blob);
      const audio = new Audio(previewUrl.current);
      player.current = audio;
      audio.onended = () => setPreview(null);
      await audio.play();
      setPreview(asset.id);
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Preview failed.");
    }
  }
  async function insert(asset: AudioAsset, source?: Blob) {
    setBusy(true);
    try {
      const blob = source ?? (await blobFor(asset));
      await saveAsset(asset.id, blob);
      await engine.loadAsset(asset.id, await blob.arrayBuffer());
      const selected = project.tracks.find(
        (t) => t.id === selectedTrackId && t.type === "audio",
      );
      const track = selected ?? createTrack("audio");
      if (!selected) track.name = asset.name;
      const clip: AudioClip = {
        id: uid(),
        type: "audio",
        name: asset.name,
        assetId: asset.id,
        startTick: Math.max(0, Math.round(tick / 480) * 480),
        durationTicks: Math.max(
          1,
          Math.round(secondsToTicks(asset.duration, project.transport.bpm)),
        ),
        loop: false,
        gain: 1,
        offsetSeconds: 0,
      };
      update("Add audio sample", (p) => {
        if (!p.assets.some((a) => a.id === asset.id))
          p.assets.push({ ...asset });
        if (selected)
          p.tracks.find((t) => t.id === selected.id)!.clips.push(clip);
        else p.tracks.push({ ...track, clips: [clip] });
      });
      selectClip(track.id, clip.id);
      onMessage(`${asset.name} added to the arrangement.`);
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Could not add audio.");
    } finally {
      setBusy(false);
    }
  }
  async function importFile(file: File) {
    if (file.size > 50 * 1024 * 1024) {
      onMessage("Choose an audio file smaller than 50 MB.");
      return;
    }
    setBusy(true);
    let ctx: AudioContext | undefined;
    try {
      ctx = new AudioContext();
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      const asset: AudioAsset = {
        id: uid(),
        name: file.name.replace(/\.[^.]+$/, ""),
        duration: buffer.duration,
        mimeType: file.type || "audio/wav",
        category: "Imported",
      };
      await insert(asset, file);
    } catch {
      onMessage("This file could not be decoded. Try a WAV or MP3 audio file.");
    } finally {
      await ctx?.close();
      setBusy(false);
    }
  }
  const assets = [
    ...STARTERS,
    ...project.assets.filter((a) => !STARTERS.some((s) => s.id === a.id)),
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
          onClick={() => fileRef.current?.click()}
        >
          <Upload />
          Import audio
        </button>
        <input
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
              onClick={() => void insert(a)}
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
