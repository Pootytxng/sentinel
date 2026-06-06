import { useState } from "react";
import type { ReactNode } from "react";
import type { AppliedChange } from "../types";
import { TrustSwitch, TrustSnapshotLine } from "../design/TrustSwitch";
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
  busyId: string | null;
  isAppliable: (recId: string) => boolean;
  activeChangeFor: (recId: string) => AppliedChange | undefined;
  onToggleRec: (recId: string) => void;
  onOpenLibrary: (focusId: string) => void;
  onDisablePreview: () => void;
};

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
}: {
  rec: Rec;
  applied: boolean;
  activeChange: AppliedChange | undefined;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="fix-row">
      <div className="fix-row-main">
        <div className="fix-row-head">
          <span className="fix-row-title">{rec.title}</span>
          <EvidenceChip p={rec.provenance} />
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

export default function Fix({
  recs,
  busyId,
  isAppliable,
  activeChangeFor,
  onToggleRec,
  onOpenLibrary,
  onDisablePreview,
}: Props) {
  const appliable = recs.filter((r) => isAppliable(r.id));
  const worthFixing = appliable.filter((r) => !r.currently_applied);
  const alreadyApplied = appliable.filter((r) => r.currently_applied);
  const advisory = recs.filter((r) => !isAppliable(r.id));

  const rowBusy = (rec: Rec) =>
    busyId !== null && (busyId === rec.id || busyId === activeChangeFor(rec.id)?.id);

  return (
    <section className="fix-root">
      <header className="fix-header">
        <div>
          <h2 className="fix-title">Fix</h2>
          <p className="fix-subtitle">
            {worthFixing.length} worth your attention · {alreadyApplied.length} already applied ·{" "}
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
            />
          ))}
        </ul>
      )}

      {/* Already applied — collapsed, each with its named prior + Undo (the same switch off). */}
      {alreadyApplied.length > 0 && (
        <CollapsibleSection title="Already applied" count={alreadyApplied.length} tint="applied">
          <ul className="fix-list">
            {alreadyApplied.map((rec) => (
              <FixRow
                key={rec.id}
                rec={rec}
                applied
                activeChange={activeChangeFor(rec.id)}
                busy={rowBusy(rec)}
                onToggle={() => onToggleRec(rec.id)}
              />
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

      {/* Guided / advisory — catalog recs Compy detects but won't auto-apply (no switch). */}
      {advisory.length > 0 && (
        <CollapsibleSection title="Compy points the way" count={advisory.length}>
          <p className="fix-refuse-intro">
            Detected, but Compy won't change these for you — they live in a vendor app or a Windows
            page with no safe, reversible switch. The classic Optimize view has the full detail on
            each (toggle "Classic Optimize" above).
          </p>
          <ul className="fix-list">
            {advisory.map((rec) => (
              <li key={rec.id} className="fix-row fix-row-advisory">
                <div className="fix-row-main">
                  <div className="fix-row-head">
                    <span className="fix-row-title">{rec.title}</span>
                    <EvidenceChip p={rec.provenance} />
                  </div>
                  <p className="fix-row-reason">{rec.impact || rec.description}</p>
                </div>
                <span className="fix-guided-tag">Guided</span>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}
    </section>
  );
}
