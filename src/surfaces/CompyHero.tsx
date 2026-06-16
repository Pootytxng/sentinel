import "./CompyHero.css";

// "Welcome to Compy" — the committed brand hero (owner "take a full swing", 2026-06-15).
//
// THE IDEA: Compy's mark is already a heartbeat inside a C. So the hero IS that, made huge and alive —
// a glowing pulse-C that BEATS like a vital-signs monitor over a teal signal field. It says, in one
// image, what Compy is: your PC's vitals, measured. Distinctly ours (a living monitor, not the generic
// floating-3D-cube every premium app reaches for), trust-coded (a healthy heartbeat), and honest — the
// three pills are our answer to the snake-oil "Max FPS · Zero Bloat · Stripped Telemetry" pitch, flipped
// to what Compy actually stands for: Measured · Reversible · Yours.
//
// Behind the compy_committed flag (default OFF). Every motion has a reduced-motion fallback (the CSS
// holds the heartbeat fully drawn + still). No fabricated claims — it's identity, not a metric.

// The pulse-C geometry is the SAME master geometry as the Wordmark (one mark, no drift): a 240r arc
// open to the right, with the ECG heartbeat threaded through its mouth.
const C_ARC = "M672 320 A240 240 0 1 0 672 704";
const PULSE = "360,512 424,512 460,434 514,594 556,470 602,512 648,512";

export function CompyHero({ greeting }: { greeting?: string }) {
  return (
    <section className="ch-hero" aria-label="Welcome to Compy">
      {/* Signal field — a committed teal glow + a faint oscilloscope grid (instrument texture, not
          glassmorphism). This is where the teal is allowed to OWN the surface. */}
      <div className="ch-field" aria-hidden="true">
        <div className="ch-field-grid" />
        <div className="ch-field-glow" />
      </div>

      <div className="ch-mark" aria-hidden="true">
        <svg viewBox="170 200 620 620" className="ch-mark-svg">
          <defs>
            <filter id="ch-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="10" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {/* The C — the steady ring of the instrument. */}
          <path
            d={C_ARC}
            fill="none"
            stroke="var(--ix-accent, #2ee6c0)"
            strokeWidth="104"
            strokeLinecap="round"
            filter="url(#ch-glow)"
            className="ch-c"
          />
          {/* The heartbeat — draws across on a loop, like a live monitor trace. */}
          <polyline
            points={PULSE}
            fill="none"
            stroke="var(--ix-accent-text, #7ff0d0)"
            strokeWidth="58"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            filter="url(#ch-glow)"
            className="ch-pulse"
          />
        </svg>
      </div>

      <div className="ch-copy">
        {greeting && <p className="ch-greeting">{greeting}</p>}
        <h1 className="ch-title">
          Welcome to <span className="ch-title-c">Compy</span>
        </h1>
        <p className="ch-tagline">Your PC's vitals — measured, never guessed.</p>
        <div className="ch-pills">
          <span className="ch-pill">
            <svg viewBox="0 0 16 16" className="ch-pill-i" aria-hidden="true">
              <polyline points="1.5 8 5 8 6.5 4.5 9 11.5 10.5 8 14.5 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Measured
          </span>
          <span className="ch-pill">
            <svg viewBox="0 0 16 16" className="ch-pill-i" aria-hidden="true">
              <path d="M8 2 13 4v3.5c0 3.2-2.1 5.3-5 6.5-2.9-1.2-5-3.3-5-6.5V4z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              <polyline points="5.8 8 7.3 9.5 10.4 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Reversible
          </span>
          <span className="ch-pill">
            <svg viewBox="0 0 16 16" className="ch-pill-i" aria-hidden="true">
              <rect x="3.5" y="7" width="9" height="6.5" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            Yours
          </span>
        </div>
      </div>
    </section>
  );
}
