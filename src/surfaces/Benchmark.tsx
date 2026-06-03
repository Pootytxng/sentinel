import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, StatusPill, SectionHeader } from "../design";
import { componentLabel, verdictLabel, verdictTone, fmtDelta } from "./benchmark-view";
import type { BenchmarkState, RunReport, Efficacy } from "../types";
import "./Benchmark.css";

const POLL_MS = 700;

// Measured-efficacy loop: run a benchmark → change something → re-measure → an honest
// "did it actually help?" verdict. Absolute scores are rough (placeholder references); the
// real signal is the comparison vs your saved baseline, which is reference-independent.
export function BenchmarkTab() {
  const [state, setState] = useState<BenchmarkState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await invoke<BenchmarkState>("get_benchmark_state"));
    } catch {
      /* leave prior state */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll only while a run is in flight.
  useEffect(() => {
    if (!state?.running) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [state?.running, refresh]);

  const run = async () => {
    setErr(null);
    try {
      await invoke("start_benchmark");
    } catch (e) {
      setErr(String(e));
    }
    refresh();
  };

  const setBaseline = async () => {
    setBusy(true);
    setErr(null);
    try {
      await invoke("set_benchmark_baseline");
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const clearBaseline = async () => {
    setBusy(true);
    try {
      await invoke("clear_benchmark_baseline");
      await refresh();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const running = state?.running ?? false;
  const hasBaseline = !!state?.baseline;
  // Efficacy is meaningful once a run happened AFTER the baseline was set.
  const showEfficacy =
    !!state?.efficacy && hasBaseline && !!state?.latest && state.latest_at !== state.baseline_at;

  return (
    <div className="bench-wrap">
      <header className="bench-head">
        <h2>Benchmark</h2>
        <p className="bench-muted">
          Measure your PC, change something, then re-measure — Sentinel tells you honestly whether it
          actually helped. A change smaller than the run-to-run noise reads as “no measurable change,”
          not a win.
        </p>
      </header>

      <div className="bench-actions">
        <button className="bench-btn bench-btn-primary" onClick={run} disabled={running}>
          {running ? "Measuring… (~10s — leave it alone)" : hasBaseline ? "Re-measure" : "Run benchmark"}
        </button>
        {err && <span className="bench-err">{err}</span>}
      </div>

      {showEfficacy && state?.efficacy && <EfficacyCard efficacy={state.efficacy} />}

      {state?.latest && (
        <RunCard
          report={state.latest}
          at={state.latest_at}
          title={hasBaseline && !showEfficacy ? "Baseline" : "Latest run"}
        />
      )}

      <Card>
        <SectionHeader title="Baseline" />
        {hasBaseline ? (
          <>
            <p className="bench-muted">
              Baseline saved{state?.baseline_at ? ` · ${fmtWhen(state.baseline_at)}` : ""}. Change a
              setting (or apply a tweak in Optimize), then hit <strong>Re-measure</strong> to see the
              effect.
            </p>
            <button className="bench-btn bench-btn-ghost" onClick={clearBaseline} disabled={busy || running}>
              Clear baseline
            </button>
          </>
        ) : (
          <>
            <p className="bench-muted">
              Run a benchmark, then save it as your baseline — the fixed point you compare future changes
              against.
            </p>
            <button
              className="bench-btn"
              onClick={setBaseline}
              disabled={busy || running || !state?.latest}
            >
              Set latest run as baseline
            </button>
          </>
        )}
      </Card>

      <ol className="bench-steps">
        <li>Run a benchmark and set it as your baseline.</li>
        <li>Change one thing (a Windows setting, or apply a tweak in Optimize).</li>
        <li>Re-measure — Sentinel reports the honest per-part verdict vs your baseline.</li>
      </ol>
    </div>
  );
}

function RunCard({ report, at, title }: { report: RunReport; at: string | null; title: string }) {
  return (
    <Card>
      <SectionHeader
        title={title}
        right={
          <StatusPill
            status={report.confidence === "clean" ? "ready" : "attention"}
            label={report.confidence === "clean" ? "Clean run" : "Noisy run"}
          />
        }
      />
      <div className="bench-bars">
        {report.components.map((c) => (
          <div className="bench-bar-row" key={c.component}>
            <span className="bench-bar-label">{componentLabel(c.component)}</span>
            {c.measured ? (
              <>
                <span className="bench-bar-track">
                  <span className="bench-bar-fill" style={{ width: `${Math.min(c.score, 100)}%` }} />
                </span>
                <span className="bench-bar-val">{c.score}</span>
              </>
            ) : (
              <span className="bench-bar-na">not measured</span>
            )}
          </div>
        ))}
      </div>
      <p className="bench-fine">
        Scores are relative (0–100, rough reference) — useful for the comparison, not as an absolute
        grade.{at ? ` · ${fmtWhen(at)}` : ""}
      </p>
      {report.notes.map((n) => (
        <p className="bench-note" key={n}>
          {n}
        </p>
      ))}
    </Card>
  );
}

function EfficacyCard({ efficacy }: { efficacy: Efficacy }) {
  return (
    <Card>
      <SectionHeader
        title="Since your baseline"
        right={<StatusPill status={verdictTone(efficacy.overall)} label={verdictLabel(efficacy.overall)} />}
      />
      <div className="bench-eff">
        {efficacy.per_component.map((c) => (
          <div className="bench-eff-row" key={c.component}>
            <span className="bench-eff-label">{componentLabel(c.component)}</span>
            <span className={`bench-eff-delta is-${verdictTone(c.verdict)}`}>{fmtDelta(c.delta_pct)}</span>
            <StatusPill status={verdictTone(c.verdict)} label={verdictLabel(c.verdict)} />
          </div>
        ))}
      </div>
      <p className="bench-fine">
        Changes within ±{efficacy.noise_floor_pct}% are reported as “no measurable change” — below the
        run-to-run noise floor, so we won’t call them a win or a loss.
      </p>
    </Card>
  );
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}
