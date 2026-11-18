export interface TempoResult {
  bpm: number | null;
  confidence: number;
  alternatives: number[];
  analyzedSeconds: number;
}
/** Broadband RMS-onset autocorrelation, not beat tracking or structural recognition.
 * Confidence is a periodicity score, not a calibrated probability. */
export function estimateTempo(
  pcm: Float32Array,
  sampleRate: number,
): TempoResult {
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate < 100 ||
    pcm.length > sampleRate * 180.1
  )
    throw new Error(
      "Tempo analysis needs at most 180 seconds of finite-rate PCM.",
    );
  const seconds = pcm.length / sampleRate;
  const empty: TempoResult = {
    bpm: null,
    confidence: 0,
    alternatives: [],
    analyzedSeconds: seconds,
  };
  if (seconds < 8) return empty;
  const hop = Math.max(1, Math.round(sampleRate / 100)),
    rate = sampleRate / hop,
    count = Math.floor(pcm.length / hop);
  const energy = new Float32Array(count),
    onsets = new Float32Array(count);
  let total = 0;
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) {
      const x = pcm[j];
      if (!Number.isFinite(x))
        throw new Error("Audio contains invalid PCM samples.");
      sum += x * x;
    }
    total += sum;
    energy[i] = Math.log1p(50 * Math.sqrt(sum / hop));
  }
  if (Math.sqrt(total / (count * hop)) < 0.0001) return empty;
  let mean = 0;
  for (let i = 1; i < count; i++) {
    onsets[i] = Math.max(0, energy[i] - energy[i - 1]);
    mean += onsets[i];
  }
  // A 50 ms triangular window reduces tempo bias from fractional-frame beats
  // (for example 180 BPM does not land on integer 100 Hz envelope frames).
  const raw = onsets.slice();
  for (let i = 2; i < count - 2; i++)
    onsets[i] =
      (raw[i - 2] + 2 * raw[i - 1] + 3 * raw[i] + 2 * raw[i + 1] + raw[i + 2]) /
      9;
  mean = onsets.reduce((sum, value) => sum + value, 0) / count;
  let variance = 0;
  for (let i = 0; i < count; i++) {
    onsets[i] -= mean;
    variance += onsets[i] * onsets[i];
  }
  if (variance / count < 1e-7) return empty;
  const lo = Math.ceil((60 * rate) / 220),
    hi = Math.floor((60 * rate) / 40),
    scores = new Map<number, number>();
  let bestLag = lo,
    best = -1;
  for (let lag = lo; lag <= hi; lag++) {
    let dot = 0,
      left = 0,
      right = 0;
    for (let i = lag; i < count; i++) {
      const a = onsets[i],
        b = onsets[i - lag];
      dot += a * b;
      left += a * a;
      right += b * b;
    }
    const correlation = dot / Math.sqrt(Math.max(1e-12, left * right));
    scores.set(lag, correlation);
    const bpm = (60 * rate) / lag;
    const score =
      correlation * (0.94 + 0.06 * Math.exp(-(Math.log2(bpm / 110) ** 2)));
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  // Several metrical levels can share a peak. Among strong local maxima,
  // prefer a central musical tempo rather than an exact third-period alias.
  const strongest = Math.max(...scores.values());
  const candidates = [...scores].filter(
    ([lag, value]) =>
      value >= strongest * 0.8 &&
      value >= 0.15 &&
      value >= (scores.get(lag - 1) ?? -1) &&
      value >= (scores.get(lag + 1) ?? -1),
  );
  candidates.sort(
    (a, b) =>
      Math.abs(Math.log2((60 * rate) / a[0] / 110)) -
      Math.abs(Math.log2((60 * rate) / b[0] / 110)),
  );
  if (candidates.length) bestLag = candidates[0][0];
  const peak = scores.get(bestLag) ?? 0;
  if (peak < 0.15) return empty;
  const a = scores.get(bestLag - 1) ?? peak,
    b = scores.get(bestLag + 1) ?? peak;
  const delta = Math.max(
    -0.5,
    Math.min(0.5, (a - b) / (2 * (a - 2 * peak + b) || 1)),
  );
  const bpm = Math.round((600 * rate) / (bestLag + delta)) / 10;
  return {
    bpm,
    confidence: Math.min(0.98, Math.max(0, peak)),
    alternatives: [bpm / 2, bpm * 2]
      .filter((v) => v >= 30 && v <= 300)
      .map((v) => Math.round(v * 10) / 10),
    analyzedSeconds: seconds,
  };
}
