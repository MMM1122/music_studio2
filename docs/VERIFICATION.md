# Verification and current limits

## Automated checks

Run with Node 22.21 and Google Chrome on macOS. Test source is included so results can be reproduced; this is MVP verification, not a claim of professional-DAW production certification.

- Strict TypeScript and production Vite build.
- 31 Vitest assertions across domain editing, theory, shared patterns, timing, serialization/validation, bounded command history, continuous-edit coalescing, IndexedDB project/blob persistence, musical scheduling, mute/solo, and WAV headers/PCM.
- Browser audio checks render the complete demo, inspect decoded PCM signal and duration, verify all-muted silence, verify BPM-dependent duration, and check imported audio position, trim, looping, and gain.
- Realtime browser checks verify an advancing audio clock and nonzero output meter, pause position, seek, rapid Play/Pause/Stop requests, and independent looping pattern preview.
- Browser UI checks cover blank 90 BPM projects, six-voice drum editing, piano notes/chords/bass, note resize and quantization, copy/paste, moving/duplicating clips, undo/redo, mute/solo, full-state save/reload, imported asset recovery, local idea acceptance/editing, and actual WAV download.
- Theme checks compare project state before/after switching during playback and verify the transport continues. Screenshots cover Gallery Light, Dark, and a 1280px laptop layout.
- Browser tests assert no uncaught page errors in the main workflows.

The 16-bar demo at 86 BPM produced a stereo 44,100 Hz PCM16 WAV lasting **46.651179 seconds** including the two-second tail (expected musical duration: 46.651163 seconds before frame rounding). Measured RMS was approximately **0.08965**, peak **0.67709**; over four million PCM samples were nonzero. These are signal measurements from a real browser render, not a visual mock.

## What has not been established

- Cross-browser behavior has not been tested in Safari/Firefox; audio format support and autoplay behavior vary by browser.
- Human listening on the user's actual speakers/audio interface has not been verified. Tests measure real generated audio and export data.
- Mobile editing, long-session stress tests, extreme 50,000-note patterns, and professional latency targets are not certified.
- Public/cloud data synchronization is not implemented. GitHub source synchronization is separate from users' local musical projects.

## Deliberate MVP limits

- 4/4 time signature only; fixed tempo per project.
- No microphone recording, MIDI input/recording, MIDI-file import/export, automation lanes, plugin hosting, or MP3 export.
- Audio samples play at original speed; no pitch-shifting or time-stretching. Sample trim is start-offset plus clip gate; no destructive waveform editor.
- Structural edits during playback reschedule with a short safety gap. Independent pattern preview is a rendered snapshot; restart it after editing.
- Synthesized instruments are lightweight and usable but do not claim to emulate a sampled commercial instrument library.
- Sample library contains six original one-shots/textures, plus user imports; there is no large commercial loop catalog.
- Local inspiration is music-theory generation; the LLM provider contract exists, but no external AI service is connected.
- JSON backups omit audio bytes. Browser storage can be cleared by the user/browser; retain source audio and export backups.
- Export has a fixed two-second tail and a ten-minute duration limit.
- Track movement uses up/down controls. Clip dragging is horizontal within its track; copy/paste supports compatible destination tracks.
