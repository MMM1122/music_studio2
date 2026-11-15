# Architecture

STUDIO is a browser-local React/Vite application. Its musical state is serializable; audio resources are not stored in React or Zustand.

## Module boundaries

- `src/domain/models.ts`: versioned Project, Track, Pattern, discriminated MIDI/Audio Clip, MidiNote, Instrument, Effect, TransportSettings, MixerSettings, and AudioAsset definitions.
- `src/domain/timing.ts`, `theory.ts`, `commands.ts`, `noteEditing.ts`: integer-tick timing, pitch/scale/chord logic, and immutable editing operations. PPQ is 480; a 4/4 bar is 1920 ticks. `theory.ts` is the only place keys, scales, note spelling, and chord qualities are defined.
- `src/domain/harmony.ts`: reads harmony from notes (`detectChord`, `inferProgression`), and voices chords with voice leading (`voiceChord`, `voiceProgression`). Pure functions over the project model; used by the idea generator and the piano roll's chord tool.
- `src/domain/validation.ts`: Zod input validation, ID/reference checks, note bounds, schema-version handling. Unknown future versions fail explicitly without deleting stored data.
- `src/stores/transportStore.ts`: playback readings (tick, playing, level, preview) copied from the engine once per animation frame. Playheads and the meter subscribe to it and write to their DOM nodes directly; the App shell re-renders when playback starts or stops, not while it runs.
- `src/stores/projectStore.ts`: authoritative project, selection, and up to 80 undo/redo snapshots. Pointer drags commit once. Optional coalescing combines continuous changes without merging discrete musical operations.
- `src/audio/scheduler.ts`: pure conversion from shared patterns and positioned clips into musical events. No React state or wall-clock timer participates in this conversion.
- `src/audio/engine.ts`: one audio service. Tone.Transport schedules using Web Audio timestamps; React reads the audio clock for visuals. A serial counter invalidates stale async Play requests. Imported assets decode without activating realtime audio. Realtime graphs persist across visual/theme changes.
- `src/audio/graph.ts`: native Web Audio synthesis and mixing. `MixBus` is the shared end of the signal path: one convolution room and one dotted-eighth ping-pong delay that every track sends to, then a rumble filter, bus compression, a soft clipper, and a limiter. `TrackGraph` is a track's strip (tone filter, pan, fader, post-fader sends). `synthesize` builds one voice per note: FM electric piano, felt piano, filtered synth and sub basses, a stereo pad, a lead with delayed vibrato, a pluck, and six drum voices with an open-hat choke. Realtime playback and offline export use the same classes.
- `src/audio/wav.ts`: PCM16 stereo WAV encoding.
- `src/persistence/database.ts`: separate IndexedDB stores for validated projects and original imported audio blobs. Theme/current-project preferences use localStorage. Removing a project preserves blobs that another project or Undo history may reference.
- `src/ai`: deterministic local suggestions plus the future server-provider boundary. Ideas use the same notes and validation as manual editing.
- `src/components`: arrangement, piano roll, drum sequencer, keyboard, inspector, sample browser, contextual ideas, and accessible modal primitives.
- `src/themes`: semantic CSS tokens and exactly two theme definitions. Shared track colors live outside theme-dependent component logic.

## Timing and editing decisions

Musical positions/durations are integer ticks. BPM converts ticks to seconds only at the audio boundary. MIDI clips reference reusable patterns, so editing a source changes all linked copies. “Make independent” clones its pattern and note IDs. A non-looping MIDI clip plays once; looped clips repeat source notes until the clip boundary. Notes are gated at the boundary and have their instrument release afterward.

Arrangement movement snaps to a quarter-note beat; piano editing supports quarter/eighth/sixteenth/thirty-second snapping. Shrinking a pattern removes notes after its new end and trims crossing notes, as one undoable command. The arrangement can scroll beyond the 16-bar starter session.

Mute overrides solo. If any track is soloed, only unmuted soloed tracks reach the output. Audio plays at its original sample rate/speed; a trim offset selects where the sample begins, and looping repeats the remaining trimmed segment. Audio duration is represented musically, so changing BPM changes the clip's timeline gate, not the pitch or playback rate of its source.

Independent pattern preview renders a dry pattern into an AudioBuffer, then loops it with a native AudioBufferSourceNode through a reusable preview effects graph. Preview pauses the arrangement and preserves its resume position. Editing a previewed pattern requires restarting preview to hear the new version; arrangement edits reschedule automatically.

Edits during playback replace only the plan for the future. Events live on Tone's transport timeline in ticks, so clearing and re-adding them while the transport runs cannot fire an event twice: the transport only fires what it has not yet passed. Notes already sounding finish naturally, tempo changes apply to the running transport, and mix/effect changes glide in place. The transport is restarted only by Play, Stop, Seek, or opening another project. Stopping fades voices over a few milliseconds rather than cutting them. Theme switching touches no audio state.

## Persistence and validation

Schema version 1 supports 4/4. Version mismatches and malformed notes/references are rejected with a visible error; there is no speculative migration. Project writes resolve after IndexedDB transactions complete. Storage quota or blocked-database errors leave the open project available. Missing audio is reported when reopening; exports refuse to silently omit missing audible assets.

Assets remain local to the browser's origin/profile. JSON backup contains metadata/references but no binary assets. A future ZIP project bundle should combine the project schema and referenced audio for truly portable sessions.

## Export and resource bounds

OfflineAudioContext uses the same instruments/effects as playback. The arrangement end plus two seconds determines its exact frame count, rounded up to the nearest 44.1 kHz frame. The export ignores loop settings, includes only audible tracks, and reports progress stages. Validation bounds external project sizes; exports longer than ten minutes are rejected before allocating their output buffer.

## Further development

1. Add portable project bundles and explicit unused-asset cleanup.
2. Add MIDI input/recording and pointer-held audition envelopes.
3. Have the interface call `domain/commands.ts` for clip and drum-step edits; those functions are tested but several components still carry their own equivalent logic.
4. Extend timing to other signatures and add tempo automation.
5. Add waveform-region selection, sample time-stretch, and audio fades.
6. Add virtualization for very large piano rolls and arrangement track lists.
7. Add real LLM providers only behind a server boundary, with schema validation and user acceptance preserved.
