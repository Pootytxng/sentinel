// The command palette's INDEX and RANKING — pure data, no React, no DOM.
//
// Why this exists (owner, 2026-08-11): "the lack of easy app/ui navigation capability ... just not
// inherently familiar or intuitive enough, which is honestly my biggest gripe with this app." A
// tester could not find things. The rail shows four rooms; the Lab's instruments, Settings, and 190+
// Blackbook entries are all BEHIND those four doors, and nothing tells a newcomer which door.
//
// The fix is one box that searches every destination at once and goes there. Two rules shape the
// ranking below, and both come from who this is for:
//
//   1. NAVIGATION OUTRANKS READING. Someone typing here is usually trying to GET somewhere, not to
//      read an article. 190 Blackbook entries would otherwise bury 4 rooms and 6 instruments on
//      almost any query, so groups carry weight and rooms/instruments sort first at equal match.
//   2. SYMPTOMS ARE SEARCH TERMS. A non-technical user types what is WRONG ("stutter", "crash",
//      "loud"), not the instrument's name. Every station indexes its own "reach for it when" line —
//      the same symptom text the Lab router already shows — so plain-English trouble finds the
//      instrument even though the words never appear in its title.
//
// Matching is deliberately dumb: case-insensitive substring, all query words must appear somewhere.
// No fuzzy matching — a fuzzy hit that lands the user in the wrong room is worse than no hit, and
// this corpus is small enough that substring finds what is there.
import type { HomeRailId, HomeRailItem } from "./homeRail";
import type { LabStationKey, LabStationInfo } from "../surfaces/lab-guided-data";
import type { KnowledgeEntry } from "../data/knowledge";
import type { InterviewFindingId, PaletteIntent } from "../surfaces/home-interview-data";

/** Where an item sends you. Each kind maps to an EXISTING single writer in App.tsx — the palette
 *  introduces no new navigation path (see CommandPalette's docblock). `intent` (P7-palette) opens
 *  the Home interview at that finding's card — the same journey answering the interview lands on. */
export type PaletteAction =
  | { kind: "room"; room: HomeRailId }
  | { kind: "station"; station: LabStationKey }
  | { kind: "entry"; entryId: string }
  | { kind: "settings" }
  | { kind: "intent"; finding: InterviewFindingId };

export type PaletteGroup = "intent" | "room" | "station" | "app" | "entry";

export type PaletteItem = {
  /** Stable unique key — also the DOM id for aria-activedescendant. */
  key: string;
  /** What the user reads. A room/instrument NAME, never an internal id (room-labels-vs-nav-ids). */
  label: string;
  /** One plain-English line saying what is through that door. Never a status sentence. */
  hint: string;
  group: PaletteGroup;
  /** Extra match text the user might type but never sees as the label: symptoms, aliases, synonyms. */
  keywords: string[];
  /** Position in the index. Breaks score ties, so rooms come out in RAIL order and instruments in
   *  dock order — the same order the app itself presents them in. Alphabetical would be a quiet
   *  reshuffle of the app's own map, which is exactly the disorientation this feature exists to
   *  fix. */
  order: number;
  action: PaletteAction;
};

/** Group ordering + base weight. Rooms and instruments outrank the corpus — see rule 1 above. */
const GROUP_WEIGHT: Record<PaletteGroup, number> = {
  // P7-palette: an intent sits between rooms and instruments. With no query the map (rooms) still
  // comes first; once a word matches, an intent's label hit (+60/+100) carries it past an
  // instrument's keyword hit (+30) and a room's hint hit (+15), so typing a problem lands on its
  // answer rather than on a door — rule 2 above, taken to the interview.
  intent: 350,
  room: 400,
  station: 300,
  app: 200,
  entry: 0,
};

export const GROUP_LABEL: Record<PaletteGroup, string> = {
  intent: "Ask Compy",
  room: "Rooms",
  station: "Test instruments",
  app: "App",
  entry: "History",
};

/** Rooms are ordered by the rail; everything else follows the group order. */
export const GROUP_ORDER: PaletteGroup[] = ["intent", "room", "station", "app", "entry"];

/**
 * Build the searchable index.
 *
 * `rail` is the rail the app is ACTUALLY showing (railFor's output), not HOME_RAIL — a palette that
 * offers a door the rail has retired would teleport the user somewhere the app no longer has.
 * Every list is optional: a caller that cannot perform an action must not index it, because an
 * entry that looks like a destination and goes nowhere is a fake affordance.
 */
export function buildPaletteIndex(input: {
  rail: HomeRailItem[];
  railLabel: (item: HomeRailItem) => string;
  roomHint: (id: HomeRailId) => string;
  stations?: { key: LabStationKey; info: LabStationInfo }[];
  entries?: KnowledgeEntry[];
  settingsLabel?: string;
  settingsHint?: string;
  /** P7-palette: the interview's answers as plain problems. Omitted → not indexed (a caller that
   *  cannot open the interview must not offer it). */
  intents?: PaletteIntent[];
  /** The one line under every intent: where it goes (the interview's card for it). */
  intentHint?: string;
}): PaletteItem[] {
  const items: PaletteItem[] = [];

  // Intents first in index order so, at equal score, the interview's own order holds; the group
  // weight keeps rooms ahead of them while nothing is typed.
  for (const intent of input.intents ?? []) {
    items.push({
      key: `intent:${intent.finding}`,
      label: intent.label,
      hint: input.intentHint ?? "",
      group: "intent",
      keywords: intent.keywords,
      order: items.length,
      action: { kind: "intent", finding: intent.finding },
    });
  }

  for (const item of input.rail) {
    items.push({
      key: `room:${item.id}`,
      label: input.railLabel(item),
      hint: input.roomHint(item.id),
      group: "room",
      keywords: [item.id],
      order: items.length,
      action: { kind: "room", room: item.id },
    });
  }

  for (const { key, info } of input.stations ?? []) {
    items.push({
      key: `station:${key}`,
      label: info.name,
      hint: info.forLine,
      group: "station",
      // whenLine is the symptom that sends you here ("games stutter", "it crashed or froze") — rule
      // 2. It is a keyword rather than the hint because the hint says what the instrument IS.
      keywords: [key, info.whenLine],
      order: items.length,
      action: { kind: "station", station: key },
    });
  }

  if (input.settingsLabel) {
    items.push({
      key: "app:settings",
      label: input.settingsLabel,
      hint: input.settingsHint ?? "",
      group: "app",
      keywords: ["settings", "preferences", "options", "language", "about", "update"],
      order: items.length,
      action: { kind: "settings" },
    });
  }

  for (const entry of input.entries ?? []) {
    items.push({
      key: `entry:${entry.id}`,
      label: entry.name,
      hint: entryHint(entry),
      group: "entry",
      keywords: [...entry.aliases, entry.topic, entry.type],
      order: items.length,
      action: { kind: "entry", entryId: entry.id },
    });
  }

  return items;
}

/** The one-line "what is this" per entry type — the field that actually answers it in each shape. */
function entryHint(entry: KnowledgeEntry): string {
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

/** Split a query into lowercase words. Empty/whitespace query → no words (the default view). */
export function queryWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Score one item against pre-split query words. Returns -1 for no match.
 *
 * Every word must appear SOMEWHERE (label, hint, or keywords) — typing more words narrows, which is
 * what people expect from a search box. The score then rewards WHERE the match landed: a label
 * beats a description, and a label the query starts is the thing you were almost certainly typing.
 */
export function scoreItem(item: PaletteItem, words: string[]): number {
  if (words.length === 0) return GROUP_WEIGHT[item.group];

  const label = item.label.toLowerCase();
  const hint = item.hint.toLowerCase();
  const keywords = item.keywords.map((k) => k.toLowerCase());

  let score = GROUP_WEIGHT[item.group];
  for (const word of words) {
    if (label.startsWith(word)) score += 100;
    else if (label.includes(word)) score += 60;
    else if (keywords.some((k) => k.includes(word))) score += 30;
    else if (hint.includes(word)) score += 15;
    else return -1; // this word appears nowhere — the item is not a match at all
  }
  return score;
}

/**
 * Rank and cut. An empty query shows the navigable destinations only (rooms, instruments, Settings)
 * — opening the palette should show you the map, not dump 190 articles at someone who has not typed
 * anything yet. Intents (P7-palette) wait for a typed word too: they answer a problem someone
 * states, and thirteen of them above the map would bury it. `limit` caps the list so the overlay
 * never becomes its own scrolling haystack.
 */
export function filterPalette(items: PaletteItem[], query: string, limit = 12): PaletteItem[] {
  const words = queryWords(query);
  const pool =
    words.length === 0 ? items.filter((i) => i.group !== "entry" && i.group !== "intent") : items;

  return pool
    .map((item) => ({ item, score: scoreItem(item, words) }))
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score || a.item.order - b.item.order)
    .slice(0, limit)
    .map((r) => r.item);
}
