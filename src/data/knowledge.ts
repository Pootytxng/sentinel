// Knowledge layer — one searchable, offline, bundled library across four entry types.
// tweaks.json grows by curated, owner-visible additions only (count pinned exactly in
// knowledge.lint.test.ts with the rationale per batch); this module injects the
// `type` discriminator and normalizes optional fields so everything shares one shape and one index.
// Static + bundled — no network, no remote fetch, no new capabilities.

import rawTweaks from "./tweaks.json";
import rawTerms from "./terms.json";
import rawTricks from "./tricks.json";
import rawGuides from "./guides.json";
// Simplified Chinese overlay siblings (i18n, 2026-07-23) — each carries ONLY the translated text
// fields for the ids it covers (name/what/why/more/pattern/tell/honest_version/goal/steps/undo),
// never structural/logic fields (aliases, related, verdict, tier, ...), which always come from the
// English seed above. See knowledgeForLanguage() below for how these get layered on.
import rawTweaksZhCN from "./tweaks.zh-CN.json";
import rawTermsZhCN from "./terms.zh-CN.json";
import rawTricksZhCN from "./tricks.zh-CN.json";
import rawGuidesZhCN from "./guides.zh-CN.json";
import { VERDICT_GLOSSARY, VERDICT_GLOSSARY_ENTRY_ID } from "./verdict-glossary";
import { TUNING_GUIDE_ENTRIES, tuningGuideEntriesForLanguage } from "./tuning-guides";
import { TOPIC_BY_ID, type Topic, type Applicability } from "./knowledge-topics";
import { deepMergeLocale } from "./locale-merge";

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

// Date-added / last-updated (A3) — OPTIONAL, central, owner-reviewable metadata: a plain
// `YYYY-MM-DD` "added" (when the entry first entered the library) and an optional "updated" (last
// meaningful revision). An id ABSENT here shows NO date — we never fabricate a date, so freshness is
// only ever shown when it's real. Kept in code (not the frozen JSON seeds) so the tweaks.json count
// pins stay untouched, and centrally like TOPIC_BY_ID / APPLIES_BY_ID for one-glance owner review.
// Organizational metadata only, never a verdict. The lint validates real ids + well-formed dates +
// updated-not-before-added. Dates are sourced from the curation history in knowledge.lint.test.ts.
export interface EntryDates {
  /** ISO YYYY-MM-DD the entry first shipped. */
  added: string;
  /** ISO YYYY-MM-DD of the last meaningful revision; omit if never revised since `added`. */
  updated?: string;
}
export const DATES_BY_ID: Record<string, EntryDates> = {
  // Original frozen seed corpus (42 entries) shipped together on the library's first cut.
  "fullscreen-optimizations": { added: "2026-06-04" },
  "hags": { added: "2026-06-04" },
  "game-mode": { added: "2026-06-04" },
  // A few dated exemplars from the documented curation batches (knowledge.lint.test.ts). The map is
  // intentionally sparse — only entries with a known, real date carry one; everything else shows none.
  "aim-tweaks": { added: "2026-06-08" },
  "set-refresh-rate": { added: "2026-06-14", updated: "2026-06-14" },
  "freesync-vrb-exclusion": { added: "2026-06-19" },
  "monitor-hint-acer-xfa253q": { added: "2026-06-19" },
};

/** The entry's date metadata from the central map; undefined (no date shown) when unmapped. */
const datesOf = (id: unknown): EntryDates | undefined => DATES_BY_ID[String(id)];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Render an ISO `YYYY-MM-DD` date as a stable, timezone-safe "Mon YYYY" (e.g. "Jun 2026") for the
 * quiet Learn freshness line. Parses the date parts directly (no `new Date(str)` locale/TZ drift), so
 * the same ISO always reads the same month/year everywhere. Returns null for empty/malformed input so
 * a bad value degrades to "no date" rather than surfacing "Invalid Date".
 */
export function formatEntryDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${MONTHS[month - 1]} ${year}`;
}

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
  // Date metadata (A3) — ISO YYYY-MM-DD "added" / optional "updated", from the central DATES_BY_ID
  // map. Absent = no date shown (we never fabricate one). Organizational metadata only, never a verdict.
  added?: string;
  updated?: string;
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

// A3 supersession chain — walk supersededBy links transitively to the CURRENT end of the line,
// so a reader landing on a twice-replaced entry gets pointed at today's guidance, not at another
// stale stop. Pure + defensive: cycle-safe (a repeated id ends the walk) and missing-target-safe
// (stops at the last resolvable entry). Returns the ordered replacements AFTER `entry`
// ([] when the entry isn't superseded or its target can't be resolved).
export function supersessionChain(
  entry: Pick<KnowledgeEntry, "id" | "status" | "supersededBy">,
  byId: ReadonlyMap<string, KnowledgeEntry>,
): KnowledgeEntry[] {
  const chain: KnowledgeEntry[] = [];
  const seen = new Set<string>([entry.id]);
  let cur = entry.status === "superseded" ? entry.supersededBy : undefined;
  while (cur && !seen.has(cur)) {
    const next = byId.get(cur);
    if (!next) break;
    chain.push(next);
    seen.add(cur);
    cur = next.status === "superseded" ? next.supersededBy : undefined;
  }
  return chain;
}

// Apply the central applicability map to a fully-built entry — adds `applies` ONLY when this id has
// tags, so an unmapped (universal) entry keeps `applies` undefined rather than an empty array. Done as
// one normalization pass over the assembled corpus so it covers EVERY source uniformly (the four JSON
// types, the derived tuning guides, and the grading meta-entry) without touching each builder.
function withApplicability<T extends KnowledgeEntry>(e: T): T {
  const a = appliesOf(e.id);
  return a ? { ...e, applies: a } : e;
}

// Apply the central date map to a fully-built entry — adds `added`/`updated` ONLY when this id has a
// date row, so an undated entry keeps both undefined (Learn then shows no freshness line) rather than
// an invented date. Same one-pass-over-the-assembled-corpus shape as withApplicability.
function withDates<T extends KnowledgeEntry>(e: T): T {
  const d = datesOf(e.id);
  return d ? { ...e, added: d.added, ...(d.updated ? { updated: d.updated } : {}) } : e;
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

// Vendor-aware monitor tuning (A4 Monitor content lane) — the generic VRR/HDR/refresh walkthroughs
// already exist, but people get stuck because the SAME feature has a different brand name and lives in
// a different app per GPU: AMD calls variable refresh "FreeSync" (set in Radeon/Adrenalin), NVIDIA
// calls it "G-SYNC" (NVIDIA App / Control Panel), and Intel Arc has its own control panel. This
// read-only display-topic term names the per-brand path for the three things that actually matter on a
// monitor — variable refresh, HDR, and the refresh rate — so a reader on ANY rig knows what the setting
// is called and where it lives. Nothing here reads/writes a setting, adds a capability, or claims an
// unmeasured/per-SKU number; it's the honest, feasible form of "vendor-aware monitor walkthroughs".
// Lives in code (like GRADING_ENTRY / FREESYNC_VRB_ENTRY) so it ships without touching the frozen
// tweaks.json count pins. Aliases stay distinct from vrr / gsync-freesync / set-refresh-rate (same-type
// alias collisions are a lint failure); single-word findability comes from the name + body via search.
const VENDOR_MONITOR_ENTRY: TermEntry = {
  type: "term",
  id: "vendor-monitor-tuning",
  name: "Monitor settings by brand (FreeSync, G-SYNC, HDR)",
  aliases: ["monitor settings by gpu", "freesync vs g-sync setup", "vendor monitor tuning", "where is freesync"],
  related: ["vrr", "gsync-freesync", "set-refresh-rate", "auto-hdr", "freesync-vrb-exclusion", "native-resolution"],
  topic: topicOf("vendor-monitor-tuning"),
  what:
    "The three settings that get the most out of any monitor — variable refresh, HDR, and its rated refresh rate — go by different brand names and live in a different app depending on your GPU: AMD calls variable refresh FreeSync, NVIDIA calls it G-SYNC, and Intel Arc has its own panel.",
  more:
    "Variable refresh (matches the monitor's refresh to your frame rate to kill tearing): on an AMD card turn on FreeSync in the monitor's on-screen menu, then enable it in Radeon Software (AMD Software: Adrenalin). On NVIDIA, enable G-SYNC (or 'G-SYNC Compatible' for a FreeSync panel) in the NVIDIA App or NVIDIA Control Panel. On Intel Arc, enable the panel's Adaptive-Sync / VRR in its control panel. HDR is a Windows setting, not a GPU-brand one — turn on 'Use HDR' (and Auto HDR for older games) in Windows Display settings, and only if your monitor advertises real HDR. The refresh rate is also set in Windows: pick the monitor's maximum advertised rate under Advanced display, since Windows often defaults a high-refresh panel to 60 Hz. One heads-up on most gaming monitors: variable refresh and a blur-reduction strobing mode usually can't run at once, so you pick one. Compy reads which GPU you have but never flips any of these for you — it just points you at the right name and place.",
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
  VENDOR_MONITOR_ENTRY,
  ACER_XFA253Q_HINT_ENTRY,
].map(withApplicability).map(withDates);

export const KNOWLEDGE_BY_ID: Map<string, KnowledgeEntry> = new Map(
  KNOWLEDGE.map((e) => [e.id, e]),
);

// ---------------------------------------------------------------------------------------------
// Simplified Chinese overlay (i18n, 2026-07-23)
//
// KNOWLEDGE / KNOWLEDGE_BY_ID above stay EXACTLY as they were — the frozen English corpus every
// existing test (knowledge.lint.test.ts, knowledge.test.ts, the per-entry guard tests, ...) pins
// against. This section adds a SEPARATE, additive read path: knowledgeForLanguage("zh-CN") returns
// a Simplified Chinese overlay of the same entries, built by deep-merging the zh-CN locale JSON
// (translated text fields only) onto each already-built English entry — so ids, aliases, `related`
// links, verdict/tier, topic, applies, and dates are always identical between languages, and only
// prose can differ. searchKnowledge() and autopsyScan() already accept an `entries` override for
// exactly this purpose (see knowledge-search.ts / knowledge-autopsy.ts).

// The four knowledge entries injected directly in this module (GRADING_ENTRY etc., above) have no
// tweaks/terms/tricks/guides.json row to carry a zh-CN sibling, so their translations are hand-authored
// here in the same {id, ...text fields} shape as a raw JSON record — picked up by the SAME overlay
// map/merge below, no special-casing needed at the call site.
const INJECTED_ENTRIES_ZH_CN: Raw[] = [
  {
    id: VERDICT_GLOSSARY_ENTRY_ID,
    name: "Compy 是怎么评级的",
    what: "Compy 给每一项优化打出三种诚实结论之一——Real(真有用)、Placebo(安慰剂)或 Risky(有风险)——这样你在改动任何设置之前,就能知道它到底值不值得花时间。",
    // Hand-translated, matching the Chinese chip/definition pairs shipped in
    // src/i18n/locales/zh-CN/blackbook.json's verdictGlossary.* (this module can't call the t()-based
    // verdictChip/verdictDefinition helpers — it's plain data, not a React tree — so the joined string
    // is written out directly; keep the two in sync if the glossary copy ever changes).
    more:
      "Real：它真的有用。对你的游戏有可衡量、有据可查的效果——值得一做。　" +
      "Placebo：纯属炒作,没有效果。网上很火,但改变不了任何可衡量的东西。我们跳过这些,免得你浪费时间去追它们。　" +
      "Risky — refused：代价不值得。它可能确实有点作用,但会带来实打实的代价——不稳定、安全漏洞,或者干脆把东西搞坏——所以 Compy 拒绝执行它,或者把决定权交给你,让你清楚利弊后自己选。",
  },
  {
    id: "freesync-vrb-exclusion",
    name: "FreeSync 与运动模糊消除(通常只能二选一)",
    what: "在大多数电竞显示器上,可变刷新率(FreeSync 或 G-Sync)和消除运动模糊的黑帧插入模式(VRB、ULMB、MBR、DyAc)无法同时开启——打开一个,另一个就会在显示器菜单里变灰锁死。",
    more: "这不是 bug,也没有任何东西坏掉:这两项技术的工作原理正好相反。VRR 会让刷新率跟着你的帧率走,以消除画面撕裂和卡顿;而运动模糊消除是让背光以固定频率闪烁,让画面更清晰,这只在稳定的固定频率下才有效。用哪个取决于你怎么玩——单机游戏和大多数帧率会变化的游戏适合用 VRR;需要极高、锁定帧率的快节奏竞技游戏适合用运动模糊消除。少数较新的显示器可以两个同时开;如果你的显示器不行,这是正常现象,不是需要修的问题。",
  },
  {
    id: "vendor-monitor-tuning",
    name: "按显卡品牌查找显示器设置(FreeSync、G-SYNC、HDR)",
    what: "能让显示器发挥全部实力的三个设置——可变刷新率、HDR,以及标称刷新率——在不同显卡品牌下叫法不同,设置的地方也不一样:AMD 把可变刷新率叫 FreeSync,NVIDIA 叫 G-SYNC,Intel Arc 则有自己的控制面板。",
    more: "可变刷新率(让显示器的刷新率跟上你的帧率,消除画面撕裂):AMD 显卡先在显示器的屏幕菜单里打开 FreeSync,再到 Radeon Software(AMD Software: Adrenalin)里启用。NVIDIA 显卡在 NVIDIA App 或 NVIDIA 控制面板里启用 G-SYNC(如果是 FreeSync 面板,选“G-SYNC Compatible”)。Intel Arc 在其控制面板里启用 Adaptive-Sync / VRR。HDR 是 Windows 的设置,和显卡品牌无关——只有显示器真正支持 HDR 时,才在 Windows 显示设置里打开“使用 HDR”(老游戏可以搭配自动 HDR)。刷新率也在 Windows 里设置:在“高级显示设置”里选显示器标称的最高刷新率,因为 Windows 经常会把高刷显示器默认设成 60 Hz。提醒一句:在大多数电竞显示器上,可变刷新率和运动模糊消除通常无法同时开启,只能二选一。Compy 会读取你用的是哪张显卡,但从不会替你翻转这些设置——它只负责告诉你正确的名称和位置。",
  },
  {
    id: "monitor-hint-acer-xfa253q",
    name: "你的显示器:Acer XFA253Q / XFA253QZ(暗影骑士 Nitro)",
    what: "这是一台 24.5 英寸 1080p IPS 电竞显示器,支持高刷新率和 AMD FreeSync——所以有两个稳赚不赔的优化:让 Windows 真正用上它的标称刷新率,并打开 FreeSync。",
    more: "两项快速检查就能把这块面板的实力用满,而且都不花性能。第一,设置刷新率:Windows 经常会把高刷显示器默认设成 60 Hz,打开「设置」选择它标称的最高刷新率——只这一步就能让整体观感顺滑不少(参见「设置你的刷新率」)。第二,在显示器屏幕菜单里打开 FreeSync,并在显卡驱动里匹配设置,这样能消除画面撕裂,还不会有普通垂直同步(V-Sync)那样的输入延迟(参见「可变刷新率」/「FreeSync 与 G-Sync」)。提醒一句:这类显示器上,FreeSync 和运动模糊消除/黑帧插入模式通常无法同时开启——只能二选一(参见「FreeSync 与运动模糊消除」)。用它的原生分辨率 1920×1080 运行,画面最清晰。我们是通过显示器的 EDID 读取出这个型号的;这里不会替你更改任何设置。",
  },
];

const ZH_CN_OVERLAY_BY_ID: Map<string, Raw> = new Map(
  [
    ...(rawTweaksZhCN as Raw[]),
    ...(rawTermsZhCN as Raw[]),
    ...(rawTricksZhCN as Raw[]),
    ...(rawGuidesZhCN as Raw[]),
    // The tuning-guide-derived entries (tuning-guides.zh-CN.json → toGuideEntry) carry translated
    // prose only; aliases/related/tier stay English through deepMergeLocale, preserving the overlay
    // invariant that structural fields match English (knowledge-i18n.test.ts).
    ...(tuningGuideEntriesForLanguage("zh-CN") as unknown as Raw[]),
    ...INJECTED_ENTRIES_ZH_CN,
  ].map((r) => [String(r.id), r]),
);

let knowledgeZhCNCache: KnowledgeEntry[] | null = null;

/**
 * The knowledge corpus in the given app language. "en" (or anything else unrecognized) returns the
 * frozen KNOWLEDGE array unchanged — zero cost, zero risk to the pinned English tests. "zh-CN" returns
 * a Simplified Chinese overlay, built once and cached: every entry the zh-CN locale files cover has its
 * text fields translated; an id they don't cover yet (a very recent English-only addition) just
 * falls back to English for that one entry rather than the whole call failing. The tuning-guide-derived
 * entries are covered too — tuningGuideEntriesForLanguage("zh-CN") folds tuning-guides.zh-CN.json into
 * the overlay above (prose only; structural fields stay English via deepMergeLocale).
 */
export function knowledgeForLanguage(lang: string): KnowledgeEntry[] {
  if (lang !== "zh-CN") return KNOWLEDGE;
  if (!knowledgeZhCNCache) {
    knowledgeZhCNCache = KNOWLEDGE.map((e) => {
      const zh = ZH_CN_OVERLAY_BY_ID.get(e.id);
      return zh ? deepMergeLocale(e, zh) : e;
    });
  }
  return knowledgeZhCNCache;
}

let knowledgeByIdZhCNCache: Map<string, KnowledgeEntry> | null = null;

/** `KNOWLEDGE_BY_ID` in the given language — see knowledgeForLanguage() above. */
export function knowledgeByIdForLanguage(lang: string): Map<string, KnowledgeEntry> {
  if (lang !== "zh-CN") return KNOWLEDGE_BY_ID;
  if (!knowledgeByIdZhCNCache) {
    knowledgeByIdZhCNCache = new Map(knowledgeForLanguage(lang).map((e) => [e.id, e]));
  }
  return knowledgeByIdZhCNCache;
}

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
