import type { GameReadiness } from "../types";
import { ArcRadar, type RadarBlip } from "./ArcRadar";
import { rowVerdict } from "./use-scan";
import "./FirstCheck.css"; // scan-row + scanzone styles (shared wherever ScanStream renders)

// The scan visual — the streaming check rows, optionally beside the radar. Shared by FirstCheck (the
// arc skin shows the radar; the classic skin doesn't) and Check (always shows it). One source of
// truth for the row markup so the two surfaces can't drift.
export function ScanStream({
  readiness,
  shownRows,
  running,
  phase,
  radar,
  radarBlips,
}: {
  readiness: GameReadiness | null;
  shownRows: number;
  running: boolean;
  phase: "scan" | "verdict";
  radar: boolean;
  radarBlips: RadarBlip[];
}) {
  const checks = readiness?.checks ?? [];
  const rows = (
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
  );
  if (!radar) return rows;
  return (
    <div className="fc-scanzone">
      <ArcRadar blips={radarBlips} shownCount={shownRows} scanning={running || phase === "scan"} />
      {rows}
    </div>
  );
}
