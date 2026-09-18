// #457: every file argument to `vitest run` is a case-insensitive substring filter, and a filter that
// matches no test file is DROPPED without a word. vitest complains only when EVERY filter misses (or
// when an unmatched filter is a `file:line`), so one stale path among live ones shrinks the run and
// still exits 0. On 2026-09-17 a #450 verification named
// src/surfaces/ledger-health-blackbook-guard.test.tsx -- the file lives under blackbook/ -- and read
// "Test Files 2 passed (2)" for a three-file command. A run where the check could not fire is not
// evidence (the class in #322), and nothing on the screen said the check had not fired.
//
// This globalSetup refuses that run before a single test starts. vitest itself answers both
// questions: which arguments are file filters (`parseCLI`, the parser the CLI runs on, so option
// values like `-t prunable` are never mistaken for paths) and which test files a filter selects
// (`TestProject.globTestFiles`, the matcher the run itself uses, include/exclude and all). The guard
// cannot disagree with the run it guards. By the time globalSetup runs vitest has already globbed
// and cached the file list, so the check costs no second walk of the tree.
//
// Boundaries, on purpose:
//   - no filters (`npm test`, the pre-push gate) returns as soon as the command line is read;
//   - a run not started from the vitest CLI (an editor extension, a programmatic createVitest) is not
//     read at all: its argv belongs to some other program, and guessing at it would refuse healthy
//     runs. That is vitest's own behaviour, unchanged -- never a pass this guard vouched for;
//   - `vitest related` takes source files, not filters, and parseCLI already keeps them out;
//   - `file:line` is matched on its file part, exactly as vitest's parseFilter does.
import { basename } from "node:path";

/** npx, npm test and scripts/run-vitest.mjs all start node_modules/vitest/vitest.mjs (`.bin/vitest` on POSIX). */
export function isVitestCli(entry) {
  return /^vitest(\.m?js)?$/i.test(basename(String(entry ?? "")));
}

/** vitest's parseFilter: a trailing `:<line>` points inside the file and is not part of its path. */
export function fileOf(filter) {
  return String(filter).replace(/:\d+$/, "");
}

/** The filters, as typed, that select no test file in any project. */
export async function unmatchedFilters(filters, projects) {
  const missing = [];
  for (const filter of filters) {
    let matched = false;
    for (const project of projects) {
      const { testFiles, typecheckTestFiles } = await project.globTestFiles([fileOf(filter)]);
      if (testFiles.length > 0 || typecheckTestFiles.length > 0) {
        matched = true;
        break;
      }
    }
    if (!matched) missing.push(String(filter));
  }
  return missing;
}

export function refusal(missing) {
  const one = missing.length === 1;
  return [
    `vitest-filter-guard (#457): ${one ? "this file filter matches" : `these ${missing.length} file filters match`} no test file:`,
    ...missing.map((f) => `  ${f}`),
    `vitest would drop ${one ? "it" : "them"} silently, run the rest, and report green for tests it never ran.`,
    "A filter is a case-insensitive substring of a test file's path: fix the path, or remove the argument.",
  ].join("\n");
}

export default async function setup(project, { argv = process.argv, parse } = {}) {
  if (!isVitestCli(argv[1])) return;
  const parseCLI = parse ?? (await import("vitest/node")).parseCLI;
  let filter;
  try {
    // parseCLI rewrites the array it is handed; this one is built here and thrown away.
    ({ filter } = parseCLI(["vitest", ...argv.slice(2)]));
  } catch (err) {
    throw new Error(`vitest-filter-guard (#457): vitest's own parser could not read this command line, so no filter was checked: ${err?.message ?? err}`);
  }
  if (!filter?.length) return;
  const projects = project.vitest?.projects?.length ? project.vitest.projects : [project];
  const missing = await unmatchedFilters(filter, projects);
  if (missing.length > 0) throw new Error(refusal(missing));
}
