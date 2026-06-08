import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  KNOWLEDGE,
  KNOWLEDGE_BY_ID,
  relatedIds,
  type KnowledgeEntry,
  type KnowledgeType,
  type TweakVerdict,
} from "../data/knowledge";
import { searchKnowledge } from "../data/knowledge-search";
import { autopsyScan, type AutopsyHit, type AutopsyResult } from "../data/knowledge-autopsy";
import { Icon } from "../design";
import { Walkthrough } from "../design/Walkthrough";
import { walkthroughForKey, type GpuVendor } from "./walkthroughs";
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

const VERDICT_LABEL: Record<TweakVerdict, string> = {
  real: "Real",
  placebo: "Placebo",
  risky: "Risky — refused",
};

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

function EntryBody({ entry }: { entry: KnowledgeEntry }) {
  switch (entry.type) {
    case "tweak":
      return (
        <>
          <div className="lx-row">
            <span className={`lx-verdict lx-verdict-${entry.verdict}`}>{VERDICT_LABEL[entry.verdict]}</span>
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
        {!open && <span className="lx-oneliner">{oneLiner(entry)}</span>}
        <span className="cmp-door-chevron cmp-door-chevron-end" aria-hidden="true">▸</span>
      </button>
      {open && (
        <div className="lx-card-body">
          <EntryBody entry={entry} />
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
        </div>
      )}
    </div>
  );
}

function hitPill(h: AutopsyHit): { label: string; cls: string } {
  if (h.type === "tweak" && h.verdict) return { label: VERDICT_LABEL[h.verdict], cls: `lx-verdict-${h.verdict}` };
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
                  <span className={`lx-verdict ${pill.cls}`}>{pill.label}</span>
                  {h.occurrences > 1 && <span className="lx-hitcount">×{h.occurrences}</span>}
                </button>
                {open && entry && (
                  <div className="lx-hit-detail">
                    <EntryBody entry={entry} />
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
        <p className="lx-result-note">We graded the first {(100000).toLocaleString()} characters of a longer paste.</p>
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
            setResult(autopsyScan(text));
            persistAutopsy(text, true);
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
    return hits;
  }, [deferredQ, filter, verdict]);

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
    setFocused(id);
    const e = KNOWLEDGE_BY_ID.get(id);
    if (e) setOpenCats((prev) => new Set(prev).add(e.type)); // expand its category
  };

  return (
    <div
      className={`lx-backdrop ${asPanel ? "lx-aspanel" : ""}`}
      onClick={asPanel ? undefined : onClose}
    >
      <div className="lx-modal" onClick={(e) => e.stopPropagation()}>
        <div className="lx-dotgrid" aria-hidden="true" />
        <div className="lx-inner">
          <div className="lx-head">
            <div>
              <h2 className="lx-title">Learn</h2>
              <p className="lx-tagline">
                Look up any tweak, term, or scam you heard online — we only answer what we've verified.
              </p>
            </div>
            {/* As a rail room there's no "Close" (you leave via the rail); only the modal form has it. */}
            {!asPanel && (
              <button className="lx-btn lx-btn-ghost" onClick={onClose}>
                Close
              </button>
            )}
          </div>

          <div className="lx-modes" role="tablist" aria-label="Library mode">
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
              {/* §5 verdict chips — narrow tweaks by our verdict, alongside the type filters. */}
              <div className="lx-filters lx-vfilters" role="group" aria-label="Filter tweaks by verdict">
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
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              {results.length === 0 ? (
                <div className="lx-empty">
                  No entry for that yet — we only answer what we've verified. If you're unsure about a
                  tweak that isn't here, measure it with Compy's benchmark instead of trusting a forum.
                </div>
              ) : !deferredQ.trim() && filter === "all" && verdict === "all" ? (
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
