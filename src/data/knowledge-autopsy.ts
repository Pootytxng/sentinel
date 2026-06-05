// Guide Autopsy — paste a tweak guide, get an honest grade. Pure, local-only matching: every entry
// name/alias is matched against the pasted text longest-first so a short alias inside a longer match
// isn't double-counted, each entry is credited once per non-overlapping occurrence, and any content
// line with no recognized term is counted as "we don't recognize this" — never given a guessed verdict.

import { KNOWLEDGE, foldText, type KnowledgeEntry, type KnowledgeType, type TweakVerdict } from "./knowledge";

/** Pasted input is capped before matching so a giant dump degrades gracefully instead of hanging. */
export const AUTOPSY_MAX_CHARS = 100_000;

export type AutopsyHit = {
  id: string;
  name: string;
  type: KnowledgeType;
  verdict?: TweakVerdict;
  occurrences: number;
};

export type AutopsyResult = {
  truncated: boolean;
  hits: AutopsyHit[];
  // Headline grade: distinct tweaks counted by verdict, plus content lines we recognized nothing in.
  grade: { real: number; placebo: number; risky: number; unknown: number };
  // Known scam patterns (tricks) spotted in the text — surfaced separately, not folded into a verdict.
  scamFlags: number;
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Tie-break so the verdict-bearing entry claims a shared word (e.g. "xmp" credits the tweak, not the term).
const TYPE_PRIORITY: Record<KnowledgeType, number> = { tweak: 0, trick: 1, guide: 2, term: 3 };

export function autopsyScan(text: string, entries: KnowledgeEntry[] = KNOWLEDGE): AutopsyResult {
  const truncated = text.length > AUTOPSY_MAX_CHARS;
  const folded = foldText(truncated ? text.slice(0, AUTOPSY_MAX_CHARS) : text);

  // Every match candidate (entry × each of its name/aliases), longest first; verdict-bearing types win ties.
  const candidates: { entry: KnowledgeEntry; needle: string }[] = [];
  for (const entry of entries) {
    for (const s of [entry.name, ...entry.aliases]) {
      const needle = foldText(s).trim();
      if (needle.length >= 2) candidates.push({ entry, needle });
    }
  }
  candidates.sort(
    (a, b) =>
      b.needle.length - a.needle.length || TYPE_PRIORITY[a.entry.type] - TYPE_PRIORITY[b.entry.type],
  );

  const claimed: [number, number][] = []; // character ranges already attributed to an entry
  const overlaps = (s: number, e: number) => claimed.some(([cs, ce]) => s < ce && cs < e);
  const occ = new Map<string, number>();

  for (const { entry, needle } of candidates) {
    // Boundaries so "ram" doesn't match inside "program"; alnum on either side blocks the match.
    const re = new RegExp(`(?<![a-z0-9])${escapeRegex(needle)}(?![a-z0-9])`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(folded)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const start = m.index;
      const end = start + m[0].length;
      if (overlaps(start, end)) continue;
      claimed.push([start, end]);
      occ.set(entry.id, (occ.get(entry.id) ?? 0) + 1);
    }
  }

  const byId = new Map(entries.map((e) => [e.id, e]));
  const hits: AutopsyHit[] = [...occ.entries()].map(([id, occurrences]) => {
    const e = byId.get(id)!;
    return {
      id,
      name: e.name,
      type: e.type,
      verdict: e.type === "tweak" ? e.verdict : undefined,
      occurrences,
    };
  });
  // Strongest signal first: most-mentioned, then verdict-bearing types, then name.
  hits.sort(
    (a, b) =>
      b.occurrences - a.occurrences ||
      TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type] ||
      a.name.localeCompare(b.name),
  );

  const grade = { real: 0, placebo: 0, risky: 0, unknown: 0 };
  let scamFlags = 0;
  for (const h of hits) {
    if (h.type === "tweak" && h.verdict) grade[h.verdict] += 1;
    else if (h.type === "trick") scamFlags += 1;
  }

  // Unknown = content lines (real text, not blank/decorative) that contain no recognized term.
  let offset = 0;
  for (const line of folded.split("\n")) {
    const start = offset;
    const end = offset + line.length;
    offset = end + 1; // account for the stripped "\n"
    const trimmed = line.trim();
    if (trimmed.length < 3 || !/[a-z]/.test(trimmed)) continue;
    const recognized = claimed.some(([cs, ce]) => cs < end && start < ce);
    if (!recognized) grade.unknown += 1;
  }

  return { truncated, hits, grade, scamFlags };
}
