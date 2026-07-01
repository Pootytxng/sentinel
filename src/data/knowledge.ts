// Knowledge layer — one searchable, offline, bundled library across four entry types.
// tweaks.json grows by curated, owner-visible additions only (count pinned exactly in
// knowledge.lint.test.ts with the rationale per batch); this module injects the
// `type` discriminator and normalizes optional fields so everything shares one shape and one index.
// Static + bundled — no network, no remote fetch, no new capabilities.

import rawTweaks from "./tweaks.json";
import rawTerms from "./terms.json";
import rawTricks from "./tricks.json";
import rawGuides from "./guides.json";
import { VERDICT_GLOSSARY, VERDICT_GLOSSARY_ENTRY_ID } from "./verdict-glossary";
import { TUNING_GUIDE_ENTRIES } from "./tuning-guides";
import { TOPIC_BY_ID, type Topic, type Applicability } from "./knowledge-topics";

export type { Topic, Applicability } from "./knowledge-topics";

/** The entry's topic from the central map (A3); falls back to "general" only if unmapped — the
 * knowledge lint enforces that every id IS mapped, so the fallback never fires in practice. */
const topicOf = (id: unknown): Topic => TOPIC_BY_ID[String(id)] ?? "general";

// Hardware applicability (AMD/NVIDIA/Intel/laptop/desktop) — central, owner-reviewable map from an
// entry id to the rigs it's RELEVANT to. OPTIONAL: an id absent here is universal (applies to every
// rig — the common case), so the map only lists entries that genuinely narrow. Tags are validated by
// the knowledge lint (real ids, known tags, no empties/dupes). Organizational metadata, never a verdict.
export const APPLIES_BY_ID: Record<string, Applicability[]> = {
  // GPU vendor-specific
  "nvidia-reflex": ["nvidia"],
  "nvidia-prefer-max-performance": ["nvidia"],
  "anti-lag-plus": ["amd"],
  // NOTE: amd-gpu-undervolt is a tuning GUIDE whose KNOWLEDGE copy is value-pinned to its derived form
  // by tuning-guides.test.ts, so it is deliberately NOT tagged here; the AMD-undervolt knowledge is
  // covered by the amd-undervolting term below.
  "amd-undervolting": ["amd"],
  // CPU vendor-specific
  "pbo-curve-optimizer": ["amd"],
  "pbo": ["amd"],
  // Memory — the profile name differs by platform (XMP = Intel's name, EXPO = AMD's)
  "xmp-expo": ["amd", "intel"],
  "xmp": ["amd", "intel"],
  "xmp-guide": ["amd", "intel"],
  // Form-factor specific
  "laptop-plugged-in-fps": ["laptop"],
};

/** The entry's hardware applicability from the central map; undefined (universal) when unmapped. */
const appliesOf = (id: unknown): Applicability[] | undefined => APPLIES_BY_ID[String(id)];

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
  // Topic (A3) — what the entry is ABOUT (display, gpu, network…), from the central knowledge-topics
  // map. Drives Learn's topic filter; organizational metadata only, never a verdict. Required, so a
  // new entry can't compile without a topic; the lint enforces an EXPLICIT map entry (no silent default).
  topic: Topic;
  // Lifecycle (A3) — an entry whose guidance has gone stale is MARKED here, not silently left wrong
  // or deleted: "superseded" points to the entry that replaces it; "deprecated" is outdated with no
  // single replacement. Absent = current. Surfaced honestly in Learn (the corpus stays publishable —
  // an old debunk reads "superseded → see X" rather than misleading a reader). Entries default current.
  status?: "deprecated" | "superseded";
  supersededBy?: string; // an existing entry id; set when status === "superseded"
  // Hardware applicability — which rigs this entry is relevant to (AMD/NVIDIA/Intel/laptop/desktop),
  // from the central APPLIES_BY_ID map. Absent = universal (applies to every rig). Organizational
  // metadata only, never a verdict; drives Learn's "fits my rig" filter.
  applies?: Applicability[];
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

// Pull the optional lifecycle fields off a raw entry (A3). Absent/unknown → current (no fields).
// Only "superseded" carries a supersededBy id. Lint (knowledge.lint.test.ts) enforces that the id is
// real + different; this mapper just shapes whatever the data declares.
export function lifecycle(t: Raw): { status?: "deprecated" | "superseded"; supersededBy?: string } {
  if (t.status === "superseded") return { status: "superseded", supersededBy: String(t.supersededBy ?? "") };
  if (t.status === "deprecated") return { status: "deprecated" };
  return {};
}

// Apply the central applicability map to a fully-built entry — adds `applies` ONLY when this id has
// tags, so an unmapped (universal) entry keeps `applies` undefined rather than an empty array. Done as
// one normalization pass over the assembled corpus so it covers EVERY source uniformly (the four JSON
// types, the derived tuning guides, and the grading meta-entry) without touching each builder.
function withApplicability<T extends KnowledgeEntry>(e: T): T {
  const a = appliesOf(e.id);
  return a ? { ...e, applies: a } : e;
}

const TWEAKS: TweakEntry[] = (rawTweaks as Raw[]).map((t) => ({
  type: "tweak",
  id: String(t.id),
  name: String(t.name),
  aliases: strArr(t.aliases),
  related: strArr(t.related),
  topic: topicOf(t.id),
  verdict: t.verdict as TweakVerdict,
  what: String(t.what),
  why: String(t.why),
  ...lifecycle(t),
}));

const TERMS: TermEntry[] = (rawTerms as Raw[]).map((t) => ({
  type: "term",
  id: String(t.id),
  name: String(t.name),
  aliases: strArr(t.aliases),
  related: strArr(t.related),
  topic: topicOf(t.id),
  what: String(t.what),
  more: String(t.more),
  ...lifecycle(t),
}));

const TRICKS: TrickEntry[] = (rawTricks as Raw[]).map((t) => ({
  type: "trick",
  id: String(t.id),
  name: String(t.name),
  aliases: strArr(t.aliases),
  related: strArr(t.related),
  topic: topicOf(t.id),
  pattern: String(t.pattern),
  tell: String(t.tell),
  honest_version: String(t.honest_version),
  ...lifecycle(t),
}));

const GUIDES: GuideEntry[] = (rawGuides as Raw[]).map((t) => ({
  type: "guide",
  id: String(t.id),
  name: String(t.name),
  aliases: strArr(t.aliases),
  related: strArr(t.related),
  topic: topicOf(t.id),
  tier: t.tier as GuideTier,
  goal: String(t.goal),
  steps: strArr(t.steps),
  undo: String(t.undo),
  ...lifecycle(t),
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
  topic: topicOf(VERDICT_GLOSSARY_ENTRY_ID),
  what:
    "Compy gives every tweak one of three honest verdicts — Real, Placebo, or Risky — so you can tell what's worth your time before you change anything.",
  more: VERDICT_GLOSSARY.map((r) => `${r.chip}: ${r.definition}`).join("  "),
};

// FreeSync ↔ VRB exclusion (A4 Monitor content lane) — a read-only display-topic explainer for a
// trap people hit live: on most gaming monitors a variable refresh rate (FreeSync / G-Sync) and the
// strobing backlight that powers blur reduction (VRB / ULMB / MBR / DyAc) CANNOT run at the same
// time — turning one on greys the other out in the monitor's OSD. Nothing here is appliable or
// mutating; it just names the trade-off honestly and sits between the two features it spans. Lives in
// code (like GRADING_ENTRY) so it ships without touching the frozen tweaks.json count pins. Aliases
// are deliberately distinct from the vrr / gsync-freesync / backlight-strobing terms (same-type alias
// collisions are a lint failure); single-word findability comes from the name + body via search.
const FREESYNC_VRB_ENTRY: TermEntry = {
  type: "term",
  id: "freesync-vrb-exclusion",
  name: "FreeSync vs blur reduction (you usually pick one)",
  aliases: ["freesync vrb conflict", "vrr vs blur reduction", "freesync ulmb", "freesync greyed out"],
  related: ["vrr", "gsync-freesync", "backlight-strobing", "vsync"],
  topic: topicOf("freesync-vrb-exclusion"),
  what:
    "On most gaming monitors a variable refresh rate (FreeSync or G-Sync) and a blur-reduction strobing mode (VRB, ULMB, MBR, DyAc) can't run at the same time — switch one on and the other greys out in the monitor's menu.",
  more:
    "It isn't a bug and nothing is broken: the two work in opposite ways. VRR keeps the refresh rate matched to your frame rate to kill tearing and stutter; blur reduction strobes the backlight at a fixed rate to sharpen motion, which only works at that steady rate. You choose one or the other for how you play — VRR for variable-frame-rate single-player and most games, blur reduction for very high, locked frame rates in fast competitive titles. A few newer monitors can do both together; if yours can't, that's normal, not a problem to fix.",
};

// Monitor model-hint cards (A4 Monitor content lane) — when Compy has read the attached panel's real
// model over EDID (read-only WmiMonitorID probe; `hardware.rs`), we point the owner at the EXISTING
// display knowledge that actually matters for THAT panel instead of leaving the detected model a dead
// string. Pure content + a tolerant model matcher: nothing here reads/writes a setting, adds a
// capability, or claims an unmeasured/per-SKU number. The card is a code-injected `term` (like
// GRADING_ENTRY / FREESYNC_VRB_ENTRY, so the frozen tweaks.json count pins stay untouched) that
// cross-links the real Learn entries the panel benefits from.
//
// Each row: `entryId` = the injected card's id · `match` = lowercased substring tokens tested against
// the EDID-decoded model (folded to alnum, so "Acer XFA253Q Z" and "XFA253QZ" both hit "xfa253q").
export interface MonitorModelHint {
  entryId: string;
  /** Lowercased alphanumeric tokens; a model matches the row if it CONTAINS any token. */
  match: string[];
}

export const MONITOR_MODEL_HINTS: MonitorModelHint[] = [
  // Acer Nitro XFA253Q / XFA253QZ family — 24.5" 1080p IPS FreeSync gaming monitors (the dev rig's
  // own panel decodes as "Acer XFA253Q Z"). Deliberately matches the shared "xfa253q" stem so the
  // whole family (spacing/suffix variants) hits one card.
  { entryId: "monitor-hint-acer-xfa253q", match: ["xfa253q"] },
];

/** Fold a raw model string to lowercase alphanumerics only (drops spaces/punctuation) for matching. */
function foldModel(model: string): string {
  return String(model).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Look up the model-hint row for a detected monitor model string (read-only, advisory). Returns the
 * matching row (whose `entryId` resolves to a browsable Learn card) or undefined when no family
 * matches — including empty / "Generic PnP Monitor" strings. First-match-wins; tokens are ORed.
 */
export function monitorHintsFor(model: string | null | undefined): MonitorModelHint | undefined {
  if (!model) return undefined;
  const folded = foldModel(model);
  if (folded.length === 0) return undefined;
  return MONITOR_MODEL_HINTS.find((h) => h.match.some((t) => folded.includes(t)));
}

/** Ids of every injected model-hint card, for guards/UI that want the full set. */
export const MONITOR_HINT_ENTRY_IDS: string[] = MONITOR_MODEL_HINTS.map((h) => h.entryId);

const ACER_XFA253Q_HINT_ENTRY: TermEntry = {
  type: "term",
  id: "monitor-hint-acer-xfa253q",
  name: "Your monitor: Acer XFA253Q / XFA253QZ (Nitro)",
  aliases: ["acer xfa253q", "xfa253qz", "acer nitro monitor", "xfa253q hints"],
  related: ["set-refresh-rate", "vrr", "gsync-freesync", "freesync-vrb-exclusion", "native-resolution"],
  topic: topicOf("monitor-hint-acer-xfa253q"),
  what:
    "This is a 24.5-inch 1080p IPS gaming monitor with a high refresh rate and AMD FreeSync — so the two free wins are making Windows actually use its rated refresh rate and turning FreeSync on.",
  more:
    "Two quick checks get the most out of this panel, and neither costs performance. First, set the refresh rate: Windows often defaults a high-refresh monitor to 60 Hz, so open Settings and pick its maximum advertised rate — that alone makes everything feel smoother (see 'Set your refresh rate'). Second, turn on FreeSync in the monitor's on-screen menu and match it in your GPU driver, which removes tearing without the input lag of plain V-Sync (see 'Variable refresh rate' / 'FreeSync & G-Sync'). One heads-up: on this class of monitor FreeSync and the blur-reduction/strobing mode usually can't run at the same time — you pick one (see 'FreeSync vs blur reduction'). Run it at its native 1920x1080 for the sharpest image. We read the model from your monitor's EDID; nothing here changes a setting for you.",
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
  FREESYNC_VRB_ENTRY,
  ACER_XFA253Q_HINT_ENTRY,
].map(withApplicability);

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
