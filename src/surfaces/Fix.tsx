import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeLedger } from "../data/ledger-write";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { AppliedChange, StartupEntry, TrialLink } from "../types";
import { keptOutsideCompy } from "../types";
import {
  LedgerHealthNotice,
  knownIncomplete,
  useLedgerHealth,
} from "../design/LedgerHealthNotice";
import { TrustSwitch, TrustSnapshotLine } from "../design/TrustSwitch";
import { WhatsThis } from "../design/WhatsThis";
import { WalkthroughDisclosure } from "../design/WalkthroughDisclosure";
import { walkthroughForKeyForLanguage, type GpuVendor } from "./walkthroughs";
import { useDismissed } from "./dismissed";
import { useEligibilityOverrides } from "./eligibility-override";
import { GUIDED_STEPS, openGuidedUri } from "./guided";
import { friendlyLabel } from "../data/friendly-labels";
import { hasUndo, liveChangeGroups } from "../data/live-changes";
import { expertTarget, EXPERT_TARGET_DISCLAIMER } from "../data/expert-targets";
import { useExpertView } from "../design/use-expert-view";
import { PROVENANCE_LABEL, PROVENANCE_NOTE } from "../data/provenance";
import { recMutation } from "../data/rec-mutations";
import { slimProofLine } from "../data/slim-proof";
import { SlimRecRow, SlimDetailRow } from "../design/SlimRecRow";
import { ActionDetailsSheet, type ActionRec } from "./ActionDetails";
import { Sheet } from "../design/bento";
import { gameModeRevertedExternally } from "./dashboard-data";
import { SidePileItem, SIDE_PILE_ORDER } from "./side-pile";
// Side-effect import: guarantees the i18next singleton is initialized even when this component
// is the first (or only) thing a test/entry point loads — mirrors main.tsx's own `import "./i18n"`.
import i18n from "../i18n";
import { humanizeWhen as humanizeWhenIn } from "../data/humanize-when";
import "./Fix.css";

// Whether the Living Instrument preview is on (DOM-read; the surface re-renders fresh on navigation,
// so a toggle in Settings is reflected when you return here). Drives the plain-language rec titles.
function livingOn(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.living === "on";
}
// Dashboard-energy preview — gates the action details sheet ("Details ›" → the popout that shows
// exactly what a tweak touches). DOM-read; the surface re-renders fresh on navigation.
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
  const { t } = useTranslation();
  if (!label) return null;
  return (
    <span className="fix-payoff" title={t("optimize.fix.payoffMeterTitle")}>
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
  // App's refresh, run after a ledger write this surface makes itself (telemetry-task disable,
  // preinstalled-app removal) so App's changes/recs and the Machine Model re-read (#619). Optional:
  // callers that never show those sections pass nothing.
  onChanged?: () => Promise<unknown> | void;
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

// Humanized timestamp (ledger §2): "3 days ago · 6:08 AM", never raw seconds. Buckets by local
// calendar day and formats in the app's language (CR-hist-today; data/humanize-when.ts).
function humanizeWhen(iso: string, t: TFunction): string {
  return humanizeWhenIn(iso, t, i18n.language);
}

// Labels come from the shared provenance source of truth so they can't drift from the
// Home limiter / action-details wording; the CSS class stays local to this surface.
const EVIDENCE: Record<Rec["provenance"], { label: string; cls: string }> = {
  verified: { label: PROVENANCE_LABEL.verified, cls: "verified" },
  "measured-signal": { label: PROVENANCE_LABEL["measured-signal"], cls: "measured" },
  "expected-impact": { label: PROVENANCE_LABEL["expected-impact"], cls: "expected" },
};

// The refuse-pile (spec §2 v1 trio). Calm one-liners consistent with tweaks.json verdicts; each
// links to its Library autopsy. Educates, never shames — no fear-tone.
const REFUSE_PILE: { id: string }[] = [
  { id: "useplatformclock" },
  { id: "pagefile-disable" },
  { id: "disable-defender" },
];
// id → the i18n key segment for its name/why pair (see optimize.fix.refusePile.* in the locale JSON).
const REFUSE_PILE_KEY: Record<string, string> = {
  useplatformclock: "forceHpet",
  "pagefile-disable": "pagefileDisable",
  "disable-defender": "disableDefender",
};

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
  const { t } = useTranslation();
  if (id !== "game-mode") return null;
  if (reverted) {
    return (
      <p className="fix-amd-note">
        {t("optimize.fix.gameModeRevertedNote")}
      </p>
    );
  }
  if (vendor === "amd") {
    return (
      <p className="fix-amd-note">
        {t("optimize.fix.gameModeAmdNote")}
      </p>
    );
  }
  return null;
}

// The rect a popout should grow out of: the whole ROW, falling back to the control itself if the
// row can't be found. Handed to <Sheet origin>, which measures against it so the panel expands from
// the thing you clicked instead of fading in from nowhere (see design/bento/Sheet.tsx).
function rowOrigin(el: HTMLElement): DOMRect {
  return (el.closest("li") ?? el).getBoundingClientRect();
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
  onOpenDetails,
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
  onOpenDetails?: (origin: DOMRect) => void;
  vendor?: GpuVendor;
  gameModeReverted?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <li className="fix-row">
      <div className="fix-row-main">
        <div className="fix-row-head">
          <RecTitle id={rec.id} title={rec.title} />
          <EvidenceChip p={rec.provenance} />
          <WhatsThis id={rec.id} onOpen={onWhatsThis} />
          {onOpenDetails && (
            // The rect of the ROW, not the button: the sheet grows out of the thing you opened,
            // which is what keeps a popout reading as the same object rather than a new place.
            <button className="fix-details" onClick={(e) => onOpenDetails(rowOrigin(e.currentTarget))} title={t("optimize.fix.seeExactlyWhatChanges")} aria-label={t("optimize.fix.seeExactlyWhatChanges")}>
              {t("optimize.fix.detailsArrow")}
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
            {t("optimize.fix.notForMe")}
          </button>
        )}
      </div>
      <TrustSwitch
        applied={applied}
        busy={busy}
        onToggle={onToggle}
        ariaLabel={t("optimize.fix.toggleAriaLabel", {
          action: applied ? t("optimize.fix.rollBack") : t("optimize.fix.apply"),
          title: rec.title,
        })}
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
  const { t, i18n } = useTranslation();
  const mut = recMutation(rec.id);
  const walkthrough = walkthroughForKeyForLanguage(rec.id, i18n.language);
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
          ariaLabel={t("optimize.fix.toggleAriaLabel", {
            action: applied ? t("optimize.fix.rollBack") : t("optimize.fix.apply"),
            title: rec.title,
          })}
        />
      }
    >
      {why && <SlimDetailRow k={t("optimize.fix.whyItMatters")} v={why} />}
      <SlimDetailRow
        k={t("optimize.fix.evidence")}
        v={
          <>
            <EvidenceChip p={rec.provenance} /> {PROVENANCE_NOTE[rec.provenance]}
          </>
        }
      />
      <SlimDetailRow
        k={t("optimize.fix.whatChanges")}
        v={
          mut
            ? `${mut.changes}${mut.elevated ? ` ${t("optimize.fix.needsAdminOk")}` : ""}${
                mut.restart ? ` ${t("optimize.fix.takesEffectAfterRestart")}` : ""
              }`
            : t("optimize.fix.singleScopedSettingFallback")
        }
      />
      <SlimDetailRow
        k={t("optimize.fix.undo")}
        v={mut?.reverts ?? t("optimize.fix.revertsFallback")}
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
          <WalkthroughDisclosure
            label={t("optimize.fix.showMeTheWay")}
            walkthrough={walkthrough}
            vendor={vendor ?? "any"}
          />
        )}
        <WhatsThis id={rec.id} onOpen={onWhatsThis} />
        {/* Deliberate, reversible decline — applied rows can't be dismissed (roll back instead). */}
        {!applied && (
          <button className="fix-dismiss" onClick={() => onDismiss(rec.id)}>
            {t("optimize.fix.notForMe")}
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
  const preferenceBaseline = expert || !!defaultOpen;
  const [open, setOpen] = useState(preferenceBaseline);
  const previousBaseline = useRef(preferenceBaseline);
  useEffect(() => {
    // Initial state already reflects the preference. Writing it again from the mount effect can
    // race and overwrite the first click on a section that appears after an async probe.
    if (previousBaseline.current === preferenceBaseline) return;
    previousBaseline.current = preferenceBaseline;
    setOpen(preferenceBaseline);
  }, [preferenceBaseline]);
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
const DEBLOAT_TASKS: { id: string }[] = [
  { id: "compatibility-appraiser" },
  { id: "ceip-consolidator" },
  { id: "ceip-usb" },
];
// id → the i18n key segment for its label/what pair (translated display text keeps the id-keyed
// Rust allowlist above untouched — see optimize.fix.debloatTasks.* in the locale JSON).
const DEBLOAT_TASK_KEY: Record<string, string> = {
  "compatibility-appraiser": "compatibilityAppraiser",
  "ceip-consolidator": "ceipConsolidator",
  "ceip-usb": "ceipUsb",
};

// App's refresh after one of the two writes below. By the time it runs the change is made, recorded
// and announced, so a refresh that fails is reported as exactly that and never as a refused change:
// the row keeps its done state (#619). App's own refresh already raises its banner for a read that
// fails; this is for whatever it lets through.
const refreshAfterWrite = async (refresh?: () => Promise<unknown> | void) => {
  try {
    await refresh?.();
  } catch (e) {
    console.error("[compy fix]", "the change was made and recorded, but the refresh after it failed", e);
  }
};

// Self-contained: runs the gated `disable_known_bloat_task` command through `writeLedger`; the applied
// change shows in the Trust Ledger (History) where it can be rolled back (re-enables the task).
function DebloatTasks({
  onWhatsThis,
  activeChangeFor,
  onChanged,
}: {
  onWhatsThis: (id: string) => void;
  onChanged?: () => Promise<unknown> | void;
  // Derive the "Disabled" state from the Trust Ledger, not just this render's local state: an applied
  // disable lands under rec_id `bloat-task:<id>`, so a persisted (still-active, not rolled-back) change
  // means the task stays off across remount/nav. Local `state` only carries THIS session's fresh click
  // + any error text; the ledger is the durable truth (mirrors the toggle-row rows' activeChangeFor use).
  activeChangeFor: (recId: string) => AppliedChange | undefined;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, "done" | string>>({});
  // Once the ledger shows a disable made here, the ledger alone answers for that row (codebase review
  // 2026-11-02): the Optimize station mounts two Fix views, and an undo in one (or in History) left
  // the other reading "Disabled" with its button spent. Until the ledger shows it (a refresh that
  // failed, #619), this click's own "done" holds the row.
  const ledgerHas = DEBLOAT_TASKS.filter((task) => state[task.id] === "done" && !!activeChangeFor(`bloat-task:${task.id}`))
    .map((task) => task.id)
    .join(",");
  useEffect(() => {
    if (!ledgerHas) return;
    const ids = ledgerHas.split(",");
    setState((s) => Object.fromEntries(Object.entries(s).filter(([id, v]) => !(v === "done" && ids.includes(id)))));
  }, [ledgerHas]);
  const disable = async (id: string) => {
    setBusy(id);
    try {
      // The command alone: only its own failure means nothing changed.
      await writeLedger("disable_known_bloat_task", { taskId: id });
      setState((s) => ({ ...s, [id]: "done" }));
    } catch {
      // Plain-English, not the raw Rust string: this is an ARMED mutation, so make clear nothing changed.
      setState((s) => ({
        ...s,
        [id]: t("optimize.fix.debloatFailed"),
      }));
      return;
    } finally {
      setBusy(null);
    }
    await refreshAfterWrite(onChanged);
  };
  return (
    <CollapsibleSection title={t("optimize.fix.telemetryTasks")} count={DEBLOAT_TASKS.length}>
      <p className="fix-refuse-intro">
        {t("optimize.fix.telemetryTasksIntro")}{" "}
        <WhatsThis id="telemetry" onOpen={onWhatsThis} />
      </p>
      <ul className="fix-list">
        {DEBLOAT_TASKS.map((task) => {
          const st = state[task.id];
          // Persisted (ledger) OR just-clicked this session. The ledger read survives remount/nav —
          // the row no longer reverts to "Disable" after leaving and returning while the task stays off.
          const done = !!activeChangeFor(`bloat-task:${task.id}`) || st === "done";
          const err = st && st !== "done" ? st : null;
          const key = DEBLOAT_TASK_KEY[task.id];
          return (
            <li className="fix-row fix-row-advisory" key={task.id}>
              <div className="fix-row-main">
                <span className="fix-row-title fix-row-title-friendly">
                  <span className="fix-row-headline">{t(`optimize.fix.debloatTasks.${key}.label`)}</span>
                  <span className="fix-row-tech">{t(`optimize.fix.debloatTasks.${key}.what`)}</span>
                </span>
                {err && <p className="fix-row-reason fix-row-error">{err}</p>}
              </div>
              <button className="btn btn-small" disabled={busy === task.id || done} onClick={() => disable(task.id)}>
                {done ? t("optimize.fix.disabledUndoInHistory") : busy === task.id ? t("optimize.fix.disablingEllipsis") : t("optimize.fix.disable")}
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
export const PRELOAD_APPS: { id: string }[] = [
  { id: "solitaire-collection" },
  { id: "feedback-hub" },
  { id: "bing-news" },
  { id: "office-hub" },
  // Spotify cut by owner curation 2026-07-06 — same package id as a real install, no honest "stub" copy.
];
// id → the i18n key segment for its label/what pair (see optimize.fix.preloadApps.* in the locale
// JSON) — keeps the Rust-allowlist-matching ids above untranslated.
const PRELOAD_APP_KEY: Record<string, string> = {
  "solitaire-collection": "solitaireCollection",
  "feedback-hub": "feedbackHub",
  "bing-news": "bingNews",
  "office-hub": "officeHub",
};

// Renders NOTHING unless the backend reports the feature armed AND at least one curated app is
// installed for this user — so shipping it dark changes zero pixels (no flag needed; the gate IS
// the switch, and the same probe lights the card up the commit the gate arms).
function PreloadApps({ onChanged }: { onChanged?: () => Promise<unknown> | void }) {
  const { t } = useTranslation();
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
      // The command alone: only its own failure means nothing changed.
      await writeLedger("remove_known_preload_app", { appId: id });
      setState((s) => ({ ...s, [id]: "done" }));
    } catch {
      // Plain-English, honest: nothing changed on a refusal/failure.
      setState((s) => ({
        ...s,
        [id]: t("optimize.fix.preloadRemoveFailed"),
      }));
      return;
    } finally {
      setBusy(null);
    }
    await refreshAfterWrite(onChanged);
  };
  return (
    <CollapsibleSection title={t("optimize.fix.preinstalledApps")} count={rows.length}>
      <p className="fix-refuse-intro">
        {t("optimize.fix.preinstalledAppsIntro")}
      </p>
      <ul className="fix-list">
        {rows.map((a) => {
          const st = state[a.id];
          const done = st === "done";
          const err = st && st !== "done" ? st : null;
          const key = PRELOAD_APP_KEY[a.id];
          return (
            <li className="fix-row fix-row-advisory" key={a.id}>
              <div className="fix-row-main">
                <span className="fix-row-title fix-row-title-friendly">
                  <span className="fix-row-headline">{t(`optimize.fix.preloadApps.${key}.label`)}</span>
                  <span className="fix-row-tech">{t(`optimize.fix.preloadApps.${key}.what`)}</span>
                </span>
                {err && <p className="fix-row-reason fix-row-error">{err}</p>}
              </div>
              <button className="btn btn-small" disabled={busy === a.id || done} onClick={() => remove(a.id)}>
                {done ? t("optimize.fix.removedUndoInHistory") : busy === a.id ? t("optimize.fix.removingEllipsis") : t("optimize.fix.remove")}
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
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const guide = GUIDED_STEPS[rec.id];
  const walkthrough = walkthroughForKeyForLanguage(rec.id, i18n.language);
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
          <span className="fix-guided-tag">{t("optimize.fix.guidedTag")}</span>
        </button>
        <RecReason id={rec.id} text={rec.impact || rec.description} />
        <ExpertTargetLine id={rec.id} />
        <div className="fix-advisory-quickacts">
          <WhatsThis id={rec.id} onOpen={onWhatsThis} />
          <button className="fix-dismiss" onClick={() => onDismiss(rec.id)}>
            {t("optimize.fix.notForMe")}
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
              <WalkthroughDisclosure
                label={t("optimize.fix.showMeTheWay")}
                walkthrough={walkthrough}
                vendor={vendor}
              />
            )}
          </div>
        )}
        {open && !guide && (
          <div className="fix-guided-detail">
            {/* An opened card ALWAYS answers — a door that opens onto nothing teaches users to
                stop clicking (J's exact conclusion). Honest: no safe switch exists; say where the
                deeper story lives. */}
            <p className="fix-guided-none">
              {t("optimize.fix.noSafeSwitchNote")}
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
  const { t } = useTranslation();
  return (
    <li className={`fix-startup-row ${!entry.enabled ? "fix-startup-off" : ""}`}>
      <div className="fix-row-main">
        <div className="fix-row-head">
          <span className="fix-row-title">{entry.name}</span>
        </div>
        <p className="fix-row-reason fix-startup-cmd">{entry.command || t("optimize.fix.noCommand")}</p>
      </div>
      <button
        className={`fix-startup-toggle ${entry.enabled ? "fix-startup-on" : ""}`}
        onClick={onToggle}
        disabled={busy}
        role="switch"
        aria-checked={entry.enabled}
        aria-label={t("optimize.fix.startupToggleAriaLabel", {
          action: entry.enabled ? t("optimize.fix.disable") : t("optimize.fix.enable"),
          name: entry.name,
        })}
      >
        <span className="fix-startup-track">
          <span className="fix-startup-thumb" />
        </span>
      </button>
    </li>
  );
}

// #638 (PR #634 follow-on): the live re-check said it could not read this change
// (`active_check` "unreadable"/"unrecognised"). The legacy `is_still_active` bool stays true for
// these on purpose, so the rollback card stays reachable, but they are not "active on this PC":
// Health and History say "can't confirm" for them, and so does this list. An absent field (an older
// payload) keeps the old reading.
function cantConfirmStillOn(c: Pick<AppliedChange, "active_check">): boolean {
  return c.active_check === "unreadable" || c.active_check === "unrecognised";
}

// Ledger Layer 1 — one card per CURRENTLY-ACTIVE change ("what is Compy doing to my machine?").
// Humanized "active since", a quiet GHOST rollback (outline; accent ink only on hover). Rollback
// BEHAVIOR is untouched — this calls the same audited onRollback.
function ActiveChangeCard({
  change,
  busy,
  onRollback,
  onWhatsThis,
  onOpenDetails,
}: {
  change: AppliedChange;
  busy: boolean;
  onRollback: () => void;
  onWhatsThis: (id: string) => void;
  onOpenDetails?: (origin: DOMRect) => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="fix-active-card">
      <div className="fix-row-main">
        <div className="fix-row-head">
          <RecTitle id={change.rec_id} title={change.rec_title} />
          <WhatsThis id={change.rec_id} onOpen={onWhatsThis} />
          {onOpenDetails && (
            <button className="fix-details" onClick={(e) => onOpenDetails(rowOrigin(e.currentTarget))} title={t("optimize.fix.seeExactlyWhatChanges")} aria-label={t("optimize.fix.seeExactlyWhatChanges")}>
              {t("optimize.fix.detailsArrow")}
            </button>
          )}
        </div>
        <p className="fix-row-reason">
          {cantConfirmStillOn(change)
            ? t("optimize.fix.appliedSinceCantConfirm", { when: humanizeWhen(change.applied_at, t) })
            : t("optimize.fix.activeSince", { when: humanizeWhen(change.applied_at, t) })}
          {change.restores_label && change.applied_label
            ? change.restores_label === change.applied_label
              ? t("optimize.fix.alreadyNoChangeNeeded", { label: change.applied_label })
              : t("optimize.fix.restoresToApplied", {
                  restores: change.restores_label,
                  applied: change.applied_label,
                })
            : change.restores_label
              ? t("optimize.fix.rollsBackTo", { restores: change.restores_label })
              : ""}
        </p>
        <PayoffMeter label={change.payoff_label} />
        {/* A5 "last seen working on" — an ACTIVE change stamped on different hardware is worth a
            quiet heads-up (it may behave differently on today's parts). Honest: only when the
            stamp is KNOWN to mismatch; legacy unstamped entries say nothing. */}
        {change.on_this_rig === false && change.hw_fingerprint && (
          <p className="fix-rig-note">
            {t("optimize.fix.lastSeenWorkingOnPre")}
            <strong>{rigLabel(change.hw_fingerprint, t)}</strong>
            {t("optimize.fix.lastSeenWorkingOnPost")}
          </p>
        )}
        {/* CR-footer-reversible: a row whose stored history resolves to no undo says so; its
            button stays visible but can't run (the footer counts it the same way). */}
        {!hasUndo(change) && <p className="fix-rig-note">{t("optimize.fix.noSavedUndo")}</p>}
      </div>
      <button className="fix-ghost-rollback" disabled={busy || !hasUndo(change)} onClick={onRollback}>
        {busy ? t("optimize.fix.rollingBackEllipsis") : t("optimize.fix.rollBack")}
      </button>
    </li>
  );
}

// A5 rig tagging: the short human name of a stamped rig ("RX 9070 XT · 32 GB RAM"). Only ever
// renders fields the stamp actually recorded — an empty GPU read stays honest.
function rigLabel(f: NonNullable<AppliedChange["hw_fingerprint"]>, t: TFunction): string {
  const gpu = f.gpu.trim() || t("optimize.fix.unknownGpu");
  return t("optimize.fix.rigLabelFormat", { gpu, ramGb: f.ram_gb });
}

// P5-outcomes-f1: "Applied/Undone because of your <outcome> Trial, <when>" for a row made from the
// Trial bench's outcome switch. Nothing for every other row.
function TrialReason({ link, kind }: { link?: TrialLink | null; kind: "applied" | "undone" }) {
  const { t } = useTranslation();
  if (!link) return null;
  const outcome = t(
    link.outcome === "max-fps"
      ? "lab.experimentBench.outcome.maxFps"
      : link.outcome === "smoothest"
        ? "lab.experimentBench.outcome.smoothest"
        : "lab.experimentBench.outcome.recommended",
  );
  const when = link.concluded_at ? humanizeWhen(link.concluded_at, t) : null;
  const text =
    kind === "applied"
      ? when
        ? t("optimize.fix.historyAppliedByTrial", { outcome, when })
        : t("optimize.fix.historyAppliedByTrialUndated", { outcome })
      : when
        ? t("optimize.fix.historyUndoneByTrial", { outcome, when })
        : t("optimize.fix.historyUndoneByTrialUndated", { outcome });
  return (
    <div className="fix-hist-trial" data-testid={`fix-hist-trial-${kind}`}>
      {text}
    </div>
  );
}

// Ledger Layer 2 — the full chronological audit trail (active + rolled-back + superseded), muted,
// each row expands to its typed receipt. Click to expand.
function HistoryRow({ change }: { change: AppliedChange }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // CR-outside-followups (b): an applied row the user recorded as changed outside Compy says so,
  // never "rolled back" (nothing was undone) and never "active" (it reads off).
  const keptOutside = keptOutsideCompy(change);
  // CR-kept-outside-nits (c): only an undo is "rolled back". A row still applied that reads off was
  // changed outside Compy and never undone, so it says it is off now, not undone.
  const rolledBack = !keptOutside && change.status === "rolled_back";
  // CR-core-parking-plan-gone: an undo that had nothing left to restore closed the row without
  // writing anything, so it says that, not "rolled back".
  const nothingRestored = rolledBack && change.nothing_restored ? change.nothing_restored : null;
  const offNow = !keptOutside && !rolledBack && !change.is_still_active;
  const unconfirmed = !keptOutside && !rolledBack && !offNow && cantConfirmStillOn(change);
  return (
    <li className={`fix-hist-row ${rolledBack ? "fix-hist-rolledback" : ""}`}>
      <button className="fix-hist-head cmp-door" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Chevron />
        <span className="fix-hist-title">{change.rec_title}</span>
        {/* A5 rig tag — only when the stamp says this entry is KNOWN to be from other hardware. */}
        {change.on_this_rig === false && (
          <span className="fix-hist-rig-tag" title={t("optimize.fix.historyOtherRigTitle")}>
            {t("optimize.fix.historyOtherRigTag")}
          </span>
        )}
        <span className="fix-hist-when">{humanizeWhen(change.applied_at, t)}</span>
        <span className="fix-hist-status">
          {keptOutside
            ? t("optimize.fix.historyChangedOutside")
            : nothingRestored
              ? t("optimize.fix.historyNothingRestored")
              : rolledBack
              ? t("optimize.fix.historyRolledBack")
              : offNow
                ? t("optimize.fix.historyOffNow")
                : unconfirmed
                ? t("optimize.fix.historyCantConfirm")
                : t("optimize.fix.historyActive")}
        </span>
      </button>
      {open && (
        <div className="fix-hist-detail">
          {keptOutside && (
            <div data-testid="fix-hist-kept-outside">
              {t("optimize.fix.historyKeptOutside", {
                plan: keptOutside.observed.name,
                when: humanizeWhen(keptOutside.recorded_at, t),
              })}
            </div>
          )}
          {nothingRestored && (
            <div data-testid="fix-hist-nothing-restored">
              {/* The one reason this build writes; any other reason still says nothing was restored. */}
              {nothingRestored.reason === "plan-gone"
                ? t("optimize.fix.historyNothingRestoredPlanGone")
                : t("optimize.fix.historyNothingRestored")}
            </div>
          )}
          {change.restores_label && change.applied_label ? (
            change.restores_label === change.applied_label ? (
              <div>
                {t("optimize.fix.historyAlreadyPre")}
                <strong>{change.applied_label}</strong>
                {t("optimize.fix.historyAlreadyPost")}
              </div>
            ) : (
              <div>
                {t("optimize.fix.historyBeforePrefix")}
                <strong>{change.restores_label}</strong>
                {t("optimize.fix.historyAfterMid")}
                <strong>{change.applied_label}</strong>
              </div>
            )
          ) : change.restores_label ? (
            <div>
              {t("optimize.fix.historyRestoresPrefix")}
              <strong>{change.restores_label}</strong>
            </div>
          ) : (
            change.applied_label && (
              <div>
                {t("optimize.fix.historySetToPrefix")}
                <strong>{change.applied_label}</strong>
              </div>
            )
          )}
          <div>
            {t("optimize.fix.historyAppliedPrefix")}
            {humanizeWhen(change.applied_at, t)}
            {change.elevation_used ? t("optimize.fix.historyElevatedSuffix") : ""}
          </div>
          {/* A5 rig tagging: where this change was applied. Legacy entries (no stamp) show
              nothing rather than a guess. */}
          {change.hw_fingerprint && (
            <div>
              {change.on_this_rig === false
                ? t("optimize.fix.historyLastSeenWorkingOnLabel")
                : t("optimize.fix.historyAppliedOnLabel")}{" "}
              <strong>{rigLabel(change.hw_fingerprint, t)}</strong>
              {change.on_this_rig === false && t("optimize.fix.historyBeforeHwChangedSuffix")}
            </div>
          )}
          {change.payoff_label && (
            <div>
              {t("optimize.fix.historyMeasuredPayoffPrefix")}
              <PayoffMeter label={change.payoff_label} />
            </div>
          )}
          <TrialReason link={change.justified_by_experiment} kind="applied" />
          {rolledBack && <TrialReason link={change.rollback_justified_by_experiment} kind="undone" />}
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
  onChanged,
  view = "all",
  v2Ia = false,
  reverted = [],
}: Props) {
  const { t } = useTranslation();
  // Which section(s) of the surface to render — the merged Optimize shell drives this via segments;
  // standalone Tune leaves it "all" so the surface is unchanged. The two ledger layers gate
  // independently so Applied (active only) and History (full trail only) are distinct views.
  const showFixes = view === "all" || view === "fixes";
  const showActive = view === "all" || view === "ledger" || view === "applied";
  const showHistory = view === "all" || view === "ledger" || view === "history";
  // Whether the ledger rendered below is the WHOLE story. Keyed on `changes` — a fresh array
  // identity from IPC on every refresh — so health is read on the same tick as the rows the user is
  // actually looking at, with no prop drilled through the three shells that mount this surface.
  // Shared with the Blackbook Logbook, which renders the same claim off the same file; see
  // `design/LedgerHealthNotice.tsx` for why UNKNOWN is neither complete nor incomplete.
  const health = useLedgerHealth(changes);
  const ledgerIncomplete = knownIncomplete(health);
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
  // `null` = closed. Open carries the rect of the bar button so the consent sheet grows out of it.
  const [sheetOrigin, setSheetOrigin] = useState<DOMRect | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [batching, setBatching] = useState(false);
  // Slim master-detail rows are the Fixes segment's one look (P4 dedup); standalone Tune
  // (view="all", the compy_optimize escape hatch) keeps the classic FixRow list.
  const slim = view === "fixes";
  // §8c (owner decision 2026-07-01, slim mode only): the batch consent sheet arrives with every
  // Recommended (safe-tier) row SELECTED — one-tap deselect; the ticked list IS exactly what will
  // change. Selection ≠ application: Apply stays the explicit act. NO auto-apply on render, ever.
  const [sheetSelected, setSheetSelected] = useState<Set<string>>(new Set());
  const openSheet = (origin: DOMRect | null) => {
    if (slim) setSheetSelected(new Set(safeBatch.map((r) => r.id)));
    setSheetOrigin(origin);
    setSheetOpen(true);
  };
  const toggleSheetItem = (id: string) =>
    setSheetSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Escape / backdrop / close are the Sheet's now (popout convergence 2026-08-13) — this surface
  // used to hand-roll all three, plus its own keydown listener. What it still owns is the ONE rule
  // the Sheet can't know: never dismiss mid-apply. That rides in as `dismissible={!batching}` on
  // the sheet below, with this second check as belt-and-braces on the close path itself.
  const closeSheet = () => {
    if (!batching) setSheetOpen(false);
  };
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

  // Ledger §2 — Layer 1: currently-active changes, ONE per change (the same tweak applied/rolled
  // back N times shows as one card, not N rows), split into on and can't-confirm (#638). The split
  // is `liveChangeGroups`, the one definition Health's count and History's undo route share (#453),
  // so this list's length is the number Health prints.
  const { active, cantConfirm: unconfirmedActive } = useMemo(() => liveChangeGroups(changes), [changes]);
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
  // apply's mutation, corrupting the rollback chain. This matches the details sheet's own guard
  // (`busy={busyId !== null}`) and the row `busy` prop only disables (no misleading per-row spinner).
  const rowBusy = (_rec: Rec) => busyId !== null;
  const living = livingOn();
  const dashV2 = dashOn();
  // Action-details state: the rec/change to present, the row it was opened from (so the sheet grows
  // out of it), and how its primary action resolves (apply vs roll back).
  const [details, setDetails] = useState<
    null | {
      rec: ActionRec;
      applied: boolean;
      origin: DOMRect | null;
      restoresLabel?: string | null;
      /** CR-undo-entry-disable: opened from a live change whose stored history resolves to no undo. */
      noUndo?: boolean;
      primary: () => void;
    }
  >(null);

  return (
    <section className="fix-root">
      {showFixes && (
      <header className="fix-header">
        <div>
          {/* In the merged Optimize "Fixes" segment (view="fixes"), the segment label already names
              the surface — suppress the standalone "Tune" tab-title to avoid stacked redundant headings
              (Check's title is suppressed the same way). Standalone Tune (view="all") keeps it. */}
          {view !== "fixes" && <h2 className="fix-title">{t("common.rail.fix")}</h2>}
          {/* V2-4b: the RoomShell verdict is the room's ONE summary line — this subtitle would
              restate it (the stacked-summaries owner catch). The consent line below stays. */}
          {v2Ia ? null : living ? (
            <p className="fix-subtitle">
              {worthFixing.length === 0
                ? t("optimize.fix.subtitleLivingEmpty")
                : t("optimize.fix.subtitleLivingCount", { count: worthFixing.length })}{" "}
              {t("optimize.fix.subtitleLivingSuffix")}
            </p>
          ) : (
            <p className="fix-subtitle">
              {t("optimize.fix.subtitleClassic", {
                worth: worthFixing.length,
                active: active.length,
                dismissed: dismissedRecs.length,
                notForRig: notForThisRig.length,
              })}
            </p>
          )}
          {/* Standing approval reassurance, re-homed here from the global footer (halfway-home §0) —
              it belongs where approval actually happens. The undo promise joined it 2026-07-10
              (title-header law): with the room header reduced to a title, the verdict sub that
              carried "every apply captures its undo first" is gone — this consent line beside the
              apply controls is its context. */}
          <p className="fix-consent">
            {t("optimize.fix.consentLine")}
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
          <div className="fix-section-label">{t("optimize.fix.driftedSectionLabel")}</div>
          <p className="fix-refuse-intro">
            {t("optimize.fix.driftedIntro", { count: drifted.length })}
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
          {v2Ia ? t("optimize.fix.sectionReadyV2") : t("optimize.fix.sectionWorthMaking")}
        </div>
      )}
      {safeBatch.length >= 2 && (
        <div className="fix-applyall-bar">
          <button className="fix-applyall" onClick={(e) => openSheet(e.currentTarget.getBoundingClientRect())}>
            {slim
              ? t("optimize.fix.applyReviewedCount", { count: safeBatch.length })
              : t("optimize.fix.applySafeFixesCount", { count: safeBatch.length })}
          </button>
          <span className="fix-applyall-hint">{t("optimize.fix.applyAllHint")}</span>
        </div>
      )}
      {batchSummary && (
        <p className="fix-applyall-summary" role="status">
          {t("optimize.fix.appliedCount", { count: batchSummary.applied })}
          {batchSummary.skipped.length > 0 &&
            t("optimize.fix.skippedSuffix", {
              count: batchSummary.skipped.length,
              titles: batchSummary.skipped.map((s) => s.title).join(", "),
            })}
          {t("optimize.fix.eachReversibleBelow")}
        </p>
      )}
      {readyRows.length === 0 ? (
        // With a drifted group above, "already dialed in" would be false — the group head + intro
        // already said what's up, so the empty line renders only when there's truly nothing.
        // One phrase, one owner: the living subtitle already says "dialed in" — this line
        // states the fact without restating it.
        drifted.length === 0 && (
          <p className="fix-empty">{t("optimize.fix.nothingWaiting")}</p>
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
                onOpenDetails={
                  dashV2
                    ? (origin) =>
                        setDetails({
                          rec: { id: rec.id, title: rec.title, description: rec.description, impact: rec.impact, provenance: rec.provenance },
                          applied: false,
                          origin,
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

          POPOUT CONVERGENCE (2026-08-13): this was a hand-rolled backdrop + modal with its own
          z-index (120), its own Escape handler, no focus trap, no focus restore and a blurred
          scrim. It is the canonical <Sheet> now — same title, same note, same list, same two
          actions, same "not while a batch is running" rule, which the Sheet carries as
          `dismissible`. The inner classes are unchanged so the room's styles keep matching. */}
      {sheetOpen && (
        <Sheet
          title={t("optimize.fix.applyTheseChangesTitle", {
            count: slim ? sheetSelected.size : safeBatch.length,
          })}
          origin={sheetOrigin}
          onClose={closeSheet}
          dismissible={!batching}
          footer={
            <>
              <button className="fix-applyall-cancel" disabled={batching} onClick={closeSheet}>
                {t("optimize.fix.cancel")}
              </button>
              <button
                className="fix-applyall-go"
                disabled={batching || (slim && sheetSelected.size === 0)}
                onClick={runApplyAll}
              >
                {batching
                  ? t("optimize.fix.applyingEllipsis")
                  : slim
                    ? t("optimize.fix.applySelectedCount", { count: sheetSelected.size })
                    : t("optimize.fix.applyAllCount", { count: safeBatch.length })}
              </button>
            </>
          }
        >
          <p className="fix-applyall-note">
            {t("optimize.fix.applyAllNote")}
            {slim && t("optimize.fix.applyAllNoteSlimSuffix")}
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
                      aria-label={t("optimize.fix.includeAriaLabel", { title: r.title })}
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
        </Sheet>
      )}
      </>
      )}

      {/* Rendered above the rows so the caveat is read before anything it qualifies. Draws nothing
          unless health is KNOWN incomplete — an unknown health leaves this surface exactly as it
          was. */}
      {showActive && <LedgerHealthNotice health={health} />}

      {/* Active on this PC (ledger Layer 1) — what Compy is currently doing, deduped, ghost rollback.
          Answers Sarah's only question: "what is Compy doing to my machine right now?" */}
      {showActive && active.length > 0 && (
        <>
          <div className="fix-section-label">{t("optimize.fix.activeOnThisPc")}</div>
          <ul className="fix-list">
            {active.map((c) => (
              <ActiveChangeCard
                key={c.id}
                change={c}
                busy={busyId !== null}
                onRollback={() => onRollback(c)}
                onWhatsThis={onOpenLibrary}
                onOpenDetails={
                  dashV2
                    ? (origin) =>
                        setDetails({
                          rec: { id: c.rec_id, title: c.rec_title },
                          applied: true,
                          origin,
                          restoresLabel: c.restores_label,
                          noUndo: !hasUndo(c),
                          primary: () => onRollback(c),
                        })
                    : undefined
                }
              />
            ))}
          </ul>
        </>
      )}

      {/* #638 — applied changes the live re-check could not read. Same card and same rollback as
          above (a rollback is never hidden), under a heading that does not claim they are on. */}
      {showActive && unconfirmedActive.length > 0 && (
        <>
          <div className="fix-section-label">{t("optimize.fix.activeCantConfirm")}</div>
          <ul className="fix-list">
            {unconfirmedActive.map((c) => (
              <ActiveChangeCard
                key={c.id}
                change={c}
                busy={busyId !== null}
                onRollback={() => onRollback(c)}
                onWhatsThis={onOpenLibrary}
                onOpenDetails={
                  dashV2
                    ? (origin) =>
                        setDetails({
                          rec: { id: c.rec_id, title: c.rec_title },
                          applied: true,
                          origin,
                          restoresLabel: c.restores_label,
                          noUndo: !hasUndo(c),
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
          ledger/applied views so standalone Tune (view="all") renders exactly as before.
          Withheld when the ledger is known-incomplete: "nothing active" would then be an
          affirmative claim about the machine sourced from a list Compy could not read. */}
      {(view === "applied" || view === "ledger") &&
        active.length === 0 &&
        unconfirmedActive.length === 0 &&
        !ledgerIncomplete && (
        <p className="fix-empty">
          {t("optimize.fix.nothingActiveOnThisPc")}
        </p>
      )}

      {/* History (ledger Layer 2) — the complete audit trail, collapsed; click a row for its
          receipt. Rolled-back + superseded entries stay, muted. */}
      {showHistory && history.length > 0 && (
        <CollapsibleSection title={t("optimize.fix.history")} count={visibleHistory.length} tint="applied">
          <p className="fix-refuse-intro">
            {t("optimize.fix.historyIntro")}
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
              {t("optimize.fix.thisRigOnly")}
              {thisRigOnly && (
                <span className="fix-rig-hidden">
                  {t("optimize.fix.otherHardwareHidden", { count: otherRigCount })}
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
        <CollapsibleSection title={t("optimize.fix.notForThisRig")} count={notForThisRig.length} tint="refuse">
          <p className="fix-refuse-intro">
            {t("optimize.fix.notForThisRigIntro")}
          </p>
          <ul className="fix-list">
            {notForThisRig.map((r) => (
              <li key={r.id} className="fix-refuse-row">
                <div className="fix-row-head">
                  <RecTitle id={r.id} title={r.title} />
                </div>
                <p className="fix-row-reason">
                  {r.ineligible_reason ?? t("optimize.fix.notApplicableFallback")}
                </p>
                {/* A5 override — reversible; the rec rejoins the normal list through the SAME
                    audited apply path. The user is asserting the detection, not skipping safety. */}
                <button className="fix-dismiss" onClick={() => override(r.id)}>
                  {t("optimize.fix.myHardwareSupportsThis")}
                </button>
              </li>
            ))}
            {overriddenRecs.map((r) => (
              <li key={r.id} className="fix-refuse-row">
                <div className="fix-row-head">
                  <RecTitle id={r.id} title={r.title} />
                  <span className="fix-override-chip">{t("optimize.fix.overriddenByYou")}</span>
                </div>
                <p className="fix-row-reason">
                  {t("optimize.fix.compysReadWasPrefix")}{" "}
                  {r.ineligible_reason ?? t("optimize.fix.notApplicableFallbackLower")}
                </p>
                <button className="fix-dismiss" onClick={() => clearOverride(r.id)}>
                  {t("optimize.fix.setAsideAgain")}
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
        <CollapsibleSection title={t("optimize.fix.dismissed")} count={dismissedRecs.length} tint="applied">
          <p className="fix-refuse-intro">
            {t("optimize.fix.dismissedIntro")}
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
                {t("optimize.fix.restoreAllCount", { count: dismissedRecs.length })}
              </button>
              <span className="fix-applyall-hint">
                {t("optimize.fix.restoreAllHint")}
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
                  {t("optimize.fix.restore")}
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
        title={view === "fixes" ? t("optimize.fix.deliberatelyRefused") : t("optimize.fix.notWorthTouching")}
        count={REFUSE_PILE.length}
        tint="refuse"
        icon={<ShieldOff />}
      >
        <p className="fix-refuse-intro">
          {t("optimize.fix.refusePileIntro")}
        </p>
        <ul className="fix-list">
          {REFUSE_PILE.map((r) => {
            const key = REFUSE_PILE_KEY[r.id];
            return (
              <li key={r.id} className="fix-refuse-row">
                <div className="fix-row-head">
                  <span className="fix-row-title">{t(`optimize.fix.refusePile.${key}.name`)}</span>
                </div>
                <p className="fix-row-reason">{t(`optimize.fix.refusePile.${key}.why`)}</p>
                <ExpertTargetLine id={r.id} />
                <button className="fix-autopsy" onClick={() => onOpenLibrary(r.id)}>
                  {t("optimize.fix.readTheAutopsy")}
                </button>
              </li>
            );
          })}
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
            <div className="fix-section-label">{t("optimize.fix.needsYourCall")}</div>
            <p className="fix-refuse-intro">
              {t("optimize.fix.advisoryIntro")}
            </p>
            <ul className="fix-list">
              {advisory.map((rec) => (
                <GuidedRow key={rec.id} rec={rec} vendor={vendor} onDismiss={dismiss} onWhatsThis={onOpenLibrary} />
              ))}
            </ul>
          </>
        ) : (
          <CollapsibleSection title={t("optimize.fix.compyPointsTheWay")} count={advisory.length}>
            <p className="fix-refuse-intro">
              {t("optimize.fix.advisoryIntro")}
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
        <CollapsibleSection title={t("optimize.fix.startupApps")} count={startup.length}>
          <p className="fix-refuse-intro">
            {t("optimize.fix.startupAppsIntro")}
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
      <DebloatTasks onWhatsThis={onOpenLibrary} activeChangeFor={activeChangeFor} onChanged={onChanged} />
      <PreloadApps onChanged={onChanged} />
      </>
      )}

      {/* The details sheet is opened from either side (fixes rows + active-change cards), so it stays
          mounted in every view; it self-gates on the `details` state. */}
      {details && (
        <ActionDetailsSheet
          rec={details.rec}
          applied={details.applied}
          busy={busyId !== null}
          origin={details.origin}
          restoresLabel={details.restoresLabel}
          noUndo={details.noUndo}
          onApply={() => {
            details.primary();
            setDetails(null);
          }}
          onRollback={() => {
            details.primary();
            setDetails(null);
          }}
          onClose={() => setDetails(null)}
        />
      )}
    </section>
  );
}
