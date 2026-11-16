/** A compact, silent line study inspired by the grooves of a record. */
export function SessionArtwork() {
  const lines = Array.from({ length: 14 }, (_, index) => {
    const offset = index - 6.5;
    return Array.from({ length: 65 }, (_, point) => {
      const t = point / 64;
      const envelope = Math.sin(t * Math.PI);
      const x = 9 + t * 138;
      const y =
        35 +
        Math.sin(t * Math.PI * 2 - 0.7) * envelope * 12 +
        offset * (2.4 + Math.cos(t * Math.PI * 2) * 1.1) * envelope;
      return `${point ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");
  });
  return (
    <figure className="session-artwork" aria-hidden="true">
      <svg viewBox="0 0 156 70" fill="none">
        <path
          className="artwork-secondary"
          d="M3 35H153"
          strokeWidth="0.5"
          strokeDasharray="1.5 4"
          opacity="0.5"
        />
        {lines.map((d, index) => (
          <path
            key={index}
            d={d}
            stroke="currentColor"
            strokeWidth={index === 6 ? 0.9 : 0.55}
            opacity={index === 6 ? 0.9 : 0.65}
          />
        ))}
        <circle cx="9" cy="35" r="1.5" fill="currentColor" />
        <circle cx="147" cy="35" r="1.5" fill="currentColor" />
      </svg>
      <figcaption>ROOM FOR RESONANCE</figcaption>
    </figure>
  );
}
