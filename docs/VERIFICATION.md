# Verification and current limits

## Version 1.6 checks — Play it in, typed tempos

- **102 unit tests passed** across 12 files. New: recording takes (bar-aligned new clips, quantize off, overdub into looping clips, notes on both sides of an existing clip, growing an unshared pattern, reporting notes that cannot be placed, drums, empty/audio/unknown tracks), MIDI message parsing and the typing layout.
- **37 Chrome browser tests passed** in one full local run. New: typing 120 into BPM over 86 gives 120 (it gave 240 before the fix, reproduced first), arrow keys, clamping on leaving the field, Escape, empty entry, one-step undo and save/reload; digit-by-digit entry for loop end bar and both Math Lab BPM fields; held computer-key notes that sound after 350 ms and fall silent after release; keys ignored in text fields and when switched off; a recorded take quantized to 1/16 and removed by one undo; metronome audible only while on (sampled every frame); a mocked MIDI input playing and releasing notes; per-track meters (drums move, the bass meter stays at zero in bars 1–4, all return to zero after Stop); playing along after importing a reference.
- **Strict TypeScript and production build passed.**
- Not verified: real MIDI hardware (only a mocked `requestMIDIAccess` input), recording feel and latency on real devices, Safari/Firefox, and how the metronome or held notes sound. Nobody listened to the output; checks are signal measurements.

## Version 1.5 checks — Reference Track & Audio Analysis

- **93 unit tests passed** across 11 files. Added coverage includes backward-compatible reference metadata, marker bounds/IDs, reference timing across BPM edits and Undo/Redo, complete-backup metadata, and onset/autocorrelation behavior for synthetic pulse trains, silence, steady tones, short/invalid inputs and work bounds.
- **29 Chrome browser tests passed** in one full local run, including all existing Studio and Math Lab checks. Seven new checks exercise WAV/MP3 import, corrupt/empty-file errors, PCM waveforms, seek/pause/resume on actual audio, reference-specific FFT, A/B with mute/solo, explicit BPM changes, editable markers, saved audio restoration, removal of the last reference and cache release on active-project deletion.
- Offline WAV comparison proves that adding a missing 120-second soloed reference leaves an ordinary-audio composition export **byte-for-byte unchanged**, including duration. Frequency measurements distinguish sought source regions (approximately 431 Hz and 668 Hz for 440/660 Hz tones at the analyser's bin resolution). Pausing holds position and resuming advances from it. A prior fractional-tick resume bug was fixed; tests now check that the position does not jump forward.
- **Strict TypeScript and production build passed.** A separate production-browser check imported the synthetic MP3, ran the built tempo worker, added a marker and checked both themes at 1280 × 1000 with no page errors, document-level horizontal overflow or audio upload requests. Screenshots were inspected. No new runtime dependencies were introduced.
- The user's full MP3 was tested locally, without adding it to the repository: **208.278 seconds**, approximately **70.08 MiB** decoded PCM, around **2.1 seconds** for import/waveform preparation in that run, successful seeking/playback and no observed POST/PUT audio uploads or page errors. The middle-three-minute tempo estimate was **154.6 BPM**, with **77.3 BPM** as a metrical alternative and only **27% periodicity**. This is an uncertain estimate, **not a verified tempo**. No human listening assessment was performed.
- The original demo remains **46.651179 seconds** at export, RMS approximately **0.15984**, peak **0.94568**. Minor render variation does not establish an audible mix change.
- Browser tests use the actual audio clock; polling replaced a fixed startup delay that could fail on a busy machine. The click-fixture spectrum is sampled faster than its pulse interval to avoid missing every transient. Safari/Firefox, real 8 GB hardware profiling and prolonged multi-song stress remain unverified. Decoder allocations occur before decoded-memory limits can be checked; resource limits are not a total-process memory guarantee.

See [REFERENCE_TRACKS.md](REFERENCE_TRACKS.md) for the import workflow, file map, shared-clock architecture, confidence interpretation, privacy and limits.

## Version 1.4 checks — Creative flow

- **79 unit tests passed** across 9 files, including curve mapping, complete-backup checksum/inventory validation and atomic rollback, plus MIDI timing, running status, sustain/all-notes-off behavior, empty-track channel accounting, the 128-track/conductor boundary, loops, swing, clip gates and malformed-file rejection.
- **22 Chrome browser tests passed** in one full local run. New checks exercise actual pointer dragging, changed notes during a continuous live loop, measured visualization movement/silence, the three-step Fourier/probability route, cancellation during audio activation, Studio transport restoration, complete audio-backed restoration into a fresh browser context, and MIDI download/reimport.
- **Strict TypeScript and production build passed.** Production-browser checks confirm that Math Lab is requested on entering the workspace and Tone only after an audio gesture, with no page errors. Initial JavaScript is approximately **492 kB / 155 kB gzip**, down from the previous single **718 kB / 211 kB gzip** bundle. The deferred Tone runtime is **229 kB / 59 kB gzip**, and the Math Lab UI is **29 kB / 10 kB gzip**. Total code grew with the new functionality; these are first-load savings, not a claim about download speed on every connection.
- The original demo still renders **46.651179 seconds**, RMS **0.15980**, peak **0.94583**; this release does not claim a new mix or subjective sound-quality improvement.
- Light/dark screenshots and the 1280px layout were checked. Validation used Chrome and actual PCM/clock/analyser data, not human listening. Safari/Firefox, hardware inputs and mobile multi-touch remain unverified. No ESLint configuration was added.

## Version 1.3 checks — Mathematical Music Lab (previous release)

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
- No microphone/audio recording, automation lanes, plugin hosting, or MP3 export. MIDI and computer-keyboard recording write notes only (no sustain pedal or controller data).
- Audio samples play at original speed; no pitch-shifting or time-stretching. Sample trim is start-offset plus clip gate; no destructive waveform editor.
- Arrangement edits and Math Lab live-preview edits replace future events without stopping the clock. Notes already sounding finish naturally; the audio scheduler looks ahead by 60 ms. Studio editor/Ideas previews remain rendered snapshots; restart those after editing.
- Synthesized instruments are lightweight and usable but do not claim to emulate a sampled commercial instrument library.
- Sample library contains six original one-shots/textures, plus user imports; there is no large commercial loop catalog.
- Chord detection works bar by bar and names one chord per bar. Two chords in a bar, or a bass playing something other than the root, will be read as the nearest single chord.
- The open hi-hat is closed by the next hat only in browsers that implement `AudioParam.cancelAndHoldAtTime` (Chrome, Edge, Safari). Elsewhere it rings for its full length.
- Local inspiration is music-theory generation; the LLM provider contract exists, but no external AI service is connected.
- JSON backups omit audio bytes; complete `.studio` backups include them (256 MB maximum), but exclude unapplied Math Lab drafts and learned preferences. Browser persistence is best-effort and cannot protect against the user clearing site data.
- Export has a fixed two-second tail and a ten-minute duration limit.
- Track movement uses up/down controls. Clip dragging is horizontal within its track; copy/paste supports compatible destination tracks.
