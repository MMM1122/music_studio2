# Reference tracks & Audio Analysis

## Import a full-length song

1. Open **Samples → Import Reference** and choose a local MP3, WAV or other format your browser can decode. The file must be nonempty and at most 50 MB. Decoded audio must be at most 20 minutes and 256 MB per file; see resource limits below.
2. STUDIO inserts a labeled reference track at the top, selects it and opens **Audio Analysis**. Existing composition tracks and BPM stay unchanged. Arrangement looping is disabled so a full song can play through.
3. Press **Play timeline** or the main transport Play. Click the waveform to seek on the shared clock. Use waveform zoom and the navigation slider to inspect a later passage. Keyboard Left/Right seeks one second; Home/End moves to the source boundaries allowed by the selected clip.
4. Use **Reference / My Composition / Both** above the arrangement. Track Mute, Solo and volume still apply within the chosen listening group. In Both, solo applies across both groups; mute always wins. For example, a soloed reference cannot silence the My Composition group.
5. Choose **Estimate BPM**, listen and check the suggested pulse, then correct **Manual BPM** if needed. Only **Set project BPM** changes the session. Add original instrument or audio tracks underneath and compose normally.
6. Set a section label and source time in seconds, or choose **Use playhead**, then **Add marker**. Existing marker names/times can be edited; click their jump buttons to navigate. Markers are manual, not automatic section recognition.
7. **Save** persists the session in this browser. **Projects → Export complete project** includes original audio and analysis metadata in one `.studio` file. Plain project JSON includes metadata only. **Export WAV** contains your composition, excluding all references.

## Timing and listening

The importer, scheduler and engine are shared with ordinary samples; there is no separate reference player. Reference clips use the same Tone transport and native `AudioBufferSourceNode` path, with playback rate 1 and their source offset applied when seeking or resuming. Composition and reference voices are cued from the same musical tick. Pause/resume rounds the transport position to an integer tick, fixing an older invalid fractional-tick string issue.

Changing BPM rescales reference clip start/duration ticks to retain their absolute seconds. Notes and ordinary clips retain beat timing. During playback, a tempo change re-cues voices together at the current **musical tick** under the new tempo: the corresponding source position can change, but playback speed/pitch do not. There is no stretching, beat warping or variable-tempo following. Integer tick rounding adds at most half a tick per edited boundary.

References start dry, with no reverb/delay sends. The existing track strip and master bus still process monitoring; the reference is not a bit-perfect bypass of the mixer. The spectrum measures the reference track after its fader and before the master, so composition sound does not contaminate it and muting/A/B exclusion produces silence. Multiple references are supported; Reference mode monitors all eligible reference tracks.

Reference markers describe timestamps within the source recording. Moving a clip changes where that source appears on the arrangement. A jump outside a trimmed clip's source range is clamped to its available range. Each reference track may contain multiple clips of the same source; a different recording needs a separate reference track. No automatic song form, key, chord, stem or transcription model is claimed.

## Analysis and resource limits

- **Waveform:** 4,096 peak buckets derived from every channel of the decoded PCM; shared cache outside project state. Preparation yields to the browser between blocks. The arrangement also uses cached PCM-derived miniature peaks.
- **Spectrum:** a lazy 2,048-sample `AnalyserNode`, 1,024 frequency bins, a logarithmic Hz axis and dB magnitudes. Canvas/DOM updates run at most about 12.5 times per second, stop drawing while hidden/offscreen and do not cause per-frame React updates. Near 44.1 kHz the bin spacing is approximately 21.5 Hz. This is a visual spectrum, not a calibrated loudness meter.
- **Tempo:** at most 180 seconds from the middle are amplitude-downsampled to 4 kHz. RMS/log energy changes form a smoothed onset envelope at 100 Hz; normalized autocorrelation searches periodic pulse candidates. A worker handles the estimator, transfers only a bounded derived buffer and is terminated after completion, cancellation or leaving the selected reference. Silent, too-short and nonperiodic audio can produce no estimate.
- **Uncertainty:** confidence reports envelope periodicity, not a calibrated chance that the musical BPM is correct. Half/double-time interpretations are shown. Live recordings, rubato, syncopation and weak percussion need manual checking. Analysis never changes project BPM automatically.
- **Memory:** original file size is capped at 50 MB, decoded duration at 20 minutes, decoded PCM at 256 MB per file and the decoded asset cache at 512 MB. A compressed file can expand substantially; the browser decoder allocates PCM before decoded-size limits can be checked. These limits reduce sustained usage but are not a hard total-process memory cap or an 8 GB hardware performance certification. Complete backups retain their existing 256 MB bundle limit; WAV export retains its ten-minute limit.
- **Privacy/lifetime:** original audio blobs live only in IndexedDB; decoded buffers and small derived arrays stay outside React/project state. There is no analysis upload or paid API. Temporary preview object URLs are revoked; observers/workers are disconnected; removed track analysers are disconnected and decoded assets from another session are released. Browser storage can be denied, exhausted or cleared. Visible errors identify decoding, missing assets and storage failures.

## Import, persistence and export architecture

`SampleBrowser` uses one validation/decode/save pipeline for both import actions. The engine decodes once and owns PCM; project state stores only an `AudioAsset` reference and an audio clip. IndexedDB stores the original blob separately. Reference tracks add optional `role: "reference"` and `reference` metadata (markers, estimate and manual correction) to schema version 1. Old projects remain valid; malformed role/metadata combinations are rejected. Complete backups include the same original audio bytes and metadata, with the existing checksum/atomic restoration guarantees.

Monitoring filters the eligible track group before applying solo/mute. Offline WAV and MIDI export first remove references from the project. Thus a long reference cannot extend a short composition export, a missing reference does not block export, and Reference Solo cannot mute the exported composition. Ordinary audio assets and composition solo/mute keep their normal behavior. The exporter still uses at least one bar plus its two-second effect tail; a reference-only project has no composition to export.

## Implementation file map

- `src/domain/models.ts`, `validation.ts`, `reference.ts`: optional reference schema, source-time metadata, track creation and tempo rescaling. `src/stores/projectStore.ts` applies rescaling to BPM edits; Undo/Redo restore whole snapshots.
- `src/components/SampleBrowser.tsx`: shared import/storage pipeline and visible validation errors. `src/app/App.tsx`: asset restoration, reference editor selection and export messaging.
- `src/audio/engine.ts`, `graph.ts`, `scheduler.ts`: shared playback, A/B routing, asset/peak ownership, analyser taps, resume fix and composition-only export selection. `src/midi/files.ts` shares composition selection.
- `src/components/ReferenceAnalysis.tsx`, `src/audio/analysis/{pcm,tempo,tempo.worker}.ts`: waveform, FFT, tempo worker and markers. `src/themes/reference-analysis.css` preserves both existing themes.
- `src/components/Arrangement.tsx`, `Inspector.tsx`, `src/stores/transportStore.ts`: reference labels, A/B controls and transport state.
- `src/domain/reference.test.ts`, `src/audio/analysis/tempo.test.ts`, `src/persistence/backup.test.ts`, `e2e/reference*.spec.ts`: metadata, timing, DSP, backup and browser/audio regressions. Fixtures are original synthesized clicks, including the MP3 decoder fixture.

See [VERIFICATION.md](VERIFICATION.md) for executed tests and remaining browser/hardware limitations. The FFT uses the browser's [Web Audio AnalyserNode API](https://www.w3.org/TR/webaudio/#AnalyserNode).
