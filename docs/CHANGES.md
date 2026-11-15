# What changed in 1.1

Version 1.1 keeps the 1.0 interface, data format, and file layout. Projects saved by 1.0 open unchanged. The work went into how the studio sounds, how well its suggestions fit a song, and how it behaves while playing.

## Sound

**One room, one delay.** In 1.0 every track owned a convolution reverb and a delay line. Tracks now send to a shared room and a shared dotted-eighth ping-pong delay (`MixBus` in `src/audio/graph.ts`). That is one convolver instead of one per track, and separate instruments sound like they are in the same space.

**Instruments.** Each voice was rebuilt:

- Electric Piano: two-operator FM with an index that falls after the attack, a tine partial, and a slight left-to-right spread across the keyboard.
- Synth Bass: saw and square through a resonant filter that closes after the attack, over an unfiltered fundamental.
- Synth Pad: three detuned saws spread in stereo with slow drift.
- Lead Synth: filter sweep and vibrato that arrives after the note settles.
- Drum Kit: shorter, lower kick; snare with more wire than shell; metallic hats; the closed hat chokes the open hat; hats, clap, and rim sit slightly off-centre. The kit's Brightness and Release controls now shape tone and decay.
- New presets: Felt Piano, Sub Bass, Pluck.

**Bus.** A 26 Hz rumble filter, slow low-ratio compression, a soft clipper, and a limiter replace the single hard limiter. Stopping fades voices over a few milliseconds instead of cutting the waveform.

### Measured, not heard

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

## Music

**The demo.** "Sunday, softly" keeps its key, tempo, and length and gains a shape: a four-bar intro on keys, pad, and rim; the full groove with a hook; a lift through Fm9–B♭13–E♭maj9; and a return. Chords are voiced by hand so each moves to the next by a step or two. (The idea generator voices the same four chords with 14 semitones of total movement, against 33 in root position; `harmony.test.ts` measures this.) The bass walks into each new root, drum velocities range from ghost notes to backbeats, and the hook is written as a question and an answer.

**Ideas follow your song.** `src/domain/harmony.ts` reads the chord in each bar from the notes on pitched tracks; the bass decides what a rootless voicing is. Basslines, melodies, and chord voicings are then written against those chords at the playhead. Melodies land on chord tones on strong beats and pass through the scale between them. In an empty project the ideas use the key's own progression and say so.

**Chords in key.** The piano roll's chord tool lists the seventh chords of the project key with roman numerals and inserts them close, open, rootless, or shell.

## Engineering

- **Scale highlighting was wrong in ten of the 24 keys.** The piano roll had its own key parser that did not recognise the ♭ and ♯ characters used in the key menu, so E♭, A♭, B♭, C♯, and F♯ keys highlighted the C scale. Keys, scales, and note spelling now come from one module, and notes are spelled for the key.
- **Editing during playback.** 1.0 stopped and restarted the transport on every edit. Under a quick series of edits the position jumped backward and the output went silent. 1.1 replaces only the future schedule; the same series now keeps real time with no silent readings.
- **Rendering.** 1.0 re-rendered the whole interface about 22 times a second while playing. Playback readings now live in their own store; playheads and the meter update their DOM nodes directly.
- **Preview.** Pattern preview uses the track's own instrument settings and folds release tails back into the loop, so the loop point has no cut notes.
- **Deploy.** Asset paths are relative, so `dist/` runs from any folder.
- **Tests.** 46 unit tests (31 before) and 12 browser tests (9 before).

## Not changed

The visual design, the project schema (still version 1), persistence, sample import, and WAV export are as they were. `docs/VERIFICATION.md` lists what has and has not been established.
