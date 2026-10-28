import { ConfidenceWord } from "../../design/ConfidenceWord";
import { withTerms } from "../../design/with-terms";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import type { PatternReport, SessionPattern } from "../../types";
import { useIntelligenceFlag } from "../../design/use-hud";
import { useExpertView } from "../../design/use-expert-view";
import { prettyGameName } from "../game-name";
import { BentoTile } from "../../design/bento/BentoGrid";
import "../../i18n";
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
  const { t } = useTranslation();
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
          <span className="bpt-card-title">{withTerms(p.title)}</span>
          {p.game && <span className="bpt-card-game">{prettyGameName(p.game) || p.game}</span>}
        </div>
        <span className="bpt-card-conf">
          <ConfidenceWord band={p.confidence} />
        </span>
      </div>
      {/* Self-review r2 2026-10-28 (P7-jargon): engine sentences carry "1% low" / "noise floor". */}
      <p className="bpt-card-detail">{withTerms(p.detail)}</p>
      {hasWorking && (
        <button
          type="button"
          className="bpt-card-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span>
            {open
              ? t("blackbook.patternsTile.hideTheWorking")
              : t("blackbook.patternsTile.whyWeThinkSo")}
          </span>
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
              <span className="bpt-evi-label">{t("blackbook.patternsTile.evidenceLabel")}</span>
              <ul>
                {p.supporting_evidence.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {p.raises_confidence.length > 0 && (
            <div className="bpt-evi bpt-evi-raise">
              <span className="bpt-evi-label">{t("blackbook.patternsTile.raisesConfidenceLabel")}</span>
              <ul>
                {p.raises_confidence.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {expert && p.next_test && (
            <p className="bpt-next">
              <span className="bpt-evi-label">{t("blackbook.patternsTile.nextTestLabel")}</span>{" "}
              {p.next_test}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function PatternsTile() {
  const { t } = useTranslation();
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
    // span="full" is not a taste call: this tile renders null in three states (flag off, fetch
    // failed, brand-new user), and only a full-width tile can vanish without leaving a hole in a
    // strict row-major grid. Its old section head is now the tile's own title + badge.
    <BentoTile
      span="full"
      title={t("blackbook.patternsTile.sectionTitle")}
      badge={
        <span className="bpt-sect-s">
          {t("blackbook.patternsTile.fromSessions", { count: sessions_considered })}
          {games_considered > 0 &&
            t("blackbook.patternsTile.andGames", { count: games_considered })}
        </span>
      }
    >
      {patterns.length === 0 ? (
        <p className="bpt-none">{t("blackbook.patternsTile.none")}</p>
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
          <span className="bpt-coverage-label">{t("blackbook.patternsTile.coverageLabel")}</span>
          <ul>
            {coverage.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </BentoTile>
  );
}

export default PatternsTile;
