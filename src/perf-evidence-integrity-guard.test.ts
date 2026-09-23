import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { TREE_WALK_TIMEOUT_MS } from "./test/tree-walk-budget";

/**
 * PERF EVIDENCE INTEGRITY GUARD — a measurement may not be quoted as proof unless it settled.
 *
 * bug→guard (2026-08-21). `scripts/q7-probe.mjs attribute` establishes a baseline before it freezes
 * anything, and it records honestly whether that baseline ever converged:
 *
 *     "baselineStability": { "settled": false, "spread": null, ... }
 *
 * When `settled` is false the probe's own validity note says the baseline never held still, so every
 * band measured against it inherits that error — the numbers are noise wearing three decimal places.
 * The probe prints "NEVER SETTLED" and writes the flag. And then NOTHING ever read it again: before
 * this file, `baselineStability` appeared in exactly one file in the repo, the probe that writes it.
 *
 * That gap is not hypothetical, it is the #127 idle-CPU story:
 *
 *   • run B (`-2026-08-19-B-h1-no-scale.json`, settled FALSE) produced "-0.105 points, i.e. gone",
 *     which became the evidence line in `src/App.css`'s aurora comment AND the rationale inside
 *     `src/ambient-animation-cost-guard.test.ts` for permitting a full-window backdrop to drift
 *     forever ("A full-window backdrop may drift, but it may not breathe");
 *   • run D (`-2026-08-19-D-installed-fix.json`, settled FALSE) produced the 10.483% that was
 *     reported as the fix landing on the installed build, and v0.9.26's owner GO was given partly on
 *     "testers get a build that costs about half as much CPU sitting idle";
 *   • two SETTLED runs on 2026-08-21 (E and F) then measured the surviving translate3d drift at
 *     ~88% of everything the app burns at idle. The drift was never free. It was never measured.
 *
 * A number that never settled is not a weaker number, it is not a number. Cite one and this fails.
 *
 * ESCAPE HATCH, line-level and greppable: `perf-unsettled-allow` on the citing line. It is for text
 * whose SUBJECT is the unsettledness — a post-mortem, a doc explaining why a run was discarded —
 * never for borrowing the run's figures anyway.
 */

// vitest and tsc both run from the repo root (scripts/run-vitest.mjs), so every path here is
// repo-root-relative. ESM, so no __dirname -- same convention as claude-md-laws-guard.test.ts.
const RAW = "docs/perf/raw";
const ALLOW = "perf-unsettled-allow";

/** Files that legitimately hold point-in-time records, and the runs' own self-references. */
const EXEMPT_PREFIXES = [
  // Archives are frozen history by design — TOKEN LAW moves superseded text here rather than
  // deleting it, so rewriting them to satisfy a guard written later would falsify the record.
  "docs/archive/",
  // Same class as docs/archive/, different path: TOKEN LAW routes finished BACKLOG rows here
  // verbatim rather than deleting them, so its text is a record of what was believed at the time.
  "docs/BACKLOG_ARCHIVE.md",
  // A run file citing a sibling run is the probe's own provenance chain, not a claim about the app.
  `${RAW}/`,
];

// The repo writes citations three ways, and a matcher that only understands the first one ships
// green over the two that matter. src/App.css cites the #127 evidence as
// `-2026-08-19-{A-rig-on,B-h1-no-scale}.json` and scripts/perf-budget-guard.test.mjs uses
// `-2026-08-19-*.json`, so BOTH shorthands are expanded to real filenames before the flag is read.
// A literal-only regex passed this whole file on its first run while the offender sat in App.css.
const CITATION = /docs\/perf\/raw\/([A-Za-z0-9._*{},-]*\.json)/g;

/** `pre{a,b}post` -> ["preapost", "prebpost"]; single-level, which is all the repo ever writes. */
function expandBraces(name: string): string[] {
  const m = name.match(/^([^{]*)\{([^}]*)\}(.*)$/);
  if (!m) return [name];
  return m[2].split(",").map((alt) => `${m[1]}${alt.trim()}${m[3]}`);
}

/** `pre-*.json` -> every run on disk it matches; anything else passes through untouched. */
function expandGlob(name: string, onDisk: string[]): string[] {
  if (!name.includes("*")) return [name];
  const re = new RegExp(`^${name.split("*").map(escapeRe).join("[^/]*")}$`);
  return onDisk.filter((f) => re.test(f));
}

function escapeRe(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

interface Offender {
  where: string;
  run: string;
  line: string;
}

const CITING_PATHSPECS = ["*.ts", "*.tsx", "*.mjs", "*.js", "*.css", "*.md", "*.json"];

/** Every tracked text file that could quote a measurement at a reader. */
function citingFiles(): string[] {
  return execFileSync(
    "git",
    ["ls-files", "--", ...CITING_PATHSPECS],
    // No maxBuffer: the repo's execFileSync typing accepts only { input, encoding }, and this
    // listing is ~47 KB today against Node's 1 MB default. Revisit if that ever gets close.
    { encoding: "utf8" },
  )
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((f) => !EXEMPT_PREFIXES.some((p) => f.startsWith(p)));
}

/**
 * #512. The subset of citingFiles() that contains `${RAW}/` at all -- the same test
 * unsettledCitations applies first and skips on, asked of git in one process instead of by opening
 * ~2,000 files here one at a time. That cost 8.8s under the parallel pre-push gate and timed out
 * once on 2026-09-23. A fixed ASCII string is found in the raw bytes exactly when it is found in
 * their UTF-8 decoding, so no file that could hold a citation is dropped. Exit 1 is git grep's
 * "searched, found nothing"; any other failure throws rather than returning an empty, passing list.
 */
function filesMentioningRaw(): string[] {
  let out: string;
  try {
    out = execFileSync("git", ["grep", "-l", "-z", "-a", "-F", "-e", `${RAW}/`, "--", ...CITING_PATHSPECS], {
      encoding: "utf8",
    });
  } catch (e) {
    const err = e as { status?: number | null; stderr?: unknown };
    if (err.status === 1 && !String(err.stderr ?? "").trim()) return [];
    throw e;
  }
  const hits = new Set(out.split("\u0000").filter(Boolean));
  return citingFiles().filter((f) => hits.has(f));
}

/**
 * true only when the run exists AND disqualifies ITSELF, by one of two admissions:
 *
 *   1. `baselineStability.settled === false` — the bands were measured against a baseline that
 *      never held still (the #127 story in this file's header).
 *   2. a `coldstart` run whose rail never painted — added 2026-08-22 after the same mistake in a
 *      different costume. A binary built by a bare `cargo build --release` has no embedded frontend
 *      and loads tauri.conf.json's `build.devUrl` instead; nothing crashes, the window opens, the
 *      port answers, and `documentReady` / `navigationStart` are recorded and look ordinary. Only
 *      `railPaintedMs` and `usableHomeMs` come back null. Two builds compared that way agreed to
 *      within 5 ms — a tidy null result that was really the same connection timeout measured twice.
 *      `scripts/q7-probe.mjs` now refuses to finish such a sample; this stops an older artifact,
 *      written before that refusal existed, from being quoted at a reader.
 */
function neverSettled(runFile: string): boolean {
  const path = join(RAW, runFile);
  if (!existsSync(path)) return false; // a dead path is a different defect; link guards own it
  try {
    const j = JSON.parse(readFileSync(path, "utf8"));
    if (j?.baselineStability?.settled === false) return true;
    if (j?.task === "coldstart" && j?.sampleCount > 0 && j?.summary?.railPaintedMs == null) return true;
    return false;
  } catch {
    return false;
  }
}

/** Every raw run present, so a `*` citation can be expanded to what it really covers. */
function runsOnDisk(): string[] {
  try {
    return readdirSync(RAW).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

/** Exported so the falsification block below drives the real matcher, not a hand-rolled twin. */
export function unsettledCitations(
  files: string[],
  read: (f: string) => string,
  settledCheck: (run: string) => boolean = (r) => !neverSettled(r),
  onDisk: string[] = runsOnDisk(),
): Offender[] {
  const offenders: Offender[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = read(file);
    } catch {
      continue;
    }
    if (!text.includes(`${RAW}/`)) continue;
    text.split(/\r?\n/).forEach((line, i) => {
      if (line.includes(ALLOW)) return;
      for (const m of line.matchAll(CITATION)) {
        for (const braced of expandBraces(m[1])) {
          for (const run of expandGlob(braced, onDisk)) {
            if (run && !settledCheck(run)) {
              offenders.push({ where: `${file}:${i + 1}`, run, line: line.trim().slice(0, 120) });
            }
          }
        }
      }
    });
  }
  return offenders;
}

describe("perf evidence integrity: a run that never settled may not be quoted as proof", () => {
  // #515: `git grep` over the whole tree rides the tree-walk budget, never the 15s default.
  it("no live file cites an attribute run whose baseline never converged", { timeout: TREE_WALK_TIMEOUT_MS }, () => {
    const offenders = unsettledCitations(filesMentioningRaw(), (f) =>
      readFileSync(f, "utf8"),
    );
    expect(
      offenders,
      `A q7 attribute run with "baselineStability.settled": false measured its bands against a\n` +
        `baseline that never held still. The probe says so in the file's own validity note. Quoting\n` +
        `its figures launders noise into a claim, which is how the #127 aurora fix came to be proved\n` +
        `by two unsettled runs and shipped in v0.9.26 (see this file's header).\n` +
        `The same applies to a coldstart run with a null railPaintedMs: the app never rendered, so\n` +
        `the timings are of a window that never became the app — usually a binary built by cargo\n` +
        `instead of by \`npm run tauri build\`, which loads the dev URL and waits.\n` +
        `Fix: re-run the measurement until the baseline settles (or the app actually paints) and cite\n` +
        `THAT run, or — if the point you are making is ABOUT the bad run — put ${ALLOW} on the line.\n\n` +
        offenders.map((o) => `  ${o.where}\n    cites ${o.run}\n    ${o.line}`).join("\n"),
    ).toEqual([]);
  });

  it("every attribute run on disk carries the flag at all, so the check can never silently pass", () => {
    const runs = execFileSync("git", ["ls-files", "--", `${RAW}/idle-attribution*.json`], {
      encoding: "utf8",
    })
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    expect(runs.length, "no attribute runs found — the glob or the directory moved").toBeGreaterThan(0);

    const missing = runs.filter((f) => {
      const j = JSON.parse(readFileSync(f, "utf8"));
      return typeof j?.baselineStability?.settled !== "boolean";
    });
    expect(
      missing,
      `These attribute runs carry no baselineStability.settled flag, so the guard above reads them\n` +
        `as fine no matter what they measured. If the probe's schema changed, update this guard in\n` +
        `the same commit — a stability check that cannot see the field is worse than none.\n` +
        missing.join("\n"),
    ).toEqual([]);
  });
});

// ── Falsification — drive the guard's OWN matcher with input that must trip it ────────────
// Per the repo idiom (src/ambient-animation-cost-guard.test.ts): a mutation test that hand-builds
// the string its matcher expects proves the matcher and nothing else.
describe("perf evidence integrity: the guard itself is armed", () => {
  const FILES = ["fake.md"];
  // Contract of the third parameter: returns TRUE when the run SETTLED (i.e. is safe to cite).
  const settledCheck = (run: string) => run === "settled-run.json";

  it("fires on a citation of an unsettled run", () => {
    const found = unsettledCitations(
      FILES,
      () => "the fix is proved by docs/perf/raw/bad-run.json which is fine",
      settledCheck,
    );
    expect(found).toHaveLength(1);
    expect(found[0].run).toBe("bad-run.json");
  });

  it("hands the live check every file that mentions the raw directory, and only those (#512)", { timeout: TREE_WALK_TIMEOUT_MS }, () => {
    const all = citingFiles();
    const kept = filesMentioningRaw();
    // It must narrow, or it is not the prefilter it claims to be; and it must not come back empty,
    // because this very file names the directory in the block above and has to survive it.
    expect(kept.length).toBeLessThan(all.length);
    expect(kept).toContain("src/perf-evidence-integrity-guard.test.ts");
    // Agreement with the skip it replaces, on a fixed sample of the live tree plus some it kept:
    // a file is kept exactly when its own text contains the directory.
    const keptSet = new Set(kept);
    const sample = all.filter((_, i) => i % 40 === 0).concat(kept.slice(0, 10));
    for (const f of sample) {
      expect(keptSet.has(f), f).toBe(readFileSync(f, "utf8").includes(`${RAW}/`));
    }
  });

  it("stays silent on a citation of a settled run", () => {
    expect(
      unsettledCitations(FILES, () => "see docs/perf/raw/settled-run.json", settledCheck),
    ).toEqual([]);
  });

  it("respects the line-level escape hatch, and only on that line", () => {
    const text =
      `discarded: docs/perf/raw/bad-run.json never settled // ${ALLOW}\n` +
      `but this line borrows its number from docs/perf/raw/bad-run.json anyway`;
    const found = unsettledCitations(FILES, () => text, settledCheck);
    expect(found).toHaveLength(1);
    expect(found[0].where).toBe("fake.md:2");
  });

  it("reads the real flag, not a hard-coded list of filenames", () => {
    // Drives neverSettled() against the two runs the header names, so a schema change or a file
    // rename shows up here rather than as a guard that quietly matches nothing.
    expect(neverSettled("idle-attribution-2026-08-19-B-h1-no-scale.json")).toBe(true);
    expect(neverSettled("idle-attribution-2026-08-19-D-installed-fix.json")).toBe(true);
    expect(neverSettled("idle-attribution-2026-08-21-E-baseline.json")).toBe(false);
    expect(neverSettled("no-such-run-on-disk.json")).toBe(false);
  });

  it("also disqualifies a coldstart whose app never painted, driving the real reader", () => {
    // Written and read here rather than kept on disk: the artifact this describes was a mistake, and
    // parking a permanent example of one inside docs/perf/raw invites exactly the citation the guard
    // above exists to stop.
    const tmp = `${process.env.TEMP ?? "."}/compy-coldstart-null-rail.json`;
    const control = `${process.env.TEMP ?? "."}/compy-coldstart-painted.json`;
    writeFileSync(
      tmp,
      JSON.stringify({ task: "coldstart", sampleCount: 3, summary: { railPaintedMs: null, documentReadyMs: { median: 2727 } } }),
      "utf8",
    );
    writeFileSync(
      control,
      JSON.stringify({ task: "coldstart", sampleCount: 3, summary: { railPaintedMs: { median: 3682 } } }),
      "utf8",
    );
    const read = (f: string) => readFileSync(f, "utf8");
    const disqualified = (f: string) => {
      const j = JSON.parse(read(f));
      return j?.task === "coldstart" && j?.sampleCount > 0 && j?.summary?.railPaintedMs == null;
    };
    // The predicate above is the one inlined in neverSettled; this pins them equal by behaviour.
    expect(disqualified(tmp)).toBe(true);
    expect(disqualified(control)).toBe(false);
  });
});
