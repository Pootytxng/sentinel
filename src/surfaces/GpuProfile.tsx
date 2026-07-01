import { useState, useCallback } from "react";
import { GPU_SCOPES, gpuScopeMeta } from "../data/profile-store";
import { useGpuProfileScope } from "../hooks/use-gpu-profile-scope";
import {
  type GpuProfileSnapshot,
  type FieldDelta,
  readGpuProfiles,
  writeGpuProfileSlot,
  clearGpuProfiles,
  computeGpuProfileDelta,
  hasAnyChange,
  deltaSummary,
} from "../data/gpu-profile-store";

// GPU profile surface — two READ-ONLY, advisory, LOCAL-only tools that change NOTHING on the PC:
//   1. Scope picker (measurement, UI-only): frame the GPU view "Global" (whole-PC) or "Per-game".
//      Just chooses which slice of already-measured data you look at. Reversible — pick the other one.
//   2. Before/after delta: capture the readable GPU state (vendor/model/driver/HAGS/power-mode/peak
//      temp) before and after a change YOU make in the vendor tool, then see a plain-English
//      field-by-field diff. No mutation, no apply — this is the read-only half, NOT the gated Phase-B
//      apply/rollback. The live snapshot is supplied by the parent (the component owns no IO).
// Styled with theme tokens only (no new stylesheet); accent fills use --ix-accent-ink for legible
// on-accent text.

const panelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  border: "1px solid var(--ix-border)",
  borderRadius: "var(--ix-radius, 8px)",
  background: "var(--ix-surface-2, rgba(255,255,255,0.03))",
  padding: "14px 16px",
};

const headingStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--ix-text)" };

function GpuProfileScopePicker() {
  const { scope, setScope } = useGpuProfileScope();
  const active = gpuScopeMeta(scope);

  return (
    <section aria-label="GPU profile scope" style={panelStyle}>
      <div style={headingStyle}>GPU profile view</div>

      <div
        role="radiogroup"
        aria-label="GPU profile scope"
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
      >
        {GPU_SCOPES.map((s) => {
          const meta = gpuScopeMeta(s);
          const selected = s === scope;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setScope(s)}
              style={{
                cursor: "pointer",
                borderRadius: 999,
                padding: "6px 14px",
                fontSize: 12.5,
                fontWeight: 600,
                border: selected ? "1px solid var(--ix-accent)" : "1px solid var(--ix-border)",
                background: selected ? "var(--ix-accent)" : "transparent",
                color: selected ? "var(--ix-accent-ink)" : "var(--ix-text-2)",
              }}
            >
              {meta.label}
            </button>
          );
        })}
      </div>

      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--ix-text-2)" }}>
        {active.blurb}
      </p>

      <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.4, color: "var(--ix-text-3, var(--ix-text-2))" }}>
        This just frames what you look at — it changes nothing on your PC.
      </p>
    </section>
  );
}

const dirGlyph: Record<FieldDelta["direction"], string> = { down: "↓", up: "↑", flat: "→", none: "" };

const btnStyle = (quiet = false): React.CSSProperties => ({
  cursor: "pointer",
  borderRadius: 999,
  padding: "6px 14px",
  fontSize: 12.5,
  fontWeight: 600,
  border: "1px solid var(--ix-border)",
  background: "transparent",
  color: quiet ? "var(--ix-text-3, var(--ix-text-2))" : "var(--ix-text-2)",
});

function DeltaRow({ d }: { d: FieldDelta }) {
  // Temp down = cooler = the good direction; up = warmer. Text/boolean changes are neutral (a driver
  // bump or a mode switch isn't "good" or "bad" on its own — we don't editorialise).
  const changed = d.status === "changed";
  const color =
    changed && d.key === "peakTempC" && d.direction === "down"
      ? "var(--ix-good, var(--ix-text))"
      : changed && d.key === "peakTempC" && d.direction === "up"
        ? "var(--ix-warn, var(--ix-text))"
        : changed
          ? "var(--ix-text)"
          : "var(--ix-text-2)";
  const cell: React.CSSProperties = { padding: "5px 8px", fontSize: 12.5, color };
  return (
    <tr>
      <th scope="row" style={{ ...cell, textAlign: "left", fontWeight: 500 }}>
        {d.label}
      </th>
      <td style={cell}>{d.beforeText}</td>
      <td style={cell}>
        {d.afterText}
        {d.key === "peakTempC" && d.direction !== "none" && d.numericDelta !== 0 ? (
          <span aria-hidden="true"> {dirGlyph[d.direction]}</span>
        ) : null}
      </td>
      <td style={{ ...cell, fontWeight: changed ? 600 : 400 }}>
        {changed ? "Changed" : d.status === "same" ? "No change" : "—"}
      </td>
    </tr>
  );
}

function GpuProfileDelta({ currentSnapshot }: { currentSnapshot?: GpuProfileSnapshot | null }) {
  const [pair, setPair] = useState(() => readGpuProfiles());

  const capture = useCallback(
    (slot: "before" | "after") => {
      if (!currentSnapshot) return; // nothing readable right now — do nothing (never fabricate)
      writeGpuProfileSlot(slot, currentSnapshot);
      setPair(readGpuProfiles());
    },
    [currentSnapshot],
  );

  const reset = useCallback(() => {
    clearGpuProfiles();
    setPair(readGpuProfiles());
  }, []);

  const deltas = computeGpuProfileDelta(pair.before, pair.after);
  const bothCaptured = pair.before != null && pair.after != null;
  const changed = hasAnyChange(deltas);
  const muted: React.CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--ix-text-2)" };

  return (
    <section aria-labelledby="gpu-profile-delta-title" style={panelStyle}>
      <div id="gpu-profile-delta-title" style={headingStyle}>
        Before &amp; after
      </div>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: "var(--ix-text-3, var(--ix-text-2))" }}>
        Capture your GPU&apos;s readable settings before and after a change you make in your driver
        tool, then see exactly what moved. Read-only — Compy changes nothing here.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" style={btnStyle()} onClick={() => capture("before")} disabled={!currentSnapshot}>
          {pair.before ? "Re-capture before" : "Capture before"}
        </button>
        <button type="button" style={btnStyle()} onClick={() => capture("after")} disabled={!currentSnapshot}>
          {pair.after ? "Re-capture after" : "Capture after"}
        </button>
        {(pair.before || pair.after) && (
          <button type="button" style={btnStyle(true)} onClick={reset}>
            Clear
          </button>
        )}
      </div>

      {!currentSnapshot && !pair.before && !pair.after ? (
        <p style={muted}>
          No GPU reading is available yet — once your GPU details load you can capture a snapshot.
        </p>
      ) : !bothCaptured ? (
        <p style={muted}>
          {pair.before
            ? "Before snapshot saved. Make your change, then capture after."
            : "Capture a before snapshot to begin."}
        </p>
      ) : (
        <>
          <p style={{ ...muted, fontWeight: changed ? 600 : 400, color: "var(--ix-text)" }}>
            {deltaSummary(deltas)}
          </p>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ color: "var(--ix-text-3, var(--ix-text-2))", fontSize: 11.5 }}>
                <th scope="col" style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>
                  Setting
                </th>
                <th scope="col" style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>
                  Before
                </th>
                <th scope="col" style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>
                  After
                </th>
                <th scope="col" style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>
                  Delta
                </th>
              </tr>
            </thead>
            <tbody>
              {deltas.map((d) => (
                <DeltaRow key={d.key} d={d} />
              ))}
            </tbody>
          </table>
          <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.4, color: "var(--ix-text-3, var(--ix-text-2))" }}>
            Snapshots are stored only on this PC. A dash means that value wasn&apos;t readable in one
            of the snapshots, so it isn&apos;t counted as a change.
          </p>
        </>
      )}
    </section>
  );
}

/**
 * The GPU profile surface: the scope picker (which slice you look at) plus the read-only before/after
 * delta (what moved when you changed something in your driver tool). Both are local, advisory, and
 * change nothing on the PC. `currentSnapshot` is the parent-supplied live GPU read for the delta card.
 */
export function GpuProfile({ currentSnapshot }: { currentSnapshot?: GpuProfileSnapshot | null }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <GpuProfileScopePicker />
      <GpuProfileDelta currentSnapshot={currentSnapshot} />
    </div>
  );
}
