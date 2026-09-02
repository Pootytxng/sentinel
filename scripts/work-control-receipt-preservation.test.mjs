// Guard: a work-control receipt is the proof a transition was allowed, so it has to survive.
//
// 2026-09-01 (#298). `docs/WORK_CONTROL.md` makes a receipt under `.claude/work-control/` the
// authorization for a proof-dependent GitHub transition, and
// `.claude/hooks/work-control-receipt-guard.mjs` denies the transition outright when no receipt
// exists at the current head. Writing one is therefore mechanical. KEEPING one was not: the receipt
// authorizing PR #290 — merged at `90e253a8`, which was `origin/main` when this guard was written —
// existed only as an untracked file in one working directory. `git clean -fd` in that folder would
// have destroyed the record of why the merge was allowed, and nothing would have gone red.
//
// That is the receipt hook's own failure mode one move later. Its header says the gate "gets skipped
// on the runs that feel obviously fine"; creating the receipt is now enforced, so preserving it is
// the step that gets skipped on those runs instead.
//
// THE SECOND CONDITION IS THE ONE THAT BITES, and it is here because it caught the author inside ten
// minutes of filing the issue. An old worktree sits on a branch cut BEFORE a receipt was committed,
// so git honestly calls that file untracked THERE while it is tracked on `main`. Most such shadows
// are byte-identical and harmless. One was not: `sentinel-q9a` held a 2299-byte pre-completion draft
// of `2026-08-25-close-issue-220.json` whose committed counterpart is 9630 bytes. Treating it as a
// stranded receipt and committing it forward DELETED `gateAnomaly`, `docGates` and `boundaryProof`
// from the record and reset `independentReview.head` to `"PENDING"`. By inspection the two cases are
// indistinguishable — both are "an untracked receipt in a worktree" — and acting on the wrong one
// silently degrades committed proof rather than losing it. That is the quieter failure, so it fails
// here too.
//
// WHY A BYTE-IDENTICAL SHADOW MUST NOT FAIL. Five of the seven untracked receipts on this machine
// were exactly that, on branches that will never move again. A rule that reddens on those is noise on
// every aging worktree, and this repository has now twice recorded the same lesson: a guard an author
// has to argue past is a guard that gets muted rather than fixed (rule E's false positive in #295,
// rule F's unmeasured-carrier pin in #297). Identical shadows are therefore explicitly benign.
//
// FAILURE POSTURE, deliberately opposite to the hook's. `.claude/hooks/*` allow silently on any error
// because a hook must never be the reason work cannot proceed. A TEST is the other half of that
// bargain: an unreadable worktree or an unresolvable `origin/main` FAILS here rather than counting as
// zero findings, for the reason rule C of `scripts/handoff-worktree-truth.test.mjs` states —
// `catch { 0 }` is how a guard grows the blind spot it was built to close.
//
// #309 WIDENED THE QUESTION. The first cut filtered `git status --porcelain` to `?? ` lines, which
// asks whether a file is UNTRACKED. The guard's question is whether the bytes exist anywhere but one
// disk, and a receipt that was committed and then edited in place answers those two differently: git
// reports ` M`, the filter dropped it, and the worktree read clean while committed proof sat
// overwritten. Same silent degradation as the stale draft above, through the door that cut left open.
//
// Local-only by nature: it sweeps `git worktree list`, and a CI checkout has one worktree and no
// stranded receipts to find. It SKIPS there and says so, rather than passing vacuously.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const RECEIPT_DIR = ".claude/work-control";

const git = (args, cwd = ROOT) => execFileSync("git", args, { cwd, encoding: "utf8" });

/**
 * Line endings are a checkout setting, not a change to the record. A worktree configured with a
 * different `core.autocrlf` than the one that wrote the file would otherwise report every shadow as
 * differing, which is the noise case above.
 */
export function sameReceipt(a, b) {
  return a.replace(/\r\n/g, "\n") === b.replace(/\r\n/g, "\n");
}

/**
 * One untracked receipt, already read. `committed` is the file's content on the comparison ref, or
 * `null` when the ref does not carry it at all.
 *
 *   stranded     — no committed counterpart. The proof exists nowhere but this disk.
 *   stale-shadow — a committed counterpart exists and DIFFERS. Preserving this one regresses it.
 *   shadow       — a committed counterpart exists and matches. Benign; an old branch, nothing more.
 *
 * Exported so the classification can be tested without a filesystem, and so the live sweep below and
 * the fixtures below cannot drift apart.
 */
export function classifyReceipt({ local, committed }) {
  if (committed === null || committed === undefined) return "stranded";
  return sameReceipt(local, committed) ? "shadow" : "stale-shadow";
}

/** Every classification that is a defect, with enough detail to act without re-deriving it. */
export function preservationFailures(entries) {
  return entries
    .map((e) => ({ ...e, verdict: classifyReceipt(e) }))
    .filter((e) => e.verdict !== "shadow")
    .map((e) => ({
      worktree: e.worktree,
      file: e.file,
      verdict: e.verdict,
      why:
        e.verdict === "stranded"
          ? "no committed counterpart — this is the only copy of the proof"
          : `differs from the committed copy (${e.local.length}B here, ${e.committed.length}B committed)` +
            " — committing it forward would overwrite the record",
    }));
}

/** `git worktree list --porcelain` -> absolute paths. Throws rather than returning [] on failure. */
export function worktreePaths(porcelain) {
  const paths = porcelain
    .split(/\r?\n/)
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length).trim())
    .filter(Boolean);
  if (!paths.length) throw new Error("git worktree list --porcelain named no worktrees");
  return paths;
}

/**
 * The argv the live sweep asks every worktree, named so a test can hold it to the one flag that
 * matters. `-uall` is not a preference: at git's default `-unormal` a fully-untracked directory
 * collapses to a single `?? .claude/work-control/` entry, which does not end in `.json`, so the
 * filter drops it and that worktree reports zero findings. A guard that silently sweeps nothing
 * is the exact posture this file exists to forbid. Caught by the #299 reviewer, reproduced in a
 * throwaway repo, and not live on this machine — all 33 worktrees measure identically under
 * `-unormal`, `-uall` and `--ignored`, so this closes a latent hole rather than a defect.
 */
export const STATUS_ARGV = ["status", "--porcelain", "-uall", "--", RECEIPT_DIR];

/**
 * Every receipt path in one worktree whose bytes on disk are in no commit — relative to that
 * worktree. Renamed from `untrackedReceipts` in #309, because it no longer returns only untracked
 * ones and a name that says otherwise is how the hole below stayed invisible.
 *
 * #309. The original read `?? ` lines and nothing else, so it asked "is this file untracked" when
 * the guard's question is "do these bytes exist anywhere but this disk". A receipt that was
 * committed and then EDITED IN PLACE answers yes to the second and no to the first: git reports it
 * as ` M`, the filter dropped the line, and the sweep read the worktree as clean while a committed
 * proof record sat overwritten on disk. That is the same silent-degradation failure as the
 * 2026-08-25 stale draft this file was written for, arriving through the one door it left open.
 *
 * So the test is now the status CODE, not the untracked marker:
 *   ??  untracked          — the original case
 *   M   modified, either column (` M`, `M `, `MM`) — #309, the case that was invisible
 *   A   added, never committed (`A `, `AM`) — in the index only, which no push carries
 * Anything carrying `D` is excluded: there are no bytes on disk to preserve, the committed copy is
 * untouched, and `readFileSync` would throw on it. `U` is included — an unmerged `UU` is content
 * sitting in the worktree that no commit holds, which is this guard's target case, and the `D`
 * shapes (`DU`, `UD`) are already gone by the line above.
 *
 * **A rename cannot be judged by its code.** The first cut excluded `R `/`C ` on the reasoning that
 * the content is unchanged and already committed under the old path, so judging the destination
 * would report a false stranding. The reasoning is right and the discriminator is wrong: git runs
 * rename detection at a SIMILARITY THRESHOLD, so a receipt that was renamed AND edited reports the
 * identical `R ` — a clean second column means "worktree matches index", never "index matches
 * HEAD". Measured in a scratch repo: a realistic receipt renamed with one field flipped reports
 * `R `, its destination blob matches nothing committed, and `git log --all` finds zero commits for
 * that path. Those bytes are on one disk only. That is the exact class this guard exists to catch,
 * escaping through its own exclusion. (A tiny file falls BELOW the threshold and reports `A `+`D `
 * instead, which is why a small fixture makes the bug invisible.)
 *
 * So the rename is settled by measurement, exactly like #310: the caller injects
 * `isPureRename(src, dest)`, and only a proof that the destination's bytes equal the source's
 * COMMITTED blob excludes it. The default is `() => false` — include — because the two failure
 * directions are not symmetric: a wrongly-included pure rename is a visible false report that the
 * next run corrects, while a wrongly-excluded edited rename is the silent loss this whole file was
 * written to prevent. A guard must never exclude on a measurement it did not make.
 *
 * KNOWN LIMIT, stated rather than left implicit: `MD`/`AD` — staged content whose worktree copy is
 * then deleted — is excluded with the other `D` shapes. That is right for the question asked here
 * (there are no bytes on disk to preserve, and `readFileSync` would throw), but the index does
 * hold content that is in no commit and no worktree. Recovering it is `git checkout-index`, not
 * this sweep.
 */
export function uncommittedReceipts(porcelainStatus, isPureRename = () => false) {
  return porcelainStatus
    .split(/\r?\n/)
    .map((line) => {
      if (line.length < 4) return null;
      const code = line.slice(0, 2);
      const rest = line.slice(3).trim();
      if (code === "??") return unquoteGitPath(rest);
      if (code.includes("D")) return null;
      const [src, dest] = splitRenamePorcelain(rest);
      // M, A or U: the destination's bytes differ from every committed copy by the code alone.
      if (/[MAU]/.test(code)) return dest;
      if (!/[RC]/.test(code)) return null;
      return isPureRename(src, dest) ? null : dest;
    })
    .filter(Boolean)
    .filter((p) => p.endsWith(".json"));
}

/**
 * Git quotes a path containing spaces or non-ASCII. Unquoting keeps such a receipt visible; a
 * backslash-escaped one survives as a path that fails to read, which fails LOUDLY in the sweep.
 * Both beat the silent drop a `.json` filter would otherwise perform on the closing quote.
 */
export function unquoteGitPath(p) {
  return p.length > 1 && p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p;
}

/**
 * A porcelain path field -> [source, destination]. For a non-rename both are the same path.
 *
 * Unquoting happens PER SIDE and AFTER the split, which is not cosmetic: git quotes each side
 * independently, so `"…/old one.json" -> "…/new one.json"` unquoted as a whole by a greedy
 * `^"(.*)"$` strips only the outermost pair and leaves a stray quote welded to the
 * destination.
 * That failed loudly at `readFileSync` rather than losing anything, but it reported the wrong
 * cause — the header blamed backslash escapes — and a guard that misnames its own failure sends the
 * next session hunting the wrong bug. Caught by peer review, not by a run.
 */
export function splitRenamePorcelain(rest) {
  const at = rest.lastIndexOf(" -> ");
  if (at < 0) {
    const only = unquoteGitPath(rest);
    return [only, only];
  }
  return [unquoteGitPath(rest.slice(0, at).trim()), unquoteGitPath(rest.slice(at + 4).trim())];
}

describe("a work-control receipt survives the worktree it was written in", () => {
  it("classifies the three cases, and only two of them are defects", () => {
    const entries = [
      { worktree: "/w/a", file: "r1.json", local: '{"a":1}', committed: null },
      { worktree: "/w/b", file: "r2.json", local: '{"a":1}', committed: '{"a":1}' },
      { worktree: "/w/c", file: "r3.json", local: '{"a":1}', committed: '{"a":1,"b":2}' },
    ];
    expect(entries.map((e) => classifyReceipt(e))).toEqual(["stranded", "shadow", "stale-shadow"]);
    expect(preservationFailures(entries).map((f) => f.file)).toEqual(["r1.json", "r3.json"]);
  });

  it("a shadow that differs only by line ending is NOT a finding", () => {
    // The noise case that would otherwise redden every worktree with a different autocrlf.
    expect(classifyReceipt({ local: '{\r\n"a":1\r\n}', committed: '{\n"a":1\n}' })).toBe("shadow");
  });

  it("the real 2026-08-25 draft is caught as stale, not mistaken for stranded", () => {
    // The exact shapes that fooled the author: a pre-completion draft against its finished record.
    const draft = JSON.stringify({ currentHead: "PENDING", gateResults: [], docGates: [] });
    const final = JSON.stringify({
      currentHead: "a25ff8427298cfe09d9ce8f611d7d8586ac81d08",
      gateResults: [{}, {}],
      docGates: ["a", "b", "c", "d", "e"],
    });
    expect(classifyReceipt({ local: draft, committed: final })).toBe("stale-shadow");
    expect(
      preservationFailures([{ worktree: "/w", file: "d.json", local: draft, committed: final }])[0].why,
    ).toMatch(/would overwrite the record/);
  });

  it("an empty worktree list is an error, never zero findings", () => {
    expect(() => worktreePaths("")).toThrow(/named no worktrees/);
  });

  it("reads only .json out of a porcelain status", () => {
    expect(
      uncommittedReceipts("?? .claude/work-control/a.json\n?? .claude/work-control/notes.md\n M x"),
    ).toEqual([".claude/work-control/a.json"]);
    // #299 review finding: at git's default `-unormal` a fully-untracked receipt directory arrives as
    // ONE entry naming the directory, which is not a `.json` path — so the sweep would report nothing
    // for that worktree and read as clean. The parser is right to drop it; the fix is the flag, and
    // this is the assertion that keeps the flag from being tidied away later.
    expect(uncommittedReceipts("?? .claude/work-control/")).toEqual([]);
    expect(STATUS_ARGV).toContain("-uall");
  });

  it("a committed receipt EDITED IN PLACE is read, not skipped for being tracked", () => {
    // #309. Every line below was invisible to this guard until the filter stopped asking "is it
    // untracked" and started asking "are these bytes in a commit". The middle three are the hole:
    // a receipt that was committed and then overwritten on disk reported nothing at all.
    const R = ".claude/work-control/2026-09-01-merge-pr-300.json";
    expect(uncommittedReceipts(` M ${R}`)).toEqual([R]);
    expect(uncommittedReceipts(`M  ${R}`)).toEqual([R]);
    expect(uncommittedReceipts(`MM ${R}`)).toEqual([R]);
    expect(uncommittedReceipts(`A  ${R}`)).toEqual([R]);
    expect(uncommittedReceipts(`AM ${R}`)).toEqual([R]);
    // Deleted: nothing on disk to preserve, and the committed copy is untouched. Returning it would
    // crash the sweep on `readFileSync` rather than report anything true.
    expect(uncommittedReceipts(` D ${R}`)).toEqual([]);
    expect(uncommittedReceipts(`D  ${R}`)).toEqual([]);
    // A rename is decided by the injected measurement, never by the code. Same line, both verdicts.
    const renamed = `R  .claude/work-control/old.json -> ${R}`;
    expect(uncommittedReceipts(renamed, () => true)).toEqual([]);
    expect(uncommittedReceipts(renamed, () => false)).toEqual([R]);
    // The predicate is handed both sides, in order, unquoted.
    let seen = null;
    uncommittedReceipts(renamed, (src, dest) => ((seen = [src, dest]), true));
    expect(seen).toEqual([".claude/work-control/old.json", R]);
    // Default is INCLUDE. A caller that cannot measure must not silently inherit an exclusion —
    // this is the direction the first cut got wrong, and it is the whole defect.
    expect(uncommittedReceipts(renamed)).toEqual([R]);
    expect(uncommittedReceipts(`RM .claude/work-control/old.json -> ${R}`, () => true)).toEqual([R]);
    // An unmerged conflict is content in the worktree that no commit holds — the target case.
    expect(uncommittedReceipts(`UU ${R}`)).toEqual([R]);
    expect(uncommittedReceipts(`AA ${R}`)).toEqual([R]);
    // ...but the D shapes of a conflict still lose to the D rule above.
    expect(uncommittedReceipts(`DU ${R}`)).toEqual([]);
    expect(uncommittedReceipts(`UD ${R}`)).toEqual([]);
    // Quoted renames unquote per SIDE. Unquoting the whole field welds a quote to the destination.
    expect(splitRenamePorcelain('".claude/work-control/old one.json" -> ".claude/work-control/new one.json"')).toEqual([
      ".claude/work-control/old one.json",
      ".claude/work-control/new one.json",
    ]);
    expect(uncommittedReceipts('RM ".claude/work-control/a b.json" -> ".claude/work-control/c d.json"')).toEqual([
      ".claude/work-control/c d.json",
    ]);
    expect(unquoteGitPath('"')).toBe('"');
    // A clean tracked receipt is the common case and must stay silent.
    expect(uncommittedReceipts("")).toEqual([]);
    // Quoted paths survive rather than being dropped by the `.json` filter at the closing quote.
    expect(uncommittedReceipts(` M "${R}"`)).toEqual([R]);
  });

  it("every receipt whose bytes are in no commit is a benign shadow of one", () => {
    let porcelain;
    try {
      porcelain = git(["worktree", "list", "--porcelain"]);
    } catch (error) {
      throw new Error(`git worktree list failed, so no receipt could be judged: ${error.message}`);
    }
    const worktrees = worktreePaths(porcelain);
    if (worktrees.length === 1) {
      // A single checkout is CI. Nothing to sweep; say so rather than pass silently.
      console.log("only one worktree — receipt preservation is a local-fleet rule, skipping");
      return;
    }

    // The question is "does this proof exist anywhere but one disk", NOT "is it on main yet". A
    // receipt committed on the lane that is about to open the PR is already preserved — git has the
    // object and the push carries it — so comparing against `origin/main` alone would redden this
    // guard for the whole life of every lane that fixes it, including the one that added it. That is
    // the muted-guard failure this file's header warns about, and it would land on the author first.
    // So each receipt is judged against the newest commit that touches it ON ANY REF.
    let anyRefResolves;
    try {
      anyRefResolves = git(["rev-parse", "--verify", "HEAD"]).trim();
    } catch (error) {
      throw new Error(`HEAD could not be resolved, so no receipt could be judged: ${error.message}`);
    }
    if (!anyRefResolves) throw new Error("HEAD resolved empty; refusing to judge receipts");

    const entries = [];
    for (const worktree of worktrees) {
      if (!existsSync(worktree)) {
        throw new Error(`git names worktree ${worktree}, but it is not on disk — sweep incomplete`);
      }
      let status;
      try {
        status = git(STATUS_ARGV, worktree);
      } catch (error) {
        throw new Error(`could not read ${worktree}: ${error.message}`);
      }
      // The rename discriminator, bound to THIS worktree. `hash-object` applies the same clean
      // filters git applied before committing, so a pure rename's two hashes are byte-identical
      // even on a CRLF checkout — verified in the scratch repo, not assumed. The leading `./` is
      // the same measurement error the carrier loop below documents. Any failure returns false,
      // which INCLUDES the receipt: an unmeasurable rename is reported, never quietly dropped.
      const isPureRename = (src, dest) => {
        try {
          const onDisk = git(["hash-object", "--", dest], worktree).trim();
          const committed = git(["rev-parse", `HEAD:./${src}`], worktree).trim();
          return onDisk !== "" && onDisk === committed;
        } catch {
          return false;
        }
      };
      for (const file of uncommittedReceipts(status, isPureRename)) {
        // Every commit on ANY ref that touches this path, newest first. Empty means the proof has
        // never been committed anywhere — the stranded case.
        let carriers;
        try {
          carriers = git(["rev-list", "--all", "--", file]).trim().split(/\r?\n/).filter(Boolean);
        } catch (error) {
          throw new Error(`could not search the refs for ${file}: ${error.message}`);
        }

        let committed = null;
        for (const carrier of carriers) {
          // The leading `./` is not cosmetic. Git Bash on this machine rewrites a bare
          // `<rev>:<path>` argument into `<rev>;<path>` with backslashes and git rejects it — the
          // measurement error that made six committed receipts read as missing when #298 was filed.
          try {
            committed = git(["show", `${carrier}:./${file}`]);
            break;
          } catch {
            // The newest commit touching a path can be the one that DELETED it. Walk back to the
            // newest commit that actually carries content rather than reading a deletion as absence.
          }
        }
        if (carriers.length && committed === null) {
          // A path with carriers but no readable content anywhere is a broken measurement, and a
          // broken measurement is never reported as a clean bill of health.
          throw new Error(`${file} is touched by ${carriers.length} commit(s) but readable in none`);
        }
        entries.push({ worktree, file, local: readFileSync(join(worktree, file), "utf8"), committed });
      }
    }

    const failures = preservationFailures(entries);
    expect(
      failures,
      failures.length
        ? "These work-control receipts are not safely preserved:\n" +
            failures
              .map((f) => `  - [${f.verdict}] ${f.file}\n      in ${f.worktree}\n      ${f.why}`)
              .join("\n") +
            "\nA stranded receipt must be committed. A stale shadow must be replaced with the" +
            " committed copy, never committed over it — including when the stale copy is a TRACKED" +
            " receipt edited in place, which is the case #309 added and the one that reads most" +
            " like an ordinary uncommitted change."
        : "",
    ).toEqual([]);
  });
});
