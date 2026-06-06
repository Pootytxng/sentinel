import { useEffect, useState } from "react";
import type { AppliedChange, GameReadiness, Priorities, PriorityItem, SessionSummary } from "../types";
import { AmbientBackdrop } from "../design/AmbientBackdrop";
import { Wordmark } from "../design/Wordmark";
import { NavGlyph } from "../design/NavGlyph";
import { HOME_RAIL, type HomeRailId } from "../design/homeRail";
import {
  type InstrumentTheme,
  INSTRUMENT_THEMES,
  readInstrumentTheme,
  applyInstrumentTheme,
  readAmbiance,
  persistAmbiance,
  AMBIANCE_OPTIONS,
  type Ambiance,
} from "../design/theme";
import { activeChangeCount } from "./dashboard-data";
import { signalRing, postureLine, liveStrip } from "./command-center-data";
import { TrustSwitch, TrustSnapshotLine } from "../design/TrustSwitch";
import "./CommandCenter.css";

// ─── Structural prop subsets ────────────────────────────────────────────────
// HardwareInfo / Recommendation live (inline) in App.tsx; we accept the exact fields the surface
// reads. Object covariance makes passing the fuller App objects type-safe without re-exporting them.
type HwSnapshot = {
  cpu_brand: string;
  cpu_cores_logical: number;
  ram_total_bytes: number;
  os_name: string;
  os_version: string;
  gpus: { name: string }[];
  cpu_arch: { family_label: string } | null;
  windows_version: { product_name: string } | null;
};
type Rec = {
  id: string;
  currently_applied: boolean;
  provenance: "verified" | "measured-signal" | "expected-impact";
};

type Props = {
  hw: HwSnapshot;
  readiness: GameReadiness | null;
  priorities: Priorities | null;
  sessions: SessionSummary[];
  changes: AppliedChange[];
  // #1 limiter — App resolves the linked rec + audited toggle so the surface stays decoupled from
  // recommendation internals and the apply/rollback flow is the SAME one the rest of the app uses.
  limiterRec: Rec | undefined;
  limiterAppliable: boolean;
  limiterActiveChange: AppliedChange | null;
  busyLimiter: boolean;
  onToggleLimiter: () => void;
  onSeeInFix: () => void;
  // Navigation into the classic (not-yet-reskinned) surfaces + the preview toggle.
  onNavigate: (tab: "Readiness" | "Monitoring" | "Optimize" | "Check" | "Play" | "Lab" | "Learn") => void;
  onRunCheck: () => void;
  onOpenSettings?: () => void;
};

const fmtGB = (b: number) => (b > 0 ? `${(b / 1024 ** 3).toFixed(0)} GB` : "—");

function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 18) return "Good afternoon";
  return "Good evening";
}

// prefers-reduced-motion → static end-state everywhere (spec §5).
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    } catch {
      return;
    }
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

// 0→1 ease-out on mount; drives the ring fill + count-ups. Static (1) immediately when reduced.
function useMountProgress(durationMs: number, reduced: boolean): number {
  const [p, setP] = useState(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) {
      setP(1);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const e = Math.min(1, (t - start) / durationMs);
      setP(1 - Math.pow(1 - e, 3)); // ease-out cubic
      if (e < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [durationMs, reduced]);
  return p;
}

// ─── Inline brand + nav glyphs (no icon font — offline, zero-outbound) ───────
// ─── Signal ring ─────────────────────────────────────────────────────────────
// Encodes the REAL readiness ratio (ideal/total). Big text is an honest word ("Dialed"/"Ready"),
// never an invented score. Fills 0→ratio on mount.
function SignalRingGauge({ readiness, progress }: { readiness: GameReadiness | null; progress: number }) {
  const ring = signalRing(readiness);
  const R = 52;
  const C = 2 * Math.PI * R;
  const dash = C * ring.ratio * progress;

  if (!ring.known) {
    return (
      <div className="cc-ring" title="Scanning…">
        <div className="cc-ring-shimmer" aria-hidden="true" />
        <div className="cc-ring-center">
          <div className="cc-ring-label cc-shimmer-text">Scanning</div>
          <div className="cc-ring-sub">running checks…</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`cc-ring cc-ring-${ring.dialed ? "dialed" : "ready"}`}
      title={`${ring.ideal}/${ring.total} readiness checks ideal`}
    >
      <svg className="cc-ring-svg" viewBox="0 0 120 120" aria-hidden="true">
        <circle className="cc-ring-track" cx="60" cy="60" r={R} />
        <circle
          className="cc-ring-fill"
          cx="60"
          cy="60"
          r={R}
          strokeDasharray={`${dash} ${C}`}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="cc-ring-center">
        <div className="cc-ring-label">{ring.label}</div>
        <div className="cc-ring-sub">{ring.sub}</div>
      </div>
    </div>
  );
}

const EVIDENCE: Record<Rec["provenance"], { label: string; cls: string }> = {
  verified: { label: "Verified", cls: "verified" },
  "measured-signal": { label: "Measured", cls: "measured" },
  "expected-impact": { label: "Expected", cls: "expected" },
};

// ─── #1 limiter card — the one thing worth doing, through the audited apply flow ─
function LimiterCard({
  priorities,
  limiter,
  limiterRec,
  appliable,
  activeChange,
  busy,
  onToggle,
  onSeeInFix,
}: {
  priorities: Priorities | null;
  limiter: PriorityItem | null;
  limiterRec: Rec | undefined;
  appliable: boolean;
  activeChange: AppliedChange | null;
  busy: boolean;
  onToggle: () => void;
  onSeeInFix: () => void;
}) {
  // Data not resolved yet → shimmer, never a placeholder spec.
  if (priorities == null) {
    return (
      <section className="cc-panel cc-limiter">
        <div className="cc-panel-eyebrow">Your #1 limiter</div>
        <div className="cc-skel cc-skel-title" />
        <div className="cc-skel cc-skel-line" />
        <div className="cc-skel cc-skel-line cc-skel-short" />
      </section>
    );
  }

  // Nothing worth fixing → the honest win state.
  if (!limiter) {
    return (
      <section className="cc-panel cc-limiter cc-limiter-clear">
        <div className="cc-panel-eyebrow">Your #1 limiter</div>
        <h3 className="cc-limiter-title">Nothing worth fixing today</h3>
        <p className="cc-limiter-reason">
          No limiter stands out on this rig right now. A lesser tool would invent one — Compy won't.
        </p>
      </section>
    );
  }

  const evidence = limiterRec ? EVIDENCE[limiterRec.provenance] : null;
  const confidenceChip = `${limiter.confidence[0].toUpperCase()}${limiter.confidence.slice(1)} confidence`;
  const applied = !!limiterRec?.currently_applied;
  const canToggle = appliable && !!limiterRec;

  return (
    <section className="cc-panel cc-limiter">
      <div className="cc-limiter-head">
        <div className="cc-panel-eyebrow">Your #1 limiter</div>
        <span className={`cc-evidence cc-evidence-${evidence?.cls ?? "expected"}`}>
          {evidence?.label ?? confidenceChip}
        </span>
      </div>
      <h3 className="cc-limiter-title">{limiter.title}</h3>
      <p className="cc-limiter-reason">{limiter.reason}</p>

      {canToggle ? (
        <>
          <div className="cc-trust">
            <TrustSwitch
              applied={applied}
              busy={busy}
              onToggle={onToggle}
              ariaLabel={`${applied ? "Roll back" : "Apply"} ${limiter.title}`}
              label={applied ? "Applied — toggle to roll back" : "Apply this fix"}
            />
          </div>
          {applied && activeChange && (
            <TrustSnapshotLine restoresLabel={activeChange.restores_label} />
          )}
        </>
      ) : (
        <button type="button" className="cc-seefix" onClick={onSeeInFix}>
          See how to fix this →
        </button>
      )}
    </section>
  );
}

// Count a real integer up to its target as the surface settles. Pure presentation of a real value.
const countUp = (target: number, progress: number) => Math.round(target * progress);

function LiveStrip({ sessions, progress }: { sessions: SessionSummary[]; progress: number }) {
  const strip = liveStrip(sessions);
  if (strip.kind === "empty") {
    return (
      <section className="cc-panel cc-live cc-live-empty">
        <div className="cc-panel-eyebrow">Last session</div>
        <p className="cc-live-emptytext">
          Play a session to see this — Compy captures it from outside the game.
        </p>
      </section>
    );
  }
  return (
    <section className="cc-panel cc-live">
      <div className="cc-live-head">
        <div className="cc-panel-eyebrow">Last session</div>
        <span className="cc-live-game">{strip.game}</span>
      </div>
      <div className="cc-live-metrics">
        <LiveMetric value={`${countUp(strip.avgFps, progress)}`} label="Avg FPS" />
        <LiveMetric value={`${countUp(strip.low1Est, progress)}`} label="1% low" note="est" />
        <LiveMetric
          value={strip.peakTempC == null ? "—" : `${countUp(strip.peakTempC, progress)}°`}
          label="Peak temp"
        />
      </div>
    </section>
  );
}

function LiveMetric({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="cc-metric">
      <div className="cc-metric-value">{value}</div>
      <div className="cc-metric-label">
        {label}
        {note && <span className="cc-metric-note"> · {note}</span>}
      </div>
    </div>
  );
}

export default function CommandCenter(props: Props) {
  const {
    hw,
    readiness,
    priorities,
    sessions,
    changes,
    limiterRec,
    limiterAppliable,
    limiterActiveChange,
    busyLimiter,
    onToggleLimiter,
    onSeeInFix,
    onNavigate,
    onRunCheck,
    onOpenSettings,
  } = props;

  const reduced = useReducedMotion();
  const progress = useMountProgress(900, reduced);

  // Instrument theme + ambiance. The theme is now app-wide (set at startup in main.tsx + here on
  // change) and persists across every surface — no unmount-removal (the classic ThemePicker is
  // retired; Instrument's Velocity/Nova/Ember is the one theme system).
  const [itheme, setITheme] = useState<InstrumentTheme>(readInstrumentTheme);
  const [ambiance, setAmbiance] = useState<Ambiance>(readAmbiance);
  useEffect(() => {
    applyInstrumentTheme(itheme);
  }, [itheme]);

  const changeTheme = (t: InstrumentTheme) => setITheme(t);
  const changeAmbiance = (a: Ambiance) => {
    setAmbiance(a);
    persistAmbiance(a);
  };

  const posture = postureLine(readiness, priorities, activeChangeCount(changes));
  const limiter = priorities?.limiters[0] ?? null;
  const gpu = hw.gpus[0]?.name ?? "No GPU detected";
  const cpu = hw.cpu_arch?.family_label || hw.cpu_brand || "CPU";
  const os = hw.windows_version?.product_name || `${hw.os_name} ${hw.os_version}`.trim();

  // Rail items derive from the SHARED HOME_RAIL definition (one-rail §1) — identical to the app-shell
  // rail by construction. Only the per-id click target + the active flag are CommandCenter-specific.
  const NAV_ONCLICK: Record<HomeRailId, () => void> = {
    home: () => {},
    check: () => onNavigate("Check"),
    play: () => onNavigate("Play"),
    fix: () => onNavigate("Optimize"),
    learn: () => onNavigate("Learn"), // Learn is a rail room now (one-rail §1b)
    lab: () => onNavigate("Lab"),
  };
  const NAV = HOME_RAIL.map((it) => ({
    ...it,
    onClick: NAV_ONCLICK[it.id],
    active: it.id === "home",
  }));

  return (
    <div className="cc-root">
      {/* Ambient hyperspeed — behind everything, step-aside guard active (freezes on game capture,
          reduced-motion, hidden document). Recolors with the instrument theme via streak tokens. */}
      <AmbientBackdrop ambiance={ambiance} themeKey={itheme} />

      <div className="cc-shell">
        {/* Glass nav rail */}
        <nav className="cc-rail" aria-label="Sections">
          <div className="cc-brand">
            <Wordmark size={22} />
          </div>
          <div className="cc-rail-items" role="tablist">
            {NAV.map((n) => (
              <button
                key={n.id}
                role="tab"
                aria-selected={!!n.active}
                className={`cc-rail-item ${n.active ? "cc-rail-item-on" : ""}`}
                onClick={n.onClick}
                title={n.label}
              >
                <NavGlyph name={n.icon} />
                <span>{n.label}</span>
              </button>
            ))}
          </div>
          {onOpenSettings && (
            <button className="cc-rail-item" onClick={onOpenSettings} title="Settings">
              <NavGlyph name="gear" />
              <span>Settings</span>
            </button>
          )}
          <div className={`cc-rig cc-rig-${posture.tone}`} title={gpu}>
            <span className="cc-rig-dot" aria-hidden="true" />
            <span className="cc-rig-gpu">{gpu}</span>
          </div>
        </nav>

        {/* Main area */}
        <div className="cc-main">
          <header className="cc-header">
            <div>
              <h1 className="cc-greeting">{greeting()}</h1>
              <p className="cc-rigline">
                {cpu} · {hw.cpu_cores_logical} threads · {fmtGB(hw.ram_total_bytes)} · {os}
              </p>
            </div>
            <button className="cc-recheck" onClick={onRunCheck}>
              Re-run check
            </button>
          </header>

          {/* Posture hero */}
          <section className={`cc-panel cc-hero cc-hero-${posture.tone}`}>
            <SignalRingGauge readiness={readiness} progress={progress} />
            <div className="cc-hero-text">
              <div className="cc-panel-eyebrow">System posture</div>
              <h2 className="cc-hero-headline">{posture.headline}</h2>
              <p className="cc-hero-sentence">{posture.sentence}</p>
              {posture.reassurance && <p className="cc-hero-reassure">{posture.reassurance}</p>}
            </div>
          </section>

          <LimiterCard
            priorities={priorities}
            limiter={limiter}
            limiterRec={limiterRec}
            appliable={limiterAppliable}
            activeChange={limiterActiveChange}
            busy={busyLimiter}
            onToggle={onToggleLimiter}
            onSeeInFix={onSeeInFix}
          />

          <LiveStrip sessions={sessions} progress={progress} />

          {/* Surface controls — theme + ambiance. The "Classic home" escape hatch is retired
              (one-rail §1b): classics are reached via Settings → New look only. */}
          <div className="cc-controls">
            <div className="cc-seg" role="group" aria-label="Theme">
              {INSTRUMENT_THEMES.map((t) => (
                <button
                  key={t.id}
                  className={`cc-seg-btn ${itheme === t.id ? "cc-seg-on" : ""}`}
                  aria-pressed={itheme === t.id}
                  onClick={() => changeTheme(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="cc-seg" role="group" aria-label="Ambient backdrop">
              {AMBIANCE_OPTIONS.map((a) => (
                <button
                  key={a.id}
                  className={`cc-seg-btn ${ambiance === a.id ? "cc-seg-on" : ""}`}
                  aria-pressed={ambiance === a.id}
                  onClick={() => changeAmbiance(a.id)}
                  title={`Ambient backdrop: ${a.label}`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
