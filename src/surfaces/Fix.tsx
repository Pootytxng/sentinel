import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AppliedChange, StartupEntry } from "../types";
import { TrustSwitch, TrustSnapshotLine } from "../design/TrustSwitch";
import { WhatsThis } from "../design/WhatsThis";
import { GUIDED_STEPS, openGuidedUri } from "./guided";
import "./Fix.css";

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
  onOpenLibrary: (focusId: string) => void;
  onDisablePreview: () => void;
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

const EVIDENCE: Record<Rec["provenance"], { label: string; cls: string }> = {
  verified: { label: "Verified", cls: "verified" },
  "measured-signal": { label: "Measured", cls: "measured" },
  "expected-impact": { label: "Expected", cls: "expected" },
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

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`fix-chev ${open ? "fix-chev-open" : ""}`}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
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

// A row for an appliable rec — title, evidence, reason, and the trust-switch (right-aligned). When
// applied, the row carries the named-prior snapshot line in its main column.
function FixRow({
  rec,
  applied,
  activeChange,
  busy,
  onToggle,
  onWhatsThis,
}: {
  rec: Rec;
  applied: boolean;
  activeChange: AppliedChange | undefined;
  busy: boolean;
  onToggle: () => void;
  onWhatsThis: (id: string) => void;
}) {
  return (
    <li className="fix-row">
      <div className="fix-row-main">
        <div className="fix-row-head">
          <span className="fix-row-title">{rec.title}</span>
          <EvidenceChip p={rec.provenance} />
          <WhatsThis id={rec.id} onOpen={onWhatsThis} />
        </div>
        <p className="fix-row-reason">{rec.impact || rec.description}</p>
        {applied && <TrustSnapshotLine restoresLabel={activeChange?.restores_label} />}
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
      <button className="fix-group-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Chevron open={open} />
        {icon && <span className="fix-group-icon">{icon}</span>}
        <span className="fix-group-title">{title}</span>
        <span className="fix-group-count">{count}</span>
      </button>
      {open && <div className="fix-group-body">{children}</div>}
    </section>
  );
}

// A guided/advisory rec — Compy detected it but won't change it (vendor app / a Windows page with no
// safe reversible switch). Carries the full where + steps + the allowlisted "Open it" deep link, so
// classic Optimize is no longer needed for the detail (parity for the release default-flip).
function GuidedRow({ rec }: { rec: Rec }) {
  const [open, setOpen] = useState(false);
  const guide = GUIDED_STEPS[rec.id];
  return (
    <li className="fix-row fix-row-advisory">
      <div className="fix-row-main">
        <div className="fix-row-head">
          <span className="fix-row-title">{rec.title}</span>
          <EvidenceChip p={rec.provenance} />
          <span className="fix-guided-tag">Guided</span>
        </div>
        <p className="fix-row-reason">{rec.impact || rec.description}</p>
        {guide && (
          <div className="fix-guided-actions">
            <button
              className="fix-guided-toggle"
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
}: {
  change: AppliedChange;
  busy: boolean;
  onRollback: () => void;
  onWhatsThis: (id: string) => void;
}) {
  return (
    <li className="fix-active-card">
      <div className="fix-row-main">
        <div className="fix-row-head">
          <span className="fix-row-title">{change.rec_title}</span>
          <WhatsThis id={change.rec_id} onOpen={onWhatsThis} />
        </div>
        <p className="fix-row-reason">
          Active since {humanizeWhen(change.applied_at)}
          {change.restores_label ? ` · rolls back to ${change.restores_label}` : ""}
        </p>
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
      <button className="fix-hist-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Chevron open={open} />
        <span className="fix-hist-title">{change.rec_title}</span>
        <span className="fix-hist-when">{humanizeWhen(change.applied_at)}</span>
        <span className="fix-hist-status">{rolledBack ? "✓ rolled back" : "active"}</span>
      </button>
      {open && (
        <div className="fix-hist-detail">
          {change.restores_label && (
            <div>
              Restores: <strong>{change.restores_label}</strong>
            </div>
          )}
          <div>
            Applied {humanizeWhen(change.applied_at)}
            {change.elevation_used ? " · elevated" : ""}
          </div>
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
  onOpenLibrary,
  onDisablePreview,
}: Props) {
  const appliable = recs.filter((r) => isAppliable(r.id));
  const worthFixing = appliable.filter((r) => !r.currently_applied);
  const advisory = recs.filter((r) => !isAppliable(r.id));

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

  return (
    <section className="fix-root">
      <header className="fix-header">
        <div>
          <h2 className="fix-title">Fix</h2>
          <p className="fix-subtitle">
            {worthFixing.length} worth your attention · {active.length} active on this PC ·{" "}
            {REFUSE_PILE.length} we'd leave alone. Every change is one click to undo.
          </p>
          {/* Standing approval reassurance, re-homed here from the global footer (halfway-home §0) —
              it belongs where approval actually happens. */}
          <p className="fix-consent">Compy never changes anything without your explicit approval.</p>
        </div>
        <button className="fix-classic" onClick={onDisablePreview} title="Switch back to classic Optimize">
          Classic Optimize
        </button>
      </header>

      {/* Worth fixing — the outstanding appliable recs, each with its trust-switch. */}
      <div className="fix-section-label">Worth fixing</div>
      {worthFixing.length === 0 ? (
        <p className="fix-empty">Nothing worth fixing right now — your appliable settings are all set.</p>
      ) : (
        <ul className="fix-list">
          {worthFixing.map((rec) => (
            <FixRow
              key={rec.id}
              rec={rec}
              applied={false}
              activeChange={undefined}
              busy={rowBusy(rec)}
              onToggle={() => onToggleRec(rec.id)}
              onWhatsThis={onOpenLibrary}
            />
          ))}
        </ul>
      )}

      {/* Active on this PC (ledger Layer 1) — what Compy is currently doing, deduped, ghost rollback.
          Answers Sarah's only question: "what is Compy doing to my machine right now?" */}
      {active.length > 0 && (
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
              />
            ))}
          </ul>
        </>
      )}

      {/* Full history (ledger Layer 2) — the complete audit trail, collapsed; click a row for its
          receipt. Rolled-back + superseded entries stay, muted. */}
      {history.length > 0 && (
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
              <GuidedRow key={rec.id} rec={rec} />
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
    </section>
  );
}
