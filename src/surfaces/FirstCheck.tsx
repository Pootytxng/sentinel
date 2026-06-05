import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GameReadiness, ReadinessCheck, Priorities, PriorityItem } from "../types";
import "./FirstCheck.css";

// Moment 2 of the first-experience arc — the first-run "first check" landing.
// Spec: docs/superpowers/specs/2026-06-04-first-experience-arc-design.md (copy VERBATIM).
// Shown once after onboarding (gated on FIRST_CHECK_KEY); later launches go straight to the app
// with a "Re-run check" affordance. Re-runs the real readiness/priorities (honest elapsed) and
// streams the rows for legibility — display stagger only, never a fake sleep (design law #2).

export const FIRST_CHECK_KEY = "compy_first_check_v1";

type RecLite = { id: string; title: string; currently_applied: boolean };

const STAGGER_MS = 280; // legibility only (spec: ≤~350ms/row, never sleep for drama)

function rowVerdict(s: ReadinessCheck["status"]): "ok" | "fix" | "unknown" {
  if (s === "attention") return "fix";
  if (s === "ready" || s === "advisory") return "ok";
  return "unknown";
}

export default function FirstCheck({ onDone }: { onDone: () => void }) {
  const [readiness, setReadiness] = useState<GameReadiness | null>(null);
  const [priorities, setPriorities] = useState<Priorities | null>(null);
  const [recs, setRecs] = useState<RecLite[]>([]);
  const [running, setRunning] = useState(true);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [shownRows, setShownRows] = useState(0);
  const [phase, setPhase] = useState<"scan" | "verdict">("scan");
  const [greenOpen, setGreenOpen] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRunning(true);
    setPhase("scan");
    setShownRows(0);
    const t0 = performance.now();
    try {
      const [r, p, rc] = await Promise.all([
        invoke<GameReadiness>("get_game_readiness"),
        invoke<Priorities>("get_priorities"),
        invoke<RecLite[]>("get_recommendations"),
      ]);
      setReadiness(r);
      setPriorities(p);
      setRecs(rc);
    } catch {
      /* leave nulls — render guards below */
    } finally {
      setElapsed((performance.now() - t0) / 1000);
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Stream the check rows in (legibility), then flip to the verdict.
  useEffect(() => {
    if (running || !readiness) return;
    const n = readiness.checks.length;
    const timers: number[] = [];
    for (let i = 0; i < n; i++) {
      timers.push(
        window.setTimeout(() => setShownRows((c) => Math.max(c, i + 1)), i * STAGGER_MS),
      );
    }
    timers.push(window.setTimeout(() => setPhase("verdict"), n * STAGGER_MS + 220));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [running, readiness]);

  const finish = () => {
    try {
      localStorage.setItem(FIRST_CHECK_KEY, "1");
    } catch {
      /* non-fatal */
    }
    onDone();
  };

  const recFor = (lim: PriorityItem | null): RecLite | null => {
    if (!lim) return null;
    const id = lim.linked ?? lim.id;
    const rec = recs.find((r) => r.id === id);
    return rec && !rec.currently_applied ? rec : null;
  };

  const applyLimiter = async (lim: PriorityItem) => {
    const rec = recFor(lim);
    if (!rec) return;
    if (
      !window.confirm(
        `Apply "${rec.title}"?\n\nCompy snapshots the prior state so you can roll this back at any time.`,
      )
    )
      return;
    setApplyingId(rec.id);
    try {
      await invoke("apply_recommendation", { recId: rec.id, recTitle: rec.title });
      await load(); // re-run so the verdict + limiters reflect the change
    } catch {
      /* reload surfaces state */
    } finally {
      setApplyingId(null);
    }
  };

  const checks = readiness?.checks ?? [];
  const limiters = priorities?.limiters ?? [];
  const fixCount = limiters.length;
  const top = limiters[0] ?? null;
  const rest = limiters.slice(1);
  const greenChecks = checks.filter((c) => rowVerdict(c.status) === "ok");

  return (
    <div className="fc-backdrop">
      <div className="fc-screen">
        <header className="fc-head">
          <span className="fc-brand">Compy</span>
          <span className="fc-status">
            {running
              ? "first check · running"
              : `first check · ${checks.length} checks · ${elapsed?.toFixed(1) ?? "—"}s`}
          </span>
        </header>

        {/* Scan rows — stream in as the (real) checks display. */}
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

        {/* Verdict — appears after the rows have streamed. */}
        {phase === "verdict" && (
          <div className="fc-verdict">
            <div className="fc-tag">VERDICT</div>
            <h1 className="fc-headline">
              {fixCount === 0
                ? "Ready to play — nothing worth fixing today"
                : `Ready to play — ${fixCount} thing${fixCount === 1 ? "" : "s"} worth fixing`}
            </h1>
            <p className="fc-subtitle">
              {fixCount === 0
                ? "Everything on this rig is already where it should be."
                : "Both reversible. Everything else on this rig is already where it should be."}
            </p>

            {/* #1 biggest limiter spotlight */}
            {top && (
              <div className="fc-spotlight">
                <div className="fc-spotlight-tag">#1 BIGGEST LIMITER</div>
                <div className="fc-spotlight-title">{top.title}</div>
                <p className="fc-spotlight-reason">{top.reason}</p>
                <div className="fc-spotlight-foot">
                  <span className="fc-chip">Expected impact · not yet measured on this rig</span>
                  {recFor(top) ? (
                    <button
                      className="fc-btn fc-btn-primary"
                      disabled={applyingId !== null}
                      onClick={() => applyLimiter(top)}
                    >
                      {applyingId === recFor(top)?.id ? "Applying…" : "Apply"}
                    </button>
                  ) : (
                    <span className="fc-chip fc-chip-muted">advisory — no one-click change</span>
                  )}
                </div>
              </div>
            )}

            {/* #2…N compact */}
            {rest.length > 0 && (
              <div className="fc-rest">
                {rest.map((lim) => (
                  <div key={lim.id} className="fc-rest-row">
                    <span className="fc-rest-title">{lim.title}</span>
                    <span className="fc-rest-conf">{lim.confidence} confidence</span>
                  </div>
                ))}
              </div>
            )}

            {/* Green strip — collapsed, expandable */}
            {greenChecks.length > 0 && (
              <div className="fc-green">
                <button className="fc-green-head" onClick={() => setGreenOpen((o) => !o)}>
                  <span>{greenChecks.length} checks already perfect — nothing to sell you here</span>
                  <span className="fc-green-caret">{greenOpen ? "▾" : "▸"}</span>
                </button>
                {greenOpen && (
                  <div className="fc-green-list">
                    {greenChecks.map((c) => (
                      <div key={c.id} className="fc-green-row">
                        <span className="fc-row-mark fc-row-ok">✓</span>
                        <span>{c.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <p className="fc-footer">
              Nothing else on this PC is worth touching — and Compy won't invent work to look busy.
              Play something tonight; the <strong>session debrief</strong> will tell you how it
              actually went.
            </p>

            <div className="fc-actions">
              <button className="fc-btn fc-btn-go" onClick={finish}>
                Open the dashboard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
