// The pulse-C brand glyph (kernel §1): a flatline → spike → curl-into-C heartbeat. Shared across
// Instrument surfaces (Command Center rail, arc headers). The C carries the accent + glow.
export function PulseC({ size = 26 }: { size?: number }) {
  return (
    <svg
      className="pulse-c"
      viewBox="0 0 34 24"
      width={size}
      height={(size * 24) / 34}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M1 12h6l2.5-7 3 14 2.2-5.5"
        stroke="var(--ix-accent)"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M30 7.5a8 8 0 1 0 0 9" stroke="var(--ix-accent)" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}
