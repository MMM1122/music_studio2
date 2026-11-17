import { useEffect, useRef } from "react";
import { engine } from "../audio/engine";

/** Line geometry comes only from measured waveform and spectral energy. */
export function SessionArtwork({ large = false }: { large?: boolean }) {
  const figure = useRef<HTMLElement>(null),
    paths = useRef<(SVGPathElement | null)[]>([]),
    caption = useRef<HTMLElement>(null);
  useEffect(() => {
    const wave = new Float32Array(1024),
      spectrum = new Uint8Array(512);
    let frame = 0,
      last = 0,
      visible = true;
    const observer = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    });
    if (figure.current) observer.observe(figure.current);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    function draw(time: number) {
      frame = requestAnimationFrame(draw);
      if (!visible || document.hidden || time - last < (reduced ? 140 : 33))
        return;
      last = time;
      engine.readAnalysis(wave, spectrum);
      const rms = Math.sqrt(
        wave.reduce((sum, v) => sum + v * v, 0) / wave.length,
      );
      const active = rms > 0.00015;
      // A threshold crossing aligns adjacent frames, so pitch is visible rather than arbitrary motion.
      let crossing = 0;
      for (let i = 1; i < 256; i++) {
        if (wave[i - 1] <= 0 && wave[i] > 0) {
          crossing = i;
          break;
        }
      }
      paths.current.forEach((path, row) => {
        if (!path) return;
        const band = spectrum[Math.min(511, 2 + row * 5)] / 255;
        const d = Array.from({ length: 65 }, (_, i) => {
          const t = i / 64,
            sample = wave[(crossing + i * 10 + row * 3) % wave.length];
          const y =
            35 + sample * 25 + (row - 6.5) * band * 2.4 * Math.sin(Math.PI * t);
          return `${i ? "L" : "M"}${(9 + t * 138).toFixed(2)},${Math.max(5, Math.min(65, y)).toFixed(2)}`;
        }).join(" ");
        path.setAttribute("d", d);
        path.style.opacity = active ? "0.65" : "0.14";
      });
      figure.current?.setAttribute("data-signal", active ? "active" : "silent");
      if (caption.current)
        caption.current.textContent = active
          ? `LIVE SOUND · ${Math.max(-80, 20 * Math.log10(rms)).toFixed(0)} dBFS`
          : "SOUND AT REST";
    }
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  return (
    <figure
      ref={figure}
      className={`session-artwork ${large ? "session-artwork-large" : ""}`}
      data-signal="silent"
      aria-label="Live audio visualization"
    >
      <svg
        viewBox="0 0 156 70"
        fill="none"
        role="img"
        aria-label="Measured waveform and frequency energy"
      >
        <path
          d="M3 35H153"
          stroke="currentColor"
          strokeWidth="0.3"
          strokeDasharray="1.5 4"
          opacity=".25"
        />
        {Array.from({ length: 14 }, (_, index) => (
          <path
            key={index}
            ref={(node) => {
              paths.current[index] = node;
            }}
            d="M9 35H147"
            stroke="currentColor"
            strokeWidth={index === 6 ? 0.9 : 0.55}
            opacity=".14"
          />
        ))}
        <circle cx="9" cy="35" r="1" fill="currentColor" />
        <circle cx="147" cy="35" r="1" fill="currentColor" />
      </svg>
      <figcaption ref={caption}>SOUND AT REST</figcaption>
    </figure>
  );
}
