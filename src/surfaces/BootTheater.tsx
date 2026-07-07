import { useEffect, useRef, useState } from "react";
import type { GameReadiness } from "../types";
import { rowVerdict } from "./use-scan";
import "./BootTheater.css";

// BootTheater (T2+T4a, spec 2026-07-06-firstcheck-monitor-mvp-train) — the FirstCheck RUN state
// in the stepper/HUD idiom: a bracket-framed terminal readout where the active check is prominent
// (scramble reveal), completed checks compress into a mono stack, pending checks stay queued, and
// a mono progress rail counts the run. FirstCheck-only (Check keeps ScanStream); classic failsafe
// via the compy_firstcheck_theater flag. Honest by construction: rows are the REAL checks after
// the real commands returned; the reveal is presentation pacing (≤~3.5s for 16 checks) and a
// click skips straight to the verdict. Nothing here ever claims measurement is still running.

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&";
const SCRAMBLE_TICK_MS = 22;

// Per-change scramble reveal for the ACTIVE check label — local on purpose (the vendored
// DecryptedText's decode-once registry deliberately suppresses re-scramble per text, which is
// right for room headlines but wrong for a boot readout that re-runs). Reduced motion → the
// plain label, no churn.
function useScramble(text: string, reduced: boolean): string {
  const [display, setDisplay] = useState(text);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (timer.current) window.clearInterval(timer.current);
    if (reduced || !text) {
      setDisplay(text);
      return;
    }
    let revealed = 0;
    // Reveal ~2 chars per tick so long labels still resolve inside ~300ms.
    const step = Math.max(2, Math.ceil(text.length / 12));
    const tick = () => {
      revealed = Math.min(text.length, revealed + step);
      const head = text.slice(0, revealed);
      const tail = text
        .slice(revealed)
        .split("")
        .map((c) => (c === " " ? " " : SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]))
        .join("");
      setDisplay(head + tail);
      if (revealed >= text.length && timer.current) {
        window.clearInterval(timer.current);
        timer.current = null;
      }
    };
    tick();
    timer.current = window.setInterval(tick, SCRAMBLE_TICK_MS);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
      timer.current = null;
    };
  }, [text, reduced]);
  return display;
}

// HUD corner brackets — four stroked corners that draw on when the theater mounts (T4a
// bracket draw-on, zero deps). Reduced motion → painted static by the CSS gate.
function BracketFrame() {
  return (
    <svg className="fct-brackets" aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 100 100">
      <path className="fct-bracket" d="M 1 9 V 1 H 9" vectorEffect="non-scaling-stroke" pathLength={1} />
      <path className="fct-bracket" d="M 91 1 H 99 V 9" vectorEffect="non-scaling-stroke" pathLength={1} />
      <path className="fct-bracket" d="M 99 91 V 99 H 91" vectorEffect="non-scaling-stroke" pathLength={1} />
      <path className="fct-bracket" d="M 9 99 H 1 V 91" vectorEffect="non-scaling-stroke" pathLength={1} />
    </svg>
  );
}

export function BootTheater({
  readiness,
  shownRows,
  running,
  reduced,
  onSkip,
}: {
  readiness: GameReadiness | null;
  shownRows: number;
  running: boolean;
  reduced: boolean;
  onSkip: () => void;
}) {
  const checks = readiness?.checks ?? [];
  const n = checks.length;
  // Row `shownRows` is the one revealing NOW: everything before it has settled into the stack,
  // everything after is queued. While the commands are still in flight there are no rows yet.
  const activeIdx = !running && n > 0 ? Math.min(shownRows, n - 1) : -1;
  const done = checks.slice(0, Math.min(shownRows, n));
  const queued = Math.max(0, n - shownRows - 1);
  const active = activeIdx >= 0 && shownRows < n ? checks[activeIdx] : null;
  const activeLabel = useScramble(active?.label ?? "", reduced);

  return (
    <button type="button" className="fct-frame" aria-label="Skip to the verdict" onClick={onSkip}>
      <BracketFrame />

      {/* Progress rail — mono micro-labels, honest counter, LED only while something is live. */}
      <div className="fct-rail">
        <span className="fct-rail-label">SYSTEM CHECK</span>
        <span className={`fct-led ${running || active ? "fct-led-scan" : ""}`} aria-hidden="true" />
        <span className="fct-rail-count">
          {running ? "· · ·" : `${String(Math.min(shownRows, n)).padStart(2, "0")}/${String(n).padStart(2, "0")}`}
        </span>
      </div>
      <div className="fct-track" aria-hidden="true">
        <div
          className="fct-track-fill"
          style={{ transform: `scaleX(${n > 0 ? Math.min(shownRows, n) / n : 0})` }}
        />
      </div>

      {/* The commands are genuinely in flight — say that, and nothing more. */}
      {running && <p className="fct-measuring">measuring — real reads on this rig, no guesses</p>}

      {/* Completed checks compress into the terminal stack. */}
      {done.length > 0 && (
        <div className="fct-stack">
          {done.map((c) => {
            const v = rowVerdict(c.status);
            return (
              <div key={c.id} className={`fct-row fct-row-${v}`}>
                <span className="fct-mark">{v === "fix" ? "→" : v === "ok" ? "✓" : "·"}</span>
                <span className="fct-label">{c.label}</span>
                <span className="fct-tag">{v === "fix" ? "worth fixing" : v === "unknown" ? "—" : ""}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Active check — the prominent readout line, scrambling in. */}
      {active && (
        <div className="fct-active">
          <span className="fct-caret" aria-hidden="true">
            &gt;
          </span>
          <span className="fct-active-label">{activeLabel}</span>
        </div>
      )}

      {/* Pending checks stay queued — a count, never fabricated detail. */}
      {queued > 0 && (
        <div className="fct-queued">
          {queued} queued{queued > 1 ? " checks" : " check"}
        </div>
      )}

      {!running && n > 0 && <div className="fct-skip-hint">click to skip</div>}
    </button>
  );
}
