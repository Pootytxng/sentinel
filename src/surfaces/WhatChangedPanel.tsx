import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  WhatChangedOutcome,
  IntelHypothesis,
  IntelSessionRef,
} from "../types";
import { useIntelligenceFlag } from "../design/use-hud";
import { useExpertView } from "../design/use-expert-view";

// Intelligence Phase 1 — the "What changed?" panel (Monitor session debrief slot). Renders the
// deterministic Rust engine's verdict for THIS session vs the previous session of the same game:
// meaningful metric deltas, what happened in between, most likely cause with its evidence AND what
// argues against it, and the next test. Additive beside ComparisonCard (which keeps the rec-scoped
// A/B story). Read-only; every sentence comes from persisted records. Flag compy_intelligence
// (default ON) — "0" renders nothing, restoring the prior tree byte-identical.

const fmtWhen = (iso: string, expert: boolean): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso; // unreadable → show the raw stamp, never guess
  return expert
    ? d.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

const sign = (n: number) => (n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1));

// One hypothesis, in §7 language: title + confidence band, Evidence, What argues against it.
function HypothesisBlock({ h, lead }: { h: IntelHypothesis; lead: boolean }) {
  return (
    <div className={`wcp-hypo${lead ? " wcp-hypo-lead" : ""}`}>
      <div className="wcp-hypo-head">
        <span className="wcp-hypo-title">{h.title}</span>
        <span className="wcp-hypo-conf">{h.confidence} confidence</span>
      </div>
      {h.supporting_evidence.length > 0 && (
        <div className="wcp-evi">
          <span className="wcp-evi-label">Evidence</span>
          <ul>
            {h.supporting_evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {h.contradicting_evidence.length > 0 && (
        <div className="wcp-evi">
          <span className="wcp-evi-label">What argues against it</span>
          <ul>
            {h.contradicting_evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {h.missing_evidence.length > 0 && (
        <div className="wcp-evi wcp-evi-missing">
          <span className="wcp-evi-label">Not recorded</span>
          <ul>
            {h.missing_evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SessionLine({
  tag,
  r,
  expert,
}: {
  tag: string;
  r: IntelSessionRef;
  expert: boolean;
}) {
  return (
    <div className="wcp-session">
      <span className="wcp-session-tag">{tag}</span>
      <span>
        {fmtWhen(r.started_at, expert)} · 1% low {r.low1_fps.toFixed(1)} · avg{" "}
        {r.avg_fps.toFixed(1)}
        {expert && ` · ${r.samples} samples · ${Math.round(r.duration_secs / 60)}m`}
        {expert &&
          r.gaming_mode_active != null &&
          ` · Gaming Mode ${r.gaming_mode_active ? "on" : "off"}`}
      </span>
    </div>
  );
}

export function WhatChangedPanel({ startedAt, arcV2 = false }: { startedAt: string; arcV2?: boolean }) {
  const on = useIntelligenceFlag();
  const expert = useExpertView();
  const [outcome, setOutcome] = useState<WhatChangedOutcome | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!on) return;
    let alive = true;
    invoke<WhatChangedOutcome>("what_changed_for_session", { startedAt })
      .then((o) => {
        if (alive) setOutcome(o);
      })
      .catch(() => {}); // fetch failure → no panel; never a fabricated report
    return () => {
      alive = false;
    };
  }, [on, startedAt]);

  if (!on || !outcome) return null;

  if (outcome.kind === "unavailable") {
    // Honest empty state — the engine's reason is already a full plain sentence
    // (e.g. "First recorded Fortnite session — nothing earlier to compare against.").
    return (
      <div className={`wcp wcp-unavailable${arcV2 ? " arc-v2" : ""}`}>
        <span className="wcp-tag">What changed?</span> {outcome.reason}
      </div>
    );
  }

  const r = outcome;
  const leader = r.leading_hypotheses[0] ?? null;
  const others = r.leading_hypotheses.slice(1);
  // The headline already names the leader for the plain-language face; the expanded block
  // below shows its evidence. Confounded reports refuse a single cause — no leader block.
  const showLeader = !r.confounded && leader != null && leader.id !== "insufficient-evidence";

  return (
    <div className={`wcp wcp-${r.verdict}${arcV2 ? " arc-v2" : ""}`}>
      <div className="wcp-head">
        <span>WHAT CHANGED? · vs your previous {r.game} session</span>
        <span className="wcp-nf">noise floor ±{r.noise_floor_pct.toFixed(0)}%</span>
      </div>

      <h3 className="wcp-headline">{r.headline}</h3>

      {r.confounded && r.notes.length > 0 && (
        <p className="wcp-note">{r.notes[0]}</p>
      )}

      {showLeader && (
        <>
          <div className="wcp-section-label">Most likely cause</div>
          <HypothesisBlock h={leader} lead />
        </>
      )}

      {r.next_action && (
        <p className="wcp-next">
          <span className="wcp-section-label">Next test</span> {r.next_action}
        </p>
      )}

      <button
        type="button"
        className="wcp-detail-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>{open ? "Hide the working" : "Show the working"}</span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="wcp-detail">
          <div className="wcp-sessions">
            <SessionLine tag="baseline" r={r.baseline} expert={expert} />
            <SessionLine tag="this one" r={r.current} expert={expert} />
            <div className="wcp-gap">
              {r.gap_days} day{r.gap_days === 1 ? "" : "s"} apart
            </div>
          </div>

          {r.observations.length > 0 && (
            <div className="wcp-obs">
              {r.observations.map((o) => (
                <div className="wcp-obs-row" key={o.metric}>
                  <span className="wcp-obs-metric">{o.metric}</span>
                  <span className="wcp-obs-vals">
                    {o.baseline.toFixed(1)} → {o.current.toFixed(1)} ({sign(o.delta_pct)}%)
                  </span>
                  <span className="wcp-obs-tag">
                    {o.reference_only
                      ? "reference only"
                      : o.meaningful
                        ? "past the noise floor"
                        : "inside the noise floor"}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="wcp-between">
            <span className="wcp-section-label">Between these sessions</span>
            {r.events_between.length === 0 ? (
              <p className="wcp-between-none">Nothing Compy recorded changed in between.</p>
            ) : (
              <ul>
                {r.events_between.map((ev) => (
                  <li key={ev.id}>
                    {ev.summary}
                    <span className="wcp-between-when">
                      {" "}
                      · {ev.observed_between ? "observed by " : ""}
                      {fmtWhen(ev.timestamp, expert)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {others.length > 0 && (
            <div className="wcp-others">
              <span className="wcp-section-label">Also possible</span>
              {others.map((h) => (
                <HypothesisBlock h={h} key={h.id} lead={false} />
              ))}
            </div>
          )}

          {r.unknowns.length > 0 && (
            <div className="wcp-unknowns">
              <span className="wcp-section-label">What Compy can't know here</span>
              <ul>
                {r.unknowns.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            </div>
          )}

          {expert && r.ruled_out.length > 0 && (
            <div className="wcp-ruled-out">
              <span className="wcp-section-label">Ruled out</span>
              {r.ruled_out.map((h) => (
                <HypothesisBlock h={h} key={h.id} lead={false} />
              ))}
            </div>
          )}

          {expert && <p className="wcp-method">{r.method_note}</p>}
        </div>
      )}
    </div>
  );
}
