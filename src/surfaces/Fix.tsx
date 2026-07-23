import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppliedChange, StartupEntry } from "../types";
import { TrustSwitch, TrustSnapshotLine } from "../design/TrustSwitch";
import { WhatsThis } from "../design/WhatsThis";
import { Walkthrough } from "../design/Walkthrough";
import { walkthroughForKey, type GpuVendor } from "./walkthroughs";
import { useDismissed } from "./dismissed";
import { useEligibilityOverrides } from "./eligibility-override";
import { GUIDED_STEPS, openGuidedUri } from "./guided";
import { friendlyLabel } from "../data/friendly-labels";
import { expertTarget, EXPERT_TARGET_DISCLAIMER } from "../data/expert-targets";
import { useExpertView } from "../design/use-expert-view";
import { PROVENANCE_LABEL, PROVENANCE_NOTE } from "../data/provenance";
import { recMutation } from "../data/rec-mutations";
import { slimProofLine } from "../data/slim-proof";
import { SlimRecRow, SlimDetailRow } from "../design/SlimRecRow";
import { ActionDrawer, type DrawerRec } from "./ActionDrawer";
import { gameModeRevertedExternally } from "./dashboard-data";
import { SidePileItem, SIDE_PILE_ORDER } from "./side-pile";
import "./Fix.css";

// Whether the Living Instrument preview is on (DOM-read; the surface re-renders fresh on navigation,
// so a toggle in Settings is reflected when you return here). Drives the plain-language rec titles.
function livingOn(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.living === "on";
}
// Dashboard-energy preview — gates the Action Drawer ("Details ›" → the pop-up that shows exactly what
// a tweak touches). DOM-read; the surface re-renders fresh on navigation.
function dashOn(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.dashV2 === "on";
}

// A rec's title. Under the Living Instrument preview, jargon recs lead with a plain-language headline
// + a quiet technical tag (owner direction 2026-06-15: friendly-first, real name kept visible). The
// original catalog title + measured detail always stay reachable via "What's this?" and exports.
function RecTitle({ id, title }: { id: string; title: string }) {
  const f = livingOn() ? friendlyLabel(id) : null;
  if (!f) return <span className="fix-row-title">{title}</span>;
  return (
    <span className="fix-row-title fix-row-title-friendly">
      <span className="fix-row-headline">{f.headline}</span>
      {f.tech && <span className="fix-row-tech">{f.tech}</span>}
    </span>
  );
}

// A rec's technical blurb. Under the preview, a rec with a friendly headline HIDES this line — the
// plain headline already says it, and the full detail stays under "What's this?" (clarify: "if the
// heading explains it, the intro is redundant"). Unmapped recs keep their reason line.
function RecReason({ id, text }: { id: string; text: string }) {
  if (livingOn() && friendlyLabel(id)) return null;
  return <p className="fix-row-reason">{text}</p>;
}

// Expert view (spec 2026-07-11-expert-layer-middle-ground §1): the exact registry key / service /
// setting a tweak touches, inline on the row — display-only, transcribed from the apply source
// (expert-targets.ts). SHIP CONDITION: the one-line rollback-boundary disclaimer renders beside
// every inline target, always. Renders nothing when the preference is off or the id is unmapped.
function ExpertTargetLine({ id }: { id: string }) {
  const expert = useExpertView();
  const t = expertTarget(id);
  if (!expert || !t) return null;
  return (
    <span className="fix-expert-target">
      <code className="fix-expert-path">{t.target}</code>
      <span className="fix-expert-note">{EXPERT_TARGET_DISCLAIMER}</span>
    </span>
  );
}

// A5 measured-payoff linkage — the honest per-tweak payoff meter. Renders ONLY the backend-derived
// category label (e.g. "Input latency", "Background CPU & RAM"): the KIND of gain a change targets,
// never a fabricated FPS/latency number (honest-measurement law). Absent → renders nothing, so a
// legacy entry or a restore-to-stock leftover shows no meter rather than an invented one.
function PayoffMeter({ label }: { label?: string | null }) {
  if (!label) return null;
  return (
    <span className="fix-payoff" title="What this change is measured to help with — not a promised number">
      <span className="fix-payoff-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

// Second live Instrument surface (spec 2026-06-05-fix-surface). Reskins the recommendations list:
// worth-fixing trust-switches → already-applied (collapsed, named priors) → the refuse-pile (what
// Compy won't touch, with a Library link) → guided/advisory recs (no switch). Reuses the EXISTING
// audited apply/rollback flow via onToggleRec; adds no mutation path of its own.

// Structural subset of App's Recommendation — object covariance lets the fuller object pass.
type Rec = {
  id: string;
  title: string;
  description: string;
  impact: string;
  currently_applied: boolean;
  provenance: "verified" | "measured-signal" | "expected-impact";
  eligible?: boolean;
  ineligible_reason?: string | null;
  severity?: "safe" | "moderate" | "advanced"; // §4 "Apply all" targets SAFE-tier only
};

type Props = {
  recs: Rec[];
  startup: StartupEntry[];
  changes: AppliedChange[];
  busyId: string | null;
  isAppliable: (recId: string) => boolean;
  activeChangeFor: (recId: string) => AppliedChange | undefined;
  onToggleRec: (recId: string) => void;
  onToggleStartup: (entry: StartupEntry) => void;
  onRollback: (c: AppliedChange) => void;
  onApplyBatch: (recIds: string[]) => Promise<{ applied: number; skipped: { title: string; reason: string }[] }>;
  onOpenLibrary: (focusId: string) => void;
  vendor: GpuVendor;
  // Section filter (Optimize merge, spec 2026-06-21): "all" (default) = today's whole Tune surface,
  // byte-identical; "fixes" = the recs / guided / startup / refuse-pile sections only (no Trust
  // Ledger); "ledger" = BOTH ledger layers; "applied" = the "Active on this PC" layer ONLY; "history"
  // = the "Full history" layer ONLY. Lets the merged Optimize shell place the same Fix surface under
  // separate Fixes / Applied / History segments without duplicating any markup — and keep each segment
  // a DISTINCT view (History is not a mirror of Applied). Old callers pass nothing → "all".
  view?: "all" | "fixes" | "ledger" | "applied" | "history";
  // V2-4b IA (spec 2026-07-03-owner-optimize-feedback) — only the V2 Optimize room sets these;
  // classic/standalone render byte-identically with them absent. v2Ia regroups the fixes view by
  // what-it-needs (ready / needs your call / applied — drifted); `reverted` is the scan's
  // applied-then-turned-off-outside-Compy list, so a drifted rec renders as ONE row in the
  // drifted group with its state on it (one-mention law), never a second time under ready.
  v2Ia?: boolean;
  reverted?: { rec_id: string; title: string }[];
};

// Humanized timestamp (ledger §2): "3 days ago · 6:08 AM", never raw seconds.
function humanizeWhen(iso: string): string {
  const t = new Date(iso);
  if (isNaN(t.getTime())) return "recently";
  const time = t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = Math.floor((Date.now() - t.getTime()) / 86400000);
  if (days <= 0) return `today · ${time}`;
  if (days === 1) return `yesterday · ${time}`;
  if (days < 7) return `${days} days ago · ${time}`;
  return `${t.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
}

// Labels come from the shared provenance source of truth so they can't drift from the
// Home limiter / ActionDrawer wording; the CSS class stays local to this surface.
const EVIDENCE: Record<Rec["provenance"], { label: string; cls: string }> = {
  verified: { label: PROVENANCE_LABEL.verified, cls: "verified" },
  "measured-signal": { label: PROVENANCE_LABEL["measured-signal"], cls: "measured" },
  "expected-impact": { label: PROVENANCE_LABEL["expected-impact"], cls: "expected" },
};

// The refuse-pile (spec §2 v1 trio). Calm one-liners consistent with tweaks.json verdicts; each
// links to its Library autopsy. Educates, never shames — no fear-tone.
const REFUSE_PILE: { id: string; name: string; why: string }[] = [
  {
    id: "useplatformclock",
    name: "Force HPET",
    why: "On modern Windows this almost always raises latency and causes stutter — the OS already picks the best timer.",
  },
  {
    id: "pagefile-disable",
    name: "Disable the pagefile",
    why: "Games that commit more memory than your RAM hard-crash with it off — leave it system-managed.",
  },
  {
    id: "disable-defender",
    name: "Disable Windows Defender",
    why: "The FPS gain is a rounding error; the cost is your only always-on protection — and some anti-cheats react badly.",
  },
];

// The knob — an enclosed chevron CHIP (doorknob grammar), so an expandable reads as a door at rest.
// The chip rotates via the parent .cmp-door[aria-expanded]; the glyph itself stays static.
function Chevron() {
  return (
    <span className="cmp-door-chevron" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
    </span>
  );
}

function ShieldOff() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 2.5v5.5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V5.5L12 3z" />
      <line x1="5" y1="4" x2="19" y2="19" />
    </svg>
  );
}

function EvidenceChip({ p }: { p: Rec["provenance"] }) {
  const e = EVIDENCE[p];
  return <span className={`fix-evidence fix-evidence-${e.cls}`}>{e.label}</span>;
}

// Honest Game Mode heads-up (one copy source — classic FixRow + the slim detail both render it).
// If we can SEE it reverted (applied before, now off), say so pointedly so the user knows
// re-applying won't hold — instead of silently re-offering it. Otherwise, on AMD, give the
// proactive warning (Radeon resets it on login).
function GameModeNote({
  id,
  vendor,
  reverted,
}: {
  id: string;
  vendor?: GpuVendor;
  reverted?: boolean;
}) {
  if (id !== "game-mode") return null;
  if (reverted) {
    return (
      <p className="fix-amd-note">
        You applied this before, but Windows switched Game Mode back off. That's your GPU's
        recording software (AMD Adrenalin / NVIDIA ShadowPlay) resetting it at login — not Compy.
        Re-applying works, but it'll reset again after the next restart.
      </p>
    );
  }
  if (vendor === "amd") {
    return (
      <p className="fix-amd-note">
        Heads up: on AMD systems, Radeon Adrenalin tends to switch Windows Game Mode back off
        after you log in (a known Windows/AMD Game Bar conflict). Compy can turn it on, but it
        may not stay on across reboots — that's the system resetting it, not a Compy bug.
      </p>
    );
  }
  return null;
}

// A row for an appliable rec — title, evidence, reason, and the trust-switch (right-aligned). When
// applied, the row carries the named-prior snapshot line in its main column.
function FixRow({
  rec,
  applied,
  activeChange,
  busy,
  onToggle,
  onWhatsThis,
  onDismiss,
  onOpenDrawer,
  vendor,
  gameModeReverted,
}: {
  rec: Rec;
  applied: boolean;
  activeChange: AppliedChange | undefined;
  busy: boolean;
  onToggle: () => void;
  onWhatsThis: (id: string) => void;
  onDismiss: (id: string) => void;
  onOpenDrawer?: () => void;
  vendor?: GpuVendor;
  gameModeReverted?: boolean;
}) {
  return (
    <li className="fix-row">
      <div className="fix-row-main">
        <div className="fix-row-head">
          <RecTitle id={rec.id} title={rec.title} />
          <EvidenceChip p={rec.provenance} />
          <WhatsThis id={rec.id} onOpen={onWhatsThis} />
          {onOpenDrawer && (
            <button className="fix-details" onClick={onOpenDrawer} title="See exactly what this changes" aria-label="See exactly what this changes">
              Details ›
            </button>
          )}
        </div>
        <RecReason id={rec.id} text={rec.impact || rec.description} />
        <GameModeNote id={rec.id} vendor={vendor} reverted={gameModeReverted} />
        {applied && (
          <TrustSnapshotLine
            restoresLabel={activeChange?.restores_label}
            appliedLabel={activeChange?.applied_label}
          />
        )}
        {/* Deliberate, reversible decline — applied rows can't be dismissed (roll back instead). */}
        {!applied && (
          <button className="fix-dismiss" onClick={() => onDismiss(rec.id)}>
            Not for me
          </button>
        )}
      </div>
      <TrustSwitch
        applied={applied}
        busy={busy}
        onToggle={onToggle}
        ariaLabel={`${applied ? "Roll back" : "Apply"} ${rec.title}`}
      />
    </li>
  );
}

// The slim master-detail rec row (P1 UI slim-down — the Fixes segment look; FixRow above
// renders byte-identical). LAYOUT ONLY: the TrustSwitch is the same component on the same audited
// onToggle path, the proof line is the rec's real evidence/reason (slimProofLine — never fabricated,
// never hidden), and everything else moves into the in-place detail panel, reusing the existing
// subcomponents (EvidenceChip / GameModeNote / TrustSnapshotLine / Walkthrough / WhatsThis / dismiss).
// Exported for slim-row-proof-guard.test.tsx (applied rows can't render via worthFixing in P1).
export function SlimFixRow({
  rec,
  applied,
  activeChange,
  busy,
  onToggle,
  onWhatsThis,
  onDismiss,
  vendor,
  gameModeReverted,
}: {
  rec: Rec;
  applied: boolean;
  activeChange: AppliedChange | undefined;
  busy: boolean;
  onToggle: () => void;
  onWhatsThis: (id: string) => void;
  onDismiss: (id: string) => void;
  vendor?: GpuVendor;
  gameModeReverted?: boolean;
}) {
  const mut = recMutation(rec.id);
  const walkthrough = walkthroughForKey(rec.id);
  const why = rec.description || rec.impact;
  return (
    <SlimRecRow
      title={<RecTitle id={rec.id} title={rec.title} />}
      proof={slimProofLine(rec)}
      meta={<ExpertTargetLine id={rec.id} />}
      badge={rec.severity === "safe" ? "recommended" : "optional"}
      status={applied ? "ready" : rec.severity === "safe" ? "attention" : "neutral"}
      control={
        <TrustSwitch
          applied={applied}
          busy={busy}
          onToggle={onToggle}
          ariaLabel={`${applied ? "Roll back" : "Apply"} ${rec.title}`}
        />
      }
    >
      {why && <SlimDetailRow k="Why it matters" v={why} />}
      <SlimDetailRow
        k="Evidence"
        v={
          <>
            <EvidenceChip p={rec.provenance} /> {PROVENANCE_NOTE[rec.provenance]}
          </>
        }
      />
      <SlimDetailRow
        k="What changes"
        v={
          mut
            ? `${mut.changes}${mut.elevated ? " Needs one admin OK." : ""}${
                mut.restart ? " Takes effect after restart." : ""
              }`
            : "A single, scoped Windows setting — Compy snapshots its exact prior value before touching it."
        }
      />
      <SlimDetailRow
        k="Undo"
        v={
          mut?.reverts ??
          "Compy captures the exact prior state before changing anything, and restores it on rollback."
        }
      />
      <GameModeNote id={rec.id} vendor={vendor} reverted={gameModeReverted} />
      {applied && (
        <TrustSnapshotLine
          restoresLabel={activeChange?.restores_label}
          appliedLabel={activeChange?.applied_label}
        />
      )}
      <div className="slimrow-acts">
        {walkthrough && (
          <details className="fix-walkthrough">
            <summary>Show me the way</summary>
            <Walkthrough walkthrough={walkthrough} vendor={vendor ?? "any"} />
          </details>
        )}
        <WhatsThis id={rec.id} onOpen={onWhatsThis} />
        {/* Deliberate, reversible decline — applied rows can't be dismissed (roll back instead). */}
        {!applied && (
          <button className="fix-dismiss" onClick={() => onDismiss(rec.id)}>
            Not for me
          </button>
        )}
      </div>
    </SlimRecRow>
  );
}

function CollapsibleSection({
  title,
  count,
  icon,
  tint,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  icon?: ReactNode;
  tint?: "applied" | "refuse";
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  // Expert view (spec §1/§3): the full panel renders OPEN — the refused drawer's reasoning and
  // every long-tail section sit inline instead of behind a collapsed door. Flipping the preference
  // re-baselines each section (open when expert, closed otherwise); the user can still toggle any
  // section freely afterward. Presentation-only: contents and controls are identical either way.
  const expert = useExpertView();
  const [open, setOpen] = useState(!!defaultOpen || expert);
  useEffect(() => setOpen(expert || !!defaultOpen), [expert, defaultOpen]);
  return (
    <section className={`fix-group ${tint ? `fix-group-${tint}` : ""}`}>
      <button className="fix-group-head cmp-door" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Chevron />
        {icon && <span className="fix-group-icon">{icon}</span>}
        <span className="fix-group-title">{title}</span>
        <span className="fix-group-count">{count}</span>
      </button>
      {open && <div className="fix-group-body">{children}</div>}
    </section>
  );
}

// The curated Microsoft CEIP / telemetry scheduled tasks Compy can disable (ARMED 2026-06-26).
// Ids match the Rust `KnownBloatTask::from_id` allowlist — the backend re-enforces it, so nothing
// off-list (never Defender / policy) can be passed. Disabling is reversible: the change lands in the
// Trust Ledger and re-enables on rollback.
const DEBLOAT_TASKS: { id: string; label: string; what: string }[] = [
  { id: "compatibility-appraiser", label: "Compatibility Appraiser", what: "feeds Microsoft's compatibility telemetry (legacy; absent on newer Windows)" },
  { id: "ceip-consolidator", label: "CEIP Consolidator", what: "sends Customer Experience Improvement Program data" },
  { id: "ceip-usb", label: "CEIP USB telemetry", what: "reports USB device usage to the CEIP" },
];

// Self-contained: invokes the gated `disable_known_bloat_task` command directly; the applied change
// shows in the Trust Ledger (History) where it can be rolled back (re-enables the task).
function DebloatTasks({
  onWhatsThis,
  activeChangeFor,
}: {
  onWhatsThis: (id: string) => void;
  // Derive the "Disabled" state from the Trust Ledger, not just this render's local state: an applied
  // disable lands under rec_id `bloat-task:<id>`, so a persisted (still-active, not rolled-back) change
  // means the task stays off across remount/nav. Local `state` only carries THIS session's fresh click
  // + any error text; the ledger is the durable truth (mirrors the toggle-row rows' activeChangeFor use).
  activeChangeFor: (recId: string) => AppliedChange | undefined;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, "done" | string>>({});
  const disable = async (id: string) => {
    setBusy(id);
    try {
      await invoke("disable_known_bloat_task", { taskId: id });
      setState((s) => ({ ...s, [id]: "done" }));
    } catch {
      // Plain-English, not the raw Rust string: this is an ARMED mutation, so make clear nothing changed.
      setState((s) => ({
        ...s,
        [id]: "Couldn't turn that off — it may need an admin OK, or the prompt was cancelled. Nothing changed; try again.",
      }));
    } finally {
      setBusy(null);
    }
  };
  return (
    <CollapsibleSection title="Telemetry tasks" count={DEBLOAT_TASKS.length}>
      <p className="fix-refuse-intro">
        Disable Microsoft telemetry scheduled tasks for this PC — reversible (re-enable from History).
        Compy only ever touches this curated list; never Defender or anything that breaks Windows.{" "}
        <WhatsThis id="telemetry" onOpen={onWhatsThis} />
      </p>
      <ul className="fix-list">
        {DEBLOAT_TASKS.map((t) => {
          const st = state[t.id];
          // Persisted (ledger) OR just-clicked this session. The ledger read survives remount/nav —
          // the row no longer reverts to "Disable" after leaving and returning while the task stays off.
          const done = !!activeChangeFor(`bloat-task:${t.id}`) || st === "done";
          const err = st && st !== "done" ? st : null;
          return (
            <li className="fix-row fix-row-advisory" key={t.id}>
              <div className="fix-row-main">
                <span className="fix-row-title fix-row-title-friendly">
                  <span className="fix-row-headline">{t.label}</span>
                  <span className="fix-row-tech">{t.what}</span>
                </span>
                {err && <p className="fix-row-reason">{err}</p>}
              </div>
              <button className="btn btn-small" disabled={busy === t.id || done} onClick={() => disable(t.id)}>
                {done ? "Disabled · undo in History" : busy === t.id ? "Disabling…" : "Disable"}
              </button>
            </li>
          );
        })}
      </ul>
    </CollapsibleSection>
  );
}

// Phase-B preload-app removal (BUILT DARK — the backend's preload_removal_gate() is false until its
// own QA + owner sign-off). Ids match the Rust `KnownPreloadApp::from_id` allowlist — the backend
// re-enforces it, so nothing off-list (never the Store, Game Bar, or a data-bearing app) can be
// passed. Removal is for THIS USER only; undo lives in History (silent re-register when Windows
// still has the files, else Compy opens the app's Store page to finish).
export const PRELOAD_APPS: { id: string; label: string; what: string }[] = [
  { id: "solitaire-collection", label: "Solitaire Collection", what: "preinstalled card-game bundle" },
  { id: "feedback-hub", label: "Feedback Hub", what: "collects Windows feedback and diagnostic reports for Microsoft" },
  { id: "bing-news", label: "Microsoft News", what: "preinstalled news-feed app" },
  { id: "office-hub", label: "Microsoft 365 (Office) hub", what: "launcher for Office web apps" },
  // Spotify cut by owner curation 2026-07-06 — same package id as a real install, no honest "stub" copy.
];

// Renders NOTHING unless the backend reports the feature armed AND at least one curated app is
// installed for this user — so shipping it dark changes zero pixels (no flag needed; the gate IS
// the switch, and the same probe lights the card up the commit the gate arms).
function PreloadApps() {
  const [view, setView] = useState<{ armed: boolean; installed: string[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, "done" | string>>({});
  useEffect(() => {
    invoke<{ armed: boolean; installed: string[] }>("get_preload_apps")
      .then(setView)
      .catch(() => setView(null));
  }, []);
  if (!view?.armed) return null;
  const rows = PRELOAD_APPS.filter((a) => view.installed.includes(a.id));
  if (rows.length === 0) return null;
  const remove = async (id: string) => {
    setBusy(id);
    try {
      await invoke("remove_known_preload_app", { appId: id });
      setState((s) => ({ ...s, [id]: "done" }));
    } catch {
      // Plain-English, honest: nothing changed on a refusal/failure.
      setState((s) => ({
        ...s,
        [id]: "Couldn't remove it — nothing changed; try again.",
      }));
    } finally {
      setBusy(null);
    }
  };
  return (
    <CollapsibleSection title="Preinstalled apps" count={rows.length}>
      <p className="fix-refuse-intro">
        Remove Store apps Windows preinstalled — for this user account only, reversible from History
        (Windows restores it silently when it can; otherwise Compy opens the app&apos;s Store page to
        finish). Compy only ever touches this curated list; never the Store itself, Xbox Game Bar, or
        an app holding your files.
      </p>
      <ul className="fix-list">
        {rows.map((a) => {
          const st = state[a.id];
          const done = st === "done";
          const err = st && st !== "done" ? st : null;
          return (
            <li className="fix-row fix-row-advisory" key={a.id}>
              <div className="fix-row-main">
                <span className="fix-row-title fix-row-title-friendly">
                  <span className="fix-row-headline">{a.label}</span>
                  <span className="fix-row-tech">{a.what}</span>
                </span>
                {err && <p className="fix-row-reason">{err}</p>}
              </div>
              <button className="btn btn-small" disabled={busy === a.id || done} onClick={() => remove(a.id)}>
                {done ? "Removed · undo in History" : busy === a.id ? "Removing…" : "Remove"}
              </button>
            </li>
          );
        })}
      </ul>
    </CollapsibleSection>
  );
}

// A guided/advisory rec — Compy detected it but won't change it (vendor app / a Windows page with no
// safe reversible switch). Carries the full where + steps + the allowlisted "Open it" deep link, so
// classic Optimize is no longer needed for the detail (parity for the release default-flip).
function GuidedRow({
  rec,
  vendor,
  onDismiss,
  onWhatsThis,
}: {
  rec: Rec;
  vendor: GpuVendor;
  onDismiss: (id: string) => void;
  onWhatsThis: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const guide = GUIDED_STEPS[rec.id];
  const walkthrough = walkthroughForKey(rec.id);
  return (
    <li className={"fix-row fix-row-advisory" + (open ? " fix-advisory-open" : "")}>
      <div className="fix-row-main">
        {/* The WHOLE head is a door (tester J 2026-07-22: clicked the card, nothing happened,
            concluded the section was dead — the affordance has to be the card, not a small link).
            WhatsThis moved OUT of the head: a button can't nest a button, and it now sits in the
            always-visible actions row where it's findable. */}
        <button
          type="button"
          className="fix-row-head fix-advisory-door"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="fix-advisory-chev" aria-hidden="true" />
          <RecTitle id={rec.id} title={rec.title} />
          <EvidenceChip p={rec.provenance} />
          <span className="fix-guided-tag">Guided</span>
        </button>
        <RecReason id={rec.id} text={rec.impact || rec.description} />
        <ExpertTargetLine id={rec.id} />
        <div className="fix-advisory-quickacts">
          <WhatsThis id={rec.id} onOpen={onWhatsThis} />
          <button className="fix-dismiss" onClick={() => onDismiss(rec.id)}>
            Not for me
          </button>
        </div>
        {guide && (
          <div className="fix-guided-actions">
            <button
              className="fix-guided-toggle cmp-door"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              {open ? "Hide steps" : `How to → ${guide.where}`}
            </button>
            {guide.openUri && (
              <button
                className="fix-guided-open"
                onClick={() => openGuidedUri(guide.openUri!)}
                title={`Opens ${guide.where} directly`}
              >
                {guide.openLabel ?? "Open it"} →
              </button>
            )}
          </div>
        )}
        {open && guide && (
          <div className="fix-guided-detail">
            <div className="fix-guided-where">
              Where: <strong>{guide.where}</strong>
            </div>
            <ol className="fix-guided-steps">
              {guide.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            {guide.state === "unknown" && (
              <p className="fix-guided-note">
                Compy can't read this one's current state — check before you change it; if it's already
                set the way you want, you're done.
              </p>
            )}
            {walkthrough && (
              <details className="fix-walkthrough">
                <summary>Show me the way</summary>
                <Walkthrough walkthrough={walkthrough} vendor={vendor} />
              </details>
            )}
          </div>
        )}
        {open && !guide && (
          <div className="fix-guided-detail">
            {/* An opened card ALWAYS answers — a door that opens onto nothing teaches users to
                stop clicking (J's exact conclusion). Honest: no safe switch exists; say where the
                deeper story lives. */}
            <p className="fix-guided-none">
              No safe, reversible switch for this one — it lives in a vendor app or a Windows page,
              and flipping it is deliberately left to you. Compy won't automate a change it can't
              safely undo.
            </p>
          </div>
        )}
      </div>
    </li>
  );
}

// User-scope auto-start entry — toggle off to keep it from launching with Windows. Reversible,
// nothing deleted. Uses the existing audited set_startup_entry_enabled flow via onToggle.
function StartupRow({
  entry,
  busy,
  onToggle,
}: {
  entry: StartupEntry;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <li className={`fix-startup-row ${!entry.enabled ? "fix-startup-off" : ""}`}>
      <div className="fix-row-main">
        <div className="fix-row-head">
          <span className="fix-row-title">{entry.name}</span>
        </div>
        <p className="fix-row-reason fix-startup-cmd">{entry.command || "(no command)"}</p>
      </div>
      <button
        className={`fix-startup-toggle ${entry.enabled ? "fix-startup-on" : ""}`}
        onClick={onToggle}
        disabled={busy}
        role="switch"
        aria-checked={entry.enabled}
        aria-label={`${entry.enabled ? "Disable" : "Enable"} ${entry.name} at startup`}
      >
        <span className="fix-startup-track">
          <span className="fix-startup-thumb" />
        </span>
      </button>
    </li>
  );
}

// Ledger Layer 1 — one card per CURRENTLY-ACTIVE change ("what is Compy doing to my machine?").
// Humanized "active since", a quiet GHOST rollback (outline; accent ink only on hover). Rollback
// BEHAVIOR is untouched — this calls the same audited onRollback.
function ActiveChangeCard({
  change,
  busy,
  onRollback,
  onWhatsThis,
  onOpenDrawer,
}: {
  change: AppliedChange;
  busy: boolean;
  onRollback: () => void;
  onWhatsThis: (id: string) => void;
  onOpenDrawer?: () => void;
}) {
  return (
    <li className="fix-active-card">
      <div className="fix-row-main">
        <div className="fix-row-head">
          <RecTitle id={change.rec_id} title={change.rec_title} />
          <WhatsThis id={change.rec_id} onOpen={onWhatsThis} />
          {onOpenDrawer && (
            <button className="fix-details" onClick={onOpenDrawer} title="See exactly what this changes" aria-label="See exactly what this changes">
              Details ›
            </button>
          )}
        </div>
        <p className="fix-row-reason">
          Active since {humanizeWhen(change.applied_at)}
          {change.restores_label && change.applied_label
            ? change.restores_label === change.applied_label
              ? ` · Already ${change.applied_label} — no change needed`
              : ` · ${change.restores_label} → ${change.applied_label}`
            : change.restores_label
              ? ` · rolls back to ${change.restores_label}`
              : ""}
        </p>
        <PayoffMeter label={change.payoff_label} />
        {/* A5 "last seen working on" — an ACTIVE change stamped on different hardware is worth a
            quiet heads-up (it may behave differently on today's parts). Honest: only when the
            stamp is KNOWN to mismatch; legacy unstamped entries say nothing. */}
        {change.on_this_rig === false && change.hw_fingerprint && (
          <p className="fix-rig-note">
            Last seen working on <strong>{rigLabel(change.hw_fingerprint)}</strong> — applied
            before your hardware changed. Rollback still works from the ledger.
          </p>
        )}
      </div>
      <button className="fix-ghost-rollback" disabled={busy} onClick={onRollback}>
        {busy ? "Rolling back…" : "Roll back"}
      </button>
    </li>
  );
}

// A5 rig tagging: the short human name of a stamped rig ("RX 9070 XT · 32 GB RAM"). Only ever
// renders fields the stamp actually recorded — an empty GPU read stays honest.
function rigLabel(f: NonNullable<AppliedChange["hw_fingerprint"]>): string {
  const gpu = f.gpu.trim() || "unknown GPU";
  return `${gpu} · ${f.ram_gb} GB RAM`;
}

// Ledger Layer 2 — the full chronological audit trail (active + rolled-back + superseded), muted,
// each row expands to its typed receipt. Click to expand.
function HistoryRow({ change }: { change: AppliedChange }) {
  const [open, setOpen] = useState(false);
  const rolledBack = change.status === "rolled_back" || !change.is_still_active;
  return (
    <li className={`fix-hist-row ${rolledBack ? "fix-hist-rolledback" : ""}`}>
      <button className="fix-hist-head cmp-door" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Chevron />
        <span className="fix-hist-title">{change.rec_title}</span>
        {/* A5 rig tag — only when the stamp says this entry is KNOWN to be from other hardware. */}
        {change.on_this_rig === false && (
          <span className="fix-hist-rig-tag" title="Applied before your hardware changed">
            other rig
          </span>
        )}
        <span className="fix-hist-when">{humanizeWhen(change.applied_at)}</span>
        <span className="fix-hist-status">{rolledBack ? "✓ rolled back" : "active"}</span>
      </button>
      {open && (
        <div className="fix-hist-detail">
          {change.restores_label && change.applied_label ? (
            change.restores_label === change.applied_label ? (
              <div>
                Already <strong>{change.applied_label}</strong> — no change needed
              </div>
            ) : (
              <div>
                Before <strong>{change.restores_label}</strong> → after{" "}
                <strong>{change.applied_label}</strong>
              </div>
            )
          ) : change.restores_label ? (
            <div>
              Restores: <strong>{change.restores_label}</strong>
            </div>
          ) : (
            change.applied_label && (
              <div>
                Set to <strong>{change.applied_label}</strong>
              </div>
            )
          )}
          <div>
            Applied {humanizeWhen(change.applied_at)}
            {change.elevation_used ? " · elevated" : ""}
          </div>
          {/* A5 rig tagging: where this change was applied. Legacy entries (no stamp) show
              nothing rather than a guess. */}
          {change.hw_fingerprint && (
            <div>
              {change.on_this_rig === false ? "Last seen working on" : "Applied on"}{" "}
              <strong>{rigLabel(change.hw_fingerprint)}</strong>
              {change.on_this_rig === false && " — before your hardware changed"}
            </div>
          )}
          {change.payoff_label && (
            <div>
              Measured payoff: <PayoffMeter label={change.payoff_label} />
            </div>
          )}
          <div className="fix-hist-id">{change.rec_id}</div>
        </div>
      )}
    </li>
  );
}

export default function Fix({
  recs,
  startup,
  changes,
  busyId,
  isAppliable,
  activeChangeFor,
  onToggleRec,
  onToggleStartup,
  onRollback,
  onApplyBatch,
  onOpenLibrary,
  vendor,
  view = "all",
  v2Ia = false,
  reverted = [],
}: Props) {
  // Which section(s) of the surface to render — the merged Optimize shell drives this via segments;
  // standalone Tune leaves it "all" so the surface is unchanged. The two ledger layers gate
  // independently so Applied (active only) and History (full trail only) are distinct views.
  const showFixes = view === "all" || view === "fixes";
  const showActive = view === "all" || view === "ledger" || view === "applied";
  const showHistory = view === "all" || view === "ledger" || view === "history";
  // Applicability gating (eligibility train): hardware-ineligible recs leave the active lists +
  // the completion denominator entirely — they sit in a quiet "Not for this rig" bucket with the
  // plain-English reason, never silently dropped, never falsely offered.
  // A5 override: the user can assert Compy's hardware READ was wrong ("My hardware supports
  // this") — the rec then rejoins the normal flow (same audited apply path, same receipt);
  // reversible from the same pile. Only capability-gated recs ever reach this pile, so the
  // override can't resurrect anything the backend omitted as irrelevant.
  const { overridden, override, clearOverride } = useEligibilityOverrides();
  const ineligible = recs.filter((r) => r.eligible === false);
  const notForThisRig = ineligible.filter((r) => !overridden.has(r.id));
  const overriddenRecs = ineligible.filter((r) => overridden.has(r.id));
  const eligibleRecs = recs.filter((r) => r.eligible !== false || overridden.has(r.id));
  // User dismissal ("Not for me"): deliberate, reversible. Dismissed = eligible + user-declined +
  // not currently applied (an APPLIED rec can't be dismissed — roll it back instead; a dismissed rec
  // that becomes applied externally just resolves normally). Dismissed leave the active denominator.
  const { dismissed, dismiss, restore } = useDismissed();
  const isDismissed = (r: Rec) => dismissed.has(r.id) && !r.currently_applied;
  const dismissedRecs = eligibleRecs.filter(isDismissed);
  const liveRecs = eligibleRecs.filter((r) => !isDismissed(r));
  const appliable = liveRecs.filter((r) => isAppliable(r.id));
  const worthFixing = appliable.filter((r) => !r.currently_applied);
  const advisory = liveRecs.filter((r) => !isAppliable(r.id));
  // V2-4b grouping (one-mention law): a rec you applied that later turned off outside Compy
  // renders ONCE, in the drifted group, with that state on it — never a second time under ready.
  // Classic (v2Ia false): drifted stays empty and readyRows === worthFixing, byte-identical.
  const revertedIds = new Set(reverted.map((r) => r.rec_id));
  const drifted = v2Ia ? worthFixing.filter((r) => revertedIds.has(r.id)) : [];
  const readyRows = v2Ia ? worthFixing.filter((r) => !revertedIds.has(r.id)) : worthFixing;

  // §4 "Apply all safe fixes" — SAFE-tier only (moderate stays individual; advisory can't apply;
  // dismissed/not-for-this-rig already excluded since this derives from worthFixing). One consent
  // sheet → onApplyBatch runs the existing apply per item (per-item ledger receipts, failure
  // isolation). Copy never promises performance.
  const safeBatch = worthFixing.filter((r) => r.severity === "safe");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [batching, setBatching] = useState(false);
  // Slim master-detail rows are the Fixes segment's one look (P4 dedup); standalone Tune
  // (view="all", the compy_optimize escape hatch) keeps the classic FixRow list.
  const slim = view === "fixes";
  // §8c (owner decision 2026-07-01, slim mode only): the batch consent sheet arrives with every
  // Recommended (safe-tier) row SELECTED — one-tap deselect; the ticked list IS exactly what will
  // change. Selection ≠ application: Apply stays the explicit act. NO auto-apply on render, ever.
  const [sheetSelected, setSheetSelected] = useState<Set<string>>(new Set());
  const openSheet = () => {
    if (slim) setSheetSelected(new Set(safeBatch.map((r) => r.id)));
    setSheetOpen(true);
  };
  const toggleSheetItem = (id: string) =>
    setSheetSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Esc closes the consent sheet (parity with the other modals) — but never mid-apply, mirroring
  // the backdrop's own guard so a keypress can't dismiss the sheet while a batch is running.
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !batching) setSheetOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen, batching]);
  const [batchSummary, setBatchSummary] = useState<{
    applied: number;
    skipped: { title: string; reason: string }[];
  } | null>(null);
  const runApplyAll = async () => {
    setBatching(true);
    // Slim (§8c): apply EXACTLY the ticked set. Classic: the whole safe batch, unchanged.
    const ids = (slim ? safeBatch.filter((r) => sheetSelected.has(r.id)) : safeBatch).map((r) => r.id);
    const res = await onApplyBatch(ids);
    setBatching(false);
    setSheetOpen(false);
    setBatchSummary(res);
  };

  // Did Game Mode revert externally (applied via Compy, since reset by recording software)? Drives
  // the honest "re-applying won't hold" note instead of silently re-offering the apply each reboot.
  const gameModeReverted = useMemo(() => gameModeRevertedExternally(changes), [changes]);

  // Ledger §2 — Layer 1: currently-active changes, deduped to the latest per rec id (so the same
  // tweak applied/rolled-back N times shows as ONE active card, not N equal rows).
  const active = useMemo(() => {
    const byRec = new Map<string, AppliedChange>();
    for (const c of changes) {
      if (!c.is_still_active) continue;
      const prev = byRec.get(c.rec_id);
      if (!prev || new Date(c.applied_at) > new Date(prev.applied_at)) byRec.set(c.rec_id, c);
    }
    return [...byRec.values()].sort((a, b) => +new Date(b.applied_at) - +new Date(a.applied_at));
  }, [changes]);
  // Layer 2: the full chronological trail (newest first).
  const history = useMemo(
    () => [...changes].sort((a, b) => +new Date(b.applied_at) - +new Date(a.applied_at)),
    [changes],
  );
  // A5 "this rig only" ledger filter — persisted view preference. Hides ONLY entries whose
  // apply-time rig stamp is KNOWN to mismatch today's hardware (on_this_rig === false); legacy
  // unstamped entries (null) always stay visible — never hide a rollback behind a guess.
  const [thisRigOnly, setThisRigOnly] = useState(() => {
    try {
      return localStorage.getItem("compy_ledger_this_rig") === "1";
    } catch {
      return false;
    }
  });
  const chooseThisRigOnly = (v: boolean) => {
    setThisRigOnly(v);
    try {
      localStorage.setItem("compy_ledger_this_rig", v ? "1" : "0");
    } catch {
      /* session-only preference */
    }
  };
  const otherRigCount = useMemo(
    () => history.filter((c) => c.on_this_rig === false).length,
    [history],
  );
  const visibleHistory =
    thisRigOnly && otherRigCount > 0
      ? history.filter((c) => c.on_this_rig !== false)
      : history;

  // ROLLBACK-CORRECTNESS: `busyId` is a single global scalar — the apply/rollback execution model is
  // serial (one in-flight op at a time). So while ANY op is in flight, disable EVERY row's switch, not
  // just the one whose id matches. Disabling only the matching row let a user start a SECOND apply/
  // rollback on a different rec while the first invoke was still pending (the app is interactive again
  // the moment UAC closes) — a second apply could snapshot a prior that already reflects the first
  // apply's mutation, corrupting the rollback chain. This matches the Action Drawer's own guard
  // (`busy={busyId !== null}`) and the row `busy` prop only disables (no misleading per-row spinner).
  const rowBusy = (_rec: Rec) => busyId !== null;
  const living = livingOn();
  const dashV2 = dashOn();
  // Action Drawer state: the rec/change to present + how its primary action resolves (apply vs roll back).
  const [drawer, setDrawer] = useState<
    null | { rec: DrawerRec; applied: boolean; restoresLabel?: string | null; primary: () => void }
  >(null);

  return (
    <section className="fix-root">
      {showFixes && (
      <header className="fix-header">
        <div>
          {/* In the merged Optimize "Fixes" segment (view="fixes"), the segment label already names
              the surface — suppress the standalone "Tune" tab-title to avoid stacked redundant headings
              (Check's title is suppressed the same way). Standalone Tune (view="all") keeps it. */}
          {view !== "fixes" && <h2 className="fix-title">Tune</h2>}
          {/* V2-4b: the RoomShell verdict is the room's ONE summary line — this subtitle would
              restate it (the stacked-summaries owner catch). The consent line below stays. */}
          {v2Ia ? null : living ? (
            <p className="fix-subtitle">
              {worthFixing.length === 0
                ? "Your rig's already dialed in."
                : `${worthFixing.length} ${worthFixing.length === 1 ? "thing" : "things"} worth a look.`}{" "}
              Measured for your rig — every change is one tap to undo.
            </p>
          ) : (
            <p className="fix-subtitle">
              {worthFixing.length} worth a look · {active.length} active ·{" "}
              {dismissedRecs.length} dismissed · {notForThisRig.length} not for this rig. Measured
              changes for your rig — every one is one click to undo.
            </p>
          )}
          {/* Standing approval reassurance, re-homed here from the global footer (halfway-home §0) —
              it belongs where approval actually happens. The undo promise joined it 2026-07-10
              (title-header law): with the room header reduced to a title, the verdict sub that
              carried "every apply captures its undo first" is gone — this consent line beside the
              apply controls is its context. */}
          <p className="fix-consent">
            Compy never changes anything without your explicit approval — and every apply captures
            its undo first, so anything here rolls back from Applied.
          </p>
        </div>
      </header>
      )}

      {/* Worth making for your rig — the outstanding appliable recs, each with its trust-switch. */}
      {showFixes && (
      <>
      {/* V2-4b "Applied — drifted" group FIRST: a regression on something you already chose
          outranks new tweaks (it's where the old drift limiter card sat). ONE row per drifted
          rec — same SlimFixRow, same audited onToggleRec apply path; the group intro carries the
          drift state, GameModeNote carries the won't-stick specifics on its row. */}
      {v2Ia && drifted.length > 0 && (
        <>
          <div className="fix-section-label">Applied — turned off outside Compy</div>
          <p className="fix-refuse-intro">
            You turned {drifted.length === 1 ? "this" : "these"} on with Compy; something outside
            Compy switched {drifted.length === 1 ? "it" : "them"} back off. Flip{" "}
            {drifted.length === 1 ? "it" : "any"} back on — or leave it, your call. Compy never
            re-applies on its own.
          </p>
          <ul className="fix-list">
            {drifted.map((rec) => (
              <SlimFixRow
                key={rec.id}
                rec={rec}
                vendor={vendor}
                gameModeReverted={gameModeReverted}
                applied={false}
                activeChange={undefined}
                busy={rowBusy(rec)}
                onToggle={() => onToggleRec(rec.id)}
                onWhatsThis={onOpenLibrary}
                onDismiss={dismiss}
              />
            ))}
          </ul>
        </>
      )}
      {/* V2-4b: the ready head disappears with its rows — a group label over nothing (the case
          where the room's only pending fix is in the drifted group above) is noise, not order. */}
      {!(v2Ia && readyRows.length === 0 && drifted.length > 0) && (
        <div className="fix-section-label">
          {v2Ia ? "Ready — one click, reversible" : "Worth making for your rig"}
        </div>
      )}
      {safeBatch.length >= 2 && (
        <div className="fix-applyall-bar">
          <button className="fix-applyall" onClick={openSheet}>
            {slim ? `Apply reviewed (${safeBatch.length})` : `Apply all safe fixes (${safeBatch.length})`}
          </button>
          <span className="fix-applyall-hint">reversible · one undo each · cleaner setup, not a magic boost</span>
        </div>
      )}
      {batchSummary && (
        <p className="fix-applyall-summary" role="status">
          Applied {batchSummary.applied}
          {batchSummary.skipped.length > 0 &&
            ` · ${batchSummary.skipped.length} skipped: ${batchSummary.skipped
              .map((s) => s.title)
              .join(", ")}`}
          . Each is individually reversible below.
        </p>
      )}
      {readyRows.length === 0 ? (
        // With a drifted group above, "already dialed in" would be false — the group head + intro
        // already said what's up, so the empty line renders only when there's truly nothing.
        // One phrase, one owner: the living subtitle already says "dialed in" — this line
        // states the fact without restating it.
        drifted.length === 0 && (
          <p className="fix-empty">Nothing waiting — no changes to make on this rig right now.</p>
        )
      ) : (
        <ul className="fix-list">
          {readyRows.map((rec) =>
            slim ? (
              // Slim master-detail row (P1): 8 → 3 visible affordances; same TrustSwitch, same
              // audited onToggleRec path; everything else in the in-place detail panel.
              <SlimFixRow
                key={rec.id}
                rec={rec}
                vendor={vendor}
                gameModeReverted={gameModeReverted}
                applied={false}
                activeChange={undefined}
                busy={rowBusy(rec)}
                onToggle={() => onToggleRec(rec.id)}
                onWhatsThis={onOpenLibrary}
                onDismiss={dismiss}
              />
            ) : (
              <FixRow
                key={rec.id}
                rec={rec}
                vendor={vendor}
                gameModeReverted={gameModeReverted}
                applied={false}
                activeChange={undefined}
                busy={rowBusy(rec)}
                onToggle={() => onToggleRec(rec.id)}
                onWhatsThis={onOpenLibrary}
                onDismiss={dismiss}
                onOpenDrawer={
                  dashV2
                    ? () =>
                        setDrawer({
                          rec: { id: rec.id, title: rec.title, description: rec.description, impact: rec.impact, provenance: rec.provenance },
                          applied: false,
                          primary: () => onToggleRec(rec.id),
                        })
                    : undefined
                }
              />
            ),
          )}
        </ul>
      )}

      {/* §4 consent sheet — the ONE consent for the batch. Lists every item + its one-line change;
          approve → sequential apply (per-item receipts, failure isolation). Copy never promises a boost.
          Backdrop/modal classes are doorknob-sanctioned for their close handlers. */}
      {sheetOpen && (
        <div
          className="fix-applyall-backdrop"
          onClick={() => {
            if (!batching) setSheetOpen(false);
          }}
        >
          <div
            className="fix-applyall-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="fix-applyall-h"
          >
            <h3 id="fix-applyall-h" className="fix-applyall-h">
              Apply these {slim ? sheetSelected.size : safeBatch.length} changes to your rig?
            </h3>
            <p className="fix-applyall-note">
              Each is reversible — Compy snapshots the prior state and writes a separate undo for every
              one. These tidy up your setup — not a performance boost.
              {slim &&
                " Recommended arrive ticked — untick anything you don't want; only what's ticked changes."}
            </p>
            <ul className="fix-applyall-list">
              {safeBatch.map((r) =>
                slim ? (
                  // §8c: pre-selected Recommended with one-tap deselect — the ticked list IS the
                  // consent screen. Apply below stays the explicit act (selection ≠ application).
                  <li key={r.id} className="fix-applyall-item">
                    <label className="fix-applyall-pick">
                      <input
                        type="checkbox"
                        checked={sheetSelected.has(r.id)}
                        disabled={batching}
                        onChange={() => toggleSheetItem(r.id)}
                        aria-label={`Include ${r.title}`}
                      />
                      <span className="fix-applyall-pick-text">
                        <span className="fix-applyall-item-title">{r.title}</span>
                        <span className="fix-applyall-item-what">{r.impact}</span>
                      </span>
                    </label>
                  </li>
                ) : (
                  <li key={r.id} className="fix-applyall-item">
                    <span className="fix-applyall-item-title">{r.title}</span>
                    <span className="fix-applyall-item-what">{r.impact}</span>
                  </li>
                ),
              )}
            </ul>
            <div className="fix-applyall-actions">
              <button
                className="fix-applyall-cancel"
                disabled={batching}
                onClick={() => setSheetOpen(false)}
              >
                Cancel
              </button>
              <button
                className="fix-applyall-go"
                disabled={batching || (slim && sheetSelected.size === 0)}
                onClick={runApplyAll}
              >
                {batching
                  ? "Applying…"
                  : slim
                    ? `Apply selected (${sheetSelected.size})`
                    : `Apply all (${safeBatch.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
      </>
      )}

      {/* Active on this PC (ledger Layer 1) — what Compy is currently doing, deduped, ghost rollback.
          Answers Sarah's only question: "what is Compy doing to my machine right now?" */}
      {showActive && active.length > 0 && (
        <>
          <div className="fix-section-label">Active on this PC</div>
          <ul className="fix-list">
            {active.map((c) => (
              <ActiveChangeCard
                key={c.id}
                change={c}
                busy={busyId !== null}
                onRollback={() => onRollback(c)}
                onWhatsThis={onOpenLibrary}
                onOpenDrawer={
                  dashV2
                    ? () =>
                        setDrawer({
                          rec: { id: c.rec_id, title: c.rec_title },
                          applied: true,
                          restoresLabel: c.restores_label,
                          primary: () => onRollback(c),
                        })
                    : undefined
                }
              />
            ))}
          </ul>
        </>
      )}

      {/* Honest empty state for the ledger room (P5.5) — the Applied segment must never be a bare
          empty room; say plainly that nothing is active and where applies will land. Scoped to the
          ledger/applied views so standalone Tune (view="all") renders exactly as before. */}
      {(view === "applied" || view === "ledger") && active.length === 0 && (
        <p className="fix-empty">
          Nothing active on this PC — anything Compy applies shows up here with one-tap undo.
        </p>
      )}

      {/* History (ledger Layer 2) — the complete audit trail, collapsed; click a row for its
          receipt. Rolled-back + superseded entries stay, muted. */}
      {showHistory && history.length > 0 && (
        <CollapsibleSection title="History" count={visibleHistory.length} tint="applied">
          <p className="fix-refuse-intro">
            The complete trail — applied, rolled back, superseded. Click any row for its receipt.
          </p>
          {/* A5 "this rig only" — rendered ONLY when some entry is KNOWN to be from other
              hardware (a filter with nothing to filter is noise). Hides exactly the entries whose
              stamp mismatches today's rig; legacy unstamped entries always stay visible. */}
          {otherRigCount > 0 && (
            <label className="fix-rig-filter">
              <input
                type="checkbox"
                checked={thisRigOnly}
                onChange={(e) => chooseThisRigOnly(e.target.checked)}
              />
              This rig only
              {thisRigOnly && (
                <span className="fix-rig-hidden">
                  {otherRigCount} from other hardware hidden
                </span>
              )}
            </label>
          )}
          <ul className="fix-list">
            {visibleHistory.map((c) => (
              <HistoryRow key={c.id} change={c} />
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {showFixes && (
      <>
      {/* Side-piles (P5 calm chrome): under the merged shell's provider the three "leave it alone"
          sections below teleport into the single "Nothing else needs attention" expander; classic/
          standalone render here as always. Moved, never removed — same content and reasons. */}
      {/* Not for this rig — hardware-ineligible recs (eligibility train): set aside with the reason,
          and OUT of the completion denominator, so they never block "all handled" or nag. */}
      {notForThisRig.length + overriddenRecs.length > 0 && (
        <SidePileItem order={SIDE_PILE_ORDER.notForThisRig}>
        <CollapsibleSection title="Not for this rig" count={notForThisRig.length} tint="refuse">
          <p className="fix-refuse-intro">
            Compy detected these don't apply to your hardware — set aside, and left out of your
            "all handled" count. If a hardware read is wrong (a dock, an adapter, a new part),
            you can override it.
          </p>
          <ul className="fix-list">
            {notForThisRig.map((r) => (
              <li key={r.id} className="fix-refuse-row">
                <div className="fix-row-head">
                  <RecTitle id={r.id} title={r.title} />
                </div>
                <p className="fix-row-reason">
                  {r.ineligible_reason ?? "Not applicable to this rig's hardware."}
                </p>
                {/* A5 override — reversible; the rec rejoins the normal list through the SAME
                    audited apply path. The user is asserting the detection, not skipping safety. */}
                <button className="fix-dismiss" onClick={() => override(r.id)}>
                  My hardware supports this — show it anyway
                </button>
              </li>
            ))}
            {overriddenRecs.map((r) => (
              <li key={r.id} className="fix-refuse-row">
                <div className="fix-row-head">
                  <RecTitle id={r.id} title={r.title} />
                  <span className="fix-override-chip">overridden by you</span>
                </div>
                <p className="fix-row-reason">
                  Treated as eligible — it now appears in your list. Compy's read was:{" "}
                  {r.ineligible_reason ?? "not applicable to this rig's hardware."}
                </p>
                <button className="fix-dismiss" onClick={() => clearOverride(r.id)}>
                  Set aside again
                </button>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
        </SidePileItem>
      )}

      {/* Dismissed — what you deliberately declined ("Not for me"). Reversible; out of the active
          denominator but one tap from restore, so a 100% reached by dismissing is a LABELED 100%. */}
      {dismissedRecs.length > 0 && (
        <SidePileItem order={SIDE_PILE_ORDER.dismissed}>
        <CollapsibleSection title="Dismissed" count={dismissedRecs.length} tint="applied">
          <p className="fix-refuse-intro">
            You set these aside. They're out of your active count — restore any one anytime.
          </p>
          {/* A5 override-all: one control to undo every "Not for me" at once, so a user who
              dismissed a pile while setting up isn't stuck tapping Restore row by row. Shown only
              with 2+ dismissed (a single per-row Restore already covers one). Reversible. */}
          {dismissedRecs.length >= 2 && (
            <div className="fix-applyall-bar">
              <button
                className="fix-restore"
                onClick={() => dismissedRecs.forEach((r) => restore(r.id))}
              >
                Restore all ({dismissedRecs.length})
              </button>
              <span className="fix-applyall-hint">
                brings every dismissed item back into your active list
              </span>
            </div>
          )}
          <ul className="fix-list">
            {dismissedRecs.map((r) => (
              <li key={r.id} className="fix-row">
                <div className="fix-row-main">
                  <div className="fix-row-head">
                    <RecTitle id={r.id} title={r.title} />
                  </div>
                  <RecReason id={r.id} text={r.impact || r.description} />
                </div>
                <button className="fix-restore" onClick={() => restore(r.id)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
        </SidePileItem>
      )}

      {/* Not worth touching — the refuse-pile. What Compy won't do, and why, with the autopsy link. */}
      <SidePileItem order={SIDE_PILE_ORDER.refusePile}>
      <CollapsibleSection
        title={view === "fixes" ? "Deliberately refused" : "Not worth touching"}
        count={REFUSE_PILE.length}
        tint="refuse"
        icon={<ShieldOff />}
      >
        <p className="fix-refuse-intro">
          Popular tweaks Compy deliberately refuses — the reason for each, with the full
          autopsy a click away.
        </p>
        <ul className="fix-list">
          {REFUSE_PILE.map((r) => (
            <li key={r.id} className="fix-refuse-row">
              <div className="fix-row-head">
                <span className="fix-row-title">{r.name}</span>
              </div>
              <p className="fix-row-reason">{r.why}</p>
              <ExpertTargetLine id={r.id} />
              <button className="fix-autopsy" onClick={() => onOpenLibrary(r.id)}>
                Read the autopsy →
              </button>
            </li>
          ))}
        </ul>
      </CollapsibleSection>
      </SidePileItem>

      {/* Guided / advisory — Compy detects but won't auto-apply; the full where + steps + the
          allowlisted "Open it" deep link live right here (no need to fall back to classic Optimize). */}
      {advisory.length > 0 &&
        (v2Ia ? (
          // V2-4b: elevated to an open, labeled group — these are real actions (the owner's
          // "cold and insignificant" catch was burial, not insignificance), grouped by what
          // they need from you: a judgment call + a few steps outside Compy.
          <>
            <div className="fix-section-label">Needs your call</div>
            <p className="fix-refuse-intro">
              Detected, but Compy won't change these for you — they live in a vendor app or a
              Windows page with no safe, reversible switch. Here's exactly where each one lives,
              with the steps.
            </p>
            <ul className="fix-list">
              {advisory.map((rec) => (
                <GuidedRow key={rec.id} rec={rec} vendor={vendor} onDismiss={dismiss} onWhatsThis={onOpenLibrary} />
              ))}
            </ul>
          </>
        ) : (
          <CollapsibleSection title="Compy points the way" count={advisory.length}>
            <p className="fix-refuse-intro">
              Detected, but Compy won't change these for you — they live in a vendor app or a Windows
              page with no safe, reversible switch. Here's exactly where each one lives, with the steps.
            </p>
            <ul className="fix-list">
              {advisory.map((rec) => (
                <GuidedRow key={rec.id} rec={rec} vendor={vendor} onDismiss={dismiss} onWhatsThis={onOpenLibrary} />
              ))}
            </ul>
          </CollapsibleSection>
        ))}

      {/* Startup apps — user-scope auto-start entries; toggle off to stop them launching with Windows. */}
      {startup.length > 0 && (
        <CollapsibleSection title="Startup apps" count={startup.length}>
          <p className="fix-refuse-intro">
            Apps that launch with Windows. Toggle one off to keep it from auto-starting — reversible,
            nothing is deleted.
          </p>
          <ul className="fix-list">
            {startup.map((entry) => (
              <StartupRow
                key={entry.name}
                entry={entry}
                busy={busyId === `startup:${entry.name}`}
                onToggle={() => onToggleStartup(entry)}
              />
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {/* Telemetry-task disable (Phase B, ARMED) — curated CEIP tasks; reversible via the Trust Ledger. */}
      <DebloatTasks onWhatsThis={onOpenLibrary} activeChangeFor={activeChangeFor} />
      <PreloadApps />
      </>
      )}

      {/* The Action Drawer is opened from either side (fixes rows + active-change cards), so it stays
          mounted in every view; it self-gates on the `drawer` state. */}
      {drawer && (
        <ActionDrawer
          rec={drawer.rec}
          applied={drawer.applied}
          busy={busyId !== null}
          restoresLabel={drawer.restoresLabel}
          onApply={() => {
            drawer.primary();
            setDrawer(null);
          }}
          onRollback={() => {
            drawer.primary();
            setDrawer(null);
          }}
          onClose={() => setDrawer(null)}
        />
      )}
    </section>
  );
}
