import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  knowledgeForLanguage,
  knowledgeByIdForLanguage,
  relatedIds,
  formatEntryDate,
  supersessionChain,
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
import { autopsyStats, readAutopsyLedger, recordAutopsy, type AutopsyLedgerEntry } from "../data/autopsy-ledger";
import {
  VERDICT_GLOSSARY,
  VERDICT_GLOSSARY_ENTRY_ID,
  verdictChip,
  verdictDefinition,
} from "../data/verdict-glossary";
import { Icon } from "../design";
import { useReducedMotion } from "../design/use-motion";
import { Walkthrough } from "../design/Walkthrough";
import { walkthroughForKeyForLanguage, type GpuVendor } from "./walkthroughs";
import { tuningGuideByIdForLanguage } from "../data/tuning-guides";
import { TuningGuideBody } from "./TuningGuide";
import "../i18n";
import "./Learn.css";

// Learn — the Instrument reskin of the knowledge library (Library + Guide Autopsy). RESKIN ONLY:
// reuses the SAME locked cores (searchKnowledge / autopsyScan / KNOWLEDGE / relatedIds) and mirrors
// the shipped state machine + copy verbatim; only the presentation changes. The classic
// TweakEncyclopedia stays in the tree (flag off). Calm surface: static dot-grid, no canvas. Tokens
// only. Read-only — no network, no mutation.

type Filter = "all" | KnowledgeType;
type Mode = "browse" | "autopsy";

// Type labels (chip/badge text) and one-line category descriptions are resolved via
// t("blackbook.learn.typeLabel.*" / "typeLabelPlural.*" / "typeDesc.*") at each call site, keyed
// by the same KnowledgeType strings (module scope can't call the translation hook).

// Verdict chip labels + their meanings come from the shared verdict-glossary (single source — the
// visible "How we grade" key, these chips' hover tooltips, and the Learn entry all read the same
// definitions, so they can't drift). `verdictChip` replaced the old local VERDICT_LABEL.

// The visible "How we grade" KEY — the foam-pit-law primary: the meaning is on the page, not hidden
// behind hover. Rendered at the top of browse (giving the verdict filter chips meaning), above the
// Autopsy claims, and AS the "How Compy grades things" entry's body. One component, one source.
function GradeKey() {
  const { t } = useTranslation();
  return (
    <div className="lx-gradekey" role="group" aria-label={t("blackbook.learn.howWeGrade")}>
      <span className="lx-gradekey-title">{t("blackbook.learn.howWeGrade")}</span>
      {VERDICT_GLOSSARY.map((r) => (
        <div key={r.verdict} className="lx-gradekey-row">
          <span className={`lx-verdict lx-verdict-${r.verdict}`} title={verdictDefinition(r.verdict, t)}>
            {verdictChip(r.verdict, t)}
          </span>
          <span className="lx-gradekey-def">{verdictDefinition(r.verdict, t)}</span>
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
function CollapsibleGradeKey({ suppressed = false }: { suppressed?: boolean }) {
  const { t } = useTranslation();
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
  if (suppressed) return null;
  if (open) {
    return (
      <div className="lx-gradekey-wrap">
        {seen && (
          <button
            className="lx-gradekey-toggle lx-gradekey-toggle-open cmp-door"
            aria-expanded={true}
            onClick={() => setOpen(false)}
          >
            {t("blackbook.learn.howWeGrade")}
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
      {t("blackbook.learn.howWeGrade")}
      <span className="cmp-door-chevron" aria-hidden="true">▸</span>
    </button>
  );
}

// The golden-rules tip line preceding a guide's steps — resolved via
// t("blackbook.learn.goldenRules") at its one call site (entryTypeBody).

const FILTER_KEYS: Filter[] = ["all", "tweak", "term", "trick", "guide"];

// Cycling placeholder examples (spec §2). Static first example under prefers-reduced-motion. Kept
// in English deliberately — these are literal example search terms from the (English) knowledge
// corpus, not sentence-level UI chrome; see i18n handoff notes.
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
const VERDICT_FILTER_KEYS: TweakVerdict[] = ["real", "placebo", "risky"];

// §5 category order for the collapsed browse sections (guides first — they're the "start here" doers).
const CATEGORY_ORDER: KnowledgeType[] = ["guide", "tweak", "term", "trick"];

// §7 — detect a URL PASTE into the autopsy. Autopsy never opens or fetches a pasted link — the
// signed update check is Compy's only outbound surface, and it is not reachable from here (the
// production CSP connect-src stays 'self' ipc:). Silent non-registration is still a doorknob
// violation, so we register the paste and coach. Returns the source kind
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

function EntryBody({
  entry,
  onNavigate,
  showInlineVerdict = true,
}: {
  entry: KnowledgeEntry;
  onNavigate: (id: string) => void;
  showInlineVerdict?: boolean;
}) {
  const { t, i18n } = useTranslation();
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
  const tuning = tuningGuideByIdForLanguage(i18n.language).get(entry.id);
  if (tuning) return <TuningGuideBody guide={tuning} />;
  return (
    <>
      {entry.status && <SupersededNote entry={entry} onNavigate={onNavigate} />}
      {entryTypeBody(entry, t, showInlineVerdict)}
    </>
  );
}

// A3 lifecycle — an outdated entry stays findable but reads honestly as superseded/deprecated
// (the corpus is publishable: an old debunk points to its replacement, never silently misleads).
// A5 chain close-out: the link resolves the supersession chain to its CURRENT end — a reader on
// a twice-replaced entry lands on today's guidance, never on another stale stop; multi-hop
// chains name the path so the trail stays auditable.
function SupersededNote({
  entry,
  onNavigate,
}: {
  entry: KnowledgeEntry;
  onNavigate: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const chain =
    entry.status === "superseded" ? supersessionChain(entry, knowledgeByIdForLanguage(i18n.language)) : [];
  const target = chain.length > 0 ? chain[chain.length - 1] : undefined;
  const arrow = t("blackbook.learn.superseded.arrow");
  return (
    <p className="lx-superseded" role="note">
      {entry.status === "superseded" ? (
        <>
          {t("blackbook.learn.superseded.warning")}
          {target ? (
            <>
              {t("blackbook.learn.superseded.seeLinkPre")}
              <button
                type="button"
                className="lx-superseded-link"
                onClick={() => onNavigate(target.id)}
              >
                {target.name}
              </button>
            </>
          ) : null}
          {t("blackbook.learn.superseded.afterLink")}
          {chain.length > 1 && (
            <span className="lx-superseded-chain">
              {t("blackbook.learn.superseded.replacedSteps")}
              {entry.name}
              {arrow}
              {chain.map((c) => c.name).join(arrow)}
            </span>
          )}
        </>
      ) : (
        <>{t("blackbook.learn.superseded.outdated")}</>
      )}
    </p>
  );
}

function entryTypeBody(entry: KnowledgeEntry, t: TFunction, showInlineVerdict = true) {
  switch (entry.type) {
    case "tweak":
      return (
        <>
          {showInlineVerdict && (
            <div className="lx-row">
              <span
                className={`lx-verdict lx-verdict-${entry.verdict}`}
                title={verdictDefinition(entry.verdict, t)}
              >
                {verdictChip(entry.verdict, t)}
              </span>
            </div>
          )}
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
            <b>{t("blackbook.learn.entryTypeBody.spotIt")}</b> {entry.tell}
          </p>
          <p className="lx-line lx-honest">
            <b>{t("blackbook.learn.entryTypeBody.honestVersion")}</b> {entry.honest_version}
          </p>
        </>
      );
    case "guide":
      return (
        <>
          <div className="lx-golden">{t("blackbook.learn.goldenRules")}</div>
          <p className="lx-what">{entry.goal}</p>
          <ol className="lx-steps">
            {entry.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <p className="lx-line lx-undo">
            <b>{t("blackbook.learn.entryTypeBody.undo")}</b> {entry.undo}
          </p>
        </>
      );
  }
}

// Per-type pill label (matches typeLabel but "guide" reads "Guide · safe" per the mock).
function typePill(type: KnowledgeType, t: TFunction): string {
  return type === "guide"
    ? t("blackbook.learn.guideSafePill")
    : t(`blackbook.learn.typeLabel.${type}`);
}

function EntryCard({
  entry,
  defaultOpen = false,
  onOpenChange,
  onNavigate,
  registerRef,
  vendor,
}: {
  entry: KnowledgeEntry;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onNavigate: (id: string) => void;
  registerRef: (el: HTMLDivElement | null) => void;
  vendor: GpuVendor;
}) {
  const { t, i18n } = useTranslation();
  // §5 de-overload: rows are COMPRESSED to name + kind + one-liner and expand IN PLACE (the same
  // expand grammar the autopsy uses). Deep-linked entries open by default. Zero copy changes.
  const [open, setOpen] = useState(defaultOpen);
  useLayoutEffect(() => {
    onOpenChange?.(open);
    return () => onOpenChange?.(false);
  }, [onOpenChange, open]);
  const related = relatedIds(entry, knowledgeForLanguage(i18n.language));
  const walkthrough = walkthroughForKeyForLanguage(entry.id, i18n.language);
  // Tweak cards take the verdict color on their edge; other types take their kind color.
  const accent = entry.type === "tweak" ? `lx-card-${entry.verdict}` : `lx-card-${entry.type}`;
  return (
    <div ref={registerRef} className={`lx-card ${accent} ${open ? "lx-card-open" : ""}`} data-kl-id={entry.id}>
      <button className="lx-card-head cmp-door" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="lx-name">{entry.name}</span>
        <span className={`lx-typepill lx-typepill-${entry.type}`}>{typePill(entry.type, t)}</span>
        {/* Hardware applicability — small honest "fits these rigs" tags; absent = applies to every rig.
            Reuses the existing typepill style (no new CSS) so it reads as a quiet metadata pill. */}
        {entry.applies?.map((a) => {
          const label = t(`blackbook.learn.applicabilityLabels.${a}`, APPLICABILITY_LABELS[a]);
          return (
            <span key={a} className="lx-typepill" title={t("blackbook.learn.applicableTitle", { label })}>
              {label}
            </span>
          );
        })}
        {!open && <span className="lx-oneliner">{oneLiner(entry)}</span>}
        <span className="cmp-door-chevron cmp-door-chevron-end" aria-hidden="true">▸</span>
      </button>
      {open && (
        <div className="lx-card-body">
          <EntryBody entry={entry} onNavigate={onNavigate} />
          {walkthrough && (
            <details className="lx-walkthrough">
              <summary>{t("blackbook.learn.showMeTheWay")}</summary>
              <Walkthrough walkthrough={walkthrough} vendor={vendor} />
            </details>
          )}
          {related.length > 0 && (
            <div className="lx-related">
              <span className="lx-related-label">{t("blackbook.learn.related")}</span>
              {related.map((id) => (
                <button key={id} className="lx-chip" onClick={() => onNavigate(id)}>
                  {knowledgeByIdForLanguage(i18n.language).get(id)!.name}
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
  const { t } = useTranslation();
  const added = formatEntryDate(entry.added);
  if (!added) return null;
  const updated = entry.updated && entry.updated !== entry.added ? formatEntryDate(entry.updated) : null;
  return (
    <p
      className="lx-datenote"
      role="note"
      style={{ margin: "10px 0 0", fontSize: "11px", color: "var(--ix-text-3)" }}
    >
      {t("blackbook.learn.dateNote.addedPre")}
      {added}
      {updated ? (
        <>
          {t("blackbook.learn.dateNote.updatedMid")}
          {updated}
        </>
      ) : null}
    </p>
  );
}

function hitPill(h: AutopsyHit, t: TFunction): { label: string; cls: string } {
  if (h.type === "tweak" && h.verdict) return { label: verdictChip(h.verdict, t), cls: `lx-verdict-${h.verdict}` };
  if (h.type === "trick") return { label: t("blackbook.learn.typeLabel.trick"), cls: "lx-verdict-risky" };
  return { label: t(`blackbook.learn.typeLabel.${h.type}`), cls: "lx-verdict-info" };
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
  const { t, i18n } = useTranslation();
  const { grade, hits, scamFlags, truncated } = result;
  const recognizedNothing = hits.length === 0 && grade.unknown === 0;
  // Expand a graded row IN PLACE (continuity §3) instead of redirecting away from the autopsy.
  const [openId, setOpenId] = useState<string | null>(null);

  if (recognizedNothing) {
    return (
      <div className="lx-result">
        <p className="lx-result-empty">{t("blackbook.learn.autopsy.resultEmpty")}</p>
        <button className="lx-btn lx-btn-ghost" onClick={onClear}>
          {t("blackbook.learn.autopsy.clearAndPasteAnother")}
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
          {t("blackbook.learn.autopsy.stickyPrefix")}
          {preview}
          {trimmed.length > 40 ? "…" : ""}
        </span>
        <span className="lx-autopsy-sticky-count">
          {t("blackbook.learn.autopsy.claimsGraded", { count: claims })}
        </span>
        <button className="lx-btn lx-btn-ghost lx-autopsy-sticky-clear" onClick={onClear}>
          {t("blackbook.learn.autopsy.clear")}
        </button>
      </div>
      <div className="lx-grade">
        {t("blackbook.learn.autopsy.gradePrefix")}{" "}
        <span className="lx-g-real">{`${grade.real} ${t("blackbook.learn.autopsy.real")}`}</span> ·{" "}
        <span className="lx-g-placebo">{`${grade.placebo} ${t("blackbook.learn.autopsy.placebo")}`}</span> ·{" "}
        <span className="lx-g-risky">{`${grade.risky} ${t("blackbook.learn.autopsy.risky")}`}</span> ·{" "}
        <span className="lx-g-unknown">
          {t("blackbook.learn.autopsy.unrecognized", { count: grade.unknown })}
        </span>
      </div>
      {scamFlags > 0 && (
        <div className="lx-scamflag">
          <Icon name="alert" size={15} />
          {t("blackbook.learn.autopsy.scamFlags", { count: scamFlags })}
        </div>
      )}
      <p className="lx-result-note">{t("blackbook.learn.autopsy.resultNote")}</p>
      {/* Visible key above the graded claims, so the verdict chips below read in context (foam-pit). */}
      {hits.length > 0 && <GradeKey />}
      {hits.length > 0 && (
        <ul className="lx-hitlist">
          {hits.map((h) => {
            const pill = hitPill(h, t);
            const open = openId === h.id;
            const entry = knowledgeByIdForLanguage(i18n.language).get(h.id);
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
                    title={h.type === "tweak" && h.verdict ? verdictDefinition(h.verdict, t) : undefined}
                  >
                    {pill.label}
                  </span>
                  {h.occurrences > 1 && <span className="lx-hitcount">×{h.occurrences}</span>}
                </button>
                {open && entry && (
                  <div className="lx-hit-detail">
                    <EntryBody entry={entry} onNavigate={onNavigate} showInlineVerdict={false} />
                    {/* Deliberate travel only — the quiet full-entry link, per the continuity law. */}
                    <button className="lx-howto" onClick={() => onNavigate(h.id)}>
                      {t("blackbook.learn.autopsy.openFullEntry")}
                    </button>
                  </div>
                )}
                {h.howTos.length > 0 && (
                  <div className="lx-howtos">
                    {h.howTos.map((gid) => (
                      <button key={gid} className="lx-howto" onClick={() => onNavigate(gid)}>
                        {t("blackbook.learn.autopsy.safeHowTo")}
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
        <p className="lx-result-note">
          {t("blackbook.learn.autopsy.truncated", { chars: AUTOPSY_MAX_CHARS.toLocaleString() })}
        </p>
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

function AutopsyPanel({
  onNavigate,
  hideRecord = false,
  onRecorded,
}: {
  onNavigate: (id: string) => void;
  // V2-6: under the V2 shell the RoomShell verdict states the autopsy record — the in-panel
  // rollup yields to it (one-mention law). Classic renders it unchanged.
  hideRecord?: boolean;
  onRecorded?: (ledger: AutopsyLedgerEntry[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const [text, setText] = useState(readAutopsyText);
  const [result, setResult] = useState<AutopsyResult | null>(() => {
    try {
      if (sessionStorage.getItem(AUTOPSY_GRADED_KEY) === "1") {
        const pasted = readAutopsyText();
        return pasted.trim() ? autopsyScan(pasted, knowledgeForLanguage(i18n.language)) : null;
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
      <p className="lx-sub">{t("blackbook.learn.autopsy.subLede")}</p>
      {/* A3.8 — your local autopsy record: a running tally of what the guides you've graded turned out
          to be. Counts only, stored on this PC. Shown once you've graded at least one guide. */}
      {!hideRecord && stats.count > 0 && (
        <div className="lx-autopsy-record" role="status">
          <span className="lx-autopsy-record-title">{t("blackbook.learn.autopsy.recordTitle")}</span>
          <span className="lx-autopsy-record-line">
            {t("blackbook.learn.autopsy.recordGuides", { count: stats.count })}
            {stats.gradedTweaks > 0 && (
              <>
                {t("blackbook.learn.autopsy.recordBreakdownPre")}
                <b className="lx-rec-real">{t("blackbook.learn.autopsy.recordRealPct", { pct: stats.realPct })}</b>
                {" · "}
                <b className="lx-rec-placebo">
                  {t("blackbook.learn.autopsy.recordPlaceboPct", { pct: stats.placeboPct })}
                </b>
                {" · "}
                <b className="lx-rec-risky">{t("blackbook.learn.autopsy.recordRiskyPct", { pct: stats.riskyPct })}</b>
              </>
            )}
            {stats.scamFlags > 0 && (
              <>
                {t("blackbook.learn.autopsy.recordScamPre")}
                {t("blackbook.learn.autopsy.recordScam", { count: stats.scamFlags })}
              </>
            )}
          </span>
        </div>
      )}
      <textarea
        className="lx-paste"
        rows={7}
        aria-label={t("blackbook.learn.autopsy.textareaAriaLabel")}
        placeholder={t("blackbook.learn.autopsy.textareaPlaceholder")}
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
            const r = autopsyScan(text, knowledgeForLanguage(i18n.language));
            setResult(r);
            persistAutopsy(text, true);
            const next = recordAutopsy(r);
            setLedger(next);
            onRecorded?.(next);
          }}
        >
          {t("blackbook.learn.autopsy.gradeButton")}
        </button>
        {text && !result && (
          <button className="lx-btn lx-btn-ghost" onClick={clear}>
            {t("blackbook.learn.autopsy.clear")}
          </button>
        )}
      </div>
      {/* §7 — honest in-voice coaching for a pasted link; reinforces the privacy promise at the exact
          moment it costs the user something. NO fetch, NO domain/title grading of unread pages. */}
      {urlKind ? (
        <div className="lx-urlcard" role="status">
          <p className="lx-urlcard-lead">{t("blackbook.learn.autopsy.urlLead")}</p>
          <p className="lx-urlcard-how">
            {urlKind === "youtube"
              ? t("blackbook.learn.autopsy.urlHowYoutube")
              : t("blackbook.learn.autopsy.urlHowWebpage")}
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
  v2 = false,
  keepRecord = false,
  onAutopsyRecorded,
}: {
  onClose: () => void;
  focusId?: string | null;
  asPanel?: boolean;
  vendor?: GpuVendor;
  // V2-6 (additive — absent = classic byte-identical, test-pinned): the V2 Blackbook room
  // provides the ONE room summary via RoomShell, so the standalone head (title + tagline) and
  // the in-panel autopsy record yield to it (one-mention law). The record feeds the room
  // verdict live through onAutopsyRecorded instead.
  v2?: boolean;
  // Title-header law (owner 2026-07-10 round 2): with the HUD header reduced to a title, the
  // RoomShell verdict no longer carries the autopsy record/coaching — the in-panel record and
  // the browse-mode Autopsy hint return to their context here (still ONE mention: panel, not
  // header). Only meaningful with v2; classic ignores it.
  keepRecord?: boolean;
  onAutopsyRecorded?: (ledger: AutopsyLedgerEntry[]) => void;
}) {
  const { t, i18n } = useTranslation();
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
  const [gradeKeyEntryOpen, setGradeKeyEntryOpen] = useState(false);
  const [phIdx, setPhIdx] = useState(0);
  // Motion law: gate on the project's resolved pref (Compy motion is ON by default and OVERRIDES OS
  // reduce-motion), NEVER raw matchMedia — the owner's WebView2 reports reduce=true, which had silently
  // frozen the placeholder cycling even though motion should run. Reactive so a Settings toggle re-arms it.
  const reducedMotion = useReducedMotion();
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
      const e = knowledgeByIdForLanguage(i18n.language).get(focusId);
      if (e) setOpenCats((prev) => new Set(prev).add(e.type)); // expand its category so it's reachable
    }
  }, [focusId, i18n.language]);

  // Persist the room's mode so the autopsy survives leaving + returning (continuity §3); modal excluded.
  useEffect(() => {
    if (!asPanel) return;
    try {
      sessionStorage.setItem(LEARN_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode, asPanel]);

  // Cycle the placeholder examples; frozen (static first) when motion is reduced.
  useEffect(() => {
    if (reducedMotion) return;
    const id = window.setInterval(() => setPhIdx((i) => (i + 1) % PLACEHOLDERS.length), 2800);
    return () => window.clearInterval(id);
  }, [reducedMotion]);

  const results = useMemo(() => {
    let hits = searchKnowledge(deferredQ, knowledgeForLanguage(i18n.language));
    if (filter !== "all") hits = hits.filter((e) => e.type === filter);
    if (verdict !== "all") hits = hits.filter((e) => e.type === "tweak" && e.verdict === verdict);
    if (topic !== "all") hits = hits.filter((e) => e.topic === topic);
    // Hardware applicability: an entry with no `applies` is universal (matches any rig); a tagged entry
    // matches only when it lists the chosen rig. So a "Fits: NVIDIA" view shows universal + NVIDIA entries.
    if (fits !== "all") hits = hits.filter((e) => !e.applies || e.applies.includes(fits));
    return hits;
  }, [deferredQ, filter, verdict, topic, fits, i18n.language]);

  // §5 "Start here" — the guides are the actionable entry points (capped). Shown only in pure browse.
  const startHere = useMemo(
    () => knowledgeForLanguage(i18n.language).filter((e) => e.type === "guide").slice(0, 5),
    [i18n.language],
  );

  // Scroll the focused entry into view and flash it once it's in the rendered list. `openCats`
  // must be a dependency (owner-catch chain 2026-07-13): on a deep-link the sibling effect expands
  // the entry's category AFTER this first runs — the card isn't rendered yet (`cardRefs` miss), the
  // early-return fires, and without `openCats` here it never re-ran, so "More in the Blackbook →"
  // landed on an unscrolled list with the focused card off-screen.
  useEffect(() => {
    if (mode !== "browse" || !focused) return;
    const el = cardRefs.current.get(focused);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("lx-flash");
    const t = setTimeout(() => el.classList.remove("lx-flash"), 1200);
    return () => clearTimeout(t);
  }, [focused, results, mode, openCats]);

  const navigateTo = (id: string) => {
    const byId = knowledgeByIdForLanguage(i18n.language);
    if (!byId.has(id)) return;
    setMode("browse");
    setQ("");
    setFilter("all");
    setVerdict("all");
    setTopic("all");
    setFits("all");
    setFocused(id);
    const e = byId.get(id);
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
          {/* Under the V2 shell the RoomShell verdict is the ONE summary — the standalone
              head yields (one-mention law). v2 only ever renders as a rail room (asPanel),
              so no Close button is lost. */}
          {!v2 && (
            <div className="lx-head">
              <div>
                <h2 className="lx-title" id="lx-modal-title">{t("common.rail.learn", "Blackbook")}</h2>
                <p className="lx-tagline">{t("blackbook.learn.tagline")}</p>
              </div>
              {/* As a rail room there's no "Close" (you leave via the rail); only the modal form has it. */}
              {!asPanel && (
                <button className="lx-btn lx-btn-ghost" onClick={onClose}>
                  {t("blackbook.learn.close")}
                </button>
              )}
            </div>
          )}

          {/* Surface the Autopsy — Blackbook's most distinctive trick (paste a guide, get it graded
              offline) otherwise hides behind the mode tab. One quiet honest line, browse-only.
              Under v2 the RoomShell verdict sub coached "paste a whole guide" so the hint yielded
              (one-mention) — under the title-header HUD (keepRecord) that sub is gone, so the hint
              returns as the coaching's one home. */}
          {mode === "browse" && (!v2 || keepRecord) && (
            <button className="lx-autopsy-hint cmp-door" onClick={() => setMode("autopsy")}>
              {t("blackbook.learn.autopsyHint")}
              <span className="cmp-door-chevron" aria-hidden="true">→</span>
            </button>
          )}

          <div className="lx-modes" role="tablist" aria-label={t("blackbook.learn.modeAriaLabel")}>
            <button
              role="tab"
              aria-selected={mode === "browse"}
              className={`lx-mode ${mode === "browse" ? "lx-mode-on" : ""}`}
              onClick={() => setMode("browse")}
            >
              {t("blackbook.learn.modes.browse")}
            </button>
            <button
              role="tab"
              aria-selected={mode === "autopsy"}
              className={`lx-mode ${mode === "autopsy" ? "lx-mode-on" : ""}`}
              onClick={() => setMode("autopsy")}
            >
              {t("blackbook.learn.modes.autopsy")}
            </button>
          </div>

          {mode === "autopsy" ? (
            <AutopsyPanel
              onNavigate={navigateTo}
              hideRecord={v2 && !keepRecord}
              onRecorded={onAutopsyRecorded}
            />
          ) : (
            <>
              <input
                className="lx-search"
                autoFocus
                aria-label={t("blackbook.learn.searchAriaLabel")}
                placeholder={t("blackbook.learn.searchPlaceholder", { example: PLACEHOLDERS[phIdx] })}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setFocused(null);
                }}
              />
              <div className="lx-filters" role="group" aria-label={t("blackbook.learn.filterByTypeAriaLabel")}>
                {FILTER_KEYS.map((key) => (
                  <button
                    key={key}
                    className={`lx-filter ${filter === key ? "lx-filter-on" : ""}`}
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                  >
                    {t(`blackbook.learn.filters.${key}`)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="lx-morefilters"
                aria-expanded={moreFilters}
                onClick={() => setMoreFilters((o) => !o)}
              >
                {moreFilters ? t("blackbook.learn.fewerFilters") : t("blackbook.learn.moreFilters")}
                {!moreFilters && activeSecondary > 0 && (
                  <span className="lx-morefilters-count">{activeSecondary}</span>
                )}
              </button>
              {moreFilters && (
                <>
              {/* §5 verdict chips — narrow tweaks by our verdict, alongside the type filters. The
                  inline "Grade:" label names the axis so this row doesn't read as a second type filter. */}
              <div className="lx-filters lx-vfilters" role="group" aria-label={t("blackbook.learn.verdictFilterAriaLabel")}>
                <span className="lx-vfilter-label" aria-hidden="true">{t("blackbook.learn.gradeLabel")}</span>
                <button
                  className={`lx-filter ${verdict === "all" ? "lx-filter-on" : ""}`}
                  aria-pressed={verdict === "all"}
                  onClick={() => setVerdict("all")}
                >
                  {t("blackbook.learn.anyVerdict")}
                </button>
                {VERDICT_FILTER_KEYS.map((key) => (
                  <button
                    key={key}
                    className={`lx-filter lx-vfilter-${key} ${verdict === key ? "lx-filter-on" : ""}`}
                    aria-pressed={verdict === key}
                    onClick={() => setVerdict(key)}
                    title={verdictDefinition(key, t)}
                  >
                    {t(`blackbook.learn.verdictFilters.${key}`)}
                  </button>
                ))}
              </div>
              {/* A3 topic filter — narrow the library by what an entry is ABOUT (display, GPU,
                  network…), orthogonal to the type + verdict axes. Labelled so the row reads as its
                  own axis, not a third type filter. */}
              <div className="lx-filters lx-vfilters" role="group" aria-label={t("blackbook.learn.topicFilterAriaLabel")}>
                <span className="lx-vfilter-label" aria-hidden="true">{t("blackbook.learn.topicLabel")}</span>
                <button
                  className={`lx-filter ${topic === "all" ? "lx-filter-on" : ""}`}
                  aria-pressed={topic === "all"}
                  onClick={() => setTopic("all")}
                >
                  {t("blackbook.learn.anyTopic")}
                </button>
                {TOPICS.map((tp) => (
                  <button
                    key={tp}
                    className={`lx-filter ${topic === tp ? "lx-filter-on" : ""}`}
                    aria-pressed={topic === tp}
                    onClick={() => setTopic(tp)}
                  >
                    {t(`blackbook.learn.topicLabels.${tp}`, TOPIC_LABELS[tp])}
                  </button>
                ))}
              </div>
              {/* Hardware applicability filter — narrow to entries that fit a chosen rig (AMD / NVIDIA /
                  Intel / laptop / desktop). Universal entries (no tags) always show; only rig-specific
                  ones are hidden when they don't match. Labelled so the row reads as its own axis. */}
              <div className="lx-filters lx-vfilters" role="group" aria-label={t("blackbook.learn.fitsFilterAriaLabel")}>
                <span className="lx-vfilter-label" aria-hidden="true">{t("blackbook.learn.fitsLabel")}</span>
                <button
                  className={`lx-filter ${fits === "all" ? "lx-filter-on" : ""}`}
                  aria-pressed={fits === "all"}
                  onClick={() => setFits("all")}
                >
                  {t("blackbook.learn.anyRig")}
                </button>
                {APPLICABILITY.map((a) => (
                  <button
                    key={a}
                    className={`lx-filter ${fits === a ? "lx-filter-on" : ""}`}
                    aria-pressed={fits === a}
                    onClick={() => setFits(a)}
                  >
                    {t(`blackbook.learn.applicabilityLabels.${a}`, APPLICABILITY_LABELS[a])}
                  </button>
                ))}
              </div>
                </>
              )}
              {/* The visible "How we grade" key — gives the verdict filter chips above their meaning
                  (foam-pit law: on the page, not hover-only). Full on a reader's first browse, a quiet
                  re-openable toggle thereafter so it stops re-claiming a block every visit. */}
              <CollapsibleGradeKey suppressed={gradeKeyEntryOpen} />
              {results.length === 0 ? (
                <div className="lx-empty">{t("blackbook.learn.empty")}</div>
              ) : !deferredQ.trim() && filter === "all" && verdict === "all" && topic === "all" && fits === "all" ? (
                // §5 PURE BROWSE — "Start here" strip + collapsed category sections (the calm open).
                <>
                  <div className="lx-starthere">
                    <span className="lx-starthere-label">{t("blackbook.learn.startHere")}</span>
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
                          <span className="lx-cat-text">
                            <span className="lx-cat-title">{t(`blackbook.learn.typeLabelPlural.${type}`)}</span>
                            <span className="lx-cat-desc">{t(`blackbook.learn.typeDesc.${type}`)}</span>
                          </span>
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
                                onOpenChange={
                                  e.id === VERDICT_GLOSSARY_ENTRY_ID ? setGradeKeyEntryOpen : undefined
                                }
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
                      onOpenChange={
                        e.id === VERDICT_GLOSSARY_ENTRY_ID ? setGradeKeyEntryOpen : undefined
                      }
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
