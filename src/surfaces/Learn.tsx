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
  onNavigate,
  registerRef,
}: {
  entry: KnowledgeEntry;
  onNavigate: (id: string) => void;
  registerRef: (el: HTMLDivElement | null) => void;
}) {
  const related = relatedIds(entry, KNOWLEDGE);
  // Tweak cards take the verdict color on their edge; other types take their kind color.
  const accent = entry.type === "tweak" ? `lx-card-${entry.verdict}` : `lx-card-${entry.type}`;
  return (
    <div ref={registerRef} className={`lx-card ${accent}`} data-kl-id={entry.id}>
      <div className="lx-card-head">
        <span className="lx-name">{entry.name}</span>
        <span className={`lx-typepill lx-typepill-${entry.type}`}>{typePill(entry.type)}</span>
      </div>
      <EntryBody entry={entry} />
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
  );
}

function hitPill(h: AutopsyHit): { label: string; cls: string } {
  if (h.type === "tweak" && h.verdict) return { label: VERDICT_LABEL[h.verdict], cls: `lx-verdict-${h.verdict}` };
  if (h.type === "trick") return { label: "Scam pattern", cls: "lx-verdict-risky" };
  return { label: TYPE_LABEL[h.type], cls: "lx-verdict-info" };
}

function AutopsyResultView({
  result,
  onNavigate,
}: {
  result: AutopsyResult;
  onNavigate: (id: string) => void;
}) {
  const { grade, hits, scamFlags, truncated } = result;
  const recognizedNothing = hits.length === 0 && grade.unknown === 0;

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

  return (
    <div className="lx-result">
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
        Anything we don't recognize gets no verdict — we won't guess. Tap a row to read the full entry.
      </p>
      {hits.length > 0 && (
        <ul className="lx-hitlist">
          {hits.map((h) => {
            const pill = hitPill(h);
            return (
              <li key={h.id}>
                <button className="lx-hitrow" onClick={() => onNavigate(h.id)}>
                  <span className="lx-hitname">{h.name}</span>
                  <span className={`lx-verdict ${pill.cls}`}>{pill.label}</span>
                  {h.occurrences > 1 && <span className="lx-hitcount">×{h.occurrences}</span>}
                </button>
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

function AutopsyPanel({ onNavigate }: { onNavigate: (id: string) => void }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<AutopsyResult | null>(null);

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
        }}
      />
      <div className="lx-autopsy-actions">
        <button className="lx-btn" disabled={!text.trim()} onClick={() => setResult(autopsyScan(text))}>
          Grade this guide
        </button>
        {text && (
          <button
            className="lx-btn lx-btn-ghost"
            onClick={() => {
              setText("");
              setResult(null);
            }}
          >
            Clear
          </button>
        )}
      </div>
      {result && <AutopsyResultView result={result} onNavigate={onNavigate} />}
    </div>
  );
}

export default function Learn({
  onClose,
  focusId = null,
  asPanel = false,
}: {
  onClose: () => void;
  focusId?: string | null;
  asPanel?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("browse");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
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
    }
  }, [focusId]);

  // Cycle the placeholder examples; frozen (static first) under prefers-reduced-motion.
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setPhIdx((i) => (i + 1) % PLACEHOLDERS.length), 2800);
    return () => window.clearInterval(id);
  }, []);

  const results = useMemo(() => {
    const hits = searchKnowledge(deferredQ);
    return filter === "all" ? hits : hits.filter((e) => e.type === filter);
  }, [deferredQ, filter]);

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
    setFocused(id);
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
              <div className="lx-list">
                {results.map((e) => (
                  <EntryCard
                    key={e.id}
                    entry={e}
                    onNavigate={navigateTo}
                    registerRef={(el) => {
                      if (el) cardRefs.current.set(e.id, el);
                      else cardRefs.current.delete(e.id);
                    }}
                  />
                ))}
                {results.length === 0 && (
                  <div className="lx-empty">
                    No entry for that yet — we only answer what we've verified. If you're unsure about a
                    tweak that isn't here, measure it with Compy's benchmark instead of trusting a forum.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
