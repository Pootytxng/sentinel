import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

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
// SCOPE, honestly: rules A and B are Markdown text checks, not semantic ones. They prove the two
// files agree about WHICH rows are open; they cannot prove a row that says OPEN is genuinely
// unbuilt. That is the false-done protocol's business and it needs a human or a code check.
//
//   C. ONE SHAPE OF THAT IS A CODE CHECK (added 2026-08-22, after it happened again). A live line
//      may not say a law has NO GUARD while a guard test names the same CSS custom property. That is
//      exactly how TYPE-1's mono residual read: `mono-law-guard.test.ts` shipped 2026-08-18
//      (`3eca4a9f`) and paid its debt to zero on 2026-08-19 (`be4c81ec`), while BACKLOG's open list
//      and UI_VISION both went on saying "still a comment with no guard" for four more days -- long
//      enough for a session to be pointed at finished work for the second time in one week. The
//      first time cost the owner a request; this class does not get a third chance at prose.
//      Archived `<details>` text is exempt by construction: it records what was true then.
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

// -- Rule C's inputs --------------------------------------------------------------------------
// A claim is only checked against a token that is REALLY a CSS custom property declared in this
// repo. Without that intersection every `--release` and `--no-bundle` in a doc would be a candidate
// token, and a guard test that happens to mention one would fail the build for no reason.

const CODE_ROOTS = ["src", "scripts"];
const SKIP_DIRS = new Set(["node_modules", "target", "dist", ".git", "coverage"]);

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full.replace(/\\/g, "/"));
  }
  return out;
};

const codeFiles = (): string[] => CODE_ROOTS.flatMap((r) => walk(r));

/** Every custom property this repo DECLARES in a stylesheet. */
const declaredProperties = (files: string[]): Set<string> => {
  const props = new Set<string>();
  for (const f of files.filter((x) => x.endsWith(".css"))) {
    for (const m of readFileSync(f, "utf8").matchAll(/(--[a-z][a-z0-9-]*)\s*:/g)) props.add(m[1]);
  }
  return props;
};

/**
 * Custom property -> the guard tests that name it more than once. Once can be an aside in a
 * comment; twice is the file working with it.
 */
const guardedProperties = (files: string[]): Map<string, string[]> => {
  const index = new Map<string, string[]>();
  for (const f of files.filter((x) => /guard[\w.-]*\.test\.(?:tsx?|mjs)$/.test(x))) {
    const text = readFileSync(f, "utf8");
    const counts = new Map<string, number>();
    for (const m of text.matchAll(/--[a-z][a-z0-9-]*/g)) counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
    for (const [prop, n] of counts) {
      if (n < 2) continue;
      index.set(prop, [...(index.get(prop) ?? []), f]);
    }
  }
  return index;
};

/** The vocabulary a doc uses to say "this law is written down and nothing checks it". */
const UNGUARDED_CLAIM = /\bno guard\b|\bnothing enforces\b|\bstill (?:just )?a comment\b|\bunguarded\b/i;
/** Greppable escape hatch, same idiom as `mutation-boundary-allow`: the line is ABOUT the gap. */
const CLAIM_ALLOW = "unguarded-claim-allow";

type Claim = { line: number; property: string; guards: string[] };

/**
 * Live lines claiming a property is unguarded while a guard test works with it. A claim routinely
 * wraps ("the mono-for-machine-values-only law is still / a comment with no guard"), so each line is
 * read together with the next one -- the same reason rule B reads whole entries rather than lines.
 */
const unguardedClaims = (
  lines: Line[],
  declared: Set<string>,
  guards: Map<string, string[]>,
): Claim[] => {
  const found: Claim[] = [];
  lines.forEach((line, i) => {
    if (line.inDetails) return;
    const next = lines[i + 1];
    const context = `${line.text} ${next && !next.inDetails ? next.text : ""}`;
    if (!UNGUARDED_CLAIM.test(context) || context.includes(CLAIM_ALLOW)) return;
    for (const property of new Set(context.match(/--[a-z][a-z0-9-]*/g) ?? [])) {
      if (!declared.has(property)) continue;
      const hits = guards.get(property);
      if (hits?.length) found.push({ line: line.n, property, guards: hits });
    }
  });
  return found;
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
      "utf8",
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
      "utf8",
    );
    const entries = backlogEntries(tmp);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toContain("COLOR-9");
    expect(entries[0].text).toContain("UI_VISION_BACKLOG.md");
    expect(OPEN_MARKER.test(entries[0].text)).toBe(true);
  });
});

describe("UI vision status guard: a live doc cannot call a guarded law unguarded (rule C)", () => {
  const files = codeFiles();
  const declared = declaredProperties(files);
  const guards = guardedProperties(files);

  it("the index it reasons over is real", () => {
    // Without this, a broken walk would silently make rule C pass on everything.
    expect(declared.size, "no custom properties found in src/ -- the CSS walk is broken").toBeGreaterThan(50);
    expect(guards.size, "no guard test names any custom property -- the guard walk is broken").toBeGreaterThan(5);
    expect(guards.get("--v2-font-mono") ?? [], "the mono law's guard should be in the index")
      .toContain("src/design/mono-law-guard.test.ts");
  });

  it.each([VISION, BACKLOG])("%s calls no law unguarded that a guard test works with", (doc) => {
    const claims = unguardedClaims(readTagged(doc), declared, guards);
    expect(
      claims.map((c) => `${doc}:${c.line} says ${c.property} is unguarded -- ${c.guards.join(", ")}`),
      `A live line calls a law unguarded while a guard test works with the same custom property.\n` +
        `That is how TYPE-1's mono residual stayed in the open list for four days after\n` +
        `mono-law-guard.test.ts shipped, pointing a session at finished work.\n\n` +
        `Fix: correct the line (say what the guard does and what it still cannot see), or -- if the\n` +
        `line is deliberately about a REMAINING hole in that guard -- put ${CLAIM_ALLOW} on it.`,
    ).toEqual([]);
  });

  it("is armed: it catches the exact sentence that shipped, and honours the escape hatch", () => {
    const claimed = (text: string, inDetails = false): Claim[] =>
      unguardedClaims([{ n: 1, text, inDetails }], declared, guards);

    const real =
      "**Still open from this row:** the `--v2-font-mono` machine-values law is still a comment with no guard.";
    expect(claimed(real).map((c) => c.property)).toEqual(["--v2-font-mono"]);
    // Archived record of what was once true: exempt, or every <details> block becomes a liability.
    expect(claimed(real, true)).toEqual([]);
    // Deliberate statement about a real remaining hole: allowed, and greppable.
    expect(claimed(`${real} <!-- ${CLAIM_ALLOW} -->`)).toEqual([]);
    // A property nothing declares, and a CLI flag that is not a property at all: both ignored.
    expect(claimed("`--v2-nonexistent-token` has no guard and `--no-bundle` has no guard either")).toEqual([]);
  });

  it("is armed across a line wrap, which is how the sentence was actually written", () => {
    const lines: Line[] = [
      // Neither line carries the whole claim: 41 names the property, 42 says "no guard", and the
      // phrase "still a comment" is itself cut in half. Only the joined context sees it.
      { n: 41, text: "**Still open:** the `--v2-font-mono` machine-values law is still", inDetails: false },
      { n: 42, text: "a comment, and nothing enforces it.", inDetails: false },
    ];
    expect(unguardedClaims(lines, declared, guards).map((c) => c.line)).toEqual([41]);
  });
});
