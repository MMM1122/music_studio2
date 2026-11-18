# STUDIO release notes

## Version 1.7.1 — Fewer words, whole song

- **One tagline.** "Make room for your sound." is the only brand line left. Removed the sidebar's "Room for your own sound.", the arrangement's "Make room for another sound." and the keyboard's "PLAY SOMETHING / Every idea starts with a note."; the footer now says what to do: "Audio starts when you press Play".
- **Fit to window.** A new arrangement button zooms so every clip (or the loop, in an empty song) fits the visible lanes and scrolls back to bar 1. Zooming out can now go down to 12 px per bar for long songs.
- **Math Lab heading** is one line like the Studio's (the eyebrow, subtitle and large artwork are gone), so the tools start about 95 px higher.
- Tests: `e2e/layout.spec.ts` adds a fit-to-window check (43 browser tests in total).

## Version 1.7 — Room to edit

- **The editor is on screen.** The Studio heading is one line instead of a 112 px banner, and the arrangement and the editor now share the window: the arrangement lanes take about half of the remaining height and the piano roll or drum grid fills the rest, so notes are visible without scrolling at 1440×900 and 1280×760 (before, the 1280×760 window showed no note grid at all). A divider between the two can be dragged, stepped with the arrow keys (Home/End for the limits), and reset with a double-click or Enter; its height is remembered.
- **Easier to read.** Every font size under 11 px was raised: 7–8 px uppercase labels and ruler numbers to 10 px, 9–10 px text to 11 px. Secondary text is darker in Gallery Light (#67635E, at least 4.7:1 on every surface) and muted text is darker in both themes (#77726C light, #8E8A85 dark; at least 4.5:1 on the page background).
- Editor toolbars no longer shrink when space is tight; the save status stays on one line.
- Tests: new `e2e/layout.spec.ts` checks the visible note grid at both window sizes, the divider (drag, keys, reload, reset), a 10 px floor for text and the contrast ratios.

## Version 1.6 — Play it in

- **Typed tempos stick.** The BPM field clamped on every keystroke, so typing 120 over 86 produced 240 (the "1" became 40, then "401" became 240), and clearing the field jumped to 40. The field now keeps what you type, applies a value as soon as it is in range, clamps only on Enter or leaving the field, restores the previous tempo on Escape or an empty entry, and records one undo step per edit. The same fix covers the Math Lab Function and Bayesian BPM fields, loop start/end bars, clip start/length, audio trim start, and attack/release.
- **Play notes from the computer keyboard.** A–L play the selected track (white keys on the home row, sharps on W E T Y U O P), Z/X change octave, and on a drum track A S D F G H play kick, snare, hats, clap and percussion. Notes sound for as long as the key is held. Keys are ignored while typing in a field, in dialogs and in Math Lab; **Keys off** in the footer turns the layout off.
- **MIDI keyboards.** **MIDI** in the footer connects every MIDI input the browser exposes (Chrome and Edge). Velocity is used; note-on with velocity 0 counts as release.
- **Record.** Arm **Record** (or press R), press Play and play. When playback stops, the take is written as one undoable edit: notes are quantized to 1/16 at their start and keep their held length; notes inside an existing clip are overdubbed into its pattern (wrapped for looping clips), others become new bar-aligned "Recorded take" clips. Timing is corrected for the browser's reported output latency.
- **Metronome.** A click on every beat, accented on the downbeat, on the shared transport. It is never included in WAV exports.
- **Track meters.** Each track header shows its own post-fader level.
- The on-screen keyboard now holds notes while pressed, follows the same octave as the computer keys, lights keys played from any source, and shows drum pads for drum tracks. With a reference or audio track selected, notes go to the first instrument track so you can play along with a reference song.

## Version 1.5 — Reference, analyze, compose

- Added **Samples → Import Reference** through the existing importer, IndexedDB assets and audio engine. Full-song reference tracks appear above composition tracks, with original-speed playback and distinct labels.
- Added a collapsible PCM waveform with source-time ruler, zoom, navigation and seeking; a track-specific real-time Hz/dB spectrum; bounded local-worker tempo estimation with uncertainty, half/double-time candidates and explicit BPM application; and editable timestamped section markers.
- Added **Reference / My Composition / Both** monitoring on the shared transport. Tempo edits preserve reference clip placement/duration in seconds and re-cue all voices at the current musical tick during playback.
- Excluded references from WAV duration, audio and solo eligibility, and from MIDI solo eligibility. Normal audio exports remain intact.
- Kept schema version 1 backward-compatible with optional validated reference metadata. Existing project saves and complete audio backups preserve markers and tempo corrections.
- Added import/decode/cache bounds, stale-import and hydration guards, visible missing/corrupt/quota errors, and track analyser cleanup. No dependencies or server audio processing were added.
- Fixed an existing pause/resume bug: fractional transport ticks must be rounded before passing Tone its integer-tick time string.
- Added synthetic WAV/MP3 fixtures and regression coverage. No copyrighted recording is included. See [verification](VERIFICATION.md) and the [Reference Track guide](REFERENCE_TRACKS.md).

## Version 1.4 — Shape, hear, compose

- Drag a 16-point musical curve and hear upcoming notes change while the audio-clock loop keeps its position. Keyboard-accessible points support Up/Down, Home and End.
- Replaced the decorative session SVG with measured waveform/frequency-energy line artwork, including a quiet state, reduced-motion behavior and hidden/offscreen throttling.
- Added a three-step first-phrase route and direct links from a curve to its Fourier sound and a probability-composed ending. Bayesian remains an interactive, locally learned preference model.
- Added complete `.studio` backups with original audio bytes, SHA-256 verification, fresh restore IDs and atomic IndexedDB writes; storage-persistence controls and a recovery error boundary.
- Added bounded MIDI format 0/1 file import and type-1 export, with explicit limitations and omission notices.
- Lazy-loaded Math Lab and Tone's runtime; narrowed project-store subscriptions and extracted shared Math Lab controls.
- Kept the existing project schema and browser origin. Existing sessions are preserved. Recording, hardware MIDI input, parameter automation and new sample libraries are future work.

## Version 1.3 — Mathematical Music Lab

- Added integrated Functions, Fourier and Bayesian workspaces with light/dark styling, actual audio preview, editable sequences and direct Studio insertion.
- Added bounded expression parsing, 16-step scale mapping, eight-harmonic synthesis for live and sequenced notes, named local sounds, and context-specific Dirichlet evidence with separately documented rejection/exploration rules.
- Added versioned local recovery, project-compatible harmonic snapshots, mathematical regression tests and browser audio/integration checks.
- Existing projects, instruments, editing, themes, samples and exports are retained. See [MATH_LAB.md](MATH_LAB.md) for use, mathematics and implementation details.

## Version 1.2

**A quieter visual identity.** Gallery Light and Dark now share warmer neutrals, editorial type, a fine-line sound study, softer track colours, and clearer clip detail. Consolidated layout rules keep the arrangement and note editor usable on laptop screens.

**A more complete musical phrase.** “Sunday, softly” adds soft left-hand roots under the opening keys, deliberate late snare/hat timing around on-grid kicks, quieter pads and effects, and section-level dynamics. The final four bars move through Cm9–A♭maj9–G7alt–Cm9 and leave the last chord room to decay. The hook uses recurring phrases and a final C; the altered dominant's bass uses an octave rather than a competing natural fifth.

**Ideas that keep the groove.** Suggested basslines read kick accents and swing from the audible drum clips at the insertion point. Melody ideas bring back a motif in bar three. Rhythmic variations move the voices of a strummed chord together, preserving their spacing and duration.

**Editing and compatibility.** Humanized drum hits remain visible and editable in their original sequencer cells. Saved projects keep their existing notes, mix, and schema. Open **Projects → Open demo session** to hear the new arrangement. Version 1.2 uses the existing public website and its browser storage origin.

**Validation.** 48 unit tests, strict TypeScript, production Vite build, and 13 browser tests for audio, editing, persistence, themes, and exports. Current measurements and limitations are recorded in [VERIFICATION.md](VERIFICATION.md).

## What changed in 1.1

Version 1.1 keeps the 1.0 interface, data format, and file layout. Projects saved by 1.0 open unchanged. The work went into how the studio sounds, how well its suggestions fit a song, and how it behaves while playing.

### Sound

**One room, one delay.** In 1.0 every track owned a convolution reverb and a delay line. Tracks now send to a shared room and a shared dotted-eighth ping-pong delay (`MixBus` in `src/audio/graph.ts`). That is one convolver instead of one per track, and separate instruments sound like they are in the same space.

**Instruments.** Each voice was rebuilt:

- Electric Piano: two-operator FM with an index that falls after the attack, a tine partial, and a slight left-to-right spread across the keyboard.
- Synth Bass: saw and square through a resonant filter that closes after the attack, over an unfiltered fundamental.
- Synth Pad: three detuned saws spread in stereo with slow drift.
- Lead Synth: filter sweep and vibrato that arrives after the note settles.
- Drum Kit: shorter, lower kick; snare with more wire than shell; metallic hats; the closed hat chokes the open hat; hats, clap, and rim sit slightly off-centre. The kit's Brightness and Release controls now shape tone and decay.
- New presets: Felt Piano, Sub Bass, Pluck.

**Bus.** A 26 Hz rumble filter, slow low-ratio compression, a soft clipper, and a limiter replace the single hard limiter. Stopping fades voices over a few milliseconds instead of cutting the waveform.

#### Measured, not heard

The demo was rendered offline in Chrome before and after, and analysed with an FFT. Share of signal energy per band:

|          | < 60 Hz | 60–120 | 120–250 | 250–500 | 500–2k | 2k–6k | > 6k |
| -------- | ------- | ------ | ------- | ------- | ------ | ----- | ---- |
| 1.0 demo | 6%      | 16%    | **67%** | 9%      | 1%     | 0%    | 1%   |
| 1.1 demo | 17%     | 37%    | 21%     | 12%     | 8%     | 2%    | 2%   |

|          | RMS        | Peak  | Stereo width (side ÷ total) | Pad level alone |
| -------- | ---------- | ----- | --------------------------- | --------------- |
| 1.0 demo | −20.9 dBFS | 0.677 | 0.02                        | −49.5 dBFS      |
| 1.1 demo | −15.3 dBFS | 0.964 | 0.10                        | −30.1 dBFS      |

In 1.0 two thirds of the energy sat between 120 and 250 Hz, the mix was effectively mono, and the pad was about 25 dB below the keys. In 1.1 the low end comes from the kick and bass, the midrange is spread out, and every track is within reach of the others.

These numbers show the mix is no longer muddy or lopsided. They do not show that it sounds good; nobody has listened to it. An early draft of the new electric piano, for example, measured a DC offset of −0.028 that would have thumped on every note; measurement found it and it was removed before release. There may be faults of taste that measurement cannot find.

### Music

**The demo.** "Sunday, softly" keeps its key, tempo, and length and gains a shape: a four-bar intro on keys, pad, and rim; the full groove with a hook; a lift through Fm9–B♭13–E♭maj9; and a return. Chords are voiced by hand so each moves to the next by a step or two. (The idea generator voices the same four chords with 14 semitones of total movement, against 33 in root position; `harmony.test.ts` measures this.) The bass walks into each new root, drum velocities range from ghost notes to backbeats, and the hook is written as a question and an answer.

**Ideas follow your song.** `src/domain/harmony.ts` reads the chord in each bar from the notes on pitched tracks; the bass decides what a rootless voicing is. Basslines, melodies, and chord voicings are then written against those chords at the playhead. Melodies land on chord tones on strong beats and pass through the scale between them. In an empty project the ideas use the key's own progression and say so.

**Chords in key.** The piano roll's chord tool lists the seventh chords of the project key with roman numerals and inserts them close, open, rootless, or shell.

### Engineering

- **Scale highlighting was wrong in ten of the 24 keys.** The piano roll had its own key parser that did not recognise the ♭ and ♯ characters used in the key menu, so E♭, A♭, B♭, C♯, and F♯ keys highlighted the C scale. Keys, scales, and note spelling now come from one module, and notes are spelled for the key.
- **Editing during playback.** 1.0 stopped and restarted the transport on every edit. Under a quick series of edits the position jumped backward and the output went silent. 1.1 replaces only the future schedule; the same series now keeps real time with no silent readings.
- **Rendering.** 1.0 re-rendered the whole interface about 22 times a second while playing. Playback readings now live in their own store; playheads and the meter update their DOM nodes directly.
- **Preview.** Pattern preview uses the track's own instrument settings and folds release tails back into the loop, so the loop point has no cut notes.
- **Deploy.** Asset paths are relative, so `dist/` runs from any folder.
- **Tests.** 46 unit tests (31 before) and 12 browser tests (9 before).

### Not changed

The visual design, the project schema (still version 1), persistence, sample import, and WAV export are as they were. `docs/VERIFICATION.md` lists what has and has not been established.
