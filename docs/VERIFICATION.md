# Verification and current limits

## Version 1.3 checks — Mathematical Music Lab

- **61 unit tests passed** across 6 files. The 13 added checks cover safe expression parsing and adversarial inputs, normalization, scale/MIDI mapping, meaningful function controls, Dirichlet probability normalization, accepted evidence and context isolation, separate rejection/exploration effects, deterministic non-training generation, bounded Fourier waveforms, Studio insertion/application, and persistence recovery.
- **Strict TypeScript and production build passed.** No lint script exists in this repository.
- **18 browser tests are covered:** the 13 existing Studio checks plus 5 Math Lab checks. The full 17-test suite passed before the final pending-activation regression was added; the final 5-test Math Lab suite then passed, including preserving manual edits on BPM changes and stopping a voice before async activation finishes. GitHub CI runs all 18 together on the published commit.
- Browser checks verify invalid expression errors, changed musical output, edited notes/settings after reload, real loop preview and stop, playable track insertion, live harmonic slider changes, note-on/off, silence after stopping or leaving a tab, named sound persistence and application to existing notes, real accept/reject count changes, generated 16-note melodies, and both themes.
- Actual offline Fourier audio was analysed at 440 Hz and 880 Hz. The pure first harmonic had approximately 7,206,718 units of coherent energy at 440 Hz versus 0.059 at 880 Hz; the pure second harmonic reversed that relationship (approximately 7,206,711 at 880 Hz versus 0.234 at 440 Hz). All-zero harmonics produced **exactly zero RMS**. These are measurements of rendered PCM, not only the SVG display.
- Gallery Light, Dark, and 1280px laptop screenshots were inspected. The laptop viewport had no document-level horizontal overflow; long sequence rows scroll within their editor.
- Verification used Chrome automation and signal analysis, not human listening. Safari/Firefox, mobile multi-touch and long-session stress remain unverified. Detailed model rules, file map, use and scope are in [MATH_LAB.md](MATH_LAB.md).

## Version 1.2 checks (previous release)

Run locally with Node 22 and headless Google Chrome on macOS. Tests are included for reproduction.

- **48 Vitest tests passed** across editing, theory, arrangement, timing, validation, history, persistence, scheduling, and WAV output. Added regressions cover the intro's chord roots, the final C-minor cadence, and preserving the voices and timing of strummed chords through rhythm variations.
- **Strict TypeScript and production Vite build passed.**
- **13 Playwright browser tests passed.** Audio checks render the complete demo, all-muted silence, BPM-dependent duration, and imported audio with positioning, trim, looping, and gain.
- Realtime checks cover play/pause/stop, seeking, rapid toggles, and independent looping pattern preview. During 25 structural edits, the clock advanced at **1.0006×** expected speed, never moved backward, and none of the sampled output levels was silent.
- Browser UI checks cover notes, chords, drums, clip editing, undo/redo, saving and reloading, imported samples, idea acceptance, WAV downloads, scale spelling, all seven pitched presets, and theme switching during playback.
- A new browser regression checks that a late snare hit appears in its correct sequencer step and that toggling the step removes the original hit.
- Screenshots cover Gallery Light, Dark, and a 1280px laptop viewport.

The complete demo rendered as stereo **44,100 Hz PCM16 WAV**, lasting **46.651179 seconds**, including the two-second effect/release tail. Measured RMS was **0.15980** (approximately **−15.93 dBFS**) and peak was **0.94583** (approximately **−0.48 dBFS**), below full scale. More than 4.1 million PCM samples were nonzero. These values are from a real browser render of version 1.2; the spectrum/stem comparisons in the version 1.1 changelog are historical results.

## What has not been established

- Cross-browser behavior has not been tested in Safari/Firefox; audio format support and autoplay behavior vary by browser.
- Verification used browser audio rendering and signal measurements, not a human listening assessment. Those checks establish audible output and headroom; musical taste and perceived balance still need listening.
- Mobile editing, long-session stress tests, extreme 50,000-note patterns, and professional latency targets are not certified.
- Public/cloud data synchronization is not implemented. GitHub source synchronization is separate from users' local musical projects.

## Deliberate MVP limits

- 4/4 time signature only; fixed tempo per project.
- No microphone recording, MIDI input/recording, MIDI-file import/export, automation lanes, plugin hosting, or MP3 export.
- Audio samples play at original speed; no pitch-shifting or time-stretching. Sample trim is start-offset plus clip gate; no destructive waveform editor.
- Structural edits during playback reschedule with a short safety gap. Independent pattern preview is a rendered snapshot; restart it after editing.
- Synthesized instruments are lightweight and usable but do not claim to emulate a sampled commercial instrument library.
- Sample library contains six original one-shots/textures, plus user imports; there is no large commercial loop catalog.
- Chord detection works bar by bar and names one chord per bar. Two chords in a bar, or a bass playing something other than the root, will be read as the nearest single chord.
- The open hi-hat is closed by the next hat only in browsers that implement `AudioParam.cancelAndHoldAtTime` (Chrome, Edge, Safari). Elsewhere it rings for its full length.
- Local inspiration is music-theory generation; the LLM provider contract exists, but no external AI service is connected.
- JSON backups omit audio bytes. Browser storage can be cleared by the user/browser; retain source audio and export backups.
- Export has a fixed two-second tail and a ten-minute duration limit.
- Track movement uses up/down controls. Clip dragging is horizontal within its track; copy/paste supports compatible destination tracks.
