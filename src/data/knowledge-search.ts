// Pure search over the knowledge library. Case-insensitive, diacritic-safe, multi-word (every word
// must match), matching name + aliases + body. With ~120 entries this is instant; it's kept pure +
// unit-tested rather than inlined so the matching rules are pinned. UI debounces the input upstream.

import { KNOWLEDGE, entryBody, foldText, type KnowledgeEntry } from "./knowledge";

type Ranked = { entry: KnowledgeEntry; rank: number };

function rankOf(entry: KnowledgeEntry, needle: string): number {
  const name = foldText(entry.name);
  const aliases = entry.aliases.map(foldText);
  if (name === needle || aliases.includes(needle)) return 0; // exact name/alias hit
  if (name.startsWith(needle) || aliases.some((a) => a.startsWith(needle))) return 1;
  if (name.includes(needle) || aliases.some((a) => a.includes(needle))) return 2;
  return 3; // body-only match
}

/**
 * Returns the entries matching `query`, best matches first. Empty query returns everything in the
 * given order. Every whitespace-separated word in the query must appear somewhere in the entry
 * (name, an alias, or the body) for it to match.
 */
export function searchKnowledge(
  query: string,
  entries: KnowledgeEntry[] = KNOWLEDGE,
): KnowledgeEntry[] {
  const needle = foldText(query.trim());
  if (!needle) return entries.slice();

  const tokens = needle.split(/\s+/).filter(Boolean);
  const ranked: Ranked[] = [];

  entries.forEach((entry, i) => {
    const haystack = [foldText(entry.name), ...entry.aliases.map(foldText), foldText(entryBody(entry))].join(
      " ",
    );
    if (tokens.every((t) => haystack.includes(t))) {
      // Stable sort key: primary rank, then original index to preserve dataset order within a rank.
      ranked.push({ entry, rank: rankOf(entry, needle) * 100000 + i });
    }
  });

  return ranked.sort((a, b) => a.rank - b.rank).map((r) => r.entry);
}
