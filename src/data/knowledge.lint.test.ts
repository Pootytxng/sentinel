// Dataset lint — the guardrail that keeps the knowledge library honest and well-formed. Runs as a
// real unit test (not a loose script) so a malformed or off-voice entry fails CI, not production.

import { describe, it, expect } from "vitest";
import rawTweaks from "./tweaks.json";
import rawTerms from "./terms.json";
import rawTricks from "./tricks.json";
import rawGuides from "./guides.json";
import { KNOWLEDGE, KNOWLEDGE_BY_ID, APPLIES_BY_ID, DATES_BY_ID, formatEntryDate } from "./knowledge";
import { TOPIC_BY_ID, TOPICS } from "./knowledge-topics";
import { APPLICABILITY, type Applicability } from "./knowledge-topics";

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

  it("lifecycle: status is valid, and a 'superseded' entry points to a real, different entry", () => {
    // A3 lifecycle guard: an outdated entry is MARKED, not silently wrong. Keeps the publishable
    // corpus honest — a "superseded" entry must point to a real, different entry that replaces it.
    const known = new Set(KNOWLEDGE.map((e) => e.id));
    const offenders: string[] = [];
    for (const [type, list] of groups) {
      for (const e of list) {
        if (e.status === undefined) continue;
        if (e.status !== "deprecated" && e.status !== "superseded") {
          offenders.push(`${type} ${String(e.id)}: invalid status "${String(e.status)}"`);
          continue;
        }
        if (e.status === "superseded") {
          const by = e.supersededBy;
          if (!isStr(by) || by.length === 0)
            offenders.push(`${type} ${String(e.id)}: superseded but no supersededBy`);
          else if (!known.has(by))
            offenders.push(`${type} ${String(e.id)}: superseded by unknown id "${by}"`);
          else if (by === String(e.id))
            offenders.push(`${type} ${String(e.id)}: cannot supersede itself`);
        }
      }
    }
    expect(offenders, `lifecycle problems:\n${offenders.join("\n")}`).toEqual([]);
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

  it("every entry has a valid topic, explicitly mapped (A3 completeness guard)", () => {
    // No silent fallback: a new entry must get an EXPLICIT topic in knowledge-topics.ts, the topic
    // must be a known one, and the map must carry no orphan ids. This is the corpus taxonomy drift-guard.
    const valid = new Set<string>(TOPICS);
    const realIds = new Set(KNOWLEDGE.map((e) => e.id));
    const unmapped = KNOWLEDGE.filter((e) => !(e.id in TOPIC_BY_ID)).map((e) => e.id);
    expect(unmapped, `entries with no explicit topic mapping: ${unmapped.join(", ")}`).toEqual([]);
    const badTopic = KNOWLEDGE.filter((e) => !valid.has(e.topic)).map((e) => `${e.id}:${e.topic}`);
    expect(badTopic, `entries with an invalid topic: ${badTopic.join(", ")}`).toEqual([]);
    const orphans = Object.keys(TOPIC_BY_ID).filter((id) => !realIds.has(id));
    expect(orphans, `TOPIC_BY_ID has ids no entry uses: ${orphans.join(", ")}`).toEqual([]);
  });

  it("hardware applicability: APPLIES_BY_ID maps only to real ids, valid tags, no empties/dupes", () => {
    // Applicability tags (AMD/NVIDIA/Intel/laptop/desktop) are OPTIONAL, central, owner-reviewable
    // metadata — an entry with no map entry applies to everything (no filter restriction). This guard
    // keeps the map honest: no orphan ids, only known tags, no empty arrays, no duplicate tags.
    const valid = new Set<string>(APPLICABILITY);
    const realIds = new Set(KNOWLEDGE.map((e) => e.id));
    const orphans = Object.keys(APPLIES_BY_ID).filter((id) => !realIds.has(id));
    expect(orphans, `APPLIES_BY_ID has ids no entry uses: ${orphans.join(", ")}`).toEqual([]);
    const problems: string[] = [];
    for (const [id, tags] of Object.entries(APPLIES_BY_ID)) {
      if (!Array.isArray(tags) || tags.length === 0) {
        problems.push(`${id}: applicability must be a NON-EMPTY array (omit the id instead of [])`);
        continue;
      }
      for (const t of tags) if (!valid.has(t)) problems.push(`${id}: invalid tag "${t}"`);
      if (new Set(tags).size !== tags.length) problems.push(`${id}: duplicate tags`);
    }
    expect(problems, `applicability problems:\n${problems.join("\n")}`).toEqual([]);
  });

  it("hardware applicability: entries carry the mapped tags (absent = applies to all)", () => {
    for (const e of KNOWLEDGE) {
      const mapped = APPLIES_BY_ID[e.id];
      if (mapped) {
        expect(e.applies, `${e.id} should carry its mapped tags`).toEqual(mapped);
      } else {
        expect(e.applies, `${e.id} has no map entry → applies should be undefined`).toBeUndefined();
      }
    }
  });

  it("hardware applicability: vendor-specific seed entries are tagged for their vendor", () => {
    // Spot-check a few unambiguous vendor entries so the map can't silently empty out. NVIDIA Reflex
    // is NVIDIA-only; AMD undervolt is AMD; the XMP/EXPO profile covers both AMD + Intel.
    const tagsOf = (id: string): Applicability[] | undefined => KNOWLEDGE_BY_ID.get(id)?.applies;
    expect(tagsOf("nvidia-reflex")).toContain("nvidia");
    expect(tagsOf("amd-undervolting")).toContain("amd");
    expect(tagsOf("xmp-expo")).toEqual(["amd", "intel"]);
    expect(tagsOf("laptop-plugged-in-fps")).toContain("laptop");
    // A universal entry (no map row) carries no applies — it fits every rig.
    expect(tagsOf("fps-cap")).toBeUndefined();
  });

  it("date metadata: DATES_BY_ID maps only real ids to well-formed ISO dates (A3)", () => {
    // Date-added / last-updated is OPTIONAL, central, owner-reviewable metadata — an entry with no
    // map row simply shows no date (never a fabricated one). This guard keeps the map honest: no
    // orphan ids, every `added` a valid YYYY-MM-DD, `updated` (when present) also valid and never
    // BEFORE `added`. Pure organizational metadata; never a verdict.
    const ISO = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
    const realIds = new Set(KNOWLEDGE.map((e) => e.id));
    const orphans = Object.keys(DATES_BY_ID).filter((id) => !realIds.has(id));
    expect(orphans, `DATES_BY_ID has ids no entry uses: ${orphans.join(", ")}`).toEqual([]);
    const problems: string[] = [];
    for (const [id, d] of Object.entries(DATES_BY_ID)) {
      if (!isStr(d.added) || !ISO.test(d.added)) {
        problems.push(`${id}: 'added' must be a YYYY-MM-DD string (got ${JSON.stringify(d.added)})`);
        continue;
      }
      // A real calendar date (rejects e.g. 2026-02-31 that passes the regex).
      if (Number.isNaN(Date.parse(`${d.added}T00:00:00Z`))) problems.push(`${id}: 'added' is not a real date`);
      if (d.updated !== undefined) {
        if (!isStr(d.updated) || !ISO.test(d.updated)) {
          problems.push(`${id}: 'updated' must be a YYYY-MM-DD string when present`);
        } else if (d.updated < d.added) {
          problems.push(`${id}: 'updated' (${d.updated}) is before 'added' (${d.added})`);
        }
      }
    }
    expect(problems, `date metadata problems:\n${problems.join("\n")}`).toEqual([]);
  });

  it("date metadata: entries carry the mapped dates (absent = no date shown)", () => {
    for (const e of KNOWLEDGE) {
      const mapped = DATES_BY_ID[e.id];
      if (mapped) {
        expect(e.added, `${e.id} should carry its mapped 'added'`).toBe(mapped.added);
        expect(e.updated, `${e.id} should carry its mapped 'updated'`).toBe(mapped.updated);
      } else {
        expect(e.added, `${e.id} has no date row → added should be undefined`).toBeUndefined();
        expect(e.updated, `${e.id} has no date row → updated should be undefined`).toBeUndefined();
      }
    }
  });

  it("date metadata: formatEntryDate renders a stable human month-year, tolerates junk", () => {
    // Deterministic, timezone-safe (parsed as UTC) so the same ISO always reads the same month/year.
    expect(formatEntryDate("2026-06-14")).toBe("Jun 2026");
    expect(formatEntryDate("2026-01-01")).toBe("Jan 2026");
    expect(formatEntryDate("2025-12-31")).toBe("Dec 2025");
    // Junk / empty degrades to null rather than "Invalid Date".
    expect(formatEntryDate("")).toBeNull();
    expect(formatEntryDate("not-a-date")).toBeNull();
    expect(formatEntryDate(undefined)).toBeNull();
  });

  it("ships the expected dataset volume (sanity floor)", () => {
    // 42 frozen seed + aim-tweaks (owner 2026-06-08) + 3 sprint debunks (2026-06-10: disable-smt-gaming,
    // nvidia-prefer-max-performance, cpu-affinity-games) + memory-compression-off (2026-06-11, the
    // Leftovers detector's explainer — R1 flagged the WhatsThis gap) + 4 R3 Lane F debunks
    // (2026-06-12: game-boosters, ram-cleaners, app-hw-accel-off, dns-for-gaming — search-intent
    // picks pairing with the dark-site pages) + 6 R5 Lane 2 debunks (2026-06-12: run-as-admin-fps,
    // high-priority-games, defrag-ssd, gpu-overclocking, clean-install-windows,
    // exclusive-fullscreen-fps — popular-myth gaps in the coverage map) + 5 R6 Lane B debunks
    // (2026-06-13: monitoring-overlay-fps, monitor-overclock-fps, close-background-apps-fps,
    // audio-enhancements-fps [placebo] + render-scale [real, the honest counterpoint lever] —
    // more uncovered popular-myth gaps) + 3 R7 Lane 3 debunks (2026-06-13: disable-hdr-fps [placebo],
    // mouse-acceleration-fps [placebo], dual-channel-ram [real, the honest hardware lever] — still-
    // missing FPS-myth gaps, paired with 2 new term explainers frame-pacing + pre-rendered-frames)
    // + 4 R10 Lane 1 debunks (2026-06-13: disable-nagle [placebo], fast-startup-fps [placebo],
    // wifi-vs-ethernet-fps [placebo], instant-replay-fps [real, the honest small-cost lever] —
    // network/boot/capture FPS-myth gaps, paired with 2 new term explainers screen-tearing +
    // core-count-gaming) + 4 R11 debunks (2026-06-14, autonomous council-overseen sprint:
    // set-refresh-rate [real, the biggest free smoothness fix], bigger-psu-fps [placebo],
    // registry-cleaners [risky — zero gain, real chance of breakage], monitor-response-time-fps
    // [placebo] — display/power/registry FPS-myth gaps; vram-overflow dropped as the vram term
    // already covers it) + 2 R11 round-2 debunks (2026-06-14, same sprint: ram-capacity-fps [placebo —
    // capacity past 'enough' is a placebo; speed/dual-channel are the real levers], pcie-gen-fps
    // [placebo — PCIe gen barely matters at x16] — hardware-spec FPS-myth gaps, distinct from
    // dual-channel-ram which is about channels not capacity) + 6 R11 marathon debunks (2026-06-14,
    // council-overseen finish-and-harden marathon: lower-graphics-settings [real — the most reliable
    // lever after resolution], integrated-graphics-disable-fps / motherboard-fps / bios-update-fps /
    // ssd-fps [placebo], cpu-overclock-fps [risky — often counterproductive vs PBO/undervolt] —
    // build/hardware/settings FPS-myth gaps; distinct from the uefi-bios / nvme-ssd-hdd TERMS) + 3 R11
    // marathon round-2 debunks (2026-06-14: laptop-plugged-in-fps [real — one of the biggest free swings
    // on a laptop], windows-11-vs-10-fps / gaming-mouse-dpi-fps [placebo] — laptop/OS/peripheral
    // FPS-myth gaps).
    // These are Library EXPLAINERS (graded real/placebo/risky), NOT appliable recs — Compy applies
    // none of them, so the ~29 appliable-catalog freeze is untouched. The pin stays exact as a
    // curation drift-guard.
    expect(TWEAKS.length).toBe(84);
    expect(TERMS.length).toBeGreaterThanOrEqual(50);
    expect(TRICKS.length).toBeGreaterThanOrEqual(12);
    expect(GUIDES.length).toBeGreaterThanOrEqual(6);
  });
});
