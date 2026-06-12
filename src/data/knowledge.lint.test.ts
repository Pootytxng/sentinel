// Dataset lint — the guardrail that keeps the knowledge library honest and well-formed. Runs as a
// real unit test (not a loose script) so a malformed or off-voice entry fails CI, not production.

import { describe, it, expect } from "vitest";
import rawTweaks from "./tweaks.json";
import rawTerms from "./terms.json";
import rawTricks from "./tricks.json";
import rawGuides from "./guides.json";
import { KNOWLEDGE } from "./knowledge";

type Raw = Record<string, unknown>;

const TWEAKS = rawTweaks as Raw[];
const TERMS = rawTerms as Raw[];
const TRICKS = rawTricks as Raw[];
const GUIDES = rawGuides as Raw[];

const isStr = (v: unknown): v is string => typeof v === "string";
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

// Required keys per type: the structural contract each entry must satisfy.
const REQUIRED = {
  tweak: { strings: ["id", "name", "verdict", "what", "why"], arrays: ["aliases"] },
  term: { strings: ["id", "name", "what", "more"], arrays: ["aliases", "related"] },
  trick: { strings: ["id", "name", "pattern", "tell", "honest_version"], arrays: ["aliases", "related"] },
  guide: { strings: ["id", "name", "tier", "goal", "undo"], arrays: ["aliases", "related", "steps"] },
} as const;

// User-facing prose, by type — these get the banned-word + non-empty voice checks.
function proseOf(type: keyof typeof REQUIRED, e: Raw): string[] {
  switch (type) {
    case "tweak":
      return [e.name, e.what, e.why].filter(isStr);
    case "term":
      return [e.name, e.what, e.more].filter(isStr);
    case "trick":
      return [e.name, e.pattern, e.tell, e.honest_version].filter(isStr);
    case "guide":
      return [e.name, e.goal, e.undo, ...((e.steps as string[]) ?? [])].filter(isStr);
  }
}

const BANNED = /\b(simply|obviously|basically)\b/i;

describe("knowledge dataset lint", () => {
  const groups: [keyof typeof REQUIRED, Raw[]][] = [
    ["tweak", TWEAKS],
    ["term", TERMS],
    ["trick", TRICKS],
    ["guide", GUIDES],
  ];

  it("every entry has its required keys with the right shapes", () => {
    for (const [type, list] of groups) {
      for (const e of list) {
        for (const k of REQUIRED[type].strings) {
          expect(isStr(e[k]), `${type} ${String(e.id)} missing string "${k}"`).toBe(true);
        }
        for (const k of REQUIRED[type].arrays) {
          expect(isStrArr(e[k]), `${type} ${String(e.id)} missing string[] "${k}"`).toBe(true);
        }
      }
    }
  });

  it("tweak verdicts are one of real | placebo | risky", () => {
    for (const e of TWEAKS) {
      expect(["real", "placebo", "risky"], `tweak ${String(e.id)}`).toContain(e.verdict);
    }
  });

  it("every shipped guide is tier 'safe' (no gated/risky content this chapter)", () => {
    for (const e of GUIDES) {
      expect(e.tier, `guide ${String(e.id)}`).toBe("safe");
    }
  });

  it("ids are unique across ALL types", () => {
    const ids = KNOWLEDGE.map((e) => e.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes, `duplicate ids: ${[...new Set(dupes)].join(", ")}`).toEqual([]);
  });

  it("every related id resolves to a real entry", () => {
    const known = new Set(KNOWLEDGE.map((e) => e.id));
    const broken: string[] = [];
    for (const e of KNOWLEDGE) {
      for (const r of e.related) if (!known.has(r)) broken.push(`${e.id} -> ${r}`);
    }
    expect(broken, `dangling related links: ${broken.join(", ")}`).toEqual([]);
  });

  it("no entry lists its own id in related (no self-references)", () => {
    const offenders = KNOWLEDGE.filter((e) => e.related.includes(e.id)).map((e) => e.id);
    expect(offenders, `self-referencing related: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no two entries of the SAME type claim the same alias (search/autopsy shadowing)", () => {
    // Cross-TYPE sharing is deliberate (a graded tweak and its term explainer both answer "XMP");
    // within one type a duplicate alias makes name+alias resolution ambiguous — one entry silently
    // shadows the other in the Guide Autopsy matcher and search ranking. Found live once:
    // "adaptive sync" on both vrr and gsync-freesync (R5 Lane 3; the umbrella term kept it).
    for (const [type, list] of groups) {
      const owners = new Map<string, string>();
      const dupes: string[] = [];
      for (const e of list) {
        for (const a of (e.aliases as string[]) ?? []) {
          const key = a.toLowerCase().trim();
          const prev = owners.get(key);
          if (prev && prev !== String(e.id)) dupes.push(`${type} "${a}": ${prev} vs ${String(e.id)}`);
          owners.set(key, String(e.id));
        }
      }
      expect(dupes, `same-type alias collisions:\n${dupes.join("\n")}`).toEqual([]);
    }
  });

  it("has no empty strings in any field (prose, aliases, related, steps)", () => {
    const empties: string[] = [];
    for (const [type, list] of groups) {
      for (const e of list) {
        const strings = [
          ...proseOf(type, e),
          ...((e.aliases as string[]) ?? []),
          ...((e.related as string[]) ?? []),
        ];
        for (const s of strings) if (isStr(s) && s.trim() === "") empties.push(String(e.id));
      }
    }
    expect(empties, `empty strings in: ${empties.join(", ")}`).toEqual([]);
  });

  it("uses none of the banned words (simply / obviously / basically) in user-facing prose", () => {
    const offenders: string[] = [];
    for (const [type, list] of groups) {
      for (const e of list) {
        for (const s of proseOf(type, e)) {
          if (BANNED.test(s)) offenders.push(`${type} ${String(e.id)}: "${s}"`);
        }
      }
    }
    expect(offenders, `banned words found:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("ships the expected dataset volume (sanity floor)", () => {
    // 42 frozen seed + aim-tweaks (owner 2026-06-08) + 3 sprint debunks (2026-06-10: disable-smt-gaming,
    // nvidia-prefer-max-performance, cpu-affinity-games) + memory-compression-off (2026-06-11, the
    // Leftovers detector's explainer — R1 flagged the WhatsThis gap) + 4 R3 Lane F debunks
    // (2026-06-12: game-boosters, ram-cleaners, app-hw-accel-off, dns-for-gaming — search-intent
    // picks pairing with the dark-site pages) + 4 R5 Lane 2 debunks (2026-06-12: run-as-admin-fps,
    // high-priority-games, defrag-ssd, gpu-overclocking — popular-myth gaps in the coverage map).
    // These are Library EXPLAINERS (graded real/placebo/risky), NOT appliable recs — Compy applies
    // none of them, so the ~29 appliable-catalog freeze is untouched. The pin stays exact as a
    // curation drift-guard.
    expect(TWEAKS.length).toBe(55);
    expect(TERMS.length).toBeGreaterThanOrEqual(50);
    expect(TRICKS.length).toBeGreaterThanOrEqual(12);
    expect(GUIDES.length).toBeGreaterThanOrEqual(6);
  });
});
