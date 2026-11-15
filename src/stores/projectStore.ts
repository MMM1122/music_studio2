import { create } from "zustand";
import { createDemoProject } from "../domain/factories";
import type { Project } from "../domain/models";
import { validateProject } from "../domain/validation";

interface HistoryEntry {
  project: Project;
  label: string;
}
export interface UpdateOptions {
  coalesceKey?: string;
}
interface ProjectState {
  project: Project;
  selectedTrackId: string | null;
  selectedClipId: string | null;
  selectedNoteIds: string[];
  past: HistoryEntry[];
  future: HistoryEntry[];
  canUndo: boolean;
  canRedo: boolean;
  historyLabel: string;
  revision: number;
  lastContinuousEdit: { key: string; at: number } | null;
  update: (
    label: string,
    mutator: (draft: Project) => void,
    options?: UpdateOptions,
  ) => void;
  load: (project: Project) => void;
  undo: () => void;
  redo: () => void;
  selectTrack: (id: string | null) => void;
  selectClip: (trackId: string, clipId: string | null) => void;
  selectNotes: (ids: string[]) => void;
}
const initial = createDemoProject();
function selection(
  project: Project,
  trackId?: string | null,
  clipId?: string | null,
) {
  const track =
    project.tracks.find((t) => t.id === trackId) ??
    project.tracks.find((t) => t.instrument.type === "electric-piano") ??
    project.tracks[0];
  const clip = track?.clips.find((c) => c.id === clipId) ?? track?.clips[0];
  return {
    selectedTrackId: track?.id ?? null,
    selectedClipId: clip?.id ?? null,
    selectedNoteIds: [],
  };
}
export const useProjectStore = create<ProjectState>((set) => ({
  project: initial,
  ...selection(initial),
  past: [],
  future: [],
  canUndo: false,
  canRedo: false,
  historyLabel: "",
  revision: 0,
  lastContinuousEdit: null,
  update: (label, mutator, options) =>
    set((state) => {
      const draft = structuredClone(state.project);
      mutator(draft);
      if (JSON.stringify(draft) === JSON.stringify(state.project)) return state;
      draft.updatedAt = new Date().toISOString();
      const now = Date.now();
      const key = options?.coalesceKey;
      const canCoalesce =
        !!key &&
        state.lastContinuousEdit?.key === key &&
        now - state.lastContinuousEdit.at < 750 &&
        !state.future.length;
      const past = canCoalesce
        ? state.past
        : [...state.past, { project: state.project, label }].slice(-80);
      const currentTrack = draft.tracks.find(
        (t) => t.id === state.selectedTrackId,
      );
      const currentClip = currentTrack?.clips.find(
        (c) => c.id === state.selectedClipId,
      );
      return {
        project: draft,
        past,
        future: [],
        canUndo: true,
        canRedo: false,
        historyLabel: label,
        revision: state.revision + 1,
        lastContinuousEdit: key ? { key, at: now } : null,
        selectedTrackId: currentTrack?.id ?? draft.tracks[0]?.id ?? null,
        selectedClipId: currentClip?.id ?? null,
        selectedNoteIds: state.selectedNoteIds.filter((id) =>
          Object.values(draft.patterns).some((pattern) =>
            pattern.notes.some((n) => n.id === id),
          ),
        ),
      };
    }),
  load: (project) =>
    set((state) => {
      const valid = validateProject(project);
      return {
        project: valid,
        ...selection(valid),
        past: [],
        future: [],
        canUndo: false,
        canRedo: false,
        historyLabel: "",
        lastContinuousEdit: null,
        revision: state.revision + 1,
      };
    }),
  undo: () =>
    set((state) => {
      const entry = state.past[state.past.length - 1];
      if (!entry) return state;
      const past = state.past.slice(0, -1);
      const future = [
        { project: state.project, label: entry.label },
        ...state.future,
      ];
      const project = { ...entry.project, updatedAt: new Date().toISOString() };
      return {
        project,
        past,
        future,
        ...selection(project, state.selectedTrackId, state.selectedClipId),
        canUndo: past.length > 0,
        canRedo: true,
        historyLabel: `Undo ${entry.label}`,
        lastContinuousEdit: null,
        revision: state.revision + 1,
      };
    }),
  redo: () =>
    set((state) => {
      const entry = state.future[0];
      if (!entry) return state;
      const past = [
        ...state.past,
        { project: state.project, label: entry.label },
      ].slice(-80);
      const future = state.future.slice(1);
      const project = { ...entry.project, updatedAt: new Date().toISOString() };
      return {
        project,
        past,
        future,
        ...selection(project, state.selectedTrackId, state.selectedClipId),
        canUndo: true,
        canRedo: future.length > 0,
        historyLabel: `Redo ${entry.label}`,
        lastContinuousEdit: null,
        revision: state.revision + 1,
      };
    }),
  selectTrack: (id) =>
    set((state) => ({
      selectedTrackId: id,
      selectedClipId:
        state.project.tracks.find((t) => t.id === id)?.clips[0]?.id ?? null,
      selectedNoteIds: [],
      lastContinuousEdit: null,
    })),
  selectClip: (trackId, clipId) =>
    set({
      selectedTrackId: trackId,
      selectedClipId: clipId,
      selectedNoteIds: [],
      lastContinuousEdit: null,
    }),
  selectNotes: (ids) =>
    set({ selectedNoteIds: [...new Set(ids)], lastContinuousEdit: null }),
}));
