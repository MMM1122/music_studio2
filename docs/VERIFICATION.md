# Verification and current limits

## Automated checks

Version 1.1 was run with Node 22.23 and headless Google Chrome on Linux. Test source is included so results can be reproduced; this is MVP verification, not a claim of professional-DAW production certification.

- Strict TypeScript and production Vite build.
- 46 Vitest tests across domain editing, theory, shared patterns, timing, serialization/validation, bounded command history, continuous-edit coalescing, IndexedDB project/blob persistence, musical scheduling, mute/solo, and WAV headers/PCM. New in 1.1: every key the transport offers resolves to the right scale, notes are spelled for the key, chords are detected from notes (including rootless voicings over a bass), the demo's eight chords are read back correctly, voicings stay in range and move less than root position, and generated basslines and melodies follow the song's chords.
- Browser audio checks render the complete demo, inspect decoded PCM signal and duration, verify all-muted silence, verify BPM-dependent duration, and check imported audio position, trim, looping, and gain.
- Realtime browser checks verify an advancing audio clock and nonzero output meter, pause position, seek, rapid Play/Pause/Stop requests, and independent looping pattern preview.
- Twenty-five structural edits in one second during playback: the transport keeps real time (0.998× and 1.002× the expected ticks in two runs), position never moves backward, and no meter reading is silent. The same sequence on the 1.0 engine rewound the position and gave 14 silent readings out of 25.
- Scale highlighting and note names are checked in the browser for C minor, E♭ minor, and E major; the in-key chord menu inserts a rootless Fm7; the arrangement playhead moves by transform while the clip DOM nodes stay the same objects.
- All seven pitched presets are added to a blank project, auditioned, played together, and exported.
- The production build was served from a sub-folder and played with no failed requests.
- Browser UI checks cover blank 90 BPM projects, six-voice drum editing, piano notes/chords/bass, note resize and quantization, copy/paste, moving/duplicating clips, undo/redo, mute/solo, full-state save/reload, imported asset recovery, local idea acceptance/editing, and actual WAV download.
- Theme checks compare project state before/after switching during playback and verify the transport continues. Screenshots cover Gallery Light, Dark, and a 1280px laptop layout.
- Browser tests assert no uncaught page errors in the main workflows.

The 16-bar demo at 86 BPM produced a stereo 44,100 Hz PCM16 WAV lasting **46.651179 seconds** including the two-second tail (expected musical duration: 46.651163 seconds before frame rounding). Measured RMS was approximately **0.1726** (−15.3 dBFS), peak **0.9632**, with no samples at full scale and no DC offset; over four million PCM samples were nonzero. These are signal measurements from a real browser render, not a visual mock. `docs/CHANGES.md` compares the spectrum and stem levels with version 1.0.

## What has not been established

- Cross-browser behavior has not been tested in Safari/Firefox; audio format support and autoplay behavior vary by browser.
- Nobody has listened to version 1.1. The instruments and mix were balanced from measurements (level, spectrum, stereo width, stem balance), which can show that a mix is not muddy, lopsided, or clipping, but cannot show that it sounds good. Judge the sound by ear and adjust levels to taste.
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
