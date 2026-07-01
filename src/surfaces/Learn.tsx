import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  KNOWLEDGE,
  KNOWLEDGE_BY_ID,
  relatedIds,
  formatEntryDate,
  type KnowledgeEntry,
  type KnowledgeType,
  type TweakVerdict,
} from "../data/knowledge";
import { searchKnowledge } from "../data/knowledge-search";
import {
  TOPICS,
  TOPIC_LABELS,
  APPLICABILITY,
  APPLICABILITY_LABELS,
  type Topic,
  type Applicability,
} from "../data/knowledge-topics";
import { autopsyScan, AUTOPSY_MAX_CHARS, type AutopsyHit, type AutopsyResult } from "../data/knowledge-autopsy";
import { autopsyStats, readAutopsyLedger, recordAutopsy } from "../data/autopsy-ledger";
import {
  VERDICT_GLOSSARY,
  VERDICT_GLOSSARY_ENTRY_ID,
  verdictChip,
  verdictDefinition,
} from "../data/verdict-glossary";
import { Icon } from "../design";
import { Walkthrough } from "../design/Walkthrough";
import { walkthroughForKey, type GpuVendor } from "./walkthroughs";
import { TUNING_GUIDE_BY_ID } from "../data/tuning-guides";
import { TuningGuideBody } from "./TuningGuide";
import "./Learn.css";

// Learn — the Instrument reskin of the knowledge library (Library + Guide Autopsy). RESKIN ONLY:
// reuses the SAME locked cores (searchKnowledge / autopsyScan / KNOWLEDGE / relatedIds) and mirrors
// the shipped state machine + copy verbatim; only the presentation changes. The classic
// TweakEncyclopedia stays in the tree (flag off). Calm surface: static dot-grid, no canvas. Tokens
// only. Read-only — no network, no mutation.

type Filter = "all" | KnowledgeType;
type Mode = "browse" | "autopsy";

const TYPE_LABEL: Record<KnowledgeType, string> = {
  tweak: "Tweak",
  term: "Term",
  trick: "Scam pattern",
  guide: "Guide",
};

// Verdict chip labels + their meanings come from the shared verdict-glossary (single source — the
// visible "How we grade" key, these chips' hover tooltips, and the Learn entry all read the same
// definitions, so they can't drift). `verdictChip` replaced the old local VERDICT_LABEL.

// The visible "How we grade" KEY — the foam-pit-law primary: the meaning is on the page, not hidden
// behind hover. Rendered at the top of browse (giving the verdict filter chips meaning), above the
// Autopsy claims, and AS the "How Compy grades things" entry's body. One component, one source.
function GradeKey() {
  return (
    <div className="lx-gradekey" role="group" aria-label="How we grade">
      <span className="lx-gradekey-title">How we grade</span>
      {VERDICT_GLOSSARY.map((r) => (
        <div key={r.verdict} className="lx-gradekey-row">
          <span className={`lx-verdict lx-verdict-${r.verdict}`} title={r.definition}>
            {r.chip}
          </span>
          <span className="lx-gradekey-def">{r.definition}</span>
        </div>
      ))}
    </div>
  );
}

// One-time-seen flag for the browse "How we grade" key (mirrors compy_sessions_seen_v1 in App.tsx):
// the full key earns its space on a reader's FIRST browse, then folds into a quiet "How we grade ▸"
// toggle they can re-open inline on any later visit. The Autopsy key (where the verdict chips are the
// whole point of the result) stays always-on — this collapse is browse-only.
const GRADEKEY_SEEN_KEY = "compy_blackbook_gradekey_seen_v1";
function readGradeKeySeen(): boolean {
  try {
    return localStorage.getItem(GRADEKEY_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

// Browse-mode "How we grade" key: full on first view, a re-openable toggle thereafter. The "seen"
// flag is written once the full key has been shown, so later visits open collapsed.
function CollapsibleGradeKey() {
  const [seen] = useState(readGradeKeySeen);
  const [open, setOpen] = useState(!seen);
  useEffect(() => {
    if (seen) return;
    try {
      localStorage.setItem(GRADEKEY_SEEN_KEY, "1");
    } catch {
      /* localStorage unavailable — degrade to per-render expanded */
    }
  }, [seen]);
  if (open) {
    return (
      <div className="lx-gradekey-wrap">
        {seen && (
          <button
            className="lx-gradekey-toggle lx-gradekey-toggle-open cmp-door"
            aria-expanded={true}
            onClick={() => setOpen(false)}
          >
            How we grade
            <span className="cmp-door-chevron" aria-hidden="true">▸</span>
          </button>
        )}
        <GradeKey />
      </div>
    );
  }
  return (
    <button
      className="lx-gradekey-toggle cmp-door"
      aria-expanded={false}
      onClick={() => setOpen(true)}
    >
      How we grade
      <span className="cmp-door-chevron" aria-hidden="true">▸</span>
    </button>
  );
}

const GOLDEN_RULES = "One change at a time · restore point first · measure, don't vibe";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "tweak", label: "Tweaks" },
  { key: "term", label: "Terms" },
  { key: "trick", label: "Tricks" },
  { key: "guide", label: "Guides" },
];

// Cycling placeholder examples (spec §2). Static first example under prefers-reduced-motion.
const PLACEHOLDERS = ['xmp', 'frame gen', 'tiny11', 'deep scan', '1% lows'];

// §5 de-overload — a one-line summary for the COLLAPSED row (the full body shows on expand).
function oneLiner(entry: KnowledgeEntry): string {
  switch (entry.type) {
    case "tweak":
      return entry.what;
    case "term":
      return entry.what;
    case "trick":
      return entry.pattern;
    case "guide":
      return entry.goal;
  }
}

// §5 verdict filter chips — narrow tweaks by our verdict, alongside the type filters + search.
const VERDICT_FILTERS: { key: TweakVerdict; label: string }[] = [
  { key: "real", label: "Real" },
  { key: "placebo", label: "Placebo" },
  { key: "risky", label: "Risky" },
];

// §5 category order for the collapsed browse sections (guides first — they're the "start here" doers).
const CATEGORY_ORDER: KnowledgeType[] = ["guide", "tweak", "term", "trick"];

// §7 — detect a URL PASTE into the autopsy. Fetching URLs is off the table ("nothing leaves your PC"
// is a shipped promise), but silent non-registration is a doorknob violation. Returns the source kind
// for in-voice coaching, or null. A mixed paste (URL + substantial prose) returns null → we grade the
// prose and ignore the URL. NEVER fetches; pure string inspection.
function detectUrlPaste(text: string): "youtube" | "webpage" | null {
  const urls = text.match(/https?:\/\/\S+/gi);
  if (!urls || urls.length === 0) return null;
  const withoutUrls = text.replace(/https?:\/\/\S+/gi, " ").trim();
  const words = withoutUrls ? withoutUrls.split(/\s+/).length : 0;
  if (words >= 8) return null; // mixed paste with real text — grade the text, ignore the link
  return /(?:youtube\.com|youtu\.be)/i.test(urls.join(" ")) ? "youtube" : "webpage";
}

function EntryBody({ entry, onNavigate }: { entry: KnowledgeEntry; onNavigate: (id: string) => void }) {
  // The "How Compy grades things" entry renders the visible key as its body (same single source).
  if (entry.id === VERDICT_GLOSSARY_ENTRY_ID && entry.type === "term") {
    return (
      <>
        <p className="lx-what">{entry.what}</p>
        <GradeKey />
      </>
    );
  }
  // Tuning guides render their rich advisory body (goal/tool/steps/range/discretion/undo) from the
  // shared single source — same component the Lab Tuning instrument uses, so they can't drift.
  const tuning = TUNING_GUIDE_BY_ID.get(entry.id);
  if (tuning) return <TuningGuideBody guide={tuning} />;
  return (
    <>
      {entry.status && <SupersededNote entry={entry} onNavigate={onNavigate} />}
      {entryTypeBody(entry)}
    </>
  );
}

// A3 lifecycle — an outdated entry stays findable but reads honestly as superseded/deprecated
// (the corpus is publishable: an old debunk points to its replacement, never silently misleads).
function SupersededNote({
  entry,
  onNavigate,
}: {
  entry: KnowledgeEntry;
  onNavigate: (id: string) => void;
}) {
  const target =
    entry.status === "superseded" && entry.supersededBy
      ? KNOWLEDGE_BY_ID.get(entry.supersededBy)
      : undefined;
  return (
    <p className="lx-superseded" role="note">
      {entry.status === "superseded" ? (
        <>
          ⚠ Superseded{target ? (
            <>
              {" "}— see{" "}
              <button
                type="button"
                className="lx-superseded-link"
                onClick={() => onNavigate(entry.supersededBy!)}
              >
                {target.name}
              </button>
            </>
          ) : null}. Kept for reference; the current guidance has moved on.
        </>
      ) : (
        <>⚠ Outdated — kept for reference; this guidance is no longer current.</>
      )}
    </p>
  );
}

function entryTypeBody(entry: KnowledgeEntry) {
  switch (entry.type) {
    case "tweak":
      return (
        <>
          <div className="lx-row">
            <span
              className={`lx-verdict lx-verdict-${entry.verdict}`}
              title={verdictDefinition(entry.verdict)}
            >
              {verdictChip(entry.verdict)}
            </span>
          </div>
          <p className="lx-what">{entry.what}</p>
          <p className="lx-why">{entry.why}</p>
        </>
      );
    case "term":
      return (
        <>
          <p className="lx-what">{entry.what}</p>
          <p className="lx-why">{entry.more}</p>
        </>
      );
    case "trick":
      return (
        <>
          <p className="lx-what">{entry.pattern}</p>
          <p className="lx-line">
            <b>Spot it:</b> {entry.tell}
          </p>
          <p className="lx-line lx-honest">
            <b>The honest version:</b> {entry.honest_version}
          </p>
        </>
      );
    case "guide":
      return (
        <>
          <div className="lx-golden">{GOLDEN_RULES}</div>
          <p className="lx-what">{entry.goal}</p>
          <ol className="lx-steps">
            {entry.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <p className="lx-line lx-undo">
            <b>Undo:</b> {entry.undo}
          </p>
        </>
      );
  }
}

// Per-type pill label (matches TYPE_LABEL but "guide" reads "Guide · safe" per the mock).
function typePill(type: KnowledgeType): string {
  return type === "guide" ? "Guide · safe" : TYPE_LABEL[type];
}

function EntryCard({
  entry,
  defaultOpen = false,
  onNavigate,
  registerRef,
  vendor,
}: {
  entry: KnowledgeEntry;
  defaultOpen?: boolean;
  onNavigate: (id: string) => void;
  registerRef: (el: HTMLDivElement | null) => void;
  vendor: GpuVendor;
}) {
  // §5 de-overload: rows are COMPRESSED to name + kind + one-liner and expand IN PLACE (the same
  // expand grammar the autopsy uses). Deep-linked entries open by default. Zero copy changes.
  const [open, setOpen] = useState(defaultOpen);
  const related = relatedIds(entry, KNOWLEDGE);
  const walkthrough = walkthroughForKey(entry.id);
  // Tweak cards take the verdict color on their edge; other types take their kind color.
  const accent = entry.type === "tweak" ? `lx-card-${entry.verdict}` : `lx-card-${entry.type}`;
  return (
    <div ref={registerRef} className={`lx-card ${accent} ${open ? "lx-card-open" : ""}`} data-kl-id={entry.id}>
      <button className="lx-card-head cmp-door" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="lx-name">{entry.name}</span>
        <span className={`lx-typepill lx-typepill-${entry.type}`}>{typePill(entry.type)}</span>
        {/* Hardware applicability — small honest "fits these rigs" tags; absent = applies to every rig.
            Reuses the existing typepill style (no new CSS) so it reads as a quiet metadata pill. */}
        {entry.applies?.map((a) => (
          <span key={a} className="lx-typepill" title={`Relevant to ${APPLICABILITY_LABELS[a]} rigs`}>
            {APPLICABILITY_LABELS[a]}
          </span>
        ))}
        {!open && <span className="lx-oneliner">{oneLiner(entry)}</span>}
        <span className="cmp-door-chevron cmp-door-chevron-end" aria-hidden="true">▸</span>
      </button>
      {open && (
        <div className="lx-card-body">
          <EntryBody entry={entry} onNavigate={onNavigate} />
          {walkthrough && (
            <details className="lx-walkthrough">
              <summary>Show me the way</summary>
              <Walkthrough walkthrough={walkthrough} vendor={vendor} />
            </details>
          )}
          {related.length > 0 && (
            <div className="lx-related">
              <span className="lx-related-label">Related</span>
              {related.map((id) => (
                <button key={id} className="lx-chip" onClick={() => onNavigate(id)}>
                  {KNOWLEDGE_BY_ID.get(id)!.name}
                </button>
              ))}
            </div>
          )}
          <EntryDateNote entry={entry} />
        </div>
      )}
    </div>
  );
}

// A3 freshness line — quiet, honest "Added / Updated" metadata at the foot of an expanded card. Only
// renders when the entry actually carries a real date (DATES_BY_ID); an undated entry shows nothing
// rather than a fabricated date. "Updated" is only shown when it differs from "Added" (no redundant
// "Added Jun 2026 · Updated Jun 2026"). Read-only organizational metadata; never a verdict.
function EntryDateNote({ entry }: { entry: KnowledgeEntry }) {
  const added = formatEntryDate(entry.added);
  if (!added) return null;
  const updated = entry.updated && entry.updated !== entry.added ? formatEntryDate(entry.updated) : null;
  return (
    <p
      className="lx-datenote"
      role="note"
      style={{ margin: "10px 0 0", fontSize: "11px", color: "var(--ix-text-3)" }}
    >
      Added {added}
      {updated ? <> · Updated {updated}</> : null}
    </p>
  );
}

function hitPill(h: AutopsyHit): { label: string; cls: string } {
  if (h.type === "tweak" && h.verdict) return { label: verdictChip(h.verdict), cls: `lx-verdict-${h.verdict}` };
  if (h.type === "trick") return { label: "Scam pattern", cls: "lx-verdict-risky" };
  return { label: TYPE_LABEL[h.type], cls: "lx-verdict-info" };
}

function AutopsyResultView({
  result,
  text,
  onNavigate,
  onClear,
}: {
  result: AutopsyResult;
  text: string;
  onNavigate: (id: string) => void;
  onClear: () => void;
}) {
  const { grade, hits, scamFlags, truncated } = result;
  const recognizedNothing = hits.length === 0 && grade.unknown === 0;
  // Expand a graded row IN PLACE (continuity §3) instead of redirecting away from the autopsy.
  const [openId, setOpenId] = useState<string | null>(null);

  if (recognizedNothing) {
    return (
      <div className="lx-result">
        <p className="lx-result-empty">
          We didn't spot anything we recognize in that. Paste a guide that actually names tweaks or
          settings and we'll grade each one.
        </p>
        <button className="lx-btn lx-btn-ghost" onClick={onClear}>
          Clear &amp; paste another
        </button>
      </div>
    );
  }

  const trimmed = text.trim();
  const preview = trimmed.replace(/\s+/g, " ").slice(0, 40);
  const claims = hits.length + grade.unknown;

  return (
    <div className="lx-result">
      {/* Sticky context header — the read-through you're in, always endable on purpose (continuity §3). */}
      <div className="lx-autopsy-sticky">
        <span className="lx-autopsy-sticky-label" title={trimmed}>
          Autopsy: {preview}
          {trimmed.length > 40 ? "…" : ""}
        </span>
        <span className="lx-autopsy-sticky-count">
          {claims} claim{claims === 1 ? "" : "s"} graded
        </span>
        <button className="lx-btn lx-btn-ghost lx-autopsy-sticky-clear" onClick={onClear}>
          Clear
        </button>
      </div>
      <div className="lx-grade">
        This guide: <span className="lx-g-real">{`${grade.real} real`}</span> ·{" "}
        <span className="lx-g-placebo">{`${grade.placebo} placebo`}</span> ·{" "}
        <span className="lx-g-risky">{`${grade.risky} risky`}</span> ·{" "}
        <span className="lx-g-unknown">
          {`${grade.unknown} thing${grade.unknown === 1 ? "" : "s"} we don't recognize`}
        </span>
      </div>
      {scamFlags > 0 && (
        <div className="lx-scamflag">
          <Icon name="alert" size={15} />
          {scamFlags} known scam pattern{scamFlags > 1 ? "s" : ""} in here — open the flagged rows below.
        </div>
      )}
      <p className="lx-result-note">
        Anything we don't recognize gets no verdict — we won't guess. Tap a row to read it right here.
      </p>
      {/* Visible key above the graded claims, so the verdict chips below read in context (foam-pit). */}
      {hits.length > 0 && <GradeKey />}
      {hits.length > 0 && (
        <ul className="lx-hitlist">
          {hits.map((h) => {
            const pill = hitPill(h);
            const open = openId === h.id;
            const entry = KNOWLEDGE_BY_ID.get(h.id);
            return (
              <li key={h.id}>
                <button
                  className="lx-hitrow cmp-door"
                  onClick={() => setOpenId(open ? null : h.id)}
                  aria-expanded={open}
                >
                  <span className="lx-hitname">{h.name}</span>
                  <span
                    className={`lx-verdict ${pill.cls}`}
                    title={h.type === "tweak" && h.verdict ? verdictDefinition(h.verdict) : undefined}
                  >
                    {pill.label}
                  </span>
                  {h.occurrences > 1 && <span className="lx-hitcount">×{h.occurrences}</span>}
                </button>
                {open && entry && (
                  <div className="lx-hit-detail">
                    <EntryBody entry={entry} onNavigate={onNavigate} />
                    {/* Deliberate travel only — the quiet full-entry link, per the continuity law. */}
                    <button className="lx-howto" onClick={() => onNavigate(h.id)}>
                      Open full entry in Library →
                    </button>
                  </div>
                )}
                {h.howTos.length > 0 && (
                  <div className="lx-howtos">
                    {h.howTos.map((gid) => (
                      <button key={gid} className="lx-howto" onClick={() => onNavigate(gid)}>
                        Safe how-to available →
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {truncated && (
        <p className="lx-result-note">We graded the first {AUTOPSY_MAX_CHARS.toLocaleString()} characters of a longer paste.</p>
      )}
    </div>
  );
}

// Autopsy state persists for the SESSION (continuity §3) — the pasted text + graded flag survive tab
// switches + Library detours, so returning to Learn shows the read-through exactly as left. The result
// is re-derived from the text (the scan is offline + pure), so nothing heavy is serialized.
const AUTOPSY_TEXT_KEY = "compy_autopsy_text";
const AUTOPSY_GRADED_KEY = "compy_autopsy_graded";
const LEARN_MODE_KEY = "compy_learn_mode";
function readAutopsyText(): string {
  try {
    return sessionStorage.getItem(AUTOPSY_TEXT_KEY) ?? "";
  } catch {
    return "";
  }
}
function persistAutopsy(text: string, graded: boolean): void {
  try {
    sessionStorage.setItem(AUTOPSY_TEXT_KEY, text);
    sessionStorage.setItem(AUTOPSY_GRADED_KEY, graded ? "1" : "0");
  } catch {
    /* sessionStorage unavailable — degrade to in-memory only */
  }
}

function AutopsyPanel({ onNavigate }: { onNavigate: (id: string) => void }) {
  const [text, setText] = useState(readAutopsyText);
  const [result, setResult] = useState<AutopsyResult | null>(() => {
    try {
      if (sessionStorage.getItem(AUTOPSY_GRADED_KEY) === "1") {
        const t = readAutopsyText();
        return t.trim() ? autopsyScan(t) : null;
      }
    } catch {
      /* ignore */
    }
    return null;
  });
  // A1/A3.8 — the local, private autopsy RECORD: a rollup of every guide graded on this PC (counts
  // only, never the text). Seeded from localStorage; grows on each grading. Local-only, like sessions.
  const [ledger, setLedger] = useState(readAutopsyLedger);
  const stats = autopsyStats(ledger);

  const clear = () => {
    setText("");
    setResult(null);
    persistAutopsy("", false);
  };

  // §7 — a URL paste gets honest coaching, never silent non-registration (and never a fetch).
  const urlKind = detectUrlPaste(text);

  return (
    <div className="lx-autopsy">
      <p className="lx-sub">
        Paste a tweak guide — a forum post, a video description, a "do these 10 things" list — and get
        the autopsy. Nothing leaves your PC; it's matched against this library, offline.
      </p>
      {/* A3.8 — your local autopsy record: a running tally of what the guides you've graded turned out
          to be. Counts only, stored on this PC. Shown once you've graded at least one guide. */}
      {stats.count > 0 && (
        <div className="lx-autopsy-record" role="status">
          <span className="lx-autopsy-record-title">Your autopsy record</span>
          <span className="lx-autopsy-record-line">
            {stats.count} guide{stats.count === 1 ? "" : "s"} graded
            {stats.gradedTweaks > 0 && (
              <>
                {" — of the tweaks recognized: "}
                <b className="lx-rec-real">{stats.realPct}% real</b>
                {" · "}
                <b className="lx-rec-placebo">{stats.placeboPct}% placebo</b>
                {" · "}
                <b className="lx-rec-risky">{stats.riskyPct}% risky</b>
              </>
            )}
            {stats.scamFlags > 0 && (
              <>
                {" · "}
                {stats.scamFlags} snake-oil trick{stats.scamFlags === 1 ? "" : "s"} flagged
              </>
            )}
          </span>
        </div>
      )}
      <textarea
        className="lx-paste"
        rows={7}
        aria-label="Paste a tweak guide to autopsy"
        placeholder="Paste the guide here…"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setResult(null);
          persistAutopsy(e.target.value, false);
        }}
      />
      <div className="lx-autopsy-actions">
        <button
          className="lx-btn"
          disabled={!text.trim() || !!urlKind}
          onClick={() => {
            const r = autopsyScan(text);
            setResult(r);
            persistAutopsy(text, true);
            setLedger(recordAutopsy(r));
          }}
        >
          Grade this guide
        </button>
        {text && !result && (
          <button className="lx-btn lx-btn-ghost" onClick={clear}>
            Clear
          </button>
        )}
      </div>
      {/* §7 — honest in-voice coaching for a pasted link; reinforces the privacy promise at the exact
          moment it costs the user something. NO fetch, NO domain/title grading of unread pages. */}
      {urlKind ? (
        <div className="lx-urlcard" role="status">
          <p className="lx-urlcard-lead">
            That's a link — and Compy never fetches the internet (nothing leaves your PC; that's the
            deal). Bring me the words instead:
          </p>
          <p className="lx-urlcard-how">
            {urlKind === "youtube"
              ? "Open the video's transcript (⋯ menu → Show transcript) → copy → paste here."
              : "Open the page → Ctrl+A, Ctrl+C → paste here. I'll grade every claim."}
          </p>
        </div>
      ) : (
        result && (
          <AutopsyResultView result={result} text={text} onNavigate={onNavigate} onClear={clear} />
        )
      )}
    </div>
  );
}

export default function Learn({
  onClose,
  focusId = null,
  asPanel = false,
  vendor = "any",
}: {
  onClose: () => void;
  focusId?: string | null;
  asPanel?: boolean;
  vendor?: GpuVendor;
}) {
  // The room (asPanel) restores its last mode so returning mid-autopsy isn't an empty browse view
  // (continuity §3). A deep-link (focusId) always lands in browse; the cross-link modal doesn't persist.
  const [mode, setMode] = useState<Mode>(() => {
    if (focusId) return "browse";
    if (asPanel) {
      try {
        return sessionStorage.getItem(LEARN_MODE_KEY) === "autopsy" ? "autopsy" : "browse";
      } catch {
        /* ignore */
      }
    }
    return "browse";
  });
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [verdict, setVerdict] = useState<TweakVerdict | "all">("all"); // §5 verdict chips
  const [topic, setTopic] = useState<Topic | "all">("all"); // A3 topic filter (what an entry is about)
  const [fits, setFits] = useState<Applicability | "all">("all"); // hardware applicability filter
  // The Grade/Topic/Fits axes are power-user refinements — collapse them behind one toggle so a first
  // browse meets the search box + type filters, not a four-row filter wall. Count shows when any is set.
  const [moreFilters, setMoreFilters] = useState(false);
  const activeSecondary =
    (verdict !== "all" ? 1 : 0) + (topic !== "all" ? 1 : 0) + (fits !== "all" ? 1 : 0);
  const [openCats, setOpenCats] = useState<Set<KnowledgeType>>(new Set()); // §5 collapsed categories
  const [focused, setFocused] = useState<string | null>(focusId);
  const [phIdx, setPhIdx] = useState(0);
  const deferredQ = useDeferredValue(q); // keeps the input snappy; dataset is tiny so results are instant
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Opened with a deep-link target (e.g. from a glossary tooltip) — go to browse and reveal it.
  useEffect(() => {
    if (focusId) {
      setMode("browse");
      setFocused(focusId);
      setQ("");
      setFilter("all");
      setVerdict("all");
      setTopic("all");
      setFits("all");
      const e = KNOWLEDGE_BY_ID.get(focusId);
      if (e) setOpenCats((prev) => new Set(prev).add(e.type)); // expand its category so it's reachable
    }
  }, [focusId]);

  // Persist the room's mode so the autopsy survives leaving + returning (continuity §3); modal excluded.
  useEffect(() => {
    if (!asPanel) return;
    try {
      sessionStorage.setItem(LEARN_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode, asPanel]);

  // Cycle the placeholder examples; frozen (static first) under prefers-reduced-motion.
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setPhIdx((i) => (i + 1) % PLACEHOLDERS.length), 2800);
    return () => window.clearInterval(id);
  }, []);

  const results = useMemo(() => {
    let hits = searchKnowledge(deferredQ);
    if (filter !== "all") hits = hits.filter((e) => e.type === filter);
    if (verdict !== "all") hits = hits.filter((e) => e.type === "tweak" && e.verdict === verdict);
    if (topic !== "all") hits = hits.filter((e) => e.topic === topic);
    // Hardware applicability: an entry with no `applies` is universal (matches any rig); a tagged entry
    // matches only when it lists the chosen rig. So a "Fits: NVIDIA" view shows universal + NVIDIA entries.
    if (fits !== "all") hits = hits.filter((e) => !e.applies || e.applies.includes(fits));
    return hits;
  }, [deferredQ, filter, verdict, topic, fits]);

  // §5 "Start here" — the guides are the actionable entry points (capped). Shown only in pure browse.
  const startHere = useMemo(() => KNOWLEDGE.filter((e) => e.type === "guide").slice(0, 5), []);

  // Scroll the focused entry into view and flash it once it's in the rendered list.
  useEffect(() => {
    if (mode !== "browse" || !focused) return;
    const el = cardRefs.current.get(focused);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("lx-flash");
    const t = setTimeout(() => el.classList.remove("lx-flash"), 1200);
    return () => clearTimeout(t);
  }, [focused, results, mode]);

  const navigateTo = (id: string) => {
    if (!KNOWLEDGE_BY_ID.has(id)) return;
    setMode("browse");
    setQ("");
    setFilter("all");
    setVerdict("all");
    setTopic("all");
    setFits("all");
    setFocused(id);
    const e = KNOWLEDGE_BY_ID.get(id);
    if (e) setOpenCats((prev) => new Set(prev).add(e.type)); // expand its category
  };

  return (
    <div
      className={`lx-backdrop ${asPanel ? "lx-aspanel" : ""}`}
      onClick={asPanel ? undefined : onClose}
    >
      <div
        className="lx-modal"
        onClick={(e) => e.stopPropagation()}
        {...(asPanel ? {} : { role: "dialog", "aria-modal": true, "aria-labelledby": "lx-modal-title" })}
      >
        <div className="lx-dotgrid" aria-hidden="true" />
        <div className="lx-inner">
          <div className="lx-head">
            <div>
              <h2 className="lx-title" id="lx-modal-title">Blackbook</h2>
              <p className="lx-tagline">
                What actually works — measured. Look up any tweak, term, or scam you heard online;
                we only answer what we've verified.
              </p>
            </div>
            {/* As a rail room there's no "Close" (you leave via the rail); only the modal form has it. */}
            {!asPanel && (
              <button className="lx-btn lx-btn-ghost" onClick={onClose}>
                Close
              </button>
            )}
          </div>

          {/* Surface the Autopsy — Blackbook's most distinctive trick (paste a guide, get it graded
              offline) otherwise hides behind the mode tab. One quiet honest line, browse-only. */}
          {mode === "browse" && (
            <button className="lx-autopsy-hint cmp-door" onClick={() => setMode("autopsy")}>
              Got a guide to fact-check? Try Autopsy
              <span className="cmp-door-chevron" aria-hidden="true">→</span>
            </button>
          )}

          <div className="lx-modes" role="tablist" aria-label="Blackbook mode">
            <button
              role="tab"
              aria-selected={mode === "browse"}
              className={`lx-mode ${mode === "browse" ? "lx-mode-on" : ""}`}
              onClick={() => setMode("browse")}
            >
              Look it up
            </button>
            <button
              role="tab"
              aria-selected={mode === "autopsy"}
              className={`lx-mode ${mode === "autopsy" ? "lx-mode-on" : ""}`}
              onClick={() => setMode("autopsy")}
            >
              Autopsy a guide
            </button>
          </div>

          {mode === "autopsy" ? (
            <AutopsyPanel onNavigate={navigateTo} />
          ) : (
            <>
              <input
                className="lx-search"
                autoFocus
                aria-label="Search the knowledge library"
                placeholder={`try "${PLACEHOLDERS[phIdx]}"…`}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setFocused(null);
                }}
              />
              <div className="lx-filters" role="group" aria-label="Filter by type">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    className={`lx-filter ${filter === f.key ? "lx-filter-on" : ""}`}
                    aria-pressed={filter === f.key}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="lx-morefilters"
                aria-expanded={moreFilters}
                onClick={() => setMoreFilters((o) => !o)}
              >
                {moreFilters ? "Fewer filters ▾" : "More filters ▸"}
                {!moreFilters && activeSecondary > 0 && (
                  <span className="lx-morefilters-count">{activeSecondary}</span>
                )}
              </button>
              {moreFilters && (
                <>
              {/* §5 verdict chips — narrow tweaks by our verdict, alongside the type filters. The
                  inline "Grade:" label names the axis so this row doesn't read as a second type filter. */}
              <div className="lx-filters lx-vfilters" role="group" aria-label="Filter tweaks by verdict">
                <span className="lx-vfilter-label" aria-hidden="true">Grade:</span>
                <button
                  className={`lx-filter ${verdict === "all" ? "lx-filter-on" : ""}`}
                  aria-pressed={verdict === "all"}
                  onClick={() => setVerdict("all")}
                >
                  Any verdict
                </button>
                {VERDICT_FILTERS.map((v) => (
                  <button
                    key={v.key}
                    className={`lx-filter lx-vfilter-${v.key} ${verdict === v.key ? "lx-filter-on" : ""}`}
                    aria-pressed={verdict === v.key}
                    onClick={() => setVerdict(v.key)}
                    title={verdictDefinition(v.key)}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              {/* A3 topic filter — narrow the library by what an entry is ABOUT (display, GPU,
                  network…), orthogonal to the type + verdict axes. Labelled so the row reads as its
                  own axis, not a third type filter. */}
              <div className="lx-filters lx-vfilters" role="group" aria-label="Filter by topic">
                <span className="lx-vfilter-label" aria-hidden="true">Topic:</span>
                <button
                  className={`lx-filter ${topic === "all" ? "lx-filter-on" : ""}`}
                  aria-pressed={topic === "all"}
                  onClick={() => setTopic("all")}
                >
                  Any topic
                </button>
                {TOPICS.map((t) => (
                  <button
                    key={t}
                    className={`lx-filter ${topic === t ? "lx-filter-on" : ""}`}
                    aria-pressed={topic === t}
                    onClick={() => setTopic(t)}
                  >
                    {TOPIC_LABELS[t]}
                  </button>
                ))}
              </div>
              {/* Hardware applicability filter — narrow to entries that fit a chosen rig (AMD / NVIDIA /
                  Intel / laptop / desktop). Universal entries (no tags) always show; only rig-specific
                  ones are hidden when they don't match. Labelled so the row reads as its own axis. */}
              <div className="lx-filters lx-vfilters" role="group" aria-label="Filter by what fits your rig">
                <span className="lx-vfilter-label" aria-hidden="true">Fits:</span>
                <button
                  className={`lx-filter ${fits === "all" ? "lx-filter-on" : ""}`}
                  aria-pressed={fits === "all"}
                  onClick={() => setFits("all")}
                >
                  Any rig
                </button>
                {APPLICABILITY.map((a) => (
                  <button
                    key={a}
                    className={`lx-filter ${fits === a ? "lx-filter-on" : ""}`}
                    aria-pressed={fits === a}
                    onClick={() => setFits(a)}
                  >
                    {APPLICABILITY_LABELS[a]}
                  </button>
                ))}
              </div>
                </>
              )}
              {/* The visible "How we grade" key — gives the verdict filter chips above their meaning
                  (foam-pit law: on the page, not hover-only). Full on a reader's first browse, a quiet
                  re-openable toggle thereafter so it stops re-claiming a block every visit. */}
              <CollapsibleGradeKey />
              {results.length === 0 ? (
                <div className="lx-empty">
                  No entry for that yet — we only answer what we've verified. If you're unsure about a
                  tweak that isn't here, measure it with Compy's benchmark instead of trusting a forum.
                </div>
              ) : !deferredQ.trim() && filter === "all" && verdict === "all" && topic === "all" && fits === "all" ? (
                // §5 PURE BROWSE — "Start here" strip + collapsed category sections (the calm open).
                <>
                  <div className="lx-starthere">
                    <span className="lx-starthere-label">Start here</span>
                    <div className="lx-starthere-row">
                      {startHere.map((e) => (
                        <button key={e.id} className="lx-starthere-chip" onClick={() => navigateTo(e.id)}>
                          {e.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  {CATEGORY_ORDER.map((type) => {
                    const items = results.filter((e) => e.type === type);
                    if (items.length === 0) return null;
                    const isOpen = openCats.has(type);
                    return (
                      <div key={type} className="lx-cat">
                        <button
                          className="lx-cat-head cmp-door"
                          aria-expanded={isOpen}
                          onClick={() =>
                            setOpenCats((prev) => {
                              const n = new Set(prev);
                              if (n.has(type)) n.delete(type);
                              else n.add(type);
                              return n;
                            })
                          }
                        >
                          <span className="lx-cat-title">{TYPE_LABEL[type]}s</span>
                          <span className="lx-cat-count">{items.length}</span>
                          <span className="cmp-door-chevron cmp-door-chevron-end" aria-hidden="true">▸</span>
                        </button>
                        {isOpen && (
                          <div className="lx-list">
                            {items.map((e) => (
                              <EntryCard
                                key={e.id === focused ? `${e.id}-f` : e.id}
                                entry={e}
                                defaultOpen={e.id === focused}
                                onNavigate={navigateTo}
                                vendor={vendor}
                                registerRef={(el) => {
                                  if (el) cardRefs.current.set(e.id, el);
                                  else cardRefs.current.delete(e.id);
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              ) : (
                // Searching or filtering → a flat list of compressed matches (names stay visible).
                <div className="lx-list">
                  {results.map((e) => (
                    <EntryCard
                      key={e.id === focused ? `${e.id}-f` : e.id}
                      entry={e}
                      defaultOpen={e.id === focused}
                      onNavigate={navigateTo}
                      vendor={vendor}
                      registerRef={(el) => {
                        if (el) cardRefs.current.set(e.id, el);
                        else cardRefs.current.delete(e.id);
                      }}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
