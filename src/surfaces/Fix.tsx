import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppliedChange, StartupEntry } from "../types";
import { TrustSwitch, TrustSnapshotLine } from "../design/TrustSwitch";
import { WhatsThis } from "../design/WhatsThis";
import { Walkthrough } from "../design/Walkthrough";
import { walkthroughForKey, type GpuVendor } from "./walkthroughs";
import { useDismissed } from "./dismissed";
import { GUIDED_STEPS, openGuidedUri } from "./guided";
import { friendlyLabel } from "../data/friendly-labels";
import { PROVENANCE_LABEL, PROVENANCE_NOTE } from "../data/provenance";
import { recMutation } from "../data/rec-mutations";
import { slimProofLine } from "../data/slim-proof";
import { SlimRecRow, SlimDetailRow } from "../design/SlimRecRow";
import { ActionDrawer, type DrawerRec } from "./ActionDrawer";
import { gameModeRevertedExternally } from "./dashboard-data";
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
// Slim rows (P1 UI slim-down, DEFAULT OFF) — master-detail rec rows on the Fixes segment. DOM-read
// like the flags above; flag off ⇒ the classic FixRow path renders byte-identical.
function slimOn(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.slimRows === "on";
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
// CommandCenter / ActionDrawer wording; the CSS class stays local to this surface.
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
        {applied && <TrustSnapshotLine restoresLabel={activeChange?.restores_label} />}
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

// The slim master-detail rec row (P1 UI slim-down, behind compy_slim_rows — flag off, FixRow above
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
      {applied && <TrustSnapshotLine restoresLabel={activeChange?.restores_label} />}
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
  const [open, setOpen] = useState(!!defaultOpen);
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
function DebloatTasks({ onWhatsThis }: { onWhatsThis: (id: string) => void }) {
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
          const done = st === "done";
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
    <li className="fix-row fix-row-advisory">
      <div className="fix-row-main">
        <div className="fix-row-head">
          <RecTitle id={rec.id} title={rec.title} />
          <WhatsThis id={rec.id} onOpen={onWhatsThis} />
          <EvidenceChip p={rec.provenance} />
          <span className="fix-guided-tag">Guided</span>
        </div>
        <RecReason id={rec.id} text={rec.impact || rec.description} />
        <button className="fix-dismiss" onClick={() => onDismiss(rec.id)}>
          Not for me
        </button>
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
            ? ` · ${change.restores_label} → ${change.applied_label}`
            : change.restores_label
              ? ` · rolls back to ${change.restores_label}`
              : ""}
        </p>
        <PayoffMeter label={change.payoff_label} />
      </div>
      <button className="fix-ghost-rollback" disabled={busy} onClick={onRollback}>
        {busy ? "Rolling back…" : "Roll back"}
      </button>
    </li>
  );
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
        <span className="fix-hist-when">{humanizeWhen(change.applied_at)}</span>
        <span className="fix-hist-status">{rolledBack ? "✓ rolled back" : "active"}</span>
      </button>
      {open && (
        <div className="fix-hist-detail">
          {change.restores_label && change.applied_label ? (
            <div>
              Before <strong>{change.restores_label}</strong> → after{" "}
              <strong>{change.applied_label}</strong>
            </div>
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
  const notForThisRig = recs.filter((r) => r.eligible === false);
  const eligibleRecs = recs.filter((r) => r.eligible !== false);
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

  // §4 "Apply all safe fixes" — SAFE-tier only (moderate stays individual; advisory can't apply;
  // dismissed/not-for-this-rig already excluded since this derives from worthFixing). One consent
  // sheet → onApplyBatch runs the existing apply per item (per-item ledger receipts, failure
  // isolation). Copy never promises performance.
  const safeBatch = worthFixing.filter((r) => r.severity === "safe");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [batching, setBatching] = useState(false);
  // Slim rows (P1, compy_slim_rows — DEFAULT OFF): master-detail rows on the Fixes segment only.
  // Flag off ⇒ every branch below takes the classic path byte-identical.
  const slim = slimOn() && view === "fixes";
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

  const rowBusy = (rec: Rec) =>
    busyId !== null && (busyId === rec.id || busyId === activeChangeFor(rec.id)?.id);
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
          {living ? (
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
              changes for YOUR rig — every one is one click to undo.
            </p>
          )}
          {/* Standing approval reassurance, re-homed here from the global footer (halfway-home §0) —
              it belongs where approval actually happens. */}
          <p className="fix-consent">Compy never changes anything without your explicit approval.</p>
        </div>
      </header>
      )}

      {/* Worth making for your rig — the outstanding appliable recs, each with its trust-switch. */}
      {showFixes && (
      <>
      <div className="fix-section-label">Worth making for your rig</div>
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
      {worthFixing.length === 0 ? (
        <p className="fix-empty">Your rig's already dialed in — nothing here needs a change right now.</p>
      ) : (
        <ul className="fix-list">
          {worthFixing.map((rec) =>
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
              one. These tidy up how your rig is set up for you — not a performance boost.
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
                busy={busyId !== null && busyId === c.id}
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

      {/* Full history (ledger Layer 2) — the complete audit trail, collapsed; click a row for its
          receipt. Rolled-back + superseded entries stay, muted. */}
      {showHistory && history.length > 0 && (
        <CollapsibleSection title="Full history" count={history.length} tint="applied">
          <p className="fix-refuse-intro">
            The complete trail — applied, rolled back, superseded. Click any row for its receipt.
          </p>
          <ul className="fix-list">
            {history.map((c) => (
              <HistoryRow key={c.id} change={c} />
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {showFixes && (
      <>
      {/* Not for this rig — hardware-ineligible recs (eligibility train): set aside with the reason,
          and OUT of the completion denominator, so they never block "all handled" or nag. */}
      {notForThisRig.length > 0 && (
        <CollapsibleSection title="Not for this rig" count={notForThisRig.length} tint="refuse">
          <p className="fix-refuse-intro">
            Compy detected these don't apply to your hardware — set aside, and left out of your
            "all handled" count.
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
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {/* Dismissed — what you deliberately declined ("Not for me"). Reversible; out of the active
          denominator but one tap from restore, so a 100% reached by dismissing is a LABELED 100%. */}
      {dismissedRecs.length > 0 && (
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
      )}

      {/* Not worth touching — the refuse-pile. What Compy won't do, and why, with the autopsy link. */}
      <CollapsibleSection
        title="Not worth touching"
        count={REFUSE_PILE.length}
        tint="refuse"
        icon={<ShieldOff />}
      >
        <p className="fix-refuse-intro">
          Popular tweaks Compy deliberately refuses — the honest reason for each, with the full
          autopsy a click away.
        </p>
        <ul className="fix-list">
          {REFUSE_PILE.map((r) => (
            <li key={r.id} className="fix-refuse-row">
              <div className="fix-row-head">
                <span className="fix-row-title">{r.name}</span>
              </div>
              <p className="fix-row-reason">{r.why}</p>
              <button className="fix-autopsy" onClick={() => onOpenLibrary(r.id)}>
                Read the autopsy →
              </button>
            </li>
          ))}
        </ul>
      </CollapsibleSection>

      {/* Guided / advisory — Compy detects but won't auto-apply; the full where + steps + the
          allowlisted "Open it" deep link live right here (no need to fall back to classic Optimize). */}
      {advisory.length > 0 && (
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
      )}

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
      <DebloatTasks onWhatsThis={onOpenLibrary} />
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
