// Knowledge layer — one searchable, offline, bundled library across four entry types.
// tweaks.json (the frozen 42-entry seed) stays byte-for-byte unchanged; this module injects the
// `type` discriminator and normalizes optional fields so everything shares one shape and one index.
// Static + bundled — no network, no remote fetch, no new capabilities.

import rawTweaks from "./tweaks.json";
import rawTerms from "./terms.json";
import rawTricks from "./tricks.json";
import rawGuides from "./guides.json";
import { VERDICT_GLOSSARY, VERDICT_GLOSSARY_ENTRY_ID } from "./verdict-glossary";
import { TUNING_GUIDE_ENTRIES } from "./tuning-guides";

// Version field on the dataset root, for future migrations. Bump + migrate when a shape changes.
export const KNOWLEDGE_VERSION = 1;

export type KnowledgeType = "tweak" | "term" | "trick" | "guide";
export type TweakVerdict = "real" | "placebo" | "risky";
// Only "safe" ships this chapter; "gated" is reserved for the future trust-gated Black Book annex
// (Black Book Part 8) so it can exist later without a schema migration.
export type GuideTier = "safe" | "gated";

interface BaseEntry {
  id: string;
  name: string;
  aliases: string[];
  related: string[];
}
export interface TweakEntry extends BaseEntry {
  type: "tweak";
  verdict: TweakVerdict;
  what: string;
  why: string;
}
export interface TermEntry extends BaseEntry {
  type: "term";
  what: string;
  more: string;
}
export interface TrickEntry extends BaseEntry {
  type: "trick";
  pattern: string;
  tell: string;
  honest_version: string;
}
export interface GuideEntry extends BaseEntry {
  type: "guide";
  tier: GuideTier;
  goal: string;
  steps: string[];
  undo: string;
}
export type KnowledgeEntry = TweakEntry | TermEntry | TrickEntry | GuideEntry;

type Raw = Record<string, unknown>;
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);

const TWEAKS: TweakEntry[] = (rawTweaks as Raw[]).map((t) => ({
  type: "tweak",
  id: String(t.id),
  name: String(t.name),
  aliases: strArr(t.aliases),
  related: strArr(t.related),
  verdict: t.verdict as TweakVerdict,
  what: String(t.what),
  why: String(t.why),
}));

const TERMS: TermEntry[] = (rawTerms as Raw[]).map((t) => ({
  type: "term",
  id: String(t.id),
  name: String(t.name),
  aliases: strArr(t.aliases),
  related: strArr(t.related),
  what: String(t.what),
  more: String(t.more),
}));

const TRICKS: TrickEntry[] = (rawTricks as Raw[]).map((t) => ({
  type: "trick",
  id: String(t.id),
  name: String(t.name),
  aliases: strArr(t.aliases),
  related: strArr(t.related),
  pattern: String(t.pattern),
  tell: String(t.tell),
  honest_version: String(t.honest_version),
}));

const GUIDES: GuideEntry[] = (rawGuides as Raw[]).map((t) => ({
  type: "guide",
  id: String(t.id),
  name: String(t.name),
  aliases: strArr(t.aliases),
  related: strArr(t.related),
  tier: t.tier as GuideTier,
  goal: String(t.goal),
  steps: strArr(t.steps),
  undo: String(t.undo),
}));

// Injected meta-entry: "How Compy grades things" — explains our own verdict vocabulary (from live-
// demo feedback: a real target user asked what real/placebo/risky mean). Built from VERDICT_GLOSSARY
// so the definitions can't drift from the visible key + hover tooltips. It lives in code, not a JSON
// seed, because its body is DERIVED. Aliases are safe multi-word phrases only — bare "real"/"risky"/
// "placebo" would pollute the Guide Autopsy's name+alias matcher; single-word findability ("grade",
// "placebo", "real", "risky", "verdict") comes from the name + body via searchKnowledge (substring).
const GRADING_ENTRY: TermEntry = {
  type: "term",
  id: VERDICT_GLOSSARY_ENTRY_ID,
  name: "How Compy grades things",
  aliases: ["how we grade", "how compy grades", "verdict glossary"],
  related: [],
  what:
    "Compy gives every tweak one of three honest verdicts — Real, Placebo, or Risky — so you can tell what's worth your time before you change anything.",
  more: VERDICT_GLOSSARY.map((r) => `${r.chip}: ${r.definition}`).join("  "),
};

// Tuning guides (spec 2026-06-08) are injected as derived `guide` entries from their single source
// (tuning-guides.ts) — same pattern as GRADING_ENTRY — so the Learn library stays searchable/browsable
// over them without duplicating the guide copy.
export const KNOWLEDGE: KnowledgeEntry[] = [
  ...TWEAKS,
  ...TERMS,
  ...TRICKS,
  ...GUIDES,
  ...TUNING_GUIDE_ENTRIES,
  GRADING_ENTRY,
];

export const KNOWLEDGE_BY_ID: Map<string, KnowledgeEntry> = new Map(
  KNOWLEDGE.map((e) => [e.id, e]),
);

/** Fold for matching: strip diacritics + lowercase so "naïve" matches "naive", "EXPO" matches "expo". */
export function foldText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** The full searchable body of an entry (everything except id/aliases), type-aware. */
export function entryBody(e: KnowledgeEntry): string {
  switch (e.type) {
    case "tweak":
      return `${e.what} ${e.why}`;
    case "term":
      return `${e.what} ${e.more}`;
    case "trick":
      return `${e.pattern} ${e.tell} ${e.honest_version}`;
    case "guide":
      return `${e.goal} ${e.steps.join(" ")} ${e.undo}`;
  }
}

/**
 * Cross-links shown on a card: the entry's own `related` plus any entry that lists THIS entry in
 * its `related` (reverse links). Keeps tweaks.json edit-free while still showing term↔tweak chips
 * both ways. Returns existing ids only, de-duped, in stable order (forward first).
 */
export function relatedIds(entry: KnowledgeEntry, all: KnowledgeEntry[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (id: string) => {
    if (id === entry.id || seen.has(id)) return;
    if (!all.some((e) => e.id === id)) return;
    seen.add(id);
    out.push(id);
  };
  entry.related.forEach(push);
  for (const e of all) {
    if (e.related.includes(entry.id)) push(e.id);
  }
  return out;
}
