/** The mark: a thin gold ring, hairline notches for the seats, and a condensed geometric S.
 *  Twenty-one notches when there is room, eight at header size, none below 20 px. */
export function Crest({ size = 24, className = "", title = "Satoshi's Council" }: { size?: number; className?: string; title?: string }) {
  const n = size >= 40 ? 21 : size >= 20 ? 8 : 0;
  const ticks = Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return (
      <line
        key={i}
        x1={(128 + 106 * Math.cos(a)).toFixed(1)}
        y1={(128 + 106 * Math.sin(a)).toFixed(1)}
        x2={(128 + 116 * Math.cos(a)).toFixed(1)}
        y2={(128 + 116 * Math.sin(a)).toFixed(1)}
      />
    );
  });
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" className={className} role="img" aria-label={title} focusable="false">
      <circle cx="128" cy="128" r="100" fill="none" stroke="var(--gold)" strokeWidth={size >= 40 ? 3 : 8} />
      {n ? (
        <g stroke="var(--gold-dim)" strokeWidth={size >= 40 ? 1.5 : 6} strokeLinecap="round">
          {ticks}
        </g>
      ) : null}
      <path
        d="M164 84H92V128H164V172H92"
        fill="none"
        stroke="var(--text)"
        strokeWidth={size >= 40 ? 14 : 24}
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}
