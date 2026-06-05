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
import "./TweakEncyclopedia.css";

// The knowledge library: one offline, bundled, searchable surface across tweaks, terms, scam-pattern
// "tricks", and safe step-by-step guides, plus the Guide Autopsy (paste a guide, get an honest grade).
// Read-only — no network, no mutation, no new capabilities. (File keeps its name so App's import is
// undisturbed; the surface is now the full library.)

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

function EntryBody({ entry }: { entry: KnowledgeEntry }) {
  switch (entry.type) {
    case "tweak":
      return (
        <>
          <div className="kl-row">
            <span className={`tweak-pill tweak-pill-${entry.verdict}`}>{VERDICT_LABEL[entry.verdict]}</span>
          </div>
          <p className="tweak-what">{entry.what}</p>
          <p className="tweak-why">{entry.why}</p>
        </>
      );
    case "term":
      return (
        <>
          <p className="tweak-what">{entry.what}</p>
          <p className="tweak-why">{entry.more}</p>
        </>
      );
    case "trick":
      return (
        <>
          <p className="tweak-what">{entry.pattern}</p>
          <p className="kl-line">
            <b>Spot it:</b> {entry.tell}
          </p>
          <p className="kl-line kl-honest">
            <b>The honest version:</b> {entry.honest_version}
          </p>
        </>
      );
    case "guide":
      return (
        <>
          <div className="kl-golden">{GOLDEN_RULES}</div>
          <p className="tweak-what">{entry.goal}</p>
          <ol className="kl-steps">
            {entry.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <p className="kl-line kl-undo">
            <b>Undo:</b> {entry.undo}
          </p>
        </>
      );
  }
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
  // Tweak cards keep the verdict-colored edge; other types are tinted by their kind.
  const accent = entry.type === "tweak" ? `tweak-${entry.verdict}` : `kl-${entry.type}`;
  return (
    <div ref={registerRef} className={`tweak-entry kl-card ${accent}`} data-kl-id={entry.id}>
      <div className="tweak-entry-head">
        <span className="tweak-name">{entry.name}</span>
        <span className={`kl-typepill kl-typepill-${entry.type}`}>{TYPE_LABEL[entry.type]}</span>
      </div>
      <EntryBody entry={entry} />
      {related.length > 0 && (
        <div className="kl-related">
          <span className="kl-related-label">Related</span>
          {related.map((id) => (
            <button key={id} className="kl-chip" onClick={() => onNavigate(id)}>
              {KNOWLEDGE_BY_ID.get(id)!.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function hitPill(h: AutopsyHit): { label: string; cls: string } {
  if (h.type === "tweak" && h.verdict) return { label: VERDICT_LABEL[h.verdict], cls: `tweak-pill-${h.verdict}` };
  if (h.type === "trick") return { label: "Scam pattern", cls: "kl-pill-trick" };
  return { label: TYPE_LABEL[h.type], cls: "kl-pill-info" };
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
      <div className="kl-result">
        <p className="kl-result-empty">
          We didn't spot anything we recognize in that. Paste a guide that actually names tweaks or
          settings and we'll grade each one.
        </p>
      </div>
    );
  }

  return (
    <div className="kl-result">
      <div className="kl-grade">
        This guide: <span className="kl-g-real">{`${grade.real} real`}</span> ·{" "}
        <span className="kl-g-placebo">{`${grade.placebo} placebo`}</span> ·{" "}
        <span className="kl-g-risky">{`${grade.risky} risky`}</span> ·{" "}
        <span className="kl-g-unknown">
          {`${grade.unknown} thing${grade.unknown === 1 ? "" : "s"} we don't recognize`}
        </span>
      </div>
      {scamFlags > 0 && (
        <div className="kl-scamflag">
          <Icon name="alert" size={15} />
          {scamFlags} known scam pattern{scamFlags > 1 ? "s" : ""} in here — open the flagged rows below.
        </div>
      )}
      <p className="kl-result-note">
        Anything we don't recognize gets no verdict — we won't guess. Tap a row to read the full entry.
      </p>
      {hits.length > 0 && (
        <ul className="kl-hitlist">
          {hits.map((h) => {
            const pill = hitPill(h);
            return (
              <li key={h.id}>
                <button className="kl-hitrow" onClick={() => onNavigate(h.id)}>
                  <span className="kl-hitname">{h.name}</span>
                  <span className={`tweak-pill ${pill.cls}`}>{pill.label}</span>
                  {h.occurrences > 1 && <span className="kl-hitcount">×{h.occurrences}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {truncated && (
        <p className="kl-result-note">We graded the first {(100000).toLocaleString()} characters of a longer paste.</p>
      )}
    </div>
  );
}

function AutopsyPanel({ onNavigate }: { onNavigate: (id: string) => void }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<AutopsyResult | null>(null);

  return (
    <div className="kl-autopsy">
      <p className="tweak-sub">
        Paste a tweak guide — a forum post, a video description, a "do these 10 things" list — and get
        the autopsy. Nothing leaves your PC; it's matched against this library, offline.
      </p>
      <textarea
        className="kl-paste"
        rows={7}
        aria-label="Paste a tweak guide to autopsy"
        placeholder="Paste the guide here…"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setResult(null);
        }}
      />
      <div className="kl-autopsy-actions">
        <button className="btn" disabled={!text.trim()} onClick={() => setResult(autopsyScan(text))}>
          Grade this guide
        </button>
        {text && (
          <button
            className="btn btn-small"
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

export default function Library({
  onClose,
  focusId = null,
}: {
  onClose: () => void;
  focusId?: string | null;
}) {
  const [mode, setMode] = useState<Mode>("browse");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [focused, setFocused] = useState<string | null>(focusId);
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
    el.classList.add("kl-flash");
    const t = setTimeout(() => el.classList.remove("kl-flash"), 1200);
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
    <div className="tweak-backdrop" onClick={onClose}>
      <div className="tweak-modal kl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tweak-head">
          <h2>Knowledge library</h2>
          <button className="btn btn-small" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="kl-modes" role="tablist" aria-label="Library mode">
          <button
            role="tab"
            aria-selected={mode === "browse"}
            className={`kl-mode ${mode === "browse" ? "kl-mode-on" : ""}`}
            onClick={() => setMode("browse")}
          >
            Look it up
          </button>
          <button
            role="tab"
            aria-selected={mode === "autopsy"}
            className={`kl-mode ${mode === "autopsy" ? "kl-mode-on" : ""}`}
            onClick={() => setMode("autopsy")}
          >
            Autopsy a guide
          </button>
        </div>

        {mode === "autopsy" ? (
          <AutopsyPanel onNavigate={navigateTo} />
        ) : (
          <>
            <p className="tweak-sub">
              Type any word you heard online — a tweak, a bit of jargon, or a sketchy "optimizer"
              trick — and get the honest answer. Everything here is verified and offline.
            </p>
            <input
              className="tweak-search"
              autoFocus
              aria-label="Search the knowledge library"
              placeholder="Search (e.g. XMP, 1% lows, deep scan, frame gen)…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setFocused(null);
              }}
            />
            <div className="kl-filters" role="group" aria-label="Filter by type">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  className={`kl-filter ${filter === f.key ? "kl-filter-on" : ""}`}
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="tweak-list">
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
                <div className="tweak-empty">
                  No entry for that yet — we only answer what we've verified. If you're unsure about a
                  tweak that isn't here, measure it with Compy's benchmark instead of trusting a forum.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
