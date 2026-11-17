import { useShallow } from "zustand/react/shallow";
import { useEffect, useState } from "react";
import { Sparkles, Play, Plus, RefreshCw, Square } from "lucide-react";
import {
  generateSuggestions,
  type Suggestion,
  type SuggestionCategory,
} from "../ai/suggestions";
import { createTrack, createMidiClip } from "../domain/factories";
import { useProjectStore } from "../stores/projectStore";
import { engine } from "../audio/engine";
import { BAR, uid } from "../domain/models";
export function Ideas({ onMessage }: { onMessage: (s: string) => void }) {
  const { musicalKey, bpm, update, selectClip } = useProjectStore(
    useShallow((state) => ({
      musicalKey: state.project.key,
      bpm: state.project.transport.bpm,
      update: state.update,
      selectClip: state.selectClip,
    })),
  );
  const [category, setCategory] = useState<SuggestionCategory>("bassline");
  const [seed, setSeed] = useState(1);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => () => engine.stopPreview(), []);
  const generate = () => {
    engine.stopPreview();
    setPreview(null);
    // Read the latest notes only when generating. Selection/history changes do not
    // need to re-render an already displayed set of suggestions.
    const { project, selectedClipId } = useProjectStore.getState();
    const clip = project.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === selectedClipId);
    const pattern =
      clip?.type === "midi" ? project.patterns[clip.patternId] : undefined;
    // Ideas are written for the bar under the playhead, where "Use idea" will place them.
    setSuggestions(
      generateSuggestions(project, category, seed, pattern, engine.getTick()),
    );
    setSeed(seed + 1);
  };
  function accept(s: Suggestion) {
    const p = structuredClone(s.pattern);
    p.id = uid();
    p.notes.forEach((n) => (n.id = uid()));
    const track = createTrack(s.instrument);
    track.name = s.name;
    const c = createMidiClip(p, Math.floor(engine.getTick() / BAR) * BAR);
    track.clips = [c];
    update("Accept inspiration", (d) => {
      d.patterns[p.id] = p;
      d.tracks.push(track);
    });
    selectClip(track.id, c.id);
    engine.stopPreview();
    setPreview(null);
    onMessage(
      "Idea added as a new editable track. Your original is preserved.",
    );
  }
  return (
    <div className="ideas-panel">
      <div className="idea-intro">
        <Sparkles size={24} />
        <h3>
          A small spark.
          <br />
          <em>Entirely your sound.</em>
        </h3>
        <p>
          Explore musical possibilities in {musicalKey} at {bpm} BPM. Keep what
          moves you, change everything else.
        </p>
      </div>
      <div className="idea-controls">
        <select
          aria-label="Idea category"
          value={category}
          onChange={(e) => setCategory(e.target.value as SuggestionCategory)}
        >
          {[
            ["bassline", "Bassline ideas"],
            ["melody", "Melody ideas"],
            ["chords", "Chord voicings"],
            ["drums", "Drum variations"],
            ["rhythm", "Rhythmic variations"],
            ["continue", "Phrase continuation"],
          ].map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button className="button primary" onClick={generate}>
          {suggestions.length ? <RefreshCw /> : <Sparkles />}Explore ideas
        </button>
      </div>
      {suggestions.map((s) => (
        <div className="idea-item" key={s.id}>
          <div>
            <strong>{s.name}</strong>
            <p>{s.description}</p>
            <span className="tag">{s.pattern.notes.length} editable notes</span>
          </div>
          <div>
            <button
              className="icon-button"
              title={`Preview ${s.name}`}
              onClick={() => {
                if (preview === s.id) {
                  engine.stopPreview();
                  setPreview(null);
                } else
                  void engine
                    .previewPattern(
                      useProjectStore.getState().project,
                      s.pattern,
                      s.instrument,
                    )
                    .then(() => setPreview(s.id))
                    .catch((e) => onMessage(String(e)));
              }}
            >
              {preview === s.id ? <Square /> : <Play />}
            </button>
            <button className="button small" onClick={() => accept(s)}>
              <Plus />
              Use idea
            </button>
          </div>
        </div>
      ))}
      <p className="library-footnote">
        Local inspiration uses music theory and seeded patterns. Works offline,
        without AI credentials. No external AI service is connected.
      </p>
    </div>
  );
}
