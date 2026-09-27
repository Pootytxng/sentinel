// Guard: a receipt's reviewer field must not claim independence the reviewer did not have (#307).
//
// 2026-09-01. `independentReview.reviewer` in the #277 receipt first said its reviewer was "holding
// its own worktree" and had "no stake in it landing". Both were false: the reviewer measured from
// checkouts it did not own, and every lane on this machine has a stake in `main` moving because each
// must merge it forward. The reviewer objected and #277's copy was corrected. The #290 receipt carried
// the identical wording and was not. The defect was a class, repaired one instance deep.
//
// `work-control-receipt-preservation.test.mjs` cannot see this: the receipt exists and is committed,
// and the overstatement is prose inside a string. This guard reads every receipt's reviewer field.
//
// A CORRECTION IS A RECEIPT OF ITS OWN, NOT A QUOTE. The first cut of this guard (PR #580 at
// 829a9f2a) rewrote the #290 receipt with the wrong wording kept in quotes, and removed every quoted
// span before matching. Codex's review of that head showed both halves were wrong:
// - A receipt is never edited (`work-control-receipt-append-only.test.mjs` now enforces that).
// - Quotation does not imply correction. `The reviewer stated "it had no stake in it landing"` is
//   still the claim, and stripping the quotes hid it.
// So nothing is stripped. A receipt whose reviewer field states an overstatement passes only when a
// correction receipt names it. That correction is `transition: "correct-receipt"` with:
// - `corrects.receipt`, the receipt's full `.claude/work-control/<name>.json` path;
// - `corrects.addedIn`, the full sha of the commit in this history that added that receipt;
// - `corrects.field`, `independentReview.reviewer`;
// - `corrects.original`, the field's EXACT text;
// - `corrects.standing`, the sentence that stands instead, which may state neither overstatement;
// - `corrects.correction`, the full note: `<standing> CORRECTED <why> ORIGINAL: "<original>"`. It
//   opens with what stands, says why, and ends with the original, labelled and quoted, as history.
// The receipt keeps what was claimed and the correction says what stands. Neither is rewritten.
//
// EVERY FIELD IS CHECKED. At 198cc2b6 only the target, the field and the original were: an empty
// `standing`, a bare file name for `receipt`, and a missing `addedIn` or `correction` all silenced a
// real overstatement. Codex's review of that head found it. A correction that is malformed in any
// field is now a finding itself and answers nothing, and so is a second correction of one receipt.
// At 9ec38223 the note only had to open with `standing` and contain `original`, so `standing`
// followed by the bare original passed, the false claim unlabelled; Codex's review of that head found
// it. The whole envelope is now checked. At 4ad7f244 the reason only had to be non-blank, so the
// original itself could stand as the reason, unlabelled and unquoted; Codex's review of that head
// found it. The reason may not restate the original, whatever its case or spacing.
//
// ONE RECEIPT PREDATES BOTH RULES. #277's was corrected in place on 2026-09-01, and its correction
// prose names both phrases. It is pinned by the sha-256 of that field, so any further edit fails here
// as well as in the append-only guard.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const RECEIPTS = join(ROOT, ".claude", "work-control");

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });

// True only when `sha` is an ancestor of HEAD and its own diff adds `path`. Missing history
// (a shallow clone, an unknown sha) throws inside, which reads as false: the correction then fails.
export function addedInThisHistory(sha, path) {
  try {
    git(["merge-base", "--is-ancestor", sha, "HEAD"]);
    return git(["diff-tree", "--no-commit-id", "-r", "--root", "--no-renames", "--name-status", sha, "--", path])
      .split(/\r?\n/)
      .includes(`A\t${path}`);
  } catch {
    return false;
  }
}

const OVERSTATEMENTS = [/\bits own worktree\b/i, /\bno stake in it landing\b/i];
const FIELD = "independentReview.reviewer";
const CORRECTED_IN_PLACE = {
  "2026-09-01-merge-pr-277.json": "5a056fe6b146b96cdf196a0f2a6e1499cdebc2476859898ed2f6aff6aa456560",
};

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

export function overstatementsIn(text) {
  return OVERSTATEMENTS.filter((pattern) => pattern.test(String(text))).map((pattern) => pattern.source);
}

const RECEIPT_PATH = /^\.claude\/work-control\/([^/]+\.json)$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const filled = (value) => typeof value === "string" && value.trim() !== "";

// Case and runs of whitespace aside, so a restated original is still found.
const loose = (text) => String(text).toLowerCase().replace(/\s+/g, " ").trim();

// True when `correction` is exactly `<standing> CORRECTED <why> ORIGINAL: "<original>"`, with <why>
// not blank and not restating the original: the original appears only in its labelled quotation.
export function correctionEnvelopeHolds(correction, standing, original) {
  const head = `${standing} CORRECTED `;
  const tail = ` ORIGINAL: "${original}"`;
  if (!filled(correction) || !correction.startsWith(head) || !correction.endsWith(tail)) return false;
  if (correction.length <= head.length + tail.length) return false;
  const why = correction.slice(head.length, -tail.length);
  return filled(why) && !loose(why).includes(loose(original));
}

// Why a correction receipt answers nothing, or null when every field is well-formed.
// `commitAdded(sha, path)` says whether that commit, in this history, added that path.
export function correctionDefect(name, corrects, receipts, commitAdded) {
  const { receipt: path, addedIn, field, original, standing, correction } = corrects ?? {};
  const target = RECEIPT_PATH.exec(String(path ?? ""))?.[1];
  if (!target || target === name || !receipts.has(target)) return `corrects ${path}, which is not another receipt's .claude/work-control/ path`;
  if (!FULL_SHA.test(String(addedIn ?? ""))) return `addedIn ${addedIn} is not a full commit sha`;
  if (!commitAdded(addedIn, path)) return `addedIn ${addedIn} is not the commit in this history that added ${path}`;
  if (field !== FIELD) return `corrects ${field}; only ${FIELD} is read`;
  if (!filled(original) || original !== receipts.get(target)?.independentReview?.reviewer) return `its original is not ${target}'s exact ${FIELD}`;
  if (!filled(standing) || overstatementsIn(standing).length) return "its standing sentence is empty or states an overstatement";
  if (!correctionEnvelopeHolds(correction, standing, original)) return 'its correction is not `<standing> CORRECTED <why> ORIGINAL: "<original>"`';
  return null;
}

// Every finding across a set of parsed receipts, keyed by file name.
export function reviewerFindings(receipts, commitAdded) {
  if (typeof commitAdded !== "function") throw new TypeError("reviewerFindings needs a commitAdded(sha, path) check");
  const findings = [];
  const corrected = new Map();
  for (const [name, receipt] of receipts) {
    if (receipt?.transition !== "correct-receipt") continue;
    const defect = correctionDefect(name, receipt.corrects, receipts, commitAdded);
    const target = RECEIPT_PATH.exec(String(receipt.corrects?.receipt))?.[1];
    if (defect) findings.push(`${name}: ${defect}`);
    else if (corrected.has(target)) findings.push(`${name}: a second correction of ${target}`);
    else corrected.set(target, receipt.corrects.original);
  }
  for (const [name, receipt] of receipts) {
    const reviewer = receipt?.independentReview?.reviewer;
    if (typeof reviewer !== "string") continue;
    const hits = overstatementsIn(reviewer);
    if (!hits.length) continue;
    if (corrected.get(name) === reviewer) continue;
    if (CORRECTED_IN_PLACE[name] === sha256(reviewer)) continue;
    findings.push(`${name}: ${hits.join(", ")}`);
  }
  return findings;
}

const ORIGINAL_290 =
  "claude-code, session sentinel-21 [933d27] - a separate live Claude Code session on this machine, separate context, holding its own worktree and its own board items (#277/#276, #279/#278, #288, #289), with no write access to this lane and no stake in it landing";
const STANDING = "claude-code, session sentinel-21 [933d27] - a separate live session, verdict bound to an exact head.";

describe("a receipt's reviewer field claims no independence it did not have (#307)", () => {
  it("fires on the original #290 wording, quoted or not", () => {
    expect(overstatementsIn(ORIGINAL_290)).toHaveLength(2);
    expect(overstatementsIn('The reviewer stated "it had no stake in it landing"')).toHaveLength(1);
    expect(overstatementsIn("The reviewer stated 'it had no stake in it landing'")).toHaveLength(1);
    expect(overstatementsIn('an unmatched "holding its own worktree')).toHaveLength(1);
    expect(overstatementsIn("the reviewer's session, holding its own worktree, and #277's copy")).toHaveLength(1);
  });

  it("a receipt passes only when a complete, well-formed correction names it", () => {
    const receipt = { independentReview: { reviewer: ORIGINAL_290 } };
    const correction = (corrects) => ({ transition: "correct-receipt", corrects });
    const ADDED = "a".repeat(40);
    // Like git, the stub resolves an abbreviated sha, so only the full-sha check stops a short one. It
    // ignores the path, so only the path check stops a bad one; the git reader is tested on paths below.
    const addedBy = (sha) => String(sha).length >= 7 && ADDED.startsWith(sha);
    const valid = {
      receipt: ".claude/work-control/r.json",
      addedIn: ADDED,
      field: FIELD,
      original: ORIGINAL_290,
      standing: STANDING,
      correction: `${STANDING} CORRECTED because both claims were false. ORIGINAL: "${ORIGINAL_290}"`,
    };
    const run = (...corrections) =>
      reviewerFindings(new Map([["r.json", receipt], ...corrections.map((corrects, i) => [`c${i}.json`, correction(corrects)])]), addedBy);
    expect(reviewerFindings(new Map([["r.json", receipt]]), addedBy)).toEqual([expect.stringMatching(/^r\.json: /)]);
    expect(run(valid)).toEqual([]);
    const { addedIn, correction: note, ...withoutBoth } = valid;
    const malformed = {
      "an original one byte off": { ...valid, original: `${ORIGINAL_290}.` },
      "an empty original": { ...valid, original: "" },
      "a standing sentence with an overstatement": { ...valid, standing: `${STANDING} It had no stake in it landing.` },
      "an empty standing sentence": { ...valid, standing: "", correction: `CORRECTED. ORIGINAL: "${ORIGINAL_290}"` },
      "a blank standing sentence": { ...valid, standing: "  " },
      "another field": { ...valid, field: "independentReview.head" },
      "a receipt that is not here": { ...valid, receipt: ".claude/work-control/gone.json" },
      "a bare file name": { ...valid, receipt: "r.json" },
      "a path outside the receipts": { ...valid, receipt: "scripts/r.json" },
      "itself": { ...valid, receipt: ".claude/work-control/c0.json" },
      "no addedIn": { ...withoutBoth, correction: note },
      "a short addedIn": { ...valid, addedIn: ADDED.slice(0, 12) },
      "an addedIn that did not add the receipt": { ...valid, addedIn: "b".repeat(40) },
      "no correction": { ...withoutBoth, addedIn },
      "a correction that is only the standing sentence": { ...valid, correction: STANDING },
      "a correction that does not open with the standing sentence": { ...valid, correction: `ORIGINAL: "${ORIGINAL_290}" ${STANDING}` },
      "the standing sentence, then the bare original": { ...valid, correction: `${STANDING} ${ORIGINAL_290}` },
      "no CORRECTED label": { ...valid, correction: `${STANDING} because both claims were false. ORIGINAL: "${ORIGINAL_290}"` },
      "no reason given": { ...valid, correction: `${STANDING} CORRECTED  ORIGINAL: "${ORIGINAL_290}"` },
      "an unlabelled original": { ...valid, correction: `${STANDING} CORRECTED because both claims were false. "${ORIGINAL_290}"` },
      "an unquoted original": { ...valid, correction: `${STANDING} CORRECTED because both claims were false. ORIGINAL: ${ORIGINAL_290}` },
      "text after the original": { ...valid, correction: `${valid.correction} It had no stake in it landing.` },
      "the original again as the reason": { ...valid, correction: `${STANDING} CORRECTED ${ORIGINAL_290} ORIGINAL: "${ORIGINAL_290}"` },
      "the original restated in other case and spacing": {
        ...valid,
        correction: `${STANDING} CORRECTED as said: ${ORIGINAL_290.toUpperCase().replace(/ /g, "  ")}. ORIGINAL: "${ORIGINAL_290}"`,
      },
    };
    for (const [label, corrects] of Object.entries(malformed)) {
      expect(run(corrects), label).toEqual([expect.stringMatching(/^c0\.json: /), expect.stringMatching(/^r\.json: /)]);
    }
    expect(run(valid, valid)).toEqual([expect.stringMatching(/^c1\.json: a second correction of r\.json$/)]);
    expect(() => reviewerFindings(new Map([["r.json", receipt]]))).toThrow(TypeError);
    const quoted = { independentReview: { reviewer: `CORRECTED: 'its own worktree' was false. ORIGINAL: "${ORIGINAL_290}"` } };
    expect(reviewerFindings(new Map([["q.json", quoted]]), addedBy)).toHaveLength(1);
  });

  it("the in-place #277 correction passes only while its text is exactly the pinned one", () => {
    const text = "holding its own worktree";
    const pinned = { "2026-09-01-merge-pr-277.json": { independentReview: { reviewer: text } } };
    expect(reviewerFindings(new Map(Object.entries(pinned)), () => true)).toHaveLength(1);
  });

  it("the #290 receipt still holds its original claim, and a correction receipt answers it", () => {
    const files = readdirSync(RECEIPTS).filter((name) => name.endsWith(".json"));
    const receipts = new Map(files.map((name) => [name, JSON.parse(readFileSync(join(RECEIPTS, name), "utf8"))]));
    expect(receipts.get("2026-09-01-merge-pr-290.json")?.independentReview?.reviewer).toBe(ORIGINAL_290);
    const answers = [...receipts.values()].filter(
      (receipt) => receipt?.transition === "correct-receipt" && receipt.corrects?.receipt === ".claude/work-control/2026-09-01-merge-pr-290.json",
    );
    expect(answers).toHaveLength(1);
    expect(reviewerFindings(receipts, addedInThisHistory)).toEqual([]);
  });

  it("addedIn is read from history: the commit that added #290's receipt passes, its parent does not", () => {
    const path = ".claude/work-control/2026-09-01-merge-pr-290.json";
    expect(addedInThisHistory("ac0eea519c2b1ee7850cf77c497b3d4245f8119c", path)).toBe(true);
    expect(addedInThisHistory("6d3283c95a213bbb8d17b8de72ce6ca21a114a8e", path)).toBe(false);
    expect(addedInThisHistory("ac0eea519c2b1ee7850cf77c497b3d4245f8119c", "2026-09-01-merge-pr-290.json")).toBe(false);
    expect(addedInThisHistory("0".repeat(40), path)).toBe(false);
  });
});
