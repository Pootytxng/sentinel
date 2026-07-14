// Guide Autopsy — paste a tweak guide, get an honest grade. Pure, local-only matching.
//
// Overlap policy (owner decision, 2026-06-05): VERDICT-BEARING entries (tweaks + tricks) win an
// overlapping span's COUNT. A guide whose alias overlaps a verdict-bearing match does NOT consume the
// match — it attaches to that row as a "safe how-to available" link. So "enable XMP" credits the XMP
// tweak's verdict AND offers the XMP guide as a how-to, rather than the longer guide alias eating it.
// Within each tier, longest-alias-first still avoids substring double-counts; each entry is credited
// once per non-overlapping occurrence; a content line with no recognized term is "we don't recognize"
// (never a guessed verdict). Input is capped so a giant dump degrades gracefully.

import { KNOWLEDGE, foldText, type KnowledgeEntry, type KnowledgeType, type TweakVerdict } from "./knowledge";

export const AUTOPSY_MAX_CHARS = 100_000;

export type AutopsyHit = {
  id: string;
  name: string;
  type: KnowledgeType;
  verdict?: TweakVerdict;
  occurrences: number;
  // Guide ids offering a safe how-to for this hit (attached, not counted as their own row).
  howTos: string[];
};

export type AutopsyResult = {
  truncated: boolean;
  hits: AutopsyHit[];
  grade: { real: number; placebo: number; risky: number; unknown: number };
  scamFlags: number;
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const isVerdictBearing = (t: KnowledgeType) => t === "tweak" || t === "trick";
// Within a tier, prefer the verdict-bearing/specific type when alias lengths tie.
const TYPE_PRIORITY: Record<KnowledgeType, number> = { tweak: 0, trick: 1, guide: 2, term: 3 };

type Claim = { start: number; end: number; ownerId: string; ownerVerdict: boolean };

export function autopsyScan(text: string, entries: KnowledgeEntry[] = KNOWLEDGE): AutopsyResult {
  const truncated = text.length > AUTOPSY_MAX_CHARS;
  const folded = foldText(truncated ? text.slice(0, AUTOPSY_MAX_CHARS) : text);

  const candidates: { entry: KnowledgeEntry; needle: string }[] = [];
  for (const entry of entries) {
    for (const s of [entry.name, ...entry.aliases]) {
      const needle = foldText(s).trim();
      if (needle.length >= 2) candidates.push({ entry, needle });
    }
  }
  // Verdict-bearing first (they win the overlap count), then longest alias, then type order.
  candidates.sort(
    (a, b) =>
      (isVerdictBearing(a.entry.type) ? 0 : 1) - (isVerdictBearing(b.entry.type) ? 0 : 1) ||
      b.needle.length - a.needle.length ||
      TYPE_PRIORITY[a.entry.type] - TYPE_PRIORITY[b.entry.type],
  );

  const claimed: Claim[] = [];
  const occ = new Map<string, number>();
  const howTos = new Map<string, Set<string>>(); // verdict ownerId -> guide ids

  for (const { entry, needle } of candidates) {
    const re = new RegExp(`(?<![a-z0-9])${escapeRegex(needle)}(?![a-z0-9])`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(folded)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const start = m.index;
      const end = start + m[0].length;
      const owner = claimed.find((c) => start < c.end && c.start < end);
      if (owner) {
        // Span already owned. A guide over a verdict owner becomes a "safe how-to" link, not a count.
        if (entry.type === "guide" && owner.ownerVerdict) {
          if (!howTos.has(owner.ownerId)) howTos.set(owner.ownerId, new Set());
          howTos.get(owner.ownerId)!.add(entry.id);
        }
        continue;
      }
      claimed.push({ start, end, ownerId: entry.id, ownerVerdict: isVerdictBearing(entry.type) });
      occ.set(entry.id, (occ.get(entry.id) ?? 0) + 1);
    }
  }

  const byId = new Map(entries.map((e) => [e.id, e]));
  const hits: AutopsyHit[] = [...occ.entries()]
    // `occ` only counts STANDALONE (non-overlapping owner) mentions — an attachment increments
    // `howTos` and `continue`s before the occ bump, never `occ`. So every guide in `occ.entries()`
    // has ≥1 genuine standalone mention distinct from any attachment span; those must NOT be dropped
    // just because the SAME guide attached elsewhere via a different alias (that undercounted a real
    // standalone occurrence). A guide with ONLY overlapping mentions has occ=0, so it never reaches
    // here anyway — it shows only as a how-to chip, no filter needed.
    .map(([id, occurrences]) => {
      const e = byId.get(id)!;
      return {
        id,
        name: e.name,
        type: e.type,
        verdict: e.type === "tweak" ? e.verdict : undefined,
        occurrences,
        howTos: [...(howTos.get(id) ?? [])],
      };
    });
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
    const recognized = claimed.some((c) => c.start < end && start < c.end);
    if (!recognized) grade.unknown += 1;
  }

  return { truncated, hits, grade, scamFlags };
}
