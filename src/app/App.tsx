import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Play,
  Pause,
  Square,
  Repeat2,
  Undo2,
  Redo2,
  Sun,
  Moon,
  Download,
  Save,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  SlidersHorizontal,
  FolderOpen,
  Music2,
  AudioLines,
  Sparkles,
  Sigma,
  Settings2,
  ChevronDown,
  ChevronUp,
  Copy,
  Trash2,
  KeyboardMusic,
  Check,
  X,
  CircleHelp,
  Headphones,
  ArrowUpRight,
  Circle,
  Timer,
  Keyboard as KeyboardIcon,
  Cable,
} from "lucide-react";
import {
  connectMidi,
  setArmed,
  setMetronome,
  startPerformance,
} from "../input/performance";
import { usePerformanceStore } from "../stores/performanceStore";
import {
  BAR,
  INSTRUMENTS,
  uid,
  type Project,
  type InstrumentType,
  type Clip,
  type Pattern,
  type Instrument,
} from "../domain/models";
import {
  createProject,
  createDemoProject,
  createTrack,
  createPattern,
  createMidiClip,
} from "../domain/factories";
import { KEYS } from "../domain/theory";
import { arrangementEnd, ticksToSeconds } from "../domain/timing";
import { useProjectStore } from "../stores/projectStore";
import {
  refreshTransport,
  startTransportSync,
  useTransportStore,
} from "../stores/transportStore";
import {
  saveProject,
  loadProject,
  listProjects,
  deleteProject,
  getAsset,
  readPreference,
  writePreference,
} from "../persistence/database";
import { validateProject } from "../domain/validation";
import { engine } from "../audio/engine";
import { compositionProject, isTrackAudible } from "../audio/scheduler";
import { ReferenceAnalysis } from "../components/ReferenceAnalysis";
import { Arrangement } from "../components/Arrangement";
import { Inspector, Range } from "../components/Inspector";
import { PianoRoll } from "../components/PianoRoll";
import { DrumSequencer } from "../components/DrumSequencer";
import { Keyboard } from "../components/Keyboard";
import { BpmInput } from "../components/BpmInput";
import { NumberField } from "../components/NumberField";
import { Modal } from "../components/Modal";
import { SampleBrowser } from "../components/SampleBrowser";
import { Ideas } from "../components/Ideas";
import { LevelMeter, PositionReadout } from "../components/TransportReadouts";
import { SessionArtwork } from "../components/SessionArtwork";

const MathLab = lazy(() =>
  import("../components/MathLab").then((module) => ({
    default: module.MathLab,
  })),
);
import { ProjectBackup } from "../components/ProjectBackup";
import { StorageProtection } from "../components/StorageProtection";
import { MidiFiles } from "../components/MidiFiles";
import { useMathLabStore } from "../stores/mathLabStore";
import { insertLabPattern, applyLabInstrument } from "../math/studio";

type Panel =
  | "samples"
  | "ideas"
  | "projects"
  | "settings"
  | "add-track"
  | "export"
  | "help"
  | null;
export function App() {
  const workspace = useMathLabStore((state) => state.workspace);
  const setWorkspace = useMathLabStore((state) => state.setWorkspace);
  const {
    project,
    selectedTrackId,
    selectedClipId,
    selectedNoteIds,
    selectTrack,
    selectClip,
    selectNotes,
    update,
    load,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useProjectStore(
    useShallow((state) => ({
      project: state.project,
      selectedTrackId: state.selectedTrackId,
      selectedClipId: state.selectedClipId,
      selectedNoteIds: state.selectedNoteIds,
      selectTrack: state.selectTrack,
      selectClip: state.selectClip,
      selectNotes: state.selectNotes,
      update: state.update,
      load: state.load,
      undo: state.undo,
      redo: state.redo,
      canUndo: state.canUndo,
      canRedo: state.canRedo,
    })),
  );
  const [theme, setTheme] = useState(() =>
    readPreference("theme") === "dark" ? "dark" : "light",
  );
  const [sidebar, setSidebar] = useState(true),
    [inspector, setInspector] = useState(true),
    [editor, setEditor] = useState(true),
    [keyboard, setKeyboard] = useState(false);
  // Playback readings come from their own store; this component re-renders when playback
  // starts or stops, never because the playhead moved.
  const playing = useTransportStore((state) => state.playing);
  const patternPreview = useTransportStore((state) => state.previewing);
  const armed = usePerformanceStore((state) => state.armed);
  const metronome = usePerformanceStore((state) => state.metronome);
  const typing = usePerformanceStore((state) => state.typing);
  const typingOctave = usePerformanceStore((state) => state.octave);
  const midi = usePerformanceStore((state) => state.midi);
  const midiDevices = usePerformanceStore((state) => state.midiDevices);
  const [panel, setPanel] = useState<Panel>(null),
    [ready, setReady] = useState(false),
    [saveStatus, setSaveStatus] = useState("Opening local session…"),
    [toast, setToast] = useState("");
  const [assetRevision, setAssetRevision] = useState(0);
  const hydration = useRef(0);
  const [audioReady, setAudioReady] = useState(false),
    [projectList, setProjectList] = useState<Project[]>([]),
    [patternId, setPatternId] = useState<string | null>(null),
    [exporting, setExporting] = useState(false),
    [exportProgress, setExportProgress] = useState(0);
  const [newName, setNewName] = useState("Untitled session");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const clipboard = useRef<Clip | null>(null);
  const importedProject = useRef<HTMLInputElement>(null);
  const track = project.tracks.find((t) => t.id === selectedTrackId);
  const clip = track?.clips.find((c) => c.id === selectedClipId);
  const pattern =
    project.patterns[
      patternId ?? (clip?.type === "midi" ? clip.patternId : "")
    ];
  const notify = useCallback((text: string) => setToast(text), []);
  const closePanel = useCallback(() => {
    engine.stopPreview();
    setPanel(null);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writePreference("theme", theme);
  }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  const hydrateAssets = useCallback(
    async (p: Project) => {
      const request = ++hydration.current;
      engine.retainAssets(p.assets.map((a) => a.id));
      const problems: string[] = [];
      for (const asset of p.assets) {
        if (
          request !== hydration.current ||
          useProjectStore.getState().project.id !== p.id
        )
          return;
        try {
          if (!engine.hasAsset(asset.id)) {
            const blob = await getAsset(asset.id);
            if (!blob)
              throw new Error(
                "missing from local storage; re-import the original file",
              );
            await engine.loadAsset(asset.id, await blob.arrayBuffer());
          }
        } catch (error) {
          problems.push(`${asset.name}: ${errorMessage(error)}`);
        }
        if (
          request !== hydration.current ||
          useProjectStore.getState().project.id !== p.id
        ) {
          engine.retainAssets(
            useProjectStore.getState().project.assets.map((a) => a.id),
          );
          return;
        }
        setAssetRevision((value) => value + 1);
      }
      if (problems.length)
        notify(`Audio could not reopen. ${problems.join("; ")}`);
    },
    [notify],
  );
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const id = readPreference("currentProject");
        if (id) {
          const stored = await loadProject(id);
          if (stored && !cancelled) {
            load(stored);
            await hydrateAssets(stored);
          }
        }
      } catch (e) {
        if (!cancelled)
          notify(`Could not reopen the last session: ${errorMessage(e)}`);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, hydrateAssets, notify]);
  useEffect(() => {
    if (!ready) return;
    engine.update(project);
    setSaveStatus("Unsaved changes");
    const timer = setTimeout(() => {
      void saveProject(project)
        .then(() => {
          writePreference("currentProject", project.id);
          setSaveStatus("All changes saved");
        })
        .catch((e) => {
          setSaveStatus("Save failed");
          notify(errorMessage(e));
        });
    }, 700);
    return () => clearTimeout(timer);
  }, [project, ready, notify]);
  useEffect(() => startTransportSync(), []);
  useEffect(() => startPerformance(notify), [notify]);
  // Dialogs and the Math Lab own the keyboard while they are open.
  useEffect(() => {
    usePerformanceStore.setState({
      suspended: panel !== null || workspace !== "studio",
    });
  }, [panel, workspace]);
  useEffect(() => {
    setPatternId(null);
    engine.stopPreview();
    refreshTransport();
  }, [selectedClipId]);
  useEffect(() => {
    if (panel === "projects")
      void listProjects()
        .then(setProjectList)
        .catch((e) => notify(errorMessage(e)));
  }, [panel, notify]);
  const togglePlay = useCallback(async () => {
    try {
      engine.stopPreview();
      if (engine.isPlaying()) engine.pause();
      else {
        await engine.play(useProjectStore.getState().project);
        setAudioReady(true);
      }
      refreshTransport();
    } catch (e) {
      notify(`Audio could not start: ${errorMessage(e)}`);
    }
  }, [notify]);
  const stop = useCallback(() => {
    engine.stop();
    engine.stopPreview();
    refreshTransport();
  }, []);
  function changeWorkspace(next: "studio" | "math") {
    engine.pause();
    engine.stopPreview();
    engine.stopLabNotes();
    refreshTransport();
    setPanel(null);
    setWorkspace(next);
  }
  function addFromLab(source: Pattern, instrument: Instrument, bpm: number) {
    try {
      engine.stopPreview();
      engine.stopLabNotes();
      let inserted: { trackId: string; clipId: string } | undefined;
      update("Add Math Lab sequence", (draft) => {
        inserted = insertLabPattern(
          draft,
          source,
          instrument,
          engine.getTick(),
          bpm,
        );
      });
      if (inserted) selectClip(inserted.trackId, inserted.clipId);
      setEditor(true);
      setInspector(true);
      setWorkspace("studio");
      refreshTransport();
      notify(
        `Added to Studio at ${useProjectStore.getState().project.transport.bpm} BPM. Edit the notes in the piano roll.`,
      );
    } catch (error) {
      notify(errorMessage(error));
    }
  }
  function applyFromLab(instrument: Instrument, trackId?: string) {
    try {
      engine.stopPreview();
      engine.stopLabNotes();
      let applied: { trackId: string; clipId: string | null } | undefined;
      update("Apply Math Lab instrument", (draft) => {
        applied = applyLabInstrument(draft, instrument, trackId);
      });
      if (applied) selectClip(applied.trackId, applied.clipId);
      setEditor(true);
      setInspector(true);
      setWorkspace("studio");
      notify(
        trackId
          ? "Fourier sound applied. Your existing notes will use this instrument."
          : "Fourier track added. Draw notes in the piano roll to compose with it.",
      );
    } catch (error) {
      notify(errorMessage(error));
    }
  }
  async function save() {
    setSaveStatus("Saving…");
    try {
      await saveProject(project);
      writePreference("currentProject", project.id);
      setSaveStatus("All changes saved");
      notify("Project saved in this browser.");
    } catch (e) {
      setSaveStatus("Save failed");
      notify(errorMessage(e));
    }
  }
  async function openProject(p: Project) {
    try {
      await saveProject(project);
      stop();
      load(p);
      writePreference("currentProject", p.id);
      await hydrateAssets(p);
      setPanel(null);
    } catch (e) {
      notify(errorMessage(e));
    }
  }
  function addTrack(type: InstrumentType | "audio") {
    const t = createTrack(type);
    if (type !== "audio") {
      const p = createPattern(type === "drum-kit" ? "drums" : "midi");
      t.clips = [createMidiClip(p)];
      update("Add track", (d) => {
        d.patterns[p.id] = p;
        d.tracks.push(t);
      });
      selectClip(t.id, t.clips[0].id);
    } else {
      update("Add audio track", (d) => d.tracks.push(t));
      selectTrack(t.id);
    }
    setEditor(true);
    setPanel(null);
    if (type === "audio") setPanel("samples");
  }
  const audition = useCallback(
    (pitch: number, velocity?: number) => {
      if (!track) return;
      void engine
        .audition(track, pitch, velocity)
        .then(() => setAudioReady(true))
        .catch((e) => notify(errorMessage(e)));
    },
    [track, notify],
  );
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.closest(
          'input,textarea,select,[contenteditable="true"]',
        )
      )
        return;
      if (panel || workspace === "math" || e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === "Space") {
        e.preventDefault();
        void togglePlay();
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveProject(useProjectStore.getState().project)
          .then(() => notify("Project saved."))
          .catch((err) => notify(errorMessage(err)));
      } else if (e.key === "Escape") {
        selectNotes([]);
      } else if (clip && track) {
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          update("Delete clip", (p) => {
            p.tracks.forEach(
              (t) => (t.clips = t.clips.filter((c) => c.id !== clip.id)),
            );
          });
        } else if (mod && e.key.toLowerCase() === "c") {
          e.preventDefault();
          clipboard.current = structuredClone(clip);
        } else if (
          mod &&
          (e.key.toLowerCase() === "v" || e.key.toLowerCase() === "d")
        ) {
          e.preventDefault();
          const source = e.key.toLowerCase() === "d" ? clip : clipboard.current;
          if (!source) return;
          if (
            (source.type === "audio") !== (track.type === "audio") ||
            (track.role === "reference" &&
              source.type === "audio" &&
              track.clips.some(
                (c) => c.type === "audio" && c.assetId !== source.assetId,
              )) ||
            (source.type === "midi" &&
              project.patterns[source.patternId]?.kind !==
                (track.type === "drums" ? "drums" : "midi"))
          ) {
            notify("Select a compatible track before pasting this clip.");
            return;
          }
          const copy = {
            ...source,
            id: uid(),
            startTick:
              e.key.toLowerCase() === "d"
                ? clip.startTick + clip.durationTicks
                : Math.floor(engine.getTick() / 480) * 480,
          };
          update("Duplicate clip", (p) =>
            p.tracks.find((t) => t.id === track.id)!.clips.push(copy),
          );
          selectClip(track.id, copy.id);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    workspace,
    panel,
    clip,
    track,
    project,
    togglePlay,
    undo,
    redo,
    selectNotes,
    update,
    selectClip,
    notify,
  ]);
  async function exportAudio() {
    setExporting(true);
    setExportProgress(0);
    try {
      const blob = await engine.exportWav(project, setExportProgress);
      download(
        blob,
        `${project.name.replace(/[^a-z0-9 _-]/gi, "").trim() || "Studio"}.wav`,
      );
      notify("WAV exported. Your sound, ready to share.");
      setPanel(null);
    } catch (e) {
      notify(`Export failed: ${errorMessage(e)}`);
    } finally {
      setExporting(false);
    }
  }
  function newPattern(duplicate = false) {
    if (!track || track.type === "audio") return;
    const p =
      duplicate && pattern
        ? structuredClone(pattern)
        : createPattern(track.type === "drums" ? "drums" : "midi");
    p.id = uid();
    p.notes.forEach((n) => (n.id = uid()));
    if (duplicate) p.name += " copy";
    update(duplicate ? "Duplicate pattern" : "Create pattern", (d) => {
      d.patterns[p.id] = p;
    });
    setPatternId(p.id);
    selectNotes([]);
  }
  function insertPattern() {
    if (!pattern || !track) return;
    const c = createMidiClip(pattern, Math.floor(engine.getTick() / BAR) * BAR);
    update("Insert pattern", (p) =>
      p.tracks.find((t) => t.id === track.id)!.clips.push(c),
    );
    selectClip(track.id, c.id);
    notify("Pattern inserted at the playhead.");
  }
  useEffect(() => {
    const cleanup = () => engine.stop();
    window.addEventListener("pagehide", cleanup);
    return () => window.removeEventListener("pagehide", cleanup);
  }, []);
  const duration = ticksToSeconds(
    arrangementEnd(project),
    project.transport.bpm,
  );
  const exportProject = compositionProject(project);
  const exportDuration = ticksToSeconds(
    arrangementEnd(exportProject),
    project.transport.bpm,
  );
  return (
    <div
      className={`studio-app ${sidebar ? "" : "sidebar-collapsed"} ${inspector ? "" : "inspector-collapsed"}`}
    >
      <header className="transport">
        <div className="brand">
          <div className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </div>
          <span>
            STUDIO<span className="brand-period">.</span>
          </span>
        </div>
        <div className="project-identity">
          <input
            aria-label="Project title"
            value={project.name}
            onChange={(e) =>
              update(
                "Rename project",
                (p) => {
                  p.name = e.target.value;
                },
                { coalesceKey: "project-name" },
              )
            }
            onBlur={() => {
              if (!project.name.trim())
                update("Name project", (p) => {
                  p.name = "Untitled session";
                });
            }}
          />
          <span>
            <i
              className={saveStatus === "All changes saved" ? "saved-dot" : ""}
            />
            {saveStatus}
          </span>
        </div>
        <div className="transport-controls">
          <button
            className={`play-button ${playing ? "playing" : ""}`}
            aria-label={playing ? "Pause" : "Play"}
            title="Play / Pause · Space"
            onClick={() => void togglePlay()}
          >
            {playing ? (
              <Pause size={17} fill="currentColor" />
            ) : (
              <Play size={17} fill="currentColor" />
            )}
          </button>
          <button
            className="icon-button"
            aria-label="Stop"
            title="Stop"
            onClick={stop}
          >
            <Square size={15} />
          </button>
          <button
            className={`icon-button loop-button ${project.transport.loop ? "active" : ""}`}
            title="Loop arrangement"
            aria-label="Loop"
            aria-pressed={project.transport.loop}
            onClick={() =>
              update("Toggle loop", (p) => {
                p.transport.loop = !p.transport.loop;
              })
            }
          >
            <Repeat2 />
          </button>
          <button
            className={`icon-button record-button ${armed ? "active" : ""}`}
            title={
              armed
                ? "Recording is on: press Play, then play notes · R"
                : "Record what you play into the selected track · R"
            }
            aria-label="Record"
            aria-pressed={armed}
            onClick={() => setArmed(!armed)}
          >
            <Circle size={13} fill={armed ? "currentColor" : "none"} />
          </button>
          <button
            className={`icon-button loop-button ${metronome ? "active" : ""}`}
            title="Metronome: a click on every beat while playing"
            aria-label="Metronome"
            aria-pressed={metronome}
            onClick={() => setMetronome(!metronome)}
          >
            <Timer size={15} />
          </button>
          <PositionReadout />
          <span className="divider" />
          <label className="bpm-control">
            <BpmInput
              bpm={project.transport.bpm}
              onChange={(bpm) =>
                update(
                  "Change tempo",
                  (p) => {
                    p.transport.bpm = bpm;
                  },
                  { coalesceKey: "tempo" },
                )
              }
            />
            <span>BPM</span>
          </label>
          <span className="time-signature" title="4/4 time signature">
            4/4
          </span>
          <select
            className="key-select"
            aria-label="Musical key"
            value={project.key}
            onChange={(e) =>
              update("Change key", (p) => {
                p.key = e.target.value;
              })
            }
          >
            {KEYS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </div>
        <div className="transport-actions">
          <button
            className="icon-button"
            title="Undo · ⌘Z"
            disabled={!canUndo}
            onClick={undo}
          >
            <Undo2 />
          </button>
          <button
            className="icon-button"
            title="Redo · ⇧⌘Z"
            disabled={!canRedo}
            onClick={redo}
          >
            <Redo2 />
          </button>
          <span className="divider" />
          <button
            className="icon-button"
            title="Save project · ⌘S"
            aria-label="Save project"
            onClick={() => void save()}
          >
            <Save />
          </button>
          <button
            className="button export-button"
            onClick={() => setPanel("export")}
          >
            <Download />
            Export
          </button>
          <button
            className="icon-button theme-button"
            aria-label={
              theme === "light"
                ? "Switch to dark theme"
                : "Switch to light theme"
            }
            title={theme === "light" ? "Dark mode" : "Gallery light mode"}
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            {theme === "light" ? <Moon /> : <Sun />}
          </button>
        </div>
      </header>
      <div className="studio-body">
        <nav className="sidebar" aria-label="Main navigation">
          <div className="sidebar-top">
            <span className="tiny muted">WORKSPACE</span>
            <button
              className="icon-button"
              title="Collapse sidebar"
              onClick={() => setSidebar(!sidebar)}
            >
              {sidebar ? <PanelLeftClose /> : <PanelLeftOpen />}
            </button>
          </div>
          <button
            className={`nav-item ${workspace === "studio" ? "active" : ""}`}
            title="Studio"
            aria-current={workspace === "studio" ? "page" : undefined}
            onClick={() => changeWorkspace("studio")}
          >
            <Music2 />
            <span>Studio</span>
            {workspace === "studio" && <span className="nav-dot" />}
          </button>
          <button
            className={`nav-item ${workspace === "math" ? "active" : ""}`}
            title="Math Lab"
            aria-current={workspace === "math" ? "page" : undefined}
            onClick={() => changeWorkspace("math")}
          >
            <Sigma />
            <span>Math Lab</span>
          </button>
          <button
            className={`nav-item ${panel === "samples" ? "selected" : ""}`}
            title="Samples"
            onClick={() => setPanel("samples")}
          >
            <AudioLines />
            <span>Samples</span>
          </button>
          <button
            className="nav-item"
            title="AI Ideas"
            onClick={() => setPanel("ideas")}
          >
            <Sparkles />
            <span>AI Ideas</span>
            <span className="local-tag">LOCAL</span>
          </button>
          <div className="sidebar-rule" />
          <button
            className="nav-item"
            title="Projects"
            onClick={() => setPanel("projects")}
          >
            <FolderOpen />
            <span>Projects</span>
          </button>
          <button
            className="nav-item"
            title="Settings"
            onClick={() => setPanel("settings")}
          >
            <Settings2 />
            <span>Settings</span>
          </button>
          <button
            className="new-session"
            title="New session"
            onClick={() => setPanel("projects")}
          >
            <Plus size={14} />
            <span>New session</span>
          </button>
          <div className="sidebar-bottom">
            <div className="quiet-note">
              <span>
                Room for
                <br />
                your own sound.
              </span>
              <div className="quiet-line" />
            </div>
            <button
              className="nav-item"
              title="Keyboard shortcuts"
              onClick={() => setPanel("help")}
            >
              <CircleHelp />
              <span>A little guidance</span>
            </button>
            <div className="version-label">STUDIO / V.1.6</div>
          </div>
        </nav>
        {workspace === "math" ? (
          <Suspense
            fallback={
              <main className="workspace">
                <div className="empty-state" role="status">
                  Opening the creative lab…
                </div>
              </main>
            }
          >
            <MathLab
              onAdd={addFromLab}
              onApplyInstrument={applyFromLab}
              onStudio={() => changeWorkspace("studio")}
              notify={notify}
            />
          </Suspense>
        ) : (
          <main className="workspace">
            <div className="workspace-heading">
              <div className="heading-copy">
                <span className="eyebrow">A SPACE FOR SOUND</span>
                <h1>
                  Make room for <em>your sound.</em>
                </h1>
                <p className="heading-subtitle">
                  A few notes. A little curiosity. Something only you could
                  make.
                </p>
              </div>
              <div className="heading-aside">
                <SessionArtwork />
                <div className="heading-details">
                  <div className="session-meta">
                    <span className="session-dot" /> {project.key}
                    <span>·</span>
                    {Math.round(duration)} sec
                  </div>
                  <button
                    onClick={() => {
                      useMathLabStore
                        .getState()
                        .patch({ tab: "functions", flowStep: 1 });
                      changeWorkspace("math");
                    }}
                  >
                    Make a first phrase <ArrowUpRight size={13} />
                  </button>
                </div>
              </div>
            </div>
            <Arrangement
              assetRevision={assetRevision}
              onSeek={(value) => {
                engine.seek(value);
                refreshTransport();
              }}
              onAddTrack={() => setPanel("add-track")}
              onOpenEditor={() => setEditor(true)}
              onInspector={() => setInspector(!inspector)}
            />
            <section
              className="editor-section"
              data-color={track?.color ?? "mauve"}
            >
              <div className="section-toolbar editor-header">
                <div className="section-title">
                  <span className="section-index">02</span>
                  <button
                    className="editor-toggle"
                    onClick={() => setEditor(!editor)}
                  >
                    {track?.type === "drums"
                      ? "Drum sequencer"
                      : clip?.type === "audio"
                        ? track?.role === "reference"
                          ? "Reference track"
                          : "Audio clip"
                        : "Piano roll"}
                    {editor ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronUp size={14} />
                    )}
                  </button>
                  {track && (
                    <span className="editor-track-tag">
                      <i />
                      {track.name}
                    </span>
                  )}
                </div>
                <div className="toolbar-actions">
                  {pattern && (
                    <>
                      <button
                        className="icon-button"
                        title={
                          patternPreview
                            ? "Stop pattern preview"
                            : "Preview pattern independently"
                        }
                        onClick={() => {
                          if (patternPreview) {
                            engine.stopPreview();
                            refreshTransport();
                          } else
                            void engine
                              .previewPattern(
                                project,
                                pattern,
                                track?.instrument,
                              )
                              .then(refreshTransport)
                              .catch((e) => notify(errorMessage(e)));
                        }}
                      >
                        {patternPreview ? <Square /> : <Play />}
                      </button>
                      <button
                        className="icon-button"
                        title="Duplicate pattern"
                        onClick={() => newPattern(true)}
                      >
                        <Copy />
                      </button>
                      <button
                        className="icon-button"
                        title="Delete pattern and its clips"
                        onClick={() => {
                          update("Delete pattern", (p) => {
                            delete p.patterns[pattern.id];
                            p.tracks.forEach(
                              (t) =>
                                (t.clips = t.clips.filter(
                                  (c) =>
                                    c.type !== "midi" ||
                                    c.patternId !== pattern.id,
                                )),
                            );
                          });
                          setPatternId(null);
                        }}
                      >
                        <Trash2 />
                      </button>
                    </>
                  )}
                  <button
                    className="icon-button"
                    title="Toggle keyboard"
                    onClick={() => setKeyboard(!keyboard)}
                  >
                    <KeyboardMusic />
                  </button>
                  {!inspector && (
                    <button
                      className="icon-button"
                      title="Open inspector"
                      onClick={() => setInspector(true)}
                    >
                      <PanelRightOpen />
                    </button>
                  )}
                </div>
              </div>
              {editor && (
                <>
                  {track && track.type !== "audio" && (
                    <div className="pattern-toolbar">
                      <select
                        aria-label="Active pattern"
                        value={pattern?.id ?? ""}
                        onChange={(e) => {
                          setPatternId(e.target.value);
                          selectNotes([]);
                        }}
                      >
                        <option value="" disabled>
                          Select a pattern
                        </option>
                        {Object.values(project.patterns)
                          .filter(
                            (p) =>
                              p.kind ===
                              (track.type === "drums" ? "drums" : "midi"),
                          )
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                      <button
                        title="Create new pattern"
                        className="button small"
                        onClick={() => newPattern()}
                      >
                        <Plus />
                        New
                      </button>
                      <button
                        className="button small"
                        disabled={!pattern}
                        title="Insert pattern at playhead"
                        onClick={insertPattern}
                      >
                        Insert into song
                      </button>
                      {pattern && (
                        <label className="pattern-length">
                          Length
                          <select
                            aria-label="Pattern length"
                            value={pattern.lengthTicks / BAR}
                            onChange={(e) =>
                              update("Resize pattern", (p) => {
                                const x = p.patterns[pattern.id];
                                x.lengthTicks = +e.target.value * BAR;
                                x.notes = x.notes
                                  .filter((n) => n.startTick < x.lengthTicks)
                                  .map((n) => ({
                                    ...n,
                                    durationTicks: Math.min(
                                      n.durationTicks,
                                      x.lengthTicks - n.startTick,
                                    ),
                                  }));
                              })
                            }
                          >
                            {[1, 2, 4, 8, 16].map((n) => (
                              <option key={n} value={n}>
                                {n} {n === 1 ? "bar" : "bars"}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  )}
                  {pattern && track ? (
                    pattern.kind === "drums" ? (
                      <DrumSequencer
                        pattern={pattern}
                        onChange={(notes, label) =>
                          update(label, (p) => {
                            p.patterns[pattern.id].notes = notes;
                          })
                        }
                        onSwingChange={(swing) =>
                          update("Set swing", (p) => {
                            p.patterns[pattern.id].swing = swing;
                          })
                        }
                        onAudition={audition}
                        clipStart={patternId ? null : (clip?.startTick ?? null)}
                      />
                    ) : (
                      <PianoRoll
                        pattern={pattern}
                        selectedIds={selectedNoteIds}
                        onSelect={selectNotes}
                        onChange={(notes, label) =>
                          update(label, (p) => {
                            p.patterns[pattern.id].notes = notes;
                          })
                        }
                        onAudition={audition}
                        musicalKey={project.key}
                        clipStart={patternId ? null : (clip?.startTick ?? null)}
                      />
                    )
                  ) : clip?.type === "audio" && track?.role === "reference" ? (
                    <ReferenceAnalysis
                      key={`${track.id}:${clip.assetId}`}
                      track={track}
                      clip={clip}
                      asset={project.assets.find((a) => a.id === clip.assetId)}
                      assetRevision={assetRevision}
                      onSeek={(tick) => {
                        engine.seek(tick);
                        refreshTransport();
                      }}
                      notify={notify}
                    />
                  ) : clip?.type === "audio" ? (
                    <div className="audio-clip-editor">
                      <AudioLines size={48} />
                      <div>
                        <h3>{clip.name}</h3>
                        <p>
                          {project.assets
                            .find((a) => a.id === clip.assetId)
                            ?.duration.toFixed(2)}{" "}
                          seconds · Original speed
                        </p>
                        <p>
                          Move or resize this clip in the arrangement. Adjust
                          trimming, looping, and gain in the inspector.
                        </p>
                        <button
                          className="button small"
                          onClick={() => setInspector(true)}
                        >
                          <SlidersHorizontal />
                          Open clip settings
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="empty-state">
                      <Music2 size={24} />
                      <h3>Every song starts somewhere.</h3>
                      <p>
                        Add an instrument, then click the grid to write your
                        first notes.
                      </p>
                      <button
                        className="button"
                        onClick={() => setPanel("add-track")}
                      >
                        <Plus />
                        Add an instrument
                      </button>
                    </div>
                  )}
                </>
              )}
              {keyboard && (
                <Keyboard
                  musicalKey={project.key}
                  drums={track?.type === "drums"}
                />
              )}
            </section>
            <footer className="workspace-footer">
              <span>
                <span className={`audio-status ${audioReady ? "ready" : ""}`} />
                {audioReady
                  ? "Audio engine ready"
                  : "Press play to bring it to life"}
              </span>
              <span className="footer-hint">
                SPACE <span>Play / Pause</span>
                <i />⌘ Z <span>Undo</span>
              </span>
              <div className="input-controls">
                <button
                  className={typing ? "on" : ""}
                  aria-label="Play notes with the computer keyboard"
                  aria-pressed={typing}
                  title="Keys A to L play the selected track · Z and X change octave"
                  onClick={() =>
                    usePerformanceStore.setState({ typing: !typing })
                  }
                >
                  <KeyboardIcon size={12} />
                  {typing ? `Keys · C${typingOctave}` : "Keys off"}
                </button>
                <button
                  className={midi === "connected" ? "on" : ""}
                  aria-label="Connect a MIDI keyboard"
                  title={
                    midi === "connected"
                      ? `Playing from: ${midiDevices.join(", ")}`
                      : "Play and record from a MIDI keyboard"
                  }
                  onClick={() => void connectMidi()}
                >
                  <Cable size={12} />
                  {
                    {
                      off: "MIDI",
                      connecting: "MIDI…",
                      connected:
                        midiDevices.length === 1
                          ? midiDevices[0]
                          : `${midiDevices.length} MIDI inputs`,
                      "no-devices": "No MIDI device found",
                      denied: "MIDI blocked by browser",
                      unsupported: "MIDI not supported here",
                    }[midi]
                  }
                </button>
              </div>
              <div className="master-control">
                <Headphones size={13} />
                <span>Master</span>
                <input
                  aria-label="Master volume"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={project.masterVolume}
                  onChange={(e) =>
                    update("Set master volume", (p) => {
                      p.masterVolume = +e.target.value;
                    })
                  }
                />
                <LevelMeter />
              </div>
            </footer>
          </main>
        )}
        {workspace === "studio" && inspector && (
          <Inspector onClose={() => setInspector(false)} />
        )}
      </div>
      {panel === "add-track" && (
        <Modal
          title="A new voice."
          subtitle="Choose an instrument to join your session."
          onClose={closePanel}
        >
          <div className="instrument-list">
            {INSTRUMENTS.map((i) => (
              <button
                key={i.type}
                data-color={i.color}
                onClick={() => addTrack(i.type)}
              >
                <span className="instrument-symbol">
                  <Music2 />
                </span>
                <div>
                  <strong>{i.name}</strong>
                  <span>{i.description}</span>
                </div>
                <Plus size={16} />
              </button>
            ))}
            <button data-color="taupe" onClick={() => addTrack("audio")}>
              <span className="instrument-symbol">
                <AudioLines />
              </span>
              <div>
                <strong>Audio sample</strong>
                <span>Bring a recording into your composition</span>
              </div>
              <Plus size={16} />
            </button>
          </div>
        </Modal>
      )}
      {panel === "samples" && (
        <Modal
          title="A collection of possibilities."
          subtitle="Original sounds, found textures, and the things you bring."
          onClose={closePanel}
          wide
        >
          <SampleBrowser
            onMessage={notify}
            onInserted={(reference) => {
              setAssetRevision((value) => value + 1);
              if (reference) {
                setPanel(null);
                setEditor(true);
                changeWorkspace("studio");
              }
            }}
          />
        </Modal>
      )}
      {panel === "ideas" && (
        <Modal title="Explore ideas" onClose={closePanel} wide>
          <Ideas onMessage={notify} />
        </Modal>
      )}
      {panel === "projects" && (
        <Modal
          title="Your sessions."
          subtitle="Saved locally, ready whenever inspiration returns."
          onClose={closePanel}
          wide
        >
          <div className="new-project-form">
            <input
              aria-label="New project name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name your session"
            />
            <button
              className="button primary"
              onClick={() =>
                void openProject(
                  createProject(newName.trim() || "Untitled session"),
                )
              }
            >
              <Plus />
              Create blank project
            </button>
          </div>
          <div className="project-list">
            {projectList.map((p) => (
              <div className="project-item" key={p.id}>
                <button onClick={() => void openProject(p)}>
                  <Music2 size={18} />
                  <div>
                    <strong>{p.name}</strong>
                    <span>
                      {p.transport.bpm} BPM · {p.key} · {p.tracks.length} tracks
                    </span>
                  </div>
                  {p.id === project.id && <span className="tag">OPEN</span>}
                </button>
                {deleteId === p.id ? (
                  <div className="delete-confirm">
                    <span>Delete?</span>
                    <button
                      className="danger"
                      onClick={() => {
                        void deleteProject(p.id)
                          .then(() => {
                            setProjectList((list) =>
                              list.filter((v) => v.id !== p.id),
                            );
                            setDeleteId(null);
                            if (p.id === project.id) {
                              stop();
                              load(createProject());
                            }
                          })
                          .catch((e) => notify(errorMessage(e)));
                      }}
                    >
                      Yes
                    </button>
                    <button onClick={() => setDeleteId(null)}>Cancel</button>
                  </div>
                ) : (
                  <button
                    className="icon-button"
                    title={`Delete project ${p.name}`}
                    onClick={() => setDeleteId(p.id)}
                  >
                    <Trash2 />
                  </button>
                )}
              </div>
            ))}
            {!projectList.length && (
              <p className="muted">
                Your first session will appear here after saving.
              </p>
            )}
          </div>
          <div className="project-tools">
            <button
              className="button small"
              onClick={() => void openProject(createDemoProject())}
            >
              Open demo session
            </button>
            <button
              className="button small"
              onClick={() =>
                download(
                  new Blob([JSON.stringify(project, null, 2)], {
                    type: "application/json",
                  }),
                  `${project.name}.studio.json`,
                )
              }
            >
              Download project JSON
            </button>
            <button
              className="button small"
              onClick={() => importedProject.current?.click()}
            >
              Import project JSON
            </button>
            <input
              hidden
              ref={importedProject}
              type="file"
              accept=".json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f)
                  void f
                    .text()
                    .then((text) =>
                      openProject(validateProject(JSON.parse(text))),
                    )
                    .catch((err) => notify(errorMessage(err)));
                e.target.value = "";
              }}
            />
          </div>
          <ProjectBackup
            project={project}
            onOpen={openProject}
            notify={notify}
          />
          <MidiFiles project={project} onOpen={openProject} notify={notify} />
          <p className="library-footnote">
            Project JSON includes notes and settings. Imported audio files
            remain in this browser and are not embedded in JSON backups.
          </p>
        </Modal>
      )}
      {panel === "settings" && (
        <Modal
          title="Make yourself at home."
          subtitle="A few preferences for your creative space."
          onClose={closePanel}
        >
          <div className="settings-content">
            <StorageProtection />
            <h4>Appearance</h4>
            <div className="theme-options">
              <button
                className={theme === "light" ? "selected" : ""}
                onClick={() => setTheme("light")}
              >
                <Sun />
                Gallery Light{theme === "light" && <Check />}
              </button>
              <button
                className={theme === "dark" ? "selected" : ""}
                onClick={() => setTheme("dark")}
              >
                <Moon />
                Dark{theme === "dark" && <Check />}
              </button>
            </div>
            <h4>Loop region</h4>
            <div className="two-fields">
              <label className="field-label">
                Start bar
                <NumberField
                  label="Loop start bar"
                  min={1}
                  max={project.transport.loopEnd / BAR}
                  step={1}
                  precision={0}
                  value={project.transport.loopStart / BAR + 1}
                  onChange={(bar) =>
                    update("Set loop start", (p) => {
                      p.transport.loopStart = Math.max(
                        0,
                        Math.min(p.transport.loopEnd - BAR, (bar - 1) * BAR),
                      );
                    })
                  }
                />
              </label>
              <label className="field-label">
                End bar (inclusive)
                <NumberField
                  label="Loop end bar"
                  min={project.transport.loopStart / BAR + 1}
                  max={256}
                  step={1}
                  precision={0}
                  value={project.transport.loopEnd / BAR}
                  onChange={(bar) =>
                    update("Set loop end", (p) => {
                      p.transport.loopEnd = Math.min(
                        BAR * 256,
                        Math.max(p.transport.loopStart + BAR, bar * BAR),
                      );
                    })
                  }
                />
              </label>
            </div>
            <h4>Master output</h4>
            <Range
              label="Master level"
              value={project.masterVolume}
              onChange={(v) =>
                update("Set master", (p) => {
                  p.masterVolume = v;
                })
              }
            />
            <p className="library-footnote">
              STUDIO saves your work automatically in this browser. Download a
              project backup and WAV before clearing browser storage. Audio
              starts only after your first interaction.
            </p>
          </div>
        </Modal>
      )}
      {panel === "export" && (
        <Modal
          title="Let it leave the room."
          subtitle="Render your complete arrangement as a stereo WAV."
          onClose={exporting ? () => {} : closePanel}
        >
          <div className="export-summary">
            <AudioLines size={42} />
            <h3>{project.name}</h3>
            <p>
              {
                exportProject.tracks.filter((t) =>
                  isTrackAudible(exportProject, t.id),
                ).length
              }{" "}
              audible tracks · {project.transport.bpm} BPM ·{" "}
              {Math.round(exportDuration + 2)} seconds
            </p>
            <div className="export-format">
              <span>WAV / PCM 16-bit</span>
              <span>44.1 kHz · Stereo</span>
            </div>
            <p className="library-footnote">
              Includes your composition mix, effects, ordinary audio clips and a
              two-second release tail. Reference tracks are always excluded,
              including from the export length. A/B listening and reference Solo
              do not affect exports. Exports the whole composition, regardless
              of the playback loop.
            </p>
            {exporting ? (
              <div role="status" className="export-progress">
                <div
                  style={{ width: `${Math.max(4, exportProgress * 100)}%` }}
                />
                <span>
                  Rendering audio… {Math.round(exportProgress * 100)}%
                </span>
              </div>
            ) : (
              <button
                className="button primary"
                disabled={!exportProject.tracks.some((t) => t.clips.length)}
                onClick={() => void exportAudio()}
              >
                <Download />
                Export WAV
              </button>
            )}
          </div>
        </Modal>
      )}
      {panel === "help" && (
        <Modal
          title="A little guidance."
          subtitle="Start with a note. The rest can follow."
          onClose={closePanel}
        >
          <div className="help-content">
            <p>
              <strong>1. Find your sound.</strong> Add a track and choose an
              instrument. The demo is fully editable; Projects also offers a
              blank session.
            </p>
            <p>
              <strong>2. Write a phrase.</strong> Click the piano grid to draw.
              Drag notes to move, drag the right edge to resize, and Shift-click
              to select several. Toggle drum steps to build a groove.
            </p>
            <p>
              <strong>3. Give it shape.</strong> Drag clips along the
              arrangement. Reused clips share a pattern; “Make independent”
              creates a separate version.
            </p>
            <p>
              <strong>4. Make it yours.</strong> Mix in the inspector, explore
              local ideas, and export your finished WAV.
            </p>
            <div className="shortcut-list">
              {[
                ["Space", "Play / Pause"],
                ["⌘ / Ctrl + Z", "Undo"],
                ["⇧ + ⌘ / Ctrl + Z", "Redo"],
                ["⌘ / Ctrl + C / V", "Copy / Paste"],
                ["⌘ / Ctrl + D", "Duplicate"],
                ["Delete / Backspace", "Delete selection"],
                ["⌘ / Ctrl + S", "Save project"],
                ["Escape", "Clear note selection / close panel"],
              ].map(([k, v]) => (
                <div key={k}>
                  <kbd>{k}</kbd>
                  <span>{v}</span>
                </div>
              ))}
            </div>
            <p className="library-footnote">
              Designed for desktop. Narrow windows scroll horizontally; close
              the sidebar and inspector for more editing space.
            </p>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            className="icon-button"
            title="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X />
          </button>
        </div>
      )}
    </div>
  );
}
function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
