import { useMemo, useState } from "react";
import rawTweaks from "../data/tweaks.json";
import "./TweakEncyclopedia.css";

// Wave-2 #3 — in-app honest verdicts on popular tweaks (real / placebo / risky-refused). The
// dataset (src/data/tweaks.json) is a SEED that Cowork's drafted dataset drops into; this file owns
// the schema + the search surface. Static + bundled — no network, no remote-rules implications.

export type TweakVerdict = "real" | "placebo" | "risky";
export type TweakEntry = {
  id: string;
  name: string;
  aliases?: string[];
  verdict: TweakVerdict;
  what: string;
  why: string;
};

const TWEAKS = rawTweaks as TweakEntry[];

const VERDICT_LABEL: Record<TweakVerdict, string> = {
  real: "Real",
  placebo: "Placebo",
  risky: "Risky — refused",
};

export default function TweakEncyclopedia({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return TWEAKS;
    return TWEAKS.filter((t) =>
      [t.name, t.what, t.why, ...(t.aliases ?? [])].join(" ").toLowerCase().includes(needle),
    );
  }, [q]);

  return (
    <div className="tweak-backdrop" onClick={onClose}>
      <div className="tweak-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tweak-head">
          <h2>Check a tweak before you try it</h2>
          <button className="btn btn-small" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="tweak-sub">
          Honest verdicts on popular tweaks — real, placebo, or risky-and-refused — with what each
          one actually does. Search anything you saw online.
        </p>
        <input
          className="tweak-search"
          autoFocus
          placeholder="Search tweaks (e.g. HPET, MSI mode, game mode)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="tweak-list">
          {results.map((t) => (
            <div key={t.id} className={`tweak-entry tweak-${t.verdict}`}>
              <div className="tweak-entry-head">
                <span className="tweak-name">{t.name}</span>
                <span className={`tweak-pill tweak-pill-${t.verdict}`}>
                  {VERDICT_LABEL[t.verdict]}
                </span>
              </div>
              <p className="tweak-what">{t.what}</p>
              <p className="tweak-why">{t.why}</p>
            </div>
          ))}
          {results.length === 0 && (
            <div className="tweak-empty">
              No match yet. "Not in the book" doesn't mean safe — when you're unsure, measure it with
              Compy's benchmark instead of trusting a forum.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
