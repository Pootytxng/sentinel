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
//   D. THE POINTER DOCS ARE IN ITS HAND TOO (added 2026-08-24, the third time). `CLAUDE.md` item 5
//      and `docs/SESSION_HANDOFF.md` both paraphrased this file's open list as "panoramic drag
//      telemetry gallery, magnetic cursor, Lenis, GSAP data-reactivity" — four features of which
//      three SHIPPED 2026-07-12 (`1d310e12`, owner-approved, §A) and the fourth the owner REJECTED
//      and had DELETED (`2de8d17c`, §A.1; `lab-ground.test.tsx` pins it absent). The owner opened
//      2026-08-24 by asking for exactly that train, gallery first. Rule B never saw it: it reads
//      BACKLOG list entries only. So: a live paragraph in a pointer doc that cites this file as
//      🔴 OPEN must name at least one row this file still lists open — rule B's test, applied where
//      the owner actually reads. A pointer names a ROW; the moment it describes features instead,
//      nothing can check it, and the rows it should have named are the ones that go on shipping.
//
// Paths are repo-root-relative; vitest runs from the repo root (scripts/run-vitest.mjs).

const VISION = "docs/UI_VISION_BACKLOG.md";
const BACKLOG = "docs/BACKLOG.md";
/** Docs the owner and a fresh session read FIRST; a paraphrase of the open list here is what he acts on. */
const POINTER_DOCS = ["CLAUDE.md", "docs/SESSION_HANDOFF.md", "docs/OWNER_ACTION_CHECKLIST.md"];

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

// -- Rule D's inputs --------------------------------------------------------------------------

type Paragraph = { n: number; text: string };

/**
 * A pointer doc split into live paragraphs: blank-line separated, and a heading, list item or
 * table row starts its own — otherwise a dense doc is one paragraph and a single open id anywhere
 * in it vouches for everything. Archived `<details>` lines are dropped first, as everywhere here.
 */
const liveParagraphs = (lines: Line[]): Paragraph[] => {
  const out: Paragraph[] = [];
  let cur: Paragraph | null = null;
  for (const line of lines) {
    if (line.inDetails || line.text.trim() === "") {
      cur = null;
      continue;
    }
    if (!cur || /^\s*(?:[-*+]\s|\d+\.\s|\||#)/.test(line.text)) {
      cur = { n: line.n, text: line.text };
      out.push(cur);
    } else cur.text += `\n${line.text}`;
  }
  return out;
};

/** Row ids a paragraph names: `NAV-1`, `DIR-1`, `COLOR-1`, and the single-letter rows as `§G`. */
const namedRows = (text: string): string[] => [
  ...[...text.matchAll(/\b([A-Z][A-Z0-9]*-\d+)\b/g)].map((m) => m[1]),
  ...[...text.matchAll(/§([A-Z])\b/g)].map((m) => m[1]),
];

/**
 * Rule D over one doc: every live paragraph that cites the vision file as 🔴 OPEN must name at
 * least one row the vision file lists open. Naming a shipped row beside an open one is fine — a
 * pointer may say "X is open; Y shipped" — naming only shipped rows, or none, is the defect.
 */
const pointerOffenders = (doc: string, paragraphs: Paragraph[], status: Map<string, boolean>): string[] => {
  const offenders: string[] = [];
  for (const p of paragraphs) {
    if (!p.text.includes("UI_VISION_BACKLOG") || !OPEN_MARKER.test(p.text)) continue;
    const known = namedRows(p.text).filter((id) => status.has(id));
    if (known.some((id) => status.get(id))) continue;
    offenders.push(
      known.length
        ? `${doc}:${p.n} calls ${known.join(", ")} open, but ${VISION} lists ${known.map((id) => `${id} as ✅`).join(", ")}.`
        : `${doc}:${p.n} says ${VISION} is 🔴 OPEN but names no row of it — name rows, not features.`,
    );
  }
  return offenders;
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

  // ── Rule D ────────────────────────────────────────────────────────────────────────────
  it("every pointer-doc paragraph citing the vision file as OPEN names a row that is still open", () => {
    const status = liveRowStatus(lines);
    const offenders = POINTER_DOCS.flatMap((doc) =>
      pointerOffenders(doc, liveParagraphs(readTagged(doc)), status),
    );
    expect(
      offenders,
      `A pointer doc is describing the vision file's open list in its own words, and those words\n` +
        `have outlived the rows. That is how the July motion stack (shipped, owner-approved) and the\n` +
        `deleted gallery were queued as the next design train on 2026-08-24.\n` +
        `Fix: name the open row ids (e.g. DIR-1, §G) and drop the feature list.\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("rule D has pointer paragraphs to read (it is not passing vacuously)", () => {
    const cited = POINTER_DOCS.flatMap((doc) =>
      liveParagraphs(readTagged(doc)).filter(
        (p) => p.text.includes("UI_VISION_BACKLOG") && OPEN_MARKER.test(p.text),
      ),
    );
    // CLAUDE.md item 5, the handoff's vision line and checklist B5 all cite the file as open.
    expect(cited.length).toBeGreaterThanOrEqual(3);
    expect(liveRowStatus(lines).get("DIR-1"), "the standing directive row lost its id").toBe(true);
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

  it("rule D catches the exact handoff paragraph that shipped, and only that shape", () => {
    const status = new Map<string, boolean>([
      ["A", false],
      ["G", true],
      ["DIR-1", true],
    ]);
    const judge = (text: string, inDetails = false) =>
      pointerOffenders(
        "fixture.md",
        liveParagraphs(text.split("\n").map((t, i) => ({ n: i + 1, text: t, inDetails }))),
        status,
      );
    // docs/SESSION_HANDOFF.md:34-37 as it stood on 2026-08-24 — verbatim.
    const shipped = [
      "- **The owner's larger design VISION is not this train** and remains open by his own backlog:",
      "  `docs/UI_VISION_BACKLOG.md` 🔴 OPEN (panoramic drag telemetry gallery, magnetic cursor, Lenis,",
      "  GSAP data-reactivity). The self-review verdict said this plainly: 6c054b77 is one scoped",
      "  increment; a reskin/lock is not the vision. That is the natural next design train.",
    ].join("\n");
    expect(judge(shipped)).toEqual([expect.stringContaining("fixture.md:1 says")]);
    // Names a row, but one the vision file lists shipped: the rule B defect, in a pointer doc.
    expect(judge("`docs/UI_VISION_BACKLOG.md` §A is 🔴 OPEN — build it.")).toEqual([
      expect.stringContaining("calls A open"),
    ]);
    // Names a live row (beside a shipped one): the honest shape, allowed.
    expect(judge("`docs/UI_VISION_BACKLOG.md` 🔴 OPEN is DIR-1; §A shipped.")).toEqual([]);
    // Cites the file without claiming it open, or from inside an archive block: not our call.
    expect(judge("read `docs/UI_VISION_BACKLOG.md` before any UI work")).toEqual([]);
    expect(judge(shipped, true)).toEqual([]);
    // A heading or list item breaks the paragraph — an open id on the next bullet vouches for nothing.
    expect(judge(`${shipped}\n- DIR-1 is open.`)).toHaveLength(1);
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
