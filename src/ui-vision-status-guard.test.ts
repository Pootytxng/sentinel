import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "fs";

// UI-VISION STATUS GUARD (bug → guard, 2026-08-22).
//
// THE DEFECT, exactly as it happened. `docs/BACKLOG.md` ▶ NEXT UP item 4 read:
//
//     4. COLOR-1 · room accents collide with the status palette —
//        UI_VISION_BACKLOG.md 🔴 OPEN. ... build it, hand him a before/after
//
// COLOR-1 shipped on 2026-08-13 (v0.9.22 `700cd565`): `src/surfaces/room-identity.css` carries zero
// live rules, `ROOM_IDENTITY` maps every room to one violet, and `src/surfaces/room-identity.test.ts`
// pins the deletion. The queue was pointing a session at a nine-day-old finished job, and the owner
// read that queue and asked for it to be built.
//
// WHY IT SURVIVED A READER. UI_VISION_BACKLOG keeps each shipped row's ORIGINAL measurement inside a
// collapsed `<details>` block, for the record — a good habit. COLOR-1's archived original still
// carried its own `### ... 🔴 OPEN` heading, so the file contained the live heading
// "COLOR-1. ✅ SHIPPED" AND, 13 lines below it, "COLOR-1. Room accents collide ... 🔴 OPEN".
// Grepping the file for open UI work — which is exactly what its own "How to use this file" section
// tells the next session to do — returns the archived line, and nothing distinguishes it from a real
// one. The marker outlived the state it described.
//
// TWO RULES, both mechanical:
//
//   A. A status marker may not appear inside a `<details>` block. Archived text is a record of what
//      was once true; a marker is a claim about what is true NOW. Keep the prose, drop the marker.
//   B. A BACKLOG entry that cites this file as 🔴 OPEN must name a row this file still lists as open.
//      This is the cross-doc half — rule A alone keeps the vision file honest, and a queue item that
//      simply went stale on its own would still slip through.
//
// SCOPE, honestly: this is a Markdown text check, not a semantic one. It proves the two files agree
// about WHICH rows are open; it cannot prove a row that says OPEN is genuinely unbuilt. That failure
// mode is the false-done protocol's business, and it needs a human or a code check, not a regex.
//
// Paths are repo-root-relative; vitest runs from the repo root (scripts/run-vitest.mjs).

const VISION = "docs/UI_VISION_BACKLOG.md";
const BACKLOG = "docs/BACKLOG.md";

/** The status vocabulary these two files actually use in headings and queue rows. */
const MARKER = /🔴 OPEN|✅ SHIPPED|✅ CLOSED|🟢 [A-Z]|🟡 [A-Z]/u;
const OPEN_MARKER = /🔴 OPEN/u;

type Line = { n: number; text: string; inDetails: boolean };

/** Every line of a file tagged with whether it sits inside a `<details>` archive block. */
const readTagged = (path: string): Line[] => {
  const out: Line[] = [];
  let depth = 0;
  readFileSync(path, "utf8")
    .split(/\r?\n/)
    .forEach((text, i) => {
      const opens = (text.match(/<details/g) ?? []).length;
      const closes = (text.match(/<\/details>/g) ?? []).length;
      // A line that OPENS a block is itself outside it (the <summary> is the visible handle);
      // a line that closes one is inside, which is why depth is applied before the update.
      out.push({ n: i + 1, text, inDetails: depth > 0 });
      depth += opens - closes;
    });
  return out;
};

/**
 * Row id -> whether its LIVE heading says open. Ids are the leading token of a top-level `### `
 * heading: `COLOR-1.`, `UX-1.`, `A0.`, `B.` — optionally behind the ⭐ the owner marks a
 * headline row with. Headings inside `<details>` are archive and are skipped by construction.
 */
const liveRowStatus = (lines: Line[]): Map<string, boolean> => {
  const status = new Map<string, boolean>();
  for (const { text, inDetails } of lines) {
    if (inDetails) continue;
    const m = /^###\s+(?:⭐\s*)?([A-Z][A-Z0-9-]*)\./.exec(text);
    if (!m) continue;
    status.set(m[1], OPEN_MARKER.test(text));
  }
  return status;
};

/**
 * BACKLOG split into list entries — a numbered item or a `- [ ]` / `- [x]` bullet, plus its
 * continuation lines. A queue item's id and its citation routinely sit on different lines
 * (item 4 named COLOR-1 on one line and linked the vision file on the next), so a per-line
 * check would have missed the very defect this file is written for.
 */
const backlogEntries = (path: string): { n: number; text: string }[] => {
  const entries: { n: number; text: string }[] = [];
  readFileSync(path, "utf8")
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (/^\s*(?:\d+\.|-\s\[[ x]\])\s/.test(line)) entries.push({ n: i + 1, text: line });
      else if (entries.length) entries[entries.length - 1].text += `\n${line}`;
    });
  return entries;
};

describe("UI vision status guard: an archived row cannot advertise itself as live work", () => {
  const lines = readTagged(VISION);

  // ── Rule A ────────────────────────────────────────────────────────────────────────────
  it("no status marker survives inside a <details> archive block", () => {
    const offenders = lines
      .filter((l) => l.inDetails && MARKER.test(l.text))
      .map((l) => `${VISION}:${l.n} — ${l.text.trim().slice(0, 100)}`);
    expect(
      offenders,
      `A collapsed <details> block is the ORIGINAL measurement, kept for the record. A status\n` +
        `marker inside one claims to describe the row's state today, and a grep for open work\n` +
        `cannot tell it apart from a live heading — that is how COLOR-1, shipped 2026-08-13, was\n` +
        `still being queued as unbuilt work on 2026-08-22.\n` +
        `Fix: delete the marker from the archived heading; the live heading above it owns status.\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the archive is real (this guard has something to guard)", () => {
    // If <details> blocks ever vanish from the file, rule A passes vacuously and reads as coverage.
    expect(lines.filter((l) => l.inDetails).length).toBeGreaterThan(20);
  });

  // ── Rule B ────────────────────────────────────────────────────────────────────────────
  it("every BACKLOG item citing the vision file as OPEN names a row that is still open", () => {
    const status = liveRowStatus(lines);
    expect(status.size, "no row ids parsed — the heading shape changed").toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const entry of backlogEntries(BACKLOG)) {
      if (!entry.text.includes("UI_VISION_BACKLOG.md")) continue;
      if (!OPEN_MARKER.test(entry.text)) continue;
      const ids = [...entry.text.matchAll(/\b([A-Z][A-Z0-9]*-\d+)\b/g)].map((m) => m[1]);
      const known = ids.filter((id) => status.has(id));
      if (!known.length) continue; // cites the file generally, names no specific row — not our call
      if (known.some((id) => status.get(id))) continue;
      offenders.push(
        `${BACKLOG}:${entry.n} calls ${known.join(", ")} open, but ${VISION} lists ` +
          `${known.map((id) => `${id} as ✅`).join(", ")}.`,
      );
    }
    expect(
      offenders,
      `The queue is pointing a session at work the vision file says is already shipped.\n` +
        `Fix: close the BACKLOG item (say what landed and where), or — if the row genuinely\n` +
        `re-opened — say so in the vision file's LIVE heading, which is what this reads.\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });
});

// ── Falsification — drive the same functions with synthetic docs that must trip them ──────
describe("UI vision status guard: the guard itself is armed", () => {
  it("rule A's tagger puts an archived heading inside the block and the live one outside", () => {
    const tmp = `${process.env.TEMP ?? "."}/compy-vision-guard-fixture.md`;
    writeFileSync(
      tmp,
      [
        "### COLOR-9. ✅ SHIPPED",
        "<details><summary>Original</summary>",
        "",
        "### COLOR-9. It collides 🔴 OPEN",
        "",
        "</details>",
      ].join("\n"),
    );
    const tagged = readTagged(tmp);
    const live = tagged.find((l) => l.text.includes("✅ SHIPPED"))!;
    const archived = tagged.find((l) => l.text.includes("🔴 OPEN"))!;
    expect(live.inDetails).toBe(false);
    expect(archived.inDetails).toBe(true);
    expect(liveRowStatus(tagged).get("COLOR-9")).toBe(false); // live heading wins
  });

  it("rule B's entry splitter keeps an id and a citation on different lines together", () => {
    const tmp = `${process.env.TEMP ?? "."}/compy-backlog-guard-fixture.md`;
    writeFileSync(
      tmp,
      ["4. **COLOR-9 · room accents collide** —", "   UI_VISION_BACKLOG.md 🔴 OPEN. Build it."].join(
        "\n",
      ),
    );
    const entries = backlogEntries(tmp);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toContain("COLOR-9");
    expect(entries[0].text).toContain("UI_VISION_BACKLOG.md");
    expect(OPEN_MARKER.test(entries[0].text)).toBe(true);
  });
});
