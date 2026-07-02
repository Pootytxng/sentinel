import { useEffect, useRef, useState, type ReactNode } from "react";
import { Term } from "../design/Term";
import type { AppliedChange, GameReadiness, Priorities, PriorityItem, SessionSummary } from "../types";
import type { HardwareInfo } from "../App";
import { AmbientBackdrop } from "../design/AmbientBackdrop";
import { Wordmark } from "../design/Wordmark";
import { BackButton, ForwardButton } from "../design/BackButton";
import { NavGlyph } from "../design/NavGlyph";
import { railFor, type HomeRailId } from "../design/homeRail";
import { useReducedMotion } from "../design/use-motion";
import { PROVENANCE_LABEL } from "../data/provenance";
import { readOptimizeMerged } from "../data/nav-flags";
import {
  type InstrumentTheme,
  readInstrumentTheme,
  applyInstrumentTheme,
  readAmbianceChoice,
  type Ambiance,
  readLivingInstrument,
  readCommitted,
} from "../design/theme";
import { CompyHero } from "./CompyHero";
import { DashboardV2 } from "./DashboardV2";
import { HomeV3 } from "./HomeV3";
import { activeChangeCount } from "./dashboard-data";
import { signalRing, postureLine, liveStrip } from "./command-center-data";
import { TrustSwitch, TrustSnapshotLine } from "../design/TrustSwitch";
import { HardwareSection } from "./HardwareSection";
import "./CommandCenter.css";

// ─── Structural prop subsets ────────────────────────────────────────────────
// The Home now renders the shared HardwareGrid (the detailed "Your hardware" cards), which reads the
// full hardware shape — so we take the real HardwareInfo (type-only import, erased at build → no
// runtime cycle). The header still reads just a few fields off it.
type Rec = {
  id: string;
  currently_applied: boolean;
  provenance: "verified" | "measured-signal" | "expected-impact";
};

type Props = {
  hw: HardwareInfo;
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
  // Navigation into the consolidated rail rooms.
  onNavigate: (tab: "Optimize" | "Check" | "Play" | "Lab" | "Learn") => void;
  onRunCheck: () => void;
  onBack: () => void;
  canGoBack: boolean;
  onForward: () => void;
  canGoForward: boolean;
};

const fmtGB = (b: number) => (b > 0 ? `${(b / 1024 ** 3).toFixed(0)} GB` : "—");

function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 18) return "Good afternoon";
  return "Good evening";
}

// Motion respects the app-wide preference (Settings → Motion), which overrides the OS by default.

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

  // Patient-gaze (shadow realm, Six Laws): hold a steady gaze on a fully-Dialed ring for 10s and it
  // takes one slow breath + whispers a different subline. Nothing changes, nothing unlocks. Hover-only
  // (no knob — invisible until found); the breath is CSS-gated so reduced-motion = the text swap only.
  const [breathing, setBreathing] = useState(false);
  const gazeTimer = useRef(0);
  const canGaze = ring.known && ring.dialed;
  const onGazeStart = () => {
    if (!canGaze) return;
    gazeTimer.current = window.setTimeout(() => setBreathing(true), 10000);
  };
  const onGazeEnd = () => {
    window.clearTimeout(gazeTimer.current);
    setBreathing(false);
  };
  useEffect(() => () => window.clearTimeout(gazeTimer.current), []);

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
      className={`cc-ring cc-ring-${ring.dialed ? "dialed" : "ready"}${breathing ? " cc-ring-breathing" : ""}`}
      title={`${ring.ideal}/${ring.total} readiness checks ideal`}
      onMouseEnter={onGazeStart}
      onMouseLeave={onGazeEnd}
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
        <div className="cc-ring-sub">{breathing ? "Nothing to fix. Go play." : ring.sub}</div>
      </div>
    </div>
  );
}

// Labels from the shared provenance source of truth (can't drift from Fix / ActionDrawer); CSS class local.
const EVIDENCE: Record<Rec["provenance"], { label: string; cls: string }> = {
  verified: { label: PROVENANCE_LABEL.verified, cls: "verified" },
  "measured-signal": { label: PROVENANCE_LABEL["measured-signal"], cls: "measured" },
  "expected-impact": { label: PROVENANCE_LABEL["expected-impact"], cls: "expected" },
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

  // Nothing worth fixing → the honest win state. Title deliberately does NOT say "measured clean" —
  // the posture verdict directly above already does (P5 taste catch: verdict + limiter were
  // double-saying it on the answer-first Home).
  if (!limiter) {
    return (
      <section className="cc-panel cc-limiter cc-limiter-clear">
        <div className="cc-panel-eyebrow">Your #1 limiter</div>
        <h3 className="cc-limiter-title">None found today</h3>
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
        <LiveMetric value={`${countUp(strip.avgFps, progress)}`} label={<Term id="hz-vs-fps">Avg FPS</Term>} />
        <LiveMetric value={`${countUp(strip.low1Est, progress)}`} label={<Term id="one-percent-lows">1% low</Term>} note="est" />
        <LiveMetric
          value={strip.peakTempC == null ? "—" : `${countUp(strip.peakTempC, progress)}°C`}
          label="Peak temp"
        />
      </div>
    </section>
  );
}

function LiveMetric({ value, label, note }: { value: string; label: ReactNode; note?: string }) {
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
    onBack,
    canGoBack,
    onForward,
    canGoForward,
  } = props;

  const reduced = useReducedMotion();
  const progress = useMountProgress(900, reduced);

  // Instrument theme + ambiance. The theme is now app-wide (set at startup in main.tsx + here on
  // change) and persists across every surface — no unmount-removal (the classic ThemePicker is
  // retired; Instrument's Velocity/Nova/Ember is the one theme system).
  // Read once on mount — appearance is changed in Settings now (smalls §4); Home only reflects the
  // current theme/ambiance (applied app-wide via data-itheme at startup + re-asserted here on mount).
  const [itheme] = useState<InstrumentTheme>(readInstrumentTheme);
  // The user's EXPLICIT ambiance choice (null = never chose). The effective ambiance is computed
  // below once the homeV3/view-mode flags are known — P3 calms the default without overriding a
  // real Settings pick; flag off ⇒ identical to the old readAmbiance() ("full") default.
  const [ambianceChoice] = useState<Ambiance | null>(readAmbianceChoice);
  // Living Instrument "simplified rail" (owner: fewer, plainer tabs) — mirrors the flag live; when on,
  // Lab leaves the everyday rail for a compact "Advanced" cell (same change as the app-shell rail).
  const [living, setLiving] = useState<boolean>(readLivingInstrument);
  useEffect(() => {
    const on = () => setLiving(readLivingInstrument());
    window.addEventListener("compy:living-changed", on);
    return () => window.removeEventListener("compy:living-changed", on);
  }, []);
  // Optimize merge — read once at render, same flag the app shell reads (default ON since 2026-06-21).
  // When on, the rail collapses Check + Tune → "Optimize" so the Home rail matches the shell rail
  // exactly. Escape hatch: compy_optimize="0" restores the classic separate Check + Tune.
  // Guarded reader — a present-but-throwing localStorage (storage-disabled WebView2) would otherwise
  // blank the default Home; default merged-ON.
  const optimizeMerged = readOptimizeMerged();
  // Committed brand hero (experimental swing, default OFF) — mirrors the flag live for review.
  const [committed, setCommitted] = useState<boolean>(readCommitted);
  useEffect(() => {
    const on = () => setCommitted(readCommitted());
    window.addEventListener("compy:committed-changed", on);
    return () => window.removeEventListener("compy:committed-changed", on);
  }, []);
  // Dashboard v2 — the premium telemetry-dashboard Home (default ON, owner-approved). Read from the DOM
  // attribute (set by main.tsx before paint / applyDashV2 on toggle) so the test env — where main.tsx
  // never runs — keeps the classic Home its tests assert. The live toggle re-reads on the event.
  const [dashV2, setDashV2] = useState<boolean>(
    () => typeof document !== "undefined" && document.documentElement.dataset.dashV2 === "on",
  );
  useEffect(() => {
    const on = () => setDashV2(document.documentElement.dataset.dashV2 === "on");
    window.addEventListener("compy:dashv2-changed", on);
    return () => window.removeEventListener("compy:dashv2-changed", on);
  }, []);
  // Answer-first Home (P3, default OFF) — same DOM-attribute + event pattern as dashV2, which it
  // supersedes when on. Test env (main.tsx never runs) keeps the classic Home its tests assert.
  const [homeV3, setHomeV3] = useState<boolean>(
    () => typeof document !== "undefined" && document.documentElement.dataset.homeV3 === "on",
  );
  useEffect(() => {
    const on = () => setHomeV3(document.documentElement.dataset.homeV3 === "on");
    window.addEventListener("compy:homev3-changed", on);
    return () => window.removeEventListener("compy:homev3-changed", on);
  }, []);
  // Mirror the Basic/Advanced view mode (set on <html> only while the P2 split is armed) so the P3
  // backdrop can auto-off in Advanced (owner §8b) and react live to the Monitor-side switch.
  const [viewMode, setViewMode] = useState<string | undefined>(
    () => (typeof document !== "undefined" ? document.documentElement.dataset.viewMode : undefined),
  );
  useEffect(() => {
    const on = () => setViewMode(document.documentElement.dataset.viewMode);
    window.addEventListener("compy:viewmode-changed", on);
    return () => window.removeEventListener("compy:viewmode-changed", on);
  }, []);
  // Effective backdrop intensity (owner §8b, P3-gated): homeV3 defaults to "calm" (barely-there
  // drift behind the hologram) and auto-offs in Advanced mode; an explicit Off/Full Settings choice
  // wins outside Advanced. Flag off ⇒ the classic default ("full").
  const ambiance: Ambiance = homeV3
    ? viewMode === "advanced"
      ? "off"
      : (ambianceChoice ?? "calm")
    : (ambianceChoice ?? "full");
  useEffect(() => {
    applyInstrumentTheme(itheme);
  }, [itheme]);

  const posture = postureLine(readiness, priorities, activeChangeCount(changes));
  const limiter = priorities?.limiters[0] ?? null;
  const gpu = hw.gpus[0]?.name ?? "No GPU detected";
  const cpu = hw.cpu_arch?.family_label || hw.cpu_brand || "CPU";
  const os = hw.windows_version?.product_name || `${hw.os_name} ${hw.os_version}`.trim();

  // Rail items derive from the SHARED rail selector (railFor, built from HOME_RAIL — one-rail §1) so
  // the Home rail is identical to the app-shell rail by construction (including the Optimize merge
  // collapse). Only the per-id click target + the active flag are CommandCenter-specific. When merged,
  // the standalone "check" entry is gone, so its onClick simply never renders.
  const NAV_ONCLICK: Record<HomeRailId, () => void> = {
    home: () => {},
    check: () => onNavigate("Check"),
    play: () => onNavigate("Play"),
    fix: () => onNavigate("Optimize"),
    learn: () => onNavigate("Learn"), // Learn is a rail room now (one-rail §1b)
    lab: () => onNavigate("Lab"),
  };
  const NAV = railFor(optimizeMerged)
    .filter((it) => !(living && it.id === "lab"))
    .map((it) => ({
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
            {/* Living Instrument (owner: fewer, plainer tabs): Lab → a compact, quieter "Advanced"
                cell so the everyday rooms read cleanly. Same routing target (the Lab surface). */}
            {living && (
              <button
                role="tab"
                aria-selected={false}
                className="cc-rail-item cc-rail-advanced"
                onClick={() => onNavigate("Lab")}
                title="Advanced — Lab: benchmarks, latency, diagnostics"
              >
                <NavGlyph name="lab" />
                <span>Advanced</span>
              </button>
            )}
          </div>
          {/* Settings now lives in the always-visible titlebar (app-wide) — the Home rail gear was
              redundant, so it's retired here too. One consistent Settings location. */}
          <div className={`cc-rig cc-rig-${posture.tone}`} title={gpu}>
            <span className="cc-rig-dot" aria-hidden="true" />
            <span className="cc-rig-gpu">{gpu}</span>
          </div>
        </nav>

        {/* Main area */}
        <div className="cc-main">
          {/* Committed brand hero (experimental swing) — the "Welcome to Compy" moment. Flag-gated. */}
          {committed && <CompyHero />}
          <header className="cc-header">
            <BackButton onBack={onBack} canGoBack={canGoBack} />
            <ForwardButton onForward={onForward} canGoForward={canGoForward} />
            <div>
              <h1 className="cc-greeting">{greeting()}</h1>
              {/* Each spec token is nowrap so the line wraps only at the "·" separators —
                  never "16 / threads" (elastic-window §2). */}
              <p className="cc-rigline">
                <span className="cc-rig-token">{cpu}</span>
                <span className="cc-rig-sep"> · </span>
                <span className="cc-rig-token">{hw.cpu_cores_logical} threads</span>
                <span className="cc-rig-sep"> · </span>
                <span className="cc-rig-token">{fmtGB(hw.ram_total_bytes)}</span>
                <span className="cc-rig-sep"> · </span>
                <span className="cc-rig-token">{os}</span>
              </p>
            </div>
            <button className="cc-recheck" onClick={onRunCheck}>
              Re-run check
            </button>
          </header>

          {homeV3 ? (
            /* Answer-first Home (P3 UI slim-down, default OFF) — verdict → #1 limiter → 3 tiles →
               the retained 3D rig centerpiece. The LimiterCard is built HERE so the audited
               apply/rollback flow is byte-for-byte the same one dashV2/classic use. */
            <HomeV3
              hw={hw}
              sessions={sessions}
              posture={posture}
              onNavigate={onNavigate}
              limiterSlot={
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
              }
            />
          ) : dashV2 ? (
            /* Dashboard v2 prototype (evolve-toward-ui-spec) — the premium telemetry dashboard.
               Flag-gated; the classic Home is one toggle away. */
            <>
              {/* The #1-limiter CTA — the one actionable thing worth doing for THIS rig — leads the
                  default Home. It was dropped when dashV2 shipped (the telemetry dashboard focused on
                  charts), so the most useful card vanished; restored here as the hero above the
                  telemetry. Same audited apply flow + props as the classic path (no new IPC). */}
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
              <DashboardV2 hw={hw} sessions={sessions} onNavigate={onNavigate} />
            </>
          ) : (
            <>
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

              {/* "Your hardware" — the detailed card grid (incl. the elastic §6 Network card), shared with
                  the classic Overview via HardwareGrid so the two Homes can't drift. Restores the owner-
                  approved grid to the default Home, below Last Session. Same `hw`, zero new IPC; the global
                  `.grid` reflows responsively (flex-wrap, min-width:0) down to the 380px floor. */}
              <section className="cc-hardware">
                <HardwareSection hw={hw} />
              </section>
            </>
          )}
          {/* Appearance controls (theme + ambiance) live in Settings → Appearance now (smalls §4) —
              the canvas stays clean; the rail's Settings gear is the way there. */}
        </div>
      </div>
    </div>
  );
}
