import type { GameReadiness } from "../types";
import { rowVerdict } from "./use-scan";
import "./FirstCheck.css"; // scan-row + sweep styles (shared wherever ScanStream renders)

// The scan visual (halfway-home §2: the submarine radar is RETIRED). A soft light beam passes across
// the streaming check rows; findings tick in as it passes (real data, real elapsed); one streak
// bursts as the verdict lands. Locked arc copy unchanged — only the visual metaphor swapped.
// Reduced-motion: the beam + streak simply don't render (the rows still stream).
export function ScanStream({
  readiness,
  shownRows,
  running,
  phase,
}: {
  readiness: GameReadiness | null;
  shownRows: number;
  running: boolean;
  phase: "scan" | "verdict";
}) {
  const checks = readiness?.checks ?? [];
  const scanning = running || phase === "scan";
  return (
    <div className="fc-sweepzone">
      {scanning && <div className="fc-sweep-beam" aria-hidden="true" />}
      <div className="fc-scan">
        {checks.map((c, i) => {
          const v = rowVerdict(c.status);
          return (
            <div
              key={c.id}
              className={`fc-row ${i < shownRows ? "fc-row-in" : "fc-row-pending"} fc-row-${v}`}
            >
              <span className="fc-row-mark">{v === "fix" ? "→" : v === "ok" ? "✓" : "·"}</span>
              <span className="fc-row-label">{c.label}</span>
              <span className="fc-row-tag">
                {v === "fix" ? "worth fixing" : v === "unknown" ? "—" : ""}
              </span>
            </div>
          );
        })}
      </div>
      {phase === "verdict" && <div className="fc-verdict-streak" aria-hidden="true" />}
    </div>
  );
}
