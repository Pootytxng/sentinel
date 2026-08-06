// @vitest-environment node
// Q7 wrote one acceptance rule above all others: performance budgets must be DERIVED FROM RECORDED
// BASELINES, NOT INVENTED. Prose cannot enforce that -- the spec it was written in carried, for a
// week, a 26.50 MB memory figure that counted one process out of eight and a claim that measuring
// this app "needs a purpose-built instrumented build". Both read as measurement. Neither was.
//
// So the budget table is mechanical. `docs/perf/q7-baseline.json` holds one entry per metric, and
// every entry names the RAW TRACE and the exact path inside it that produced its number. This guard
// re-opens each raw trace and re-derives the value: a baseline number that no longer matches the
// recording it cites -- because someone hand-edited the summary, or re-recorded and forgot to update
// it -- fails the build. It also fails a budget that nothing recorded has to meet, and a spec budget
// with no recording behind it at all.
//
// What it deliberately does NOT do: re-run the probe. These traces come off a live installed build
// on the owner's machine (scripts/q7-probe.mjs); CI has no such machine. The guard's job is that the
// PUBLISHED numbers stay honest about the traces on disk, which is checkable anywhere.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(root, "docs/perf/q7-baseline.json");
const RAW_DIR = join(root, "docs/perf/raw");
const SPEC = join(root, "docs/superpowers/specs/2026-07-31-q7-native-baseline.md");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** Walk "a.b.2.c" through a parsed trace. Returns undefined for any missing hop, so a stale source
 *  path fails as a missing value rather than throwing something unreadable. */
function resolvePath(obj, path) {
  return path.split(".").reduce((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    return acc[key];
  }, obj);
}

const baseline = existsSync(BASELINE) ? readJson(BASELINE) : null;
const metricEntries = Object.entries(baseline?.metrics ?? {});

/** The three things a number in a budget column can mean. Documented in the baseline's own
 *  `$comment`; enforced here, because the distinction is worthless if it is only prose.
 *
 *    upper bound  — worst recorded + headroom. The app has EARNED this; it is a real gate.
 *    exact        — budget equals the recording. Any drift at all fails (invariants: process count,
 *                   a demand-loop that must draw zero frames).
 *    open finding — a ceiling on a KNOWN DEFECT, written so it cannot grow while the fix is queued.
 *                   NOT an accepted cost. Must name the guard or file carrying the finding, and must
 *                   be re-derived and cut when it closes.
 *
 *  Why mechanical: `budget >= value` is the only arithmetic a defect ceiling and an earned bound
 *  have in common, so without this field they read identically — and a defect that reads as a spec
 *  is a defect nobody ever fixes. */
const BUDGET_KINDS = new Set(["upper bound", "exact", "open finding"]);
const SRC_PATH = /\b(?:src|scripts|src-tauri)\/[\w./-]+\.(?:tsx?|mjs|rs)\b/g;

describe("Q7 performance baseline: every published number traces to a recording", () => {
  it("the baseline file exists and names the build it was recorded against", () => {
    expect(baseline, `${BASELINE} is missing`).toBeTruthy();
    // The stamp is the only thing tying these numbers to a specific binary. Without it a baseline is
    // a number with no subject -- see verify-live-build-via-embedded-hash: mtime lies, the stamp does not.
    expect(baseline.recordedAgainst?.buildStamp ?? "").toMatch(/^[0-9a-f]{7,40} · (release|debug)$/);
    expect(baseline.recordedAgainst?.machine ?? "").toBeTruthy();
    expect(metricEntries.length).toBeGreaterThanOrEqual(8);
  });

  it.each(metricEntries)("%s carries a complete, self-describing record", (key, m) => {
    for (const field of ["value", "unit", "statistic", "source", "budget", "budgetBasis", "budgetKind"]) {
      expect(m[field], `${key} is missing "${field}"`).not.toBe(undefined);
    }
    expect(typeof m.value, `${key}.value must be a number`).toBe("number");
    expect(typeof m.budget, `${key}.budget must be a number`).toBe("number");
    // "how this budget was chosen" in the artifact itself, not in a commit message nobody re-reads.
    expect(String(m.budgetBasis).length, `${key}.budgetBasis must say how the budget was chosen`)
      .toBeGreaterThan(20);
    expect(String(m.statistic).length, `${key}.statistic must name what the value is (worst/median/...)`)
      .toBeGreaterThan(3);
  });

  it.each(metricEntries)("%s names the build it was recorded against, header or its own", (key, m) => {
    // A baseline is re-cut a few rows at a time -- three idle rows moved to ff0ce65f while eleven
    // others still describe dc4d55e. One header stamp covering both would make the file quietly
    // claim a build for numbers that were never taken on it, which is worse than no stamp: it is a
    // wrong one, and every reader downstream would trust it. A row that moved says so on the row.
    if (m.recordedAgainst === undefined) return;
    expect(m.recordedAgainst.buildStamp ?? "", `${key}.recordedAgainst.buildStamp must be a build stamp`)
      .toMatch(/^[0-9a-f]{7,40} · (release|debug)$/);
    expect(
      m.recordedAgainst.buildStamp,
      `${key} overrides the header stamp with the same value -- an override that overrides nothing ` +
        `reads as provenance while carrying none. Delete it, or re-record and change it.`,
    ).not.toBe(baseline.recordedAgainst?.buildStamp);
    expect(String(m.recordedAgainst.why ?? "").length, `${key}.recordedAgainst must say WHY it differs`)
      .toBeGreaterThan(20);
  });

  it.each(metricEntries)("%s re-derives from the raw trace it cites", (key, m) => {
    const [file, path] = String(m.source).split("#");
    const traceFile = join(RAW_DIR, file);
    expect(existsSync(traceFile), `${key} cites ${file}, which is not in docs/perf/raw/`).toBe(true);
    expect(path, `${key}.source must name a path inside the trace ("file.json#a.b.c")`).toBeTruthy();

    const recorded = resolvePath(readJson(traceFile), path);
    expect(recorded, `${key}: ${m.source} resolves to nothing in the trace`).not.toBe(undefined);
    // Exact equality, not a tolerance: the baseline is a transcription of the trace, and a
    // transcription that drifted is the failure mode this guard exists for.
    expect(recorded, `${key}: baseline says ${m.value}, the trace says ${recorded}`).toBe(m.value);
  });

  it.each(metricEntries)("%s has a budget the recording itself meets", (key, m) => {
    // Every Q7 metric is a ceiling of some kind (time, memory, calls per second, CPU share). A budget
    // below the number actually recorded is a budget that has never once passed on the machine it was
    // measured on -- an aspiration filed as a gate.
    expect(m.budget, `${key}: budget ${m.budget} is below the recorded ${m.value}`)
      .toBeGreaterThanOrEqual(m.value);
  });

  it.each(metricEntries)("%s says which KIND of budget it is, and means it", (key, m) => {
    expect(
      BUDGET_KINDS.has(m.budgetKind),
      `${key}.budgetKind is "${m.budgetKind}" -- must be one of: ${[...BUDGET_KINDS].join(" | ")}.\n` +
        `See the $comment in docs/perf/q7-baseline.json for what each one commits you to.`,
    ).toBe(true);

    if (m.budgetKind === "exact") {
      // "Exact" is a claim that the recording IS the contract -- an invariant, not a range. Padding
      // one silently converts an invariant into a range and nobody notices until it has drifted.
      expect(m.budget, `${key} is declared exact, so budget must EQUAL the recorded ${m.value}`)
        .toBe(m.value);
    }

    if (m.budgetKind === "open finding") {
      // An open finding is a ceiling on a DEFECT. Two things keep it from decaying into an accepted
      // cost: it must say so in words, and it must name the guard or source file that carries it --
      // so the next reader can find the thing to fix, and so a fix has a written place to land.
      expect(
        /not an accepted cost/i.test(String(m.budgetBasis)),
        `${key} is an open finding, so budgetBasis must say plainly that it is NOT AN ACCEPTED COST.\n` +
          `A ceiling on a defect that reads like an earned bound is a defect nobody fixes.`,
      ).toBe(true);

      const cited = [...new Set(String(m.budgetBasis).match(SRC_PATH) ?? [])];
      expect(
        cited.length,
        `${key} is an open finding but budgetBasis names no file. Cite the offending source AND the\n` +
          `guard pinning it (e.g. src/design/jarvis/LenisSpine.tsx, src/shell-idle-guard.test.ts).`,
      ).toBeGreaterThanOrEqual(2);

      // A finding pointing at a file that no longer exists is worse than no finding: it reads as a
      // live defect and cannot be acted on. If the file moved, the finding needs re-deriving anyway.
      const missing = cited.filter((p) => !existsSync(join(root, p)));
      expect(missing, `${key} cites files that no longer exist -- re-derive the finding`).toEqual([]);
    }
  });
});

describe("Q7 spec and baseline cannot drift apart", () => {
  const specText = existsSync(SPEC) ? readFileSync(SPEC, "utf8") : "";

  it("the spec cites every recorded metric", () => {
    expect(specText, `${SPEC} is missing`).toBeTruthy();
    const uncited = metricEntries.map(([k]) => k).filter((k) => !specText.includes(k));
    expect(uncited, "recorded metrics the spec never mentions").toEqual([]);
  });

  it("the spec invents no budget the baseline has not recorded", () => {
    // The spec's budget table is written as `| `metricKey` | ... |`. Any key in that column with no
    // entry in the baseline is exactly the thing Q7 forbids: a budget with nothing behind it.
    const cited = [...specText.matchAll(/^\|\s*`([A-Za-z][A-Za-z0-9_]*)`\s*\|/gm)].map((x) => x[1]);
    const known = new Set(metricEntries.map(([k]) => k));
    const invented = [...new Set(cited)].filter((k) => !known.has(k));
    expect(invented, "budget rows in the spec with no recorded metric behind them").toEqual([]);
    expect(cited.length, "the spec's budget table has no rows").toBeGreaterThanOrEqual(8);
  });
});
