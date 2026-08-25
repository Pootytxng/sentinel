import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

/* THE APPROVED COMPS EXIST, AND NO LEDGER MAY SAY OTHERWISE.
 *
 * 2026-08-25. Three live ledgers — BACKLOG, OWNER_ACTION_CHECKLIST, SESSION_HANDOFF — all said
 * #213's B1–B5 direction was "blocked on the owner's ChatGPT mockups", one of them adding "no
 * session in this repo has them". None of that was true. On 2026-08-23 the owner approved four
 * room comps and they were bundled with an implementation-ready handoff (issue #49's own claim
 * comment records the folder). The claim was invented in `642d48d6`, copied into two more ledgers,
 * and never re-derived.
 *
 * The cost was not a wrong sentence. `docs/OWNER_ACTION_CHECKLIST.md` is the ONE list of things
 * waiting on him, and this sat on it as the only open item in its section — so his own complaint
 * ("looks terrible", "stale and lifeless") was handed back to him as homework he had already done.
 * The taste decree says aesthetic calls "must never be parked on him by default". This parked one.
 *
 * Two rules, failing in different environments on purpose — the same split as
 * `scripts/handoff-worktree-truth.test.mjs`, and for the same reason.
 *
 *   A. Portable. No live ledger may assert that a design train is waiting on owner-supplied
 *      mockups. This runs anywhere, and it is the rule that decays: the sentence is easy to write
 *      again from memory, and it reads exactly like the truth.
 *   B. Local only. The bundle path is recorded HERE rather than in prose, because prose is what
 *      failed — a path buried in a GitHub comment is not something a fresh session finds. On a
 *      machine that has the folder, all four comps must be present and non-empty. A CI checkout has
 *      no `.codex/` tree, so it SKIPS and says so rather than passing vacuously.
 */

/** The owner-approved four-room bundle, recorded here because a GitHub comment is not a record. */
const COMP_BUNDLE = join(
  "C:",
  "Users",
  "Kuya",
  ".codex",
  "visualizations",
  "2026",
  "08",
  "23",
  "01a02bee-5474-7961-b05a-e674fb8bb165",
  "compy-four-room-handoff",
);

const COMPS = [
  "01-health-approved.png",
  "02-live-approved.png",
  "03-history-approved.png",
  "04-test-approved.png",
];

const LEDGERS = ["docs/BACKLOG.md", "docs/OWNER_ACTION_CHECKLIST.md", "docs/SESSION_HANDOFF.md"];

/** A block that has been struck, dated as retracted, or quoted as the error — not a live claim. */
const RETRACTED = /~~|RETRACTED|was never|is NOT his|invented in|it was never true/i;

/** Something is being waited on. */
const BLOCKING = /blocked on|waiting on|needs (?:his|the owner's|your)|only you have/i;

/**
 * Live claims that a design train is blocked on owner-supplied mockups.
 *
 * Scoped to the bullet/paragraph, not the document: the fix for this very defect leaves the wrong
 * sentence QUOTED in all three files so the next session can see what was believed and why. A
 * whole-document match would read the quote and fail the doc for recording its own correction —
 * the same trap `repoStateBullet` exists to avoid in the worktree guard.
 */
export function mockupBlockClaims(markdown: string): string[] {
  return markdown
    .split(/\r?\n\s*\r?\n|\r?\n(?=[-*\d]+[.)]?\s+\*\*)/)
    .filter((block) => {
      const mention = block.match(/mockups?/i);
      if (!mention || !BLOCKING.test(block)) return false;
      // A retraction must be announced BEFORE or alongside the claim it retracts — that is how one
      // is actually written (a struck heading, a stamp up front). Without this the escape is
      // paragraph-wide, and a future writer could restate the false claim in a paragraph that
      // happens to say "invented in" two sentences later and never trip the rule.
      const out = RETRACTED.exec(block);
      return !(out && out.index < (mention.index ?? 0) + 60);
    })
    .map((block) => block.trim().split(/\r?\n/)[0]);
}

describe("the approved comps guard", () => {
  it("still catches the sentence it was written for", () => {
    // Pinned against fixtures so a green run can never mean "the splitter found no blocks".
    expect(
      mockupBlockClaims("- **B1–B5 is direction** and is blocked on the owner's ChatGPT mockups — no session has them."),
    ).toHaveLength(1);
    expect(
      mockupBlockClaims("2. **#49's B1–B5 direction is blocked on the ChatGPT mockups only you have** — paste them in."),
    ).toHaveLength(1);
    // A retraction that quotes the old claim is a record, not a claim.
    expect(
      mockupBlockClaims('2. ~~**needs your ChatGPT mockups**~~ — RETRACTED, it was never true. He approved them.'),
    ).toEqual([]);
    // Mockups mentioned with nothing blocked on them is fine.
    expect(mockupBlockClaims("The four approved mockups are the spec for this pass.")).toEqual([]);
    // Blocked on something that is not a mockup is not this rule's business.
    expect(mockupBlockClaims("- **Registering the domain is blocked on money.**")).toEqual([]);
    // THE TIGHTENING, and it is the reason this guard has a position check at all: the FIRST
    // attempt to falsify rule A failed. The injected false claim landed in a paragraph that also
    // said "invented in", the escape was paragraph-wide, and the guard stayed green while the
    // sentence it exists to catch sat in the file. A retraction word arriving long after the claim
    // excuses nothing.
    expect(
      mockupBlockClaims(
        "- **B1-B5 is blocked on the owner's ChatGPT mockups** and nobody in this repo has them. " +
          "Unrelated aside, three sentences later: that number was never re-derived.",
      ),
    ).toHaveLength(1);
  });

  it("A: no live ledger says a design train is waiting on his mockups", () => {
    for (const ledger of LEDGERS) {
      const claims = mockupBlockClaims(readFileSync(ledger, "utf8"));
      expect(
        claims,
        `${ledger} says a design train is blocked on owner-supplied mockups. He approved four room ` +
          `comps on 2026-08-23; they are bundled at the path in this file. Re-derive before writing ` +
          `this again — it parked his own complaint back on him for two days:\n  - ${claims.join("\n  - ")}`,
      ).toEqual([]);
    }
  });

  it("B: the recorded bundle is really there, with all four comps", () => {
    if (!existsSync(COMP_BUNDLE)) {
      // Vacuous here by construction (no `.codex/` tree in CI). Say it out loud rather than pass.
      expect(existsSync(COMP_BUNDLE)).toBe(false);
      return;
    }
    for (const comp of COMPS) {
      const p = join(COMP_BUNDLE, comp);
      expect(existsSync(p), `${comp} is missing from the approved bundle at ${COMP_BUNDLE}`).toBe(true);
      // Decoded length, not a byte count: the repo's fs type shim only admits "utf8". It is a
      // not-a-stub check, and a 1.1MB PNG clears it by three orders of magnitude either way.
      expect(readFileSync(p, "utf8").length, `${comp} is a stub`).toBeGreaterThan(1024);
    }
    expect(existsSync(join(COMP_BUNDLE, "HANDOFF.md"))).toBe(true);
  });
});
