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
// - `corrects.receipt`, the receipt's path;
// - `corrects.field`, `independentReview.reviewer`;
// - `corrects.original`, the field's EXACT text;
// - `corrects.standing`, the sentence that stands instead, which may state neither overstatement.
// The receipt keeps what was claimed and the correction says what stands. Neither is rewritten.
//
// ONE RECEIPT PREDATES BOTH RULES. #277's was corrected in place on 2026-09-01, and its correction
// prose names both phrases. It is pinned by the sha-256 of that field, so any further edit fails here
// as well as in the append-only guard.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const RECEIPTS = join(ROOT, ".claude", "work-control");

const OVERSTATEMENTS = [/\bits own worktree\b/i, /\bno stake in it landing\b/i];
const FIELD = "independentReview.reviewer";
const CORRECTED_IN_PLACE = {
  "2026-09-01-merge-pr-277.json": "5a056fe6b146b96cdf196a0f2a6e1499cdebc2476859898ed2f6aff6aa456560",
};

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

export function overstatementsIn(text) {
  return OVERSTATEMENTS.filter((pattern) => pattern.test(String(text))).map((pattern) => pattern.source);
}

// Every finding across a set of parsed receipts, keyed by file name.
export function reviewerFindings(receipts) {
  const findings = [];
  const corrected = new Map();
  for (const [name, receipt] of receipts) {
    if (receipt?.transition !== "correct-receipt") continue;
    const { receipt: path, field, original, standing } = receipt.corrects ?? {};
    const target = String(path ?? "").replace(/^\.claude\/work-control\//, "");
    if (!receipts.has(target)) findings.push(`${name}: corrects ${path}, which is not a receipt here`);
    else if (field !== FIELD) findings.push(`${name}: corrects ${field}; only ${FIELD} is read`);
    else if (typeof original !== "string") findings.push(`${name}: records no original text`);
    else if (typeof standing !== "string" || overstatementsIn(standing).length) findings.push(`${name}: its standing sentence states an overstatement`);
    else corrected.set(target, original);
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

  it("a receipt passes only when a correction names it, its field and its exact text", () => {
    const receipt = { independentReview: { reviewer: ORIGINAL_290 } };
    const correction = (corrects) => ({ transition: "correct-receipt", corrects });
    const valid = { receipt: ".claude/work-control/r.json", field: FIELD, original: ORIGINAL_290, standing: STANDING };
    const run = (corrects) => reviewerFindings(new Map([["r.json", receipt], ["c.json", correction(corrects)]]));
    expect(reviewerFindings(new Map([["r.json", receipt]]))).toHaveLength(1);
    expect(run(valid)).toEqual([]);
    expect(run({ ...valid, original: `${ORIGINAL_290}.` })).toEqual([expect.stringMatching(/^r\.json: /)]);
    expect(run({ ...valid, standing: `${STANDING} It had no stake in it landing.` })).toHaveLength(2);
    expect(run({ ...valid, field: "independentReview.head" })).toHaveLength(2);
    expect(run({ ...valid, receipt: ".claude/work-control/gone.json" })).toHaveLength(2);
    const quoted = { independentReview: { reviewer: `CORRECTED: 'its own worktree' was false. ORIGINAL: "${ORIGINAL_290}"` } };
    expect(reviewerFindings(new Map([["q.json", quoted]]))).toHaveLength(1);
  });

  it("the in-place #277 correction passes only while its text is exactly the pinned one", () => {
    const text = "holding its own worktree";
    const pinned = { "2026-09-01-merge-pr-277.json": { independentReview: { reviewer: text } } };
    expect(reviewerFindings(new Map(Object.entries(pinned)))).toHaveLength(1);
  });

  it("the #290 receipt still holds its original claim, and a correction receipt answers it", () => {
    const files = readdirSync(RECEIPTS).filter((name) => name.endsWith(".json"));
    const receipts = new Map(files.map((name) => [name, JSON.parse(readFileSync(join(RECEIPTS, name), "utf8"))]));
    expect(receipts.get("2026-09-01-merge-pr-290.json")?.independentReview?.reviewer).toBe(ORIGINAL_290);
    const answers = [...receipts.values()].filter(
      (receipt) => receipt?.transition === "correct-receipt" && receipt.corrects?.receipt === ".claude/work-control/2026-09-01-merge-pr-290.json",
    );
    expect(answers).toHaveLength(1);
    expect(reviewerFindings(receipts)).toEqual([]);
  });
});
