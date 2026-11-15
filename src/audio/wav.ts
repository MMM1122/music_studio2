/** Interleaved, little-endian 16-bit PCM in a standard RIFF/WAVE container. */
export function encodeWav(
  channels: readonly Float32Array[],
  sampleRate: number,
): ArrayBuffer {
  if (
    channels.length < 1 ||
    channels.length > 2 ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0
  )
    throw new Error("Invalid WAV channel configuration.");
  const length = channels[0].length;
  if (channels.some((channel) => channel.length !== length))
    throw new Error("WAV channels must have equal length.");
  const bytesPerFrame = channels.length * 2;
  const buffer = new ArrayBuffer(44 + length * bytesPerFrame);
  const view = new DataView(buffer);
  const string = (offset: number, value: string) =>
    [...value].forEach((character, index) =>
      view.setUint8(offset + index, character.charCodeAt(0)),
    );
  string(0, "RIFF");
  view.setUint32(4, 36 + length * bytesPerFrame, true);
  string(8, "WAVE");
  string(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerFrame, true);
  view.setUint16(32, bytesPerFrame, true);
  view.setUint16(34, 16, true);
  string(36, "data");
  view.setUint32(40, length * bytesPerFrame, true);
  let offset = 44;
  for (let frame = 0; frame < length; frame++)
    for (const channel of channels) {
      const sample = Number.isFinite(channel[frame])
        ? Math.max(-1, Math.min(1, channel[frame]))
        : 0;
      view.setInt16(
        offset,
        Math.round(sample * (sample < 0 ? 0x8000 : 0x7fff)),
        true,
      );
      offset += 2;
    }
  return buffer;
}
