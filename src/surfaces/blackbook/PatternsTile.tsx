import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PatternReport, SessionPattern } from "../../types";
import { useIntelligenceFlag } from "../../design/use-hud";
import { useExpertView } from "../../design/use-expert-view";
import { prettyGameName } from "../game-name";
import "./patterns-tile.css";

// Intelligence Phase 2 — cross-session pattern detection, surfaced in Blackbook (§5E: the room that
// holds the historical record). The deterministic Rust detectors (intelligence_patterns.rs) read
// every recorded session and report trends/thermal/memory/driver/mode/fade patterns — each a
// plain-language finding with a confidence BAND (never numeric), the real numbers in it, and what
// would raise confidence. This is a READ view: one get_intelligence_patterns fetch, zero mutation,
// zero network. Gated on compy_intelligence (default ON); a failed fetch ⇒ no tile (never a
// fabricated pattern). §0.12: detectors that stayed silent say why (coverage) — surfaced under the
// Expert view rather than dropped. The plain findings themselves are for every user (§7 language).

function PatternCard({ p, expert }: { p: SessionPattern; expert: boolean }) {
  const [open, setOpen] = useState(false);
  const hasWorking =
    p.confidence_reason.length > 0 ||
    p.supporting_evidence.length > 0 ||
    p.raises_confidence.length > 0 ||
    p.next_test != null;
  return (
    <div className={`bpt-card bpt-conf-${p.confidence}`}>
      <div className="bpt-card-head">
        <div className="bpt-card-titles">
          <span className="bpt-card-title">{p.title}</span>
          {p.game && <span className="bpt-card-game">{prettyGameName(p.game) || p.game}</span>}
        </div>
        <span className="bpt-card-conf">{p.confidence} confidence</span>
      </div>
      <p className="bpt-card-detail">{p.detail}</p>
      {hasWorking && (
        <button
          type="button"
          className="bpt-card-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span>{open ? "Hide the working" : "Why we think so"}</span>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        </button>
      )}
      {open && (
        <div className="bpt-card-working">
          {p.confidence_reason && (
            <p className="bpt-why">{p.confidence_reason}</p>
          )}
          {p.supporting_evidence.length > 0 && (
            <div className="bpt-evi">
              <span className="bpt-evi-label">Evidence</span>
              <ul>
                {p.supporting_evidence.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {p.raises_confidence.length > 0 && (
            <div className="bpt-evi bpt-evi-raise">
              <span className="bpt-evi-label">What would make this clearer</span>
              <ul>
                {p.raises_confidence.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {expert && p.next_test && (
            <p className="bpt-next">
              <span className="bpt-evi-label">Next test</span> {p.next_test}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function PatternsTile() {
  const on = useIntelligenceFlag();
  const expert = useExpertView();
  const [report, setReport] = useState<PatternReport | null>(null);

  useEffect(() => {
    if (!on) return;
    let alive = true;
    invoke<PatternReport>("get_intelligence_patterns")
      .then((r) => {
        if (alive) setReport(r);
      })
      .catch(() => {}); // fetch failure → no tile; never a fabricated pattern
    return () => {
      alive = false;
    };
  }, [on]);

  if (!on || !report) return null;
  // Brand-new user with nothing recorded — no empty tile noise; the tape's own empty state speaks.
  if (report.sessions_considered === 0) return null;

  const { patterns, coverage, sessions_considered, games_considered } = report;

  return (
    <div className="bpt">
      <div className="bpt-sect">
        <span className="bpt-sect-t">Patterns across your sessions</span>
        <span className="bpt-sect-rule" aria-hidden="true" />
        <span className="bpt-sect-s">
          from {sessions_considered} session{sessions_considered === 1 ? "" : "s"}
          {games_considered > 0 &&
            ` · ${games_considered} game${games_considered === 1 ? "" : "s"}`}
        </span>
      </div>

      {patterns.length === 0 ? (
        <p className="bpt-none">
          No clear cross-session pattern yet — nothing has moved past what normal variation
          explains.
        </p>
      ) : (
        <div className="bpt-cards">
          {patterns.map((p) => (
            <PatternCard key={`${p.id}:${p.game ?? "all"}`} p={p} expert={expert} />
          ))}
        </div>
      )}

      {/* §0.12 — detectors that stayed silent say exactly why (missing data), never vanish.
          Kept in the Expert view: the everyday face shows the findings, the inspector sees the gaps. */}
      {expert && coverage.length > 0 && (
        <div className="bpt-coverage">
          <span className="bpt-coverage-label">What Compy couldn't judge yet</span>
          <ul>
            {coverage.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default PatternsTile;
