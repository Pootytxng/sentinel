// Guards for the only component that writes to Work Control.
//
// The load-bearing refusal: postClaim throws unless it is handed a PASS verdict. A claim is a
// statement that the invariant holds, so a claim that can be posted without a verdict is a claim
// that can describe a state nobody verified — which is exactly the failure mode #14 exposed.
//
// Its twin (#643): postRelease throws unless the caller is the folder and branch the live claim names.
// On 2026-10-03 a session that had already released #637 posted a second released Handoff eight
// minutes after its successor claimed, and nothing mechanical stopped it. Every refusal below is
// asserted together with the fact that nothing was sent.
//
// Every board mutation goes through a PLAN of `gh` invocations, so the field quirks that cost real
// time are pinned here rather than rediscovered: date fields need `--date` (`--text` fails with
// "Did not receive a date value"), and clearing an expiry needs `--clear`.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import * as claimModule from "./claim.mjs";
import {
  claimExpiry,
  HANDOFF_HEADER,
  parseClaim,
  parseHandoff,
  planPostClaim,
  postClaim,
  postRelease,
  releaseDecision,
  renderClaim,
  renderHandoff,
  TAKEOVER_HEADER,
  threadLease,
} from "./claim.mjs";
import { cmdRelease, measureSeat, parseArgs } from "./release.mjs";
import { samePath } from "./worktree-field.mjs";
import { readClaimCache, writeClaimCache } from "../../scripts/lib/scope-drift.mjs";
import { evaluateWorkControl } from "../../scripts/work-control-gate.mjs";
import { GIT_SPAWN_TIMEOUT_MS } from "../../src/test/tree-walk-budget.ts";

const FOLDER = "C:\\Users\\Kuya\\code\\sentinel-workflow";
const BRANCH = "feat/single-entry-workflow";

const FACTS = {
  lane: "Claude Code",
  executor: "Claude Code (Opus 5)",
  repository: "Pootytxng/sentinel",
  folder: FOLDER,
  branch: BRANCH,
  scope: "single-entry workflow tooling only",
  started: "2026-07-30",
  expires: "2026-07-31",
  nextAction: "Implement the launcher.",
  processes: [{ name: "compy.exe", count: 1, note: "installed review build from #14" }],
};

const PASS = { verdict: "PASS", checks: [{ name: "git.clean", expected: "clean", actual: "clean", ok: true }] };
const REFUSE = { verdict: "REFUSE", checks: [{ name: "git.clean", expected: "clean", actual: "1 modified", ok: false }] };

const IDS = {
  projectId: "PVT_x",
  itemId: "PVTI_x",
  fields: {
    status: { id: "F_status", options: { Active: "o_active", "Needs Kuya": "o_needs", Review: "o_review" } },
    lane: { id: "F_lane", options: { "Claude Code": "o_cc" } },
    gate: { id: "F_gate", options: { None: "o_none", Kuya: "o_kuya" } },
    worktree: { id: "F_wt" },
    nextAction: { id: "F_next" },
    claimExpires: { id: "F_exp" },
    lastVerified: { id: "F_ver" },
  },
};

describe("a claim may not be posted without a verdict", () => {
  it("throws on a REFUSE verdict", () => {
    expect(() => postClaim({ issue: 18, verdict: REFUSE, facts: FACTS, ids: IDS, dryRun: true })).toThrow(/verdict/i);
  });

  it("throws when handed no verdict at all", () => {
    expect(() => postClaim({ issue: 18, facts: FACTS, ids: IDS, dryRun: true })).toThrow(/verdict/i);
    expect(() => postClaim({ issue: 18, verdict: {}, facts: FACTS, ids: IDS, dryRun: true })).toThrow(/verdict/i);
  });

  it("proceeds on PASS", () => {
    const r = postClaim({ issue: 18, verdict: PASS, facts: FACTS, ids: IDS, dryRun: true });
    expect(r.plan.length).toBeGreaterThan(0);
  });
});

describe("the claim block matches the WORK_CONTROL template", () => {
  const body = renderClaim({ ...FACTS, verdict: PASS });

  it.each([
    "### Ownership claim",
    "- Lane:",
    "- Executor/tool:",
    "- Repository:",
    "- Worktree folder:",
    "- Branch:",
    "- Write scope:",
    "- Started:",
    "- Claim expires:",
    "- Next action:",
    "- Active build/install/helper processes:",
  ])("carries %s", (field) => {
    expect(body).toContain(field);
  });

  it("states the measured facts, not placeholders", () => {
    expect(body).toContain(FOLDER);
    expect(body).toContain(BRANCH);
    expect(body).toMatch(/compy\.exe/);
  });

  it("carries the verdict that licensed it, so the claim is auditable", () => {
    expect(body).toMatch(/PASS/);
    expect(body).toMatch(/git\.clean/);
  });

  it("says `none` for processes rather than omitting the line", () => {
    expect(renderClaim({ ...FACTS, processes: [], verdict: PASS })).toMatch(/processes: none/i);
  });
});

describe("round-tripping a claim off the issue", () => {
  it("parses back what it rendered", () => {
    const parsed = parseClaim(renderClaim({ ...FACTS, verdict: PASS }));
    expect(parsed).toMatchObject({ lane: "Claude Code", folder: FOLDER, branch: BRANCH, expires: "2026-07-31" });
  });

  it("returns null for a comment that is not a claim", () => {
    expect(parseClaim("just a normal comment")).toBeNull();
  });

  it("reads the bold-bullet and two-column-table forms other writers post by hand", () => {
    // #224's claim (2026-09-01) was a table. It parsed as a claim with no fields — and under #358 a
    // live writer with no readable scope is a refusal the other side cannot cure.
    const table = [
      "### Ownership claim — exclusive write owner, issue #224",
      "",
      "| field | value |",
      "|---|---|",
      "| **writer** | Claude Code session `sentinel-63` |",
      "| **worktree** | `C:\\Users\\Kuya\\code\\sentinel\\.claude\\worktrees\\compy-visual-recovery-kit-6fd074` |",
      "| **branch** | `claude/compy-visual-recovery-kit-6fd074` |",
      "| **head at claim** | `cdd976f3` |",
      "| **expiry** | 2026-09-02T12:00:00Z |",
    ].join("\n");
    expect(parseClaim(table)).toMatchObject({
      executor: "Claude Code session `sentinel-63`",
      folder: "C:\\Users\\Kuya\\code\\sentinel\\.claude\\worktrees\\compy-visual-recovery-kit-6fd074",
      branch: "claude/compy-visual-recovery-kit-6fd074",
      expires: "2026-09-02T12:00:00Z",
      scope: null,
      lane: null,
    });
    const bold = "### Ownership claim\n- **Lane:** Codex\n- **Write scope**: `scripts/x.mjs`, `docs/`\n- **Claim expires:** 2026-09-03\n";
    expect(parseClaim(bold)).toMatchObject({ lane: "Codex", scope: "`scripts/x.mjs`, `docs/`", expires: "2026-09-03" });
  });
});

describe("claimExpiry — the expiry as writers actually spell it", () => {
  it("reads a date, a timestamp, and either with prose after it", () => {
    expect(claimExpiry("2026-09-03").toISOString()).toBe("2026-09-03T23:59:59.000Z");
    expect(claimExpiry("2026-09-02T04:55Z (12 hours)").toISOString()).toBe("2026-09-02T04:55:00.000Z");
    expect(claimExpiry("2026-09-02T12:00:00Z").toISOString()).toBe("2026-09-02T12:00:00.000Z");
    expect(claimExpiry("2026-08-03 (12-hour alarm; no automatic takeover)").toISOString()).toBe("2026-08-03T23:59:59.000Z");
  });

  it("is null, never a guess, for anything else — a claim stays live until its expiry is read as past", () => {
    expect(claimExpiry(null)).toBeNull();
    expect(claimExpiry("next Tuesday")).toBeNull();
  });
});

describe("the handoff, and guard 7's other half", () => {
  const body = renderHandoff({
    outcome: "Reconciler landed.",
    files: "beca0e5",
    verification: "128 tests green",
    remaining: "launcher",
    gates: "none",
    worktreeState: "clean",
    processes: "none",
    nextAction: "Write the launcher.",
    claim: "released",
  });

  it("carries every WORK_CONTROL handoff field", () => {
    for (const f of ["### Handoff", "- Outcome:", "- Files/commits/PR:", "- Verification:", "- Remaining work:", "- Gates or owner actions:", "- Worktree state:", "- Active processes:", "- Exact next action:", "- Claim:"]) {
      expect(body).toContain(f);
    }
  });

  it("parses the exact next action back out — the value guard 7 compares against", () => {
    expect(parseHandoff(body).nextAction).toBe("Write the launcher.");
    expect(parseHandoff(body).released).toBe(true);
  });

  it("returns null for a comment that is not a handoff", () => {
    expect(parseHandoff("### Ownership claim\n- Lane: Codex")).toBeNull();
  });
});

// #411: the work-control gate asks one question of an issue thread before a close (is a lease still
// live?) and answers it through this fold, the same one gather.readIssueThread uses, so the two
// cannot disagree. Each case is the shape of a real comment found by reading all 840 comments in the
// repository on 2026-09-10.
describe("threadLease: is a lease still live on this thread?", () => {
  const at = (createdAt, ...lines) => ({ createdAt, body: lines.join("\n") });
  const CLAIM = at("2026-09-10T06:41:51Z", "### Ownership claim", "- Lane: Claude Code", "- Write scope: `src-tauri/src/race_seam.rs`");
  const RELEASE = at("2026-09-10T07:52:00Z", "### Handoff", "- Exact next action: none", "- Claim: released");

  it("reads the newest claim as live until a newer handoff releases it", () => {
    expect(threadLease([CLAIM]).claim).toMatchObject({ lane: "Claude Code", postedAt: "2026-09-10T06:41:51Z" });
    expect(threadLease([CLAIM, RELEASE]).claim).toBeNull();
    expect(threadLease([RELEASE, { ...CLAIM, createdAt: "2026-09-10T08:00:00Z" }]).claim).not.toBeNull();
    expect(threadLease([]).claim).toBeNull();
  });

  it.each(["- Claim: transferred to codex until 2026-09-11T08:00Z", "- Claim: renewed until 2026-08-04.", "- Outcome: merged"])(
    "keeps the lease live after a handoff whose last line is %j",
    (last) => {
      expect(threadLease([CLAIM, at("2026-09-10T07:52:00Z", "### Handoff", last)]).claim).not.toBeNull();
    },
  );

  it("does not read a HELD lease as released because its Claim line mentions the release (#399, #407)", () => {
    const held = at("2026-09-10T07:52:00Z", "### Handoff", "- Claim: **HELD.** Comment `IC_x`, scope unchanged. Released only when a review verdict lands.");
    expect(parseHandoff(held.body).released).toBe(false);
    expect(threadLease([CLAIM, held]).claim).not.toBeNull();
  });

  it.each(["released", "Released.", "**released.**", "RELEASED** by Cowork.", "Released 2026-09-03; lane complete.", "`released`"])(
    "reads a release as writers spell it: %s",
    (value) => {
      expect(parseHandoff(`### Handoff\n- Claim: ${value}`).released).toBe(true);
    },
  );

  it("does not count a sentence that merely mentions a header as a lease event", () => {
    // #283's close comment (2026-09-10T07:50:16Z) named the Handoff still to come. It is not one.
    const mention = at("2026-09-10T07:50:16Z", "Closing. The lease stays held until the carrier lands. Then the `### Handoff` and Done follow.");
    expect(parseHandoff(mention.body)).toBeNull();
    // #408 and #409 (2026-09-09) retold "a fresh **`### Ownership claim`**" after the lease was released.
    const retelling = at("2026-09-10T08:00:00Z", "The measurements that licensed it, followed by a fresh **`### Ownership claim`** (20:43).");
    expect(parseClaim(retelling.body)).toBeNull();
    expect(threadLease([CLAIM, RELEASE, retelling]).claim).toBeNull();
  });

  it("still reads a header that opens its line after a byte-order mark, or carries a suffix (#49)", () => {
    expect(parseClaim("\uFEFF### Ownership claim\n- Lane: Codex")).toMatchObject({ lane: "Codex" });
    expect(parseHandoff("### Handoff — Phase B step 3 complete\n- Claim: released.").released).toBe(true);
  });

  it("reads a claim and a release in one comment as a live lease: the release has to come after", () => {
    const both = at("2026-09-10T07:52:00Z", "### Handoff", "- Claim: released", "", "### Ownership claim", "- Lane: Codex");
    expect(threadLease([both]).claim).not.toBeNull();
  });

  // HQ review 5165670535 on e56c6395, finding 2: comparing the newest claim with the newest handoff let
  // a later Handoff that says nothing of the claim bring a released one back. The thread is folded
  // once, in posting order, one transition per comment.
  describe("folded in posting order: a release holds until a new claim", () => {
    const LATER = at("2026-09-10T08:10:00Z", "### Handoff", "- Outcome: review requested", "- Exact next action: independent review");
    const RECLAIM = at("2026-09-10T08:20:00Z", "### Ownership claim", "- Lane: Codex", "- Write scope: `docs/`");

    it("claim: live; release: none; a handoff that does not release: still none; a new claim: live", () => {
      expect(threadLease([CLAIM]).claim).toMatchObject({ postedAt: CLAIM.createdAt });
      expect(threadLease([CLAIM, RELEASE]).claim).toBeNull();
      expect(threadLease([CLAIM, RELEASE, LATER]).claim).toBeNull();
      expect(threadLease([CLAIM, RELEASE, LATER, RECLAIM]).claim).toMatchObject({ lane: "Codex", postedAt: RECLAIM.createdAt });
    });

    it("still reports the newest handoff, released or not: guard 7 reads its next action", () => {
      expect(threadLease([CLAIM, RELEASE, LATER]).handoff).toMatchObject({ nextAction: "independent review", released: false, postedAt: LATER.createdAt });
    });

    it.each(["transferred to codex until 2026-09-11T08:00Z", "**HELD.** Scope unchanged. Released only when a review verdict lands."])(
      "keeps the lease through a handoff that preserves it (%s), and through a later one that says nothing, until a release",
      (kept) => {
        const hold = at("2026-09-10T07:52:00Z", "### Handoff", `- Claim: ${kept}`);
        const release = { ...RELEASE, createdAt: "2026-09-10T08:30:00Z" };
        expect(threadLease([CLAIM, hold]).claim).toMatchObject({ postedAt: CLAIM.createdAt });
        expect(threadLease([CLAIM, hold, LATER]).claim).toMatchObject({ postedAt: CLAIM.createdAt });
        expect(threadLease([CLAIM, hold, LATER, release]).claim).toBeNull();
      },
    );

    // #517: the push-time overlap gate dates a held path from the run, not the newest comment, so a
    // refresh cannot reset a lane's seniority and a release must end the run with the lease.
    it("returns the run since the last release, oldest first, ending in the live claim", () => {
      const REFRESH = at("2026-09-10T07:00:00Z", "### Ownership claim", "- Lane: Claude Code", "- Write scope: `src-tauri/src/race_seam.rs`, `docs/`");
      const lease = threadLease([CLAIM, REFRESH]);
      expect(lease.run.map((c) => c.postedAt)).toEqual([CLAIM.createdAt, REFRESH.createdAt]);
      expect(lease.run.at(-1)).toBe(lease.claim);
      expect(threadLease([CLAIM, RELEASE]).run).toEqual([]);
      expect(threadLease([CLAIM, RELEASE, LATER, RECLAIM]).run.map((c) => c.postedAt)).toEqual([RECLAIM.createdAt]);
      expect(threadLease([]).run).toEqual([]);
    });

    it("carries the claim comment's url when the reader supplied one, and invents none when it did not", () => {
      const url = "https://github.com/Pootytxng/sentinel/issues/1#issuecomment-1";
      expect(threadLease([{ ...CLAIM, url }]).claim).toMatchObject({ url });
      expect(threadLease([CLAIM]).claim).not.toHaveProperty("url");
    });
  });

  // HQ review 5165670535 on e56c6395, finding 1: a line-start regex read a release quoted inside fenced
  // code as a real one, and let a close through while the claim above it was live.
  describe("an example is not an event: nothing inside fenced code or an HTML comment is read", () => {
    const HANDOFF_EXAMPLE = ["The release will read:", "", "```text", "### Handoff", "- Exact next action: none", "- Claim: released", "```"];
    const CLAIM_EXAMPLE = ["WORK_CONTROL's template, for the next writer:", "", "```text", "### Ownership claim", "- Lane: <coordination label; informational>", "- Write scope: <exact paths/globs>", "```"];

    it("parseHandoff does not recognize a fenced Handoff example", () => {
      expect(parseHandoff(HANDOFF_EXAMPLE.join("\n"))).toBeNull();
    });

    it("parseClaim does not recognize a fenced Ownership claim example", () => {
      expect(parseClaim(CLAIM_EXAMPLE.join("\n"))).toBeNull();
    });

    it("threadLease keeps the genuine claim before the example live, and raises no claim from one", () => {
      const lease = threadLease([CLAIM, at("2026-09-10T07:52:00Z", ...HANDOFF_EXAMPLE)]);
      expect(lease.claim).toMatchObject({ postedAt: CLAIM.createdAt });
      expect(lease.handoff).toBeNull();
      expect(threadLease([CLAIM, RELEASE, at("2026-09-10T08:00:00Z", ...CLAIM_EXAMPLE)]).claim).toBeNull();
    });

    it("reads a genuine block's own fields, not the example it quotes", () => {
      const held = ["### Handoff", "- Outcome: held for review", "When the lease ends, this line reads:", "```", "- Claim: released", "```", "- Claim: transferred to codex until 2026-09-11T08:00Z"];
      expect(parseHandoff(held.join("\n")).released).toBe(false);
      const claim = ["### Ownership claim", "~~~", "- Lane: <coordination label>", "~~~", "- Lane: Claude Code"];
      expect(parseClaim(claim.join("\n")).lane).toBe("Claude Code");
    });

    // The contexts it models, each read the way CommonMark 0.31 renders it.
    it.each([
      ["a tilde fence", ["~~~", "### Handoff", "- Claim: released", "~~~"]],
      ["a fence indented three spaces", ["   ```", "### Handoff", "- Claim: released", "   ```"]],
      ["a fence a shorter run cannot close", ["````md", "```", "### Handoff", "- Claim: released", "```", "````"]],
      ["a fence the other character cannot close", ["```", "~~~", "### Handoff", "- Claim: released", "```"]],
      ["a fence never closed, which runs to the end of the comment", ["```text", "### Handoff", "- Claim: released"]],
      ["an HTML comment, which renders as nothing at all", ["<!--", "### Handoff", "- Claim: released", "-->"]],
      ["a tab's indentation, which makes it indented code", ["\t### Handoff", "- Claim: released"]],
    ])("reads no Handoff inside %s", (_, lines) => {
      expect(parseHandoff(lines.join("\n"))).toBeNull();
    });

    // And what it must not over-read: hiding a genuine claim would let a close through.
    it.each([
      ["after a closed fence", ["```", "npm test", "```", "### Ownership claim", "- Lane: Codex"]],
      ["after a one-line HTML comment", ["<!-- claim below -->", "### Ownership claim", "- Lane: Codex"]],
      ["after three backticks whose info string holds a backtick: inline code, not a fence", ["```js``` opened the example", "### Ownership claim", "- Lane: Codex"]],
      ["after three backticks indented four spaces: indented code, not a fence", ["    ```", "### Ownership claim", "- Lane: Codex"]],
    ])("still reads a claim %s", (_, lines) => {
      expect(parseClaim(lines.join("\n"))).toMatchObject({ lane: "Codex" });
    });
  });

  // HQ review 5167660647 on 3ce1beb9: a raw HTML block is not Markdown either, and a release quoted in
  // a `<pre>` still released the claim above it. Every shape below was rendered by GitHub's own
  // /markdown endpoint on 2026-09-10, and each expectation is what that page showed, except the ones
  // named at the end: each of those fails closed, and says so.
  describe("an example is not an event: nothing inside a raw HTML block is read", () => {
    const PRE_EXAMPLE = ["The release will read:", "", "<pre>", "### Handoff", "- Exact next action: none", "- Claim: released", "</pre>"];
    const H = ["### Handoff", "- Claim: released"];
    const C = ["### Ownership claim", "- Lane: Codex"];

    it("parseHandoff does not recognize a Handoff inside a <pre> block", () => {
      expect(parseHandoff(PRE_EXAMPLE.join("\n"))).toBeNull();
    });

    it("threadLease keeps the genuine claim before the example live", () => {
      const lease = threadLease([CLAIM, at("2026-09-10T07:52:00Z", ...PRE_EXAMPLE)]);
      expect(lease.claim).toMatchObject({ postedAt: CLAIM.createdAt });
      expect(lease.handoff).toBeNull();
      // The review's own shape. At 3ce1beb9 its claim survived only because a comment is read release
      // first, and the example still stood as the thread's newest Handoff.
      const own = threadLease([at("2026-09-10T06:41:51Z", "### Ownership claim", "- Lane: Claude Code", "", "<pre>", ...H, "</pre>")]);
      expect(own.claim).toMatchObject({ lane: "Claude Code" });
      expect(own.handoff).toBeNull();
    });

    it("still reads a genuine Handoff after the block, in the same comment or a later one", () => {
      const same = [...PRE_EXAMPLE, "", "### Handoff", "- Exact next action: independent review", "- Claim: released"];
      expect(parseHandoff(same.join("\n"))).toMatchObject({ nextAction: "independent review", released: true });
      const lease = threadLease([CLAIM, at("2026-09-10T07:51:00Z", ...PRE_EXAMPLE), RELEASE]);
      expect(lease.claim).toBeNull();
      expect(lease.handoff).toMatchObject({ postedAt: RELEASE.createdAt, released: true });
    });

    it("raises no claim from a <pre> example, and does not revive a released lease with one", () => {
      const example = ["WORK_CONTROL's template:", "", "<pre>", "### Ownership claim", "- Lane: <coordination label>", "</pre>"];
      expect(parseClaim(example.join("\n"))).toBeNull();
      expect(threadLease([CLAIM, RELEASE, at("2026-09-10T08:00:00Z", ...example)]).claim).toBeNull();
    });

    // Every kind the renderer starts, by GitHub's list of tags: `<textarea>` and `<source>` are on it,
    // `<search>` is not, and a declaration needs a capital letter.
    it.each([
      ["a <pre> never closed, which runs to the end", ["<pre>", ...H]],
      ["a <PRE> with attributes", ['<PRE class="x">', ...H, "</PRE>"]],
      ["a <textarea>, across a blank line", ["<textarea>", "x", "", ...H, "</textarea>"]],
      ["a <script>", ["<script>", ...H, "</script>"]],
      ["a <style>", ["<style>", ...H, "</style>"]],
      ["a <pre> that interrupts a paragraph", ["Example:", "<pre>", ...H, "</pre>"]],
      ["a <pre> indented three spaces", ["   <pre>", ...H, "</pre>"]],
      ["a <pre> indented two spaces, which a less indented line does not end", ["  <pre>", ...H, "</pre>"]],
      ["a processing instruction", ["<?php", ...H, "?>"]],
      ["a declaration", ["<!EXAMPLE", ...H, ">"]],
      ["CDATA", ["<![CDATA[", ...H, "]]>"]],
      ["a <details> with no blank line after it", ["<details>", "<summary>Example</summary>", ...H, "</details>"]],
      ["a <div>", ["<div>", ...H, "</div>"]],
      ["a <DIV>", ["<DIV>", ...H]],
      ["a closing </div>", ["</div>", ...H]],
      ["a <source>", ['<source src="x">', ...H]],
      ["a <div> that interrupts a paragraph", ["Example:", "<div>", ...H]],
      ["a lone open tag", ["<code>", ...H, "</code>"]],
      ["a lone tag with attributes", ['<a href="https://example.com" title=\'x\'>', ...H]],
      ["a lone closing tag", ["</span>", ...H]],
      ["a lone self-closing tag", ["<br/>", ...H]],
      ["a lone custom element", ["<my-tag>", ...H]],
      ["a lone tag whose name only starts like pre", ["<prefix>", ...H]],
      ["a lone tag after a blank line", ["Example:", "", "<span>", ...H]],
      ["a lone tag after a heading", ["### Notes", "<span>", ...H]],
      ["a lone tag after closed fenced code", ["```", "x", "```", "<span>", ...H]],
      ["a lone tag after indented code", ["    code", "<span>", ...H]],
      ["a lone tag after a setext heading", ["Notes", "---", "<span>", ...H]],
      ["a lone tag after an empty list item", ["-", "<span>", ...H]],
      ["a lone tag after a list item's lazy line", ["- item", "lazy text", "<br>", ...H]],
      ["a lone tag after a loose list item", ["- item", "", "  more", "<br>", ...H]],
      ["a lone tag after a quote's lazy line", ["> quoted", "lazy", "<br>", ...H]],
      ["a lone tag after a table", ["| a | b |", "|---|---|", "| x | y |", "<span>", ...H]],
      ["a lone tag indented less than its ordered item", ["1. item", "  <br>", ...H]],
      ["a lone tag after a footnote definition", ["Text[^1]", "", "[^1]: note", "<br>", ...H]],
      ["a lone tag after a footnote definition's lazy line", ["Text[^1]", "", "[^1]: note", "lazy", "<br>", ...H]],
      ["a lone tag after a footnote definition that interrupts a paragraph", ["Text[^1]", "[^1]: note", "<br>", ...H]],
    ])("reads no Handoff inside %s", (_, lines) => {
      expect(parseHandoff(lines.join("\n"))).toBeNull();
    });

    it.each([
      ["after a closed <pre>", ["<pre>", "x", "</pre>", ...H]],
      ["after a one-line <pre>", ["<pre>x</pre>", ...H]],
      ["after a <pre> that ends mid-line", ["<pre>", "x</pre> tail", ...H]],
      ["after a <pre> ended by another tag of its kind", ["<pre>", "x", "</textarea>", ...H]],
      ["after a <div> ended by a blank line", ["<div>", "x", "", ...H]],
      ["after a <div> ended by a line of spaces", ["<div>", "   ", ...H]],
      ["after a lone tag ended by a blank line", ["<span>", "x", "", ...H]],
      ["after a closed declaration", ["<!EXAMPLE", "x", ">", ...H]],
      ["after a closed processing instruction", ["<?x", "?>", ...H]],
      ["after closed CDATA", ["<![CDATA[", "x", "]]>", ...H]],
      ["after a one-line declaration", ["<!DOCTYPE html>", ...H]],
      ["after `<!` and a lowercase letter, not a declaration here", ["<!example", ...H, ">"]],
      ["after a paragraph, which a lone tag cannot interrupt", ["Taking this over.", "<br>", ...H]],
      ["after a paragraph and <search>, only a lone tag here", ["Text", "<search>", ...H]],
      ["after a tag with text after it", ["<span> text", ...H]],
      ["after an unfinished tag", ['<a href="x"', ...H]],
      ["after a tag indented four spaces: indented code", ["    <span>", ...H]],
      ["after a <pre> closed inside its list item", ["- Example:", "  <pre>", "  x", "  </pre>", ...H]],
      ["that ends a list item holding a <pre>", ["- <pre>", "### Handoff", "- Claim: released", "</pre>"]],
      ["after a link reference definition, which a lone tag cannot interrupt", ["[x]: https://example.com", "<br>", ...H]],
    ])("still reads a Handoff %s", (_, lines) => {
      expect(parseHandoff(lines.join("\n"))).toMatchObject({ released: true });
    });

    it.each([
      ["a <details> with no blank line after it", ["<details>", "<summary>Old claim</summary>", ...C, "</details>"]],
      ["a lone </pre>", ["</pre>", ...C]],
      ["a lone tag after a list item", ["- Taking this over.", "<br>", ...C]],
      ["a lone tag after a quote", ["> quoted", "<br>", ...C]],
      ["a <pre> indented two spaces, which a less indented line does not end", ["  <pre>", ...C, "</pre>"]],
      ["a lone tag after a footnote definition", ["Text[^1]", "", "[^1]: note", "<br>", ...C]],
      ["a lone tag after a footnote definition that interrupts a paragraph", ["Text[^1]", "[^1]: note", "<br>", ...C]],
    ])("reads no claim inside %s", (_, lines) => {
      expect(parseClaim(lines.join("\n"))).toBeNull();
    });

    // And what it must not over-read: hiding a genuine claim would let a close through.
    it.each([
      ["after a closed <pre>", ["<pre>", "npm test", "</pre>", ...C]],
      ["after a one-line <pre>", ["<pre>npm test</pre>", ...C]],
      ["after a <pre> that ends mid-line", ["<pre>", "x</pre> tail", ...C]],
      ["after a <details> block ended by a blank line", ["<details>", "", ...C, "", "</details>"]],
      ["after a lone tag ended by a blank line", ["<br>", "", ...C]],
      ["after a paragraph, which a lone tag cannot interrupt", ["Taking this over.", "<br>", ...C]],
      ["after a paragraph whose next line only looks like a list item", ["Text", "*", "<br>", ...C]],
      ["after a paragraph whose next line only looks like an ordered item", ["Text", "2. x", "<br>", ...C]],
      ["after a paragraph and <search>, only a lone tag here", ["Text", "<search>", ...C]],
      ["after a tag with text after it", ["<span> text", ...C]],
      ["after an unfinished tag", ['<a href="x"', ...C]],
      ["after a <pre> indented four spaces: indented code", ["    <pre>", ...C]],
      ["after a sentence that mentions <pre>", ["See <pre> below", ...C]],
      ["after `<!` and a lowercase letter", ["<!example", ...C, ">"]],
      ["after a lone tag indented into its list item's paragraph", ["- item", "  <br>", ...C]],
      ["after an unclosed <pre> inside a list item, which the item's end closes", ["- Example:", "  <pre>", "  x", ...C]],
      ["after a <div> inside a list item", ["- x", "  <div>", "  y", ...C]],
      ["after a <div> on a list item's own line", ["- <div>", ...C]],
      ["after a list, a blank line and a paragraph", ["- item", "", "Text", "<br>", ...C]],
      ["after an empty list item and a paragraph", ["-", "Text", "<br>", ...C]],
    ])("still reads a claim %s", (_, lines) => {
      expect(parseClaim(lines.join("\n"))).toMatchObject({ lane: "Codex" });
    });

    // Where the renderer's reading turns on list or table context this module does not track, a Handoff
    // is read as hidden and a claim as shown: a mistake keeps a lease live, never ends one. A Handoff
    // header counts only at the start of its line, where no list item can hold it.
    it.each([
      ["a <pre> opened on a list item's line", ["- <pre>", "  ### Handoff", "- Claim: released"]],
      ["a <pre> indented under a list item", ["- Example:", "  <pre>", "  ### Handoff", "- Claim: released"]],
      ["a <pre> indented four spaces under a list item", ["- x", "    <pre>", "  ### Handoff", "- Claim: released"]],
      ["a fence opened on a list item's line", ["- ```", "  ### Handoff", "- Claim: released"]],
    ])("reads no Handoff inside %s, which only a list item's indentation puts there", (_, lines) => {
      expect(parseHandoff(lines.join("\n"))).toBeNull();
    });

    it.each([
      ["an indented header", ["  ### Handoff", "- Claim: released"]],
      ["a lone tag indented into its list item's paragraph", ["- item", "  <br>", ...H]],
      ["a lone tag indented into its ordered item's paragraph", ["1. item", "   <br>", ...H]],
    ])("reads no Handoff after %s, though GitHub shows one: the lease stays live", (_, lines) => {
      expect(parseHandoff(lines.join("\n"))).toBeNull();
    });

    it("still reads an indented claim header, and a claim GitHub hides after a table: the lease holds", () => {
      expect(parseClaim(["  ### Ownership claim", "- Lane: Codex"].join("\n"))).toMatchObject({ lane: "Codex" });
      expect(parseClaim(["| a | b |", "|---|---|", "| x | y |", "<br>", ...C].join("\n"))).toMatchObject({ lane: "Codex" });
    });
  });

  // HQ review 5171061412 on c71c6d3c: a fence left open inside a list item hid a genuine claim after the
  // item to the end of the comment, though GitHub ends the fence with the item. Every shape below was
  // rendered by GitHub's /markdown endpoint on 2026-09-10, and each expectation is what that page showed,
  // except the ones named at the end: each of those fails closed, and says so.
  describe("a block left open inside a list item ends with the item", () => {
    const ITEM_FENCE = ["- Example:", "  ```", "  npm test"];
    const H = ["### Handoff", "- Claim: released"];
    const C = ["### Ownership claim", "- Lane: Codex"];

    it("parseClaim reads a genuine claim after a fence left open inside a list item", () => {
      expect(parseClaim([...ITEM_FENCE, ...C].join("\n"))).toMatchObject({ lane: "Codex" });
    });

    it("threadLease reads that claim as live, and after a release as a new lease", () => {
      const claim = at("2026-09-10T08:00:00Z", ...ITEM_FENCE, ...C);
      expect(threadLease([claim]).claim).toMatchObject({ lane: "Codex", postedAt: claim.createdAt });
      expect(threadLease([CLAIM, RELEASE, claim]).claim).toMatchObject({ lane: "Codex", postedAt: claim.createdAt });
    });

    it("reads no Handoff still inside that fence, so the claim before it stays live", () => {
      const inside = ["- Example:", "  ```", "  ### Handoff", "  - Claim: released"];
      expect(parseHandoff(inside.join("\n"))).toBeNull();
      const lease = threadLease([CLAIM, at("2026-09-10T07:52:00Z", ...inside)]);
      expect(lease.claim).toMatchObject({ postedAt: CLAIM.createdAt });
      expect(lease.handoff).toBeNull();
    });

    it.each([
      ["after a tilde fence", ["- Example:", "  ~~~", "  x", ...C]],
      ["after a fence left open in an ordered item", ["1. Run:", "   ```", "   x", ...C]],
      ["after a fence with an info string", ["- Example:", "  ```sh", "  x", ...C]],
      ["after a blank line inside the fence", ["- Example:", "  ```", "  x", "", ...C]],
      ["after a fence left open in an outer item, under a nested one", ["- a", "  - b", "  ```", "  x", ...C]],
      ["indented one space, short of the item's text", ["- Example:", "  ```", "  x", " ### Ownership claim", "- Lane: Codex"]],
      ["after a closer indented three past the item's text", ["- Example:", "  ```", "  x", "     ```", "  ### Ownership claim", "- Lane: Codex"]],
      ["after a fence indented past the item's text, closed there", ["- Example:", "   ```", "  x", "   ```", "   ### Ownership claim", "- Lane: Codex"]],
      ["after a line that only looks like its closer, four past the item's text", ["- Example:", "   ```", "  x", "      ```", "   ```", "   ### Ownership claim", "- Lane: Codex"]],
      ["after a fence under an ordered item's number, short of its text: a top-level fence, closed", ["1. Run this:", "  ```", "git status", "  ```", ...C]],
      ["after a fence under a two-space marker, short of its text: a top-level fence, closed", ["-  Example:", "  ```", "x", "  ```", ...C]],
      ["after a <pre> under a two-space marker, short of its text: a top-level block, closed", ["-  Example:", "  <pre>", "x", "", "</pre>", ...C]],
      ["after a fence closed at column 0, which GitHub reads as opening another, and a fence closing that", ["- Example:", "  ```", "  x", "```", "Then:", "```", ...C]],
    ])("still reads a claim %s", (_, lines) => {
      expect(parseClaim(lines.join("\n"))).toMatchObject({ lane: "Codex" });
    });

    // The repair reaches only a block inside a list item: a top-level one still runs to its own end.
    it.each([
      ["a fence never closed", ["```", "x", ...C]],
      ["a fence still inside its list item", ["- Example:", "  ```", "  ### Ownership claim", "  - Lane: Codex"]],
      ["a fence after a list, indented one space", ["- item", "", " ```", "x", ...C]],
      ["a fence under an ordered item's number, short of its text", ["1. Run this:", "  ```", "git status", ...C]],
      ["a fence after a list and a paragraph", ["- item", "", "Text", "  ```", "x", ...C]],
      ["a fence that ends a list item", ["- item", "```", "x", ...C]],
      ["a fence after a closed one under a two-space marker", ["-  Example:", "  ```", "x", "  ```", "", "```text", ...C]],
      ["a <pre> under an ordered item's number, short of its text", ["1. item", "  <pre>", "  x", ...C]],
      ["a <pre> after a list item, indented one space", ["- item", " <pre>", "x", ...C]],
      ["an HTML comment left open inside a list item, which GitHub never closes", ["- Example:", "  <!--", "  x", ...C]],
    ])("reads no claim inside %s", (_, lines) => {
      expect(parseClaim(lines.join("\n"))).toBeNull();
    });

    it("reads no Handoff inside a top-level fence never closed", () => {
      expect(parseHandoff(["```", "x", ...H].join("\n"))).toBeNull();
    });

    // The line that ends the item can open a block of its own, and a Handoff after it is then code: on
    // c71c6d3c each of these released the claim above it.
    it.each([
      ["a fence closed at column 0, which GitHub reads as opening another", ["- Example:", "  ```", "  npm test", "```", ...H]],
      ["a fence opened after a list item's fence ended", ["- Example:", "  ```", "  x", "Then:", "  ```", ...H]],
      ["a fence opened at column 0 inside a list item's <pre>", ["- Example:", "  <pre>", "  x", "```", "</pre>", ...H]],
      ["a fence opened at column 0 inside a list item's <div>", ["- Example:", "  <div>", "```", "", ...H]],
      ["an HTML comment its list item ended before its `-->`", ["- Example:", "  <!--", "x", "-->", ...H]],
    ])("reads no Handoff GitHub hides after %s", (_, lines) => {
      expect(parseHandoff(lines.join("\n"))).toBeNull();
      expect(threadLease([CLAIM, at("2026-09-10T07:52:00Z", ...lines)]).claim).toMatchObject({ postedAt: CLAIM.createdAt });
    });

    it.each([
      ["a fence closed under the item's text", ["- Example:", "  ```", "  x", "  ```", ...H]],
      ["a fence closed a space deeper", ["- Example:", "  ```", "  x", "   ```", ...H]],
      ["a <pre> closed under the item's text", ["- Example:", "  <pre>", "  x", "  </pre>", ...H]],
      ["a <div> and a blank line", ["- Example:", "  <div>", "  x", "", ...H]],
    ])("still reads a Handoff after a list item's block that ends inside the item: %s", (_, lines) => {
      expect(parseHandoff(lines.join("\n"))).toMatchObject({ released: true });
      expect(threadLease([CLAIM, at("2026-09-10T07:52:00Z", ...lines)]).claim).toBeNull();
    });

    // Where GitHub settles it the other way, each fails closed: past a line that may have ended a list
    // item under an open block, a claim is read and a Handoff is not.
    it.each([
      ["a fence left open inside a list item", [...ITEM_FENCE, ...H]],
      ["a fence closed at column 0 and a later pair of fences", ["- Example:", "  ```", "  x", "```", "Then:", "```", ...H]],
      ["a fence indented past the item's text, closed under it", ["- Example:", "   ```", "  x", "  ```", ...H]],
      ["a fence after a list GitHub has ended, closed at column 0", ["- item", "", " text", "  ```", "  x", "```", ...H]],
    ])("reads no Handoff after %s, though GitHub shows one: the lease stays live", (_, lines) => {
      expect(parseHandoff(lines.join("\n"))).toBeNull();
    });

    it.each([
      ["in a fence opened after a list item's fence ended", ["- Example:", "  ```", "  x", "Then:", "  ```", ...C]],
      ["after a lone tag that ends a list item's <pre>", ["- Example:", "  <pre>", "  x", "<br>", ...C]],
      ["in a fence opened by a list item's fence closed at column 0", ["- Example:", "  ```", "  npm test", "```", ...C]],
      ["in a fence opened at column 0 inside a list item's <pre>", ["- Example:", "  <pre>", "  x", "```", "</pre>", ...C]],
      ["in a fence opened at column 0 inside a list item's <div>", ["- Example:", "  <div>", "```", "", ...C]],
      ["after an HTML comment its list item ended before its `-->`", ["- Example:", "  <!--", "x", "-->", ...C]],
    ])("still reads a claim GitHub hides %s: the lease holds", (_, lines) => {
      expect(parseClaim(lines.join("\n"))).toMatchObject({ lane: "Codex" });
    });
  });

  // HQ review 5172037615 on afc6dfc7: a Handoff read its fields from the whole comment, so a Claim line
  // above its header, or under a later heading, released the claim before it. A Handoff's section runs
  // from its header to the next line that opens another section.
  describe("a Handoff reads its fields only from its own section", () => {
    const NOTES = ["### Notes", "- Claim: released", ""];
    const OWN = ["### Handoff", "- Outcome: review requested", "- Exact next action: independent review"];
    const TEMPLATE = renderHandoff({ outcome: "merged", nextAction: "none", claim: "released" });

    it.each([
      ["above its header, in a Handoff with no Claim line", [...NOTES, ...OWN]],
      ["above its header, over the Handoff's own HELD", [...NOTES, "### Handoff", "- Claim: HELD. Review pending."]],
      ["under a later heading", [...OWN, "", "### Notes", "- Claim: released"]],
      ["under a later heading of another level", [...OWN, "", "# Notes", "- Claim: released"]],
      ["under a later setext heading", [...OWN, "", "Notes", "-----", "- Claim: released"]],
      ["that is the text of a later setext heading", [...OWN, "", "| Claim | released |", "==="]],
      ["past a thematic break", [...OWN, "", "***", "- Claim: released"]],
      ["under a heading in a later list item", [...OWN, "- ### Notes", "- Claim: released"]],
      ["under a heading in a quote", [...OWN, "", "> ### Notes", "", "- Claim: released"]],
      ["under an HTML heading", [...OWN, "", "<h3>Notes</h3>", "", "- Claim: released"]],
      ["past an HTML rule", [...OWN, "", "<hr>", "", "- Claim: released"]],
      ["that an underline indented into its list item makes a heading", [...OWN, "- Claim: released", "  ---"]],
      ["that === indented into its list item makes a heading", [...OWN, "- Claim: released", "  ==="]],
      ["that an underline four columns in makes a heading", [...OWN, "- Claim: released", "    ---"]],
      ["that an underline after a tab makes a heading", [...OWN, "- Claim: released", "\t---"]],
      ["that an underline makes a heading with the line after it", [...OWN, "- Claim: released", "  (lane)", "  ---"]],
      ["in the template, that an underline indented into its item makes a heading", [TEMPLATE, "  ---"]],
    ])("does not release on a Claim line %s, so the claim before it stays live", (_, lines) => {
      expect(parseHandoff(lines.join("\n"))).toMatchObject({ released: false });
      expect(threadLease([CLAIM, at("2026-09-10T07:52:00Z", ...lines)]).claim).toMatchObject({ postedAt: CLAIM.createdAt });
    });

    it.each([
      ["released", "HELD. Review pending.", false],
      ["HELD. Review pending.", "released", false],
      ["released", "released", true],
    ])("releases on two Handoffs in one comment only when both do: %j, then %j", (first, second, released) => {
      const body = ["### Handoff", `- Claim: ${first}`, "", "### Handoff", `- Claim: ${second}`].join("\n");
      expect(parseHandoff(body).released).toBe(released);
    });

    it("does not release when a Handoff's own Claim lines disagree", () => {
      expect(parseHandoff("### Handoff\n- Claim: released\n- Claim: HELD. Review pending.").released).toBe(false);
    });

    it("reads no field from above its header or under a later heading", () => {
      const body = ["### Notes", "- Exact next action: stale", "- Outcome: stale", "", ...OWN, "", "### Next", "- Verification: elsewhere"];
      expect(parseHandoff(body.join("\n"))).toMatchObject({
        outcome: "review requested",
        nextAction: "independent review",
        verification: null,
        released: false,
      });
    });

    it("still reads the rendered template as a release, with a section or a rule after it", () => {
      const body = renderHandoff({ outcome: "merged", nextAction: "none", claim: "released" });
      expect(parseHandoff(body)).toMatchObject({ outcome: "merged", nextAction: "none", released: true });
      expect(parseHandoff([body, "", "### Notes", "- Claim: HELD. Another lane's."].join("\n")).released).toBe(true);
      expect(parseHandoff([body, "---", "Posted by the lane."].join("\n")).released).toBe(true);
      expect(threadLease([CLAIM, at("2026-09-10T07:52:00Z", body)]).claim).toBeNull();
    });

    // GitHub reads each underline here as a rule, or as the heading of another item, so the Claim line
    // stays the Handoff's own.
    it("still releases when an underline below its Claim line is a rule, or takes another item", () => {
      const claim = [...OWN, "- Claim: released"];
      expect(parseHandoff([...claim, " ---"].join("\n")).released).toBe(true);
      expect(parseHandoff([...claim, "", "  ---"].join("\n")).released).toBe(true);
      expect(parseHandoff([...claim, "  ***"].join("\n")).released).toBe(true);
      expect(parseHandoff(["### Handoff", "- Claim: released", "- Outcome: review requested", "  ---"].join("\n")).released).toBe(true);
    });
  });
});

describe("the gh plan pins the field quirks that cost real time", () => {
  const plan = planPostClaim({ issue: 18, ids: IDS, facts: FACTS, verdict: PASS }).map((s) => s.argv.join(" "));

  it("sets the five minimum fields plus Status", () => {
    expect(plan.join("\n")).toContain("F_lane");
    expect(plan.join("\n")).toContain("F_wt");
    expect(plan.join("\n")).toContain("F_next");
    expect(plan.join("\n")).toContain("F_exp");
    expect(plan.join("\n")).toContain("F_ver");
    expect(plan.join("\n")).toContain("o_active");
  });

  it("writes date fields with --date, never --text", () => {
    for (const step of plan) {
      if (step.includes("F_exp") || step.includes("F_ver")) {
        expect(step).toMatch(/--date /);
        expect(step).not.toMatch(/--text /);
      }
    }
  });

  it("writes the worktree field in canonical form", () => {
    expect(plan.join("\n")).toContain(`${FOLDER} @ ${BRANCH}`);
  });

  it("posts the claim comment before editing fields, so a half-run still leaves evidence", () => {
    const full = planPostClaim({ issue: 18, ids: IDS, facts: FACTS, verdict: PASS });
    expect(full[0].argv.slice(0, 2)).toEqual(["issue", "comment"]);
  });
});

// ── releasing a lease (#643) ─────────────────────────────────────
//
// The thread is the incident's: the predecessor claims, releases, and the successor claims. Every
// release below goes through `attempt`, which hands postRelease a recorder in place of `gh`, so a test
// can say what WOULD have been sent and nothing here can reach GitHub. The issue number names no issue.

const ISSUE = 999_637;
const HOLDER = { folder: "C:\\lanes\\successor", branch: "claude/successor" };
const PREDECESSOR = { folder: "C:\\lanes\\predecessor", branch: "claude/predecessor" };
const NOW = new Date("2026-10-03T05:30:25Z");
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

const posted = (createdAt, body, n) => ({ createdAt, body, url: `https://github.com/Pootytxng/sentinel/issues/${ISSUE}#issuecomment-${n}` });
/** A claim as `renderClaim` writes it for a seat; `drop` removes whole lines by label. */
const claimText = (seat, { drop = [], ...facts } = {}) =>
  renderClaim({ ...FACTS, folder: seat.folder, branch: seat.branch, expires: "2026-10-03T17:22:01Z", verdict: PASS, ...facts })
    .split("\n")
    .filter((l) => !drop.some((label) => l.startsWith(`- ${label}:`)))
    .join("\n");
const RELEASED = renderHandoff({ outcome: "done", nextAction: "Kuya reviews.", claim: "released" });

const A_CLAIM = posted("2026-10-03T03:10:00Z", claimText(PREDECESSOR, { expires: "2026-10-03T15:10:00Z" }), 1);
const A_RELEASE = posted("2026-10-03T05:21:02Z", RELEASED, 2);
const B_CLAIM = posted("2026-10-03T05:22:01Z", claimText(HOLDER), 3);
const INCIDENT = [A_CLAIM, A_RELEASE, B_CLAIM];
/** A thread holding one live claim, posted at the successor's time. */
const claimedBy = (seat = HOLDER, opts = {}) => [posted("2026-10-03T05:22:01Z", claimText(seat, opts), 3)];
/** The successor's claim, a day old and past its own expiry. */
const lapsedClaim = (opts = {}) => [posted("2026-10-02T00:00:00Z", claimText(HOLDER, { expires: "2026-10-02T12:00:00Z", ...opts }), 4)];
const LAPSED = lapsedClaim();

const tmp = mkdtempSync(join(tmpdir(), "compy-release-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** In place of `gh`: records each step it is handed, and fails the step at `failAt` the way gh does. */
const recorder = (failAt = null) => {
  const sent = [];
  const exec = (plan, { dryRun = false } = {}) =>
    plan.map((step) => {
      if (dryRun) return { ...step, ran: false };
      if (sent.length === failAt) {
        throw Object.assign(new Error(`Command failed: gh ${step.argv.join(" ")}`), { stderr: "GraphQL: Could not resolve to a ProjectV2Item\nsecond line\n" });
      }
      sent.push(step);
      return { ...step, ran: true };
    });
  return { sent, exec };
};

/** One release through the guard: what it returned or threw, and every step that was sent. */
const attempt = ({ thread = INCIDENT, self = HOLDER, body = RELEASED, failAt = null, ...rest } = {}) => {
  const { sent, exec } = recorder(failAt);
  try {
    const result = postRelease({ issue: ISSUE, self, ids: IDS, body, read: () => thread, now: NOW, exec, cacheDir: tmp, ...rest });
    return { result, error: null, sent };
  } catch (error) {
    return { result: null, error, sent };
  }
};

/** Refused with this code, and NOTHING was sent: no comment, no board edit. */
const refused = (code, opts) => {
  const { result, error, sent } = attempt(opts);
  expect(result, "the release was not refused").toBeNull();
  expect(error?.code, String(error?.stack ?? error)).toBe(code);
  expect(sent.map((s) => s.describe)).toEqual([]);
  return error;
};

/** Allowed: the whole plan was sent in order, the comment first. Returns the comment's text too. */
const allowed = (opts, via = "holder") => {
  const { result, error, sent } = attempt(opts);
  expect(error, String(error?.stack ?? error)).toBeNull();
  expect(result.via).toBe(via);
  expect(sent.map((s) => s.describe)).toEqual(result.plan.map((s) => s.describe));
  expect(sent[0].argv.slice(0, 3)).toEqual(["issue", "comment", String(ISSUE)]);
  return { result, sent, body: sent[0].argv.at(-1) };
};

describe("postRelease: only the folder and branch the live claim names may end it (#643)", () => {
  it("lets the holder release: the comment, then the board row", () => {
    const { result, sent, body } = allowed();
    expect(body).toBe(RELEASED);
    expect(result.claim.url).toBe(B_CLAIM.url);
    expect(sent.map((s) => s.describe)).toEqual([`comment on #${ISSUE}`, "set F_status=Review", "set F_gate=None", "set F_next", "clear F_exp"]);
  });

  it.each([
    ["prose after the branch", { branch: `${HOLDER.branch} (cut from origin/main at 1780fef1)` }],
    ["the branch in a code span, then prose", { branch: `\`${HOLDER.branch}\`, cut from origin/main` }],
    ["a comma after the branch", { branch: `${HOLDER.branch}, cut from origin/main` }],
    ["the folder in a code span, then prose", { folder: `\`${HOLDER.folder}\` (created fresh by the launcher)` }],
    ["both in code spans", { folder: `\`${HOLDER.folder}\``, branch: `\`${HOLDER.branch}\`` }],
  ])("reads the holder out of a claim written with %s", (_, facts) => {
    allowed({ thread: claimedBy(HOLDER, facts) });
  });

  it.each(["c:/lanes/successor", "C:\\lanes\\successor\\", "C:\\LANES\\Successor"])("knows its own folder spelled %j", (folder) => {
    allowed({ self: { ...HOLDER, folder } });
  });

  it("refuses the incident: a predecessor releasing after its successor claimed", () => {
    const error = refused("RELEASE_NOT_HOLDER", { self: PREDECESSOR });
    expect(error.message).toContain(B_CLAIM.url);
    expect(error.message).toContain(`${HOLDER.folder} @ ${HOLDER.branch}`);
    expect(error.message).toContain("2026-10-03T05:22:01Z");
    expect(error.message).toContain(PREDECESSOR.folder);
    expect(error.claim.url).toBe(B_CLAIM.url);
  });

  it.each([
    ["another folder on a branch of the same name", { folder: PREDECESSOR.folder, branch: HOLDER.branch }],
    ["a folder whose path only starts the same", { ...HOLDER, folder: `${HOLDER.folder}-2` }],
    ["the folder above it", { ...HOLDER, folder: "C:\\lanes" }],
    ["a folder inside it", { ...HOLDER, folder: `${HOLDER.folder}\\tools` }],
  ])("refuses %s", (_, self) => {
    refused("RELEASE_NOT_HOLDER", { self });
  });

  it.each([PREDECESSOR.branch, `${HOLDER.branch}-2`, "claude/success", "main"])("refuses the holding folder on another branch (%s)", (branch) => {
    const error = refused("RELEASE_BRANCH_MISMATCH", { self: { ...HOLDER, branch } });
    expect(error.message).toContain(B_CLAIM.url);
  });

  it.each([null, undefined, "", "  "])("refuses the holding folder on no branch (%j)", (branch) => {
    const error = refused("RELEASE_SELF_UNKNOWN", { self: { folder: HOLDER.folder, branch } });
    expect(error.message).toMatch(/on no branch/);
  });

  it.each([null, {}, { folder: null }, { folder: "  " }, { branch: HOLDER.branch }])("refuses a caller whose own folder was not measured (%j)", (self) => {
    const error = refused("RELEASE_SELF_UNKNOWN", { self });
    expect(error.message).toMatch(/could not be measured/);
  });

  it("refuses a caller that says nothing of itself", () => {
    expect(releaseDecision({ issue: ISSUE, comments: INCIDENT, self: undefined, now: NOW })).toMatchObject({ ok: false, code: "RELEASE_SELF_UNKNOWN" });
  });

  it.each([
    ["no folder line", { drop: ["Worktree folder"] }],
    ["no branch line", { drop: ["Branch"] }],
    ["neither line", { drop: ["Worktree folder", "Branch"] }],
    ["an empty folder", { folder: "" }],
    ["an empty branch", { branch: "" }],
  ])("refuses everyone when the live claim has %s: nobody can be shown to hold it", (_, opts) => {
    for (const self of [HOLDER, PREDECESSOR]) {
      const error = refused("RELEASE_HOLDER_UNKNOWN", { thread: claimedBy(HOLDER, opts), self });
      expect(error.message).toMatch(/does not name/);
    }
  });

  it("refuses a second release, and names the first", () => {
    for (const self of [PREDECESSOR, HOLDER]) {
      const error = refused("RELEASE_NO_LIVE_CLAIM", { thread: [A_CLAIM, A_RELEASE], self });
      expect(error.message).toContain(A_RELEASE.url);
      expect(error.message).toContain("2026-10-03T05:21:02Z");
    }
  });

  it("does not let a takeover reason open a thread that has no lease", () => {
    refused("RELEASE_NO_LIVE_CLAIM", { thread: [A_CLAIM, A_RELEASE], self: PREDECESSOR, takeover: "the folder is gone", liveness: () => "dead" });
  });

  it.each([
    ["an empty thread", []],
    ["a note that only mentions a claim", [posted("2026-10-03T05:00:00Z", "I will post a `### Ownership claim` once the preflight passes.", 5)]],
  ])("refuses a thread nobody claimed: %s", (_, thread) => {
    const error = refused("RELEASE_NO_LIVE_CLAIM", { thread });
    expect(error.message).toMatch(/no Ownership claim is in force/);
  });

  it.each([
    ["no reader", null],
    ["a reader that throws", () => { throw new Error("gh: HTTP 502"); }],
    ["a reader that answers null", () => null],
    ["a reader that answers nothing", () => undefined],
    ["a reader that answers an object", () => ({ comments: INCIDENT })],
    ["a reader that answers text", () => JSON.stringify(INCIDENT)],
  ])("refuses when the thread was not read: %s", (_, read) => {
    const error = refused("RELEASE_THREAD_UNREADABLE", { read });
    expect(error.message).toMatch(/An unknown lease is not the caller's lease/);
  });

  it("reads the thread itself, once, and takes no lease the caller brought", () => {
    const lease = threadLease(INCIDENT);
    refused("RELEASE_THREAD_UNREADABLE", { read: null, comments: INCIDENT, lease, claim: lease.claim });
    const asked = [];
    allowed({ read: (...args) => { asked.push(args); return INCIDENT; } });
    expect(asked).toEqual([[ISSUE]]);
  });
});

describe("postRelease: a takeover is asked for, measured and recorded (#643)", () => {
  const REASON = "worktree removed on 2026-10-02; no claude.exe has it open; its transcript is cold";
  const dead = () => "dead";
  const UNMEASURED = [
    ["no session record", () => "none"],
    ["a record that cannot be read", () => "unknown"],
    ["an answer outside the vocabulary", () => "probably dead"],
    ["no answer", () => undefined],
    ["a probe that throws", () => { throw new Error("EPERM"); }],
    ["no probe", null],
    ["a word where a probe belongs", "dead"],
  ];

  it.each([undefined, null, false])("is never implied (takeover: %j): a dead holder on an expired claim is still not the caller's lease", (takeover) => {
    refused("RELEASE_NOT_HOLDER", { thread: LAPSED, self: PREDECESSOR, liveness: dead, takeover });
  });

  it.each(["", "  \n\t ", true, {}, { reason: " " }])("refuses a takeover that gives no reason (%j)", (takeover) => {
    refused("RELEASE_TAKEOVER_NO_REASON", { thread: LAPSED, self: PREDECESSOR, liveness: dead, takeover });
  });

  it("refuses the holder asking for one, so the flag cannot become the habit", () => {
    refused("RELEASE_TAKEOVER_NOT_NEEDED", { thread: LAPSED, self: HOLDER, takeover: REASON, liveness: dead });
  });

  it.each([
    ["an expired claim", LAPSED],
    ["an unexpired claim", INCIDENT],
  ])("never takes over a live holder on %s", (_, thread) => {
    const error = refused("RELEASE_HOLDER_LIVE", { thread, self: PREDECESSOR, takeover: REASON, liveness: () => "live" });
    expect(error.message).toContain(thread.at(-1).url);
  });

  it("takes over a dead holder before its clock runs out, and says both", () => {
    const { body } = allowed({ self: PREDECESSOR, takeover: REASON, liveness: dead }, "takeover");
    expect(body).toContain("the holding session is dead");
    expect(body).toContain("the claim's clock had not run out");
  });

  it.each(UNMEASURED)("with %s, a reason does not end a lease whose own clock is running", (_, liveness) => {
    const error = refused("RELEASE_LEASE_NOT_LAPSED", { self: PREDECESSOR, takeover: REASON, liveness });
    expect(error.message).toContain("2026-10-03T17:22:01.000Z");
    expect(error.message).toContain(B_CLAIM.url);
  });

  it.each(UNMEASURED)("with %s, takes over once the claim's own clock has run out", (_, liveness) => {
    const { body } = allowed({ thread: LAPSED, self: PREDECESSOR, takeover: REASON, liveness }, "takeover");
    expect(body).toContain("the claim's clock ran out at 2026-10-02T12:00:00.000Z (its Claim expires line)");
  });

  it("gives a claim with no expiry line the documented 12 hours, to the second", () => {
    const ask = { thread: claimedBy(HOLDER, { drop: ["Claim expires"] }), self: PREDECESSOR, takeover: REASON, liveness: () => "none" };
    refused("RELEASE_LEASE_NOT_LAPSED", { ...ask, now: new Date("2026-10-03T17:22:00Z") });
    const { body } = allowed({ ...ask, now: new Date("2026-10-03T17:22:01Z") }, "takeover");
    expect(body).toContain("the claim's clock ran out at 2026-10-03T17:22:01.000Z (the 12-hour default)");
  });

  it("never lets a clock it cannot read run out, and still takes over a dead holder", () => {
    const ask = { thread: claimedBy(HOLDER, { expires: "when the review lands" }), self: PREDECESSOR, takeover: REASON, now: new Date("2027-10-03T00:00:00Z") };
    const error = refused("RELEASE_LEASE_NOT_LAPSED", { ...ask, liveness: () => "none" });
    expect(error.message).toMatch(/clock cannot be read/);
    allowed({ ...ask, liveness: dead }, "takeover");
  });

  it("asks the probe about the folder the claim names, and nothing else", () => {
    const asked = [];
    const liveness = (...args) => {
      asked.push(args);
      return "dead";
    };
    allowed({ thread: claimedBy(HOLDER, { folder: `\`${HOLDER.folder}\` (created fresh by the launcher)` }), self: PREDECESSOR, takeover: REASON, liveness }, "takeover");
    expect(asked).toEqual([[HOLDER.folder]]);
  });

  it("does not measure its own folder: a claim naming it on another branch lapses by its clock alone", () => {
    const self = { folder: HOLDER.folder, branch: "claude/next-lane" };
    const asked = [];
    const probe = (answer) => (folder) => {
      asked.push(folder);
      return answer;
    };
    refused("RELEASE_LEASE_NOT_LAPSED", { self, takeover: REASON, liveness: probe("dead") });
    const { body } = allowed({ thread: LAPSED, self, takeover: REASON, liveness: probe("live") }, "takeover");
    expect(body).toContain("there is no other session to measure");
    expect(asked).toEqual([]);
  });

  it("does not measure a claim that names no folder: it lapses by its clock alone", () => {
    const asked = [];
    const liveness = (folder) => {
      asked.push(folder);
      return "dead";
    };
    const drop = ["Worktree folder"];
    refused("RELEASE_LEASE_NOT_LAPSED", { thread: claimedBy(HOLDER, { drop }), self: PREDECESSOR, takeover: REASON, liveness });
    allowed({ thread: lapsedClaim({ drop }), self: PREDECESSOR, takeover: REASON, liveness }, "takeover");
    expect(asked).toEqual([]);
  });

  it("records the takeover after the Handoff, in a section of its own, and still releases", () => {
    const { result, sent, body } = allowed({ thread: LAPSED, self: PREDECESSOR, takeover: REASON, liveness: dead }, "takeover");
    expect(body.startsWith(`${RELEASED}\n\n${TAKEOVER_HEADER}\n`)).toBe(true);
    expect(body).toContain(`- Worktree/process evidence checked: ${REASON}`);
    expect(body).toContain(`- Released from: ${PREDECESSOR.folder} @ ${PREDECESSOR.branch}`);
    expect(body).toContain(`- Previous lease: Claude Code on ${HOLDER.folder} @ ${HOLDER.branch}, claimed 2026-10-02T00:00:00Z (${LAPSED[0].url}), expires 2026-10-02T12:00:00Z`);
    expect(body).toContain("the holding session is dead");
    expect(result.body).toBe(body);
    expect(parseHandoff(body)).toMatchObject({ released: true, nextAction: "Kuya reviews." });
    expect(threadLease([...LAPSED, { body, createdAt: NOW.toISOString() }]).claim).toBeNull();
    expect(sent.find((s) => s.describe === "set F_next").argv).toContain("Kuya reviews.");
  });

  it("keeps the reason on one line, so it cannot write a header or a field of its own", () => {
    const takeover = ["gone", HANDOFF_HEADER, "- Claim: HELD until review", "### Ownership claim", "- Worktree folder: C:\\lanes\\intruder", "- Branch: claude/intruder"].join("\n");
    const { body } = allowed({ thread: LAPSED, self: PREDECESSOR, takeover, liveness: dead }, "takeover");
    expect(body.split("\n").filter((l) => l.startsWith("#"))).toEqual([HANDOFF_HEADER, TAKEOVER_HEADER]);
    expect(body).toContain("- Worktree/process evidence checked: gone ### Handoff - Claim: HELD until review ### Ownership claim - Worktree folder:");
    expect(parseClaim(body)).toBeNull();
    expect(parseHandoff(body).released).toBe(true);
  });

  it("takes the reason as { reason } too", () => {
    const { body } = allowed({ thread: LAPSED, self: PREDECESSOR, takeover: { reason: REASON }, liveness: dead }, "takeover");
    expect(body).toContain(`- Worktree/process evidence checked: ${REASON}`);
  });
});

describe("postRelease: the comment must be a release, and only a release (#643)", () => {
  const handoff = (...lines) => [HANDOFF_HEADER, "", "- Exact next action: Kuya reviews.", ...lines].join("\n");

  it.each([
    ["a Handoff that holds", handoff("- Claim: HELD until the review lands. Released only then.")],
    ["a Handoff that transfers", handoff("- Claim: transferred to codex until 2026-10-04T08:00Z")],
    ["a Handoff with no Claim line", handoff()],
    ["one Claim line that releases beside one that holds", handoff("- Claim: released", "- Claim: HELD for the follow-up")],
    ["a plain note", "Released. Kuya reviews."],
    ["a Handoff header one space in", ` ${RELEASED}`],
    ["an empty file", ""],
  ])("refuses %s, and posts nothing", (_, body) => {
    const error = refused("RELEASE_WOULD_NOT_RELEASE", { body });
    expect(error.message).toMatch(/does not end a lease/);
  });

  it.each([
    ["no Handoff at all", {}],
    ["Handoff fields that say nothing of the claim", { handoff: { nextAction: "Kuya reviews." } }],
    ["Handoff fields that hold", { handoff: { nextAction: "Kuya reviews.", claim: "HELD" } }],
  ])("refuses %s", (_, opts) => {
    refused("RELEASE_WOULD_NOT_RELEASE", { body: null, ...opts });
  });

  it("refuses a comment that releases and claims at once", () => {
    const error = refused("RELEASE_WOULD_NOT_RELEASE", { body: `${RELEASED}\n\n${claimText(PREDECESSOR)}` });
    expect(error.message).toMatch(/carries an Ownership claim/);
  });

  it("renders the Handoff from its fields when it is handed fields", () => {
    const fields = { outcome: "done", nextAction: "Kuya reviews.", claim: "released" };
    expect(allowed({ body: null, handoff: fields }).body).toBe(renderHandoff(fields));
  });
});

describe("release", () => {
  // The plan is not exported (#643): it is read off the guarded release, as a dry run by the holder.
  const planned = (handoff = { outcome: "done", nextAction: "Kuya reviews.", claim: "released" }) =>
    attempt({ thread: claimedBy(), body: null, handoff, status: "Needs Kuya", gate: "Kuya", lastVerified: "2026-07-30", dryRun: true }).result.plan.map((s) =>
      s.argv.join(" "),
    );

  it("clears the expiry with --clear, because an empty --text is not empty", () => {
    const step = planned().find((s) => s.includes("F_exp"));
    expect(step).toMatch(/--clear/);
  });

  it("sets Last verified as a date", () => {
    expect(planned().find((s) => s.includes("F_ver"))).toMatch(/--date 2026-07-30/);
  });

  it("moves Status and Gate to what the handoff declares, not to a default", () => {
    expect(planned().join("\n")).toContain("o_needs");
    expect(planned().join("\n")).toContain("o_kuya");
  });

  it("posts the handoff comment first — the durable record precedes the index", () => {
    expect(planned()[0]).toMatch(/^issue comment/);
  });

  it("sets Next action to the handoff's exact next action, so guard 7 passes by construction", () => {
    const step = planned().find((s) => s.includes("F_next"));
    expect(step).toContain("Kuya reviews.");
  });

  it.each([undefined, "", "   "])("clears Next action when the handoff names none (%j), because an empty --text is not empty", (nextAction) => {
    const step = planned({ outcome: "done", nextAction, claim: "released" }).find((s) => s.includes("F_next"));
    expect(step).toMatch(/--clear/);
    expect(step).not.toMatch(/--text/);
  });
});

describe("postRelease: what a run leaves behind (#643)", () => {
  const seed = () => writeClaimCache({ issue: ISSUE, scopeText: "`tools/entry/claim.mjs`", folder: HOLDER.folder, branch: HOLDER.branch }, { dir: tmp });
  const cached = () => readClaimCache({ issue: ISSUE, dir: tmp });

  it("a dry run sends nothing and forgets nothing", () => {
    seed();
    const { result, error, sent } = attempt({ dryRun: true });
    expect(error).toBeNull();
    expect(sent).toEqual([]);
    expect(result.ran.map((s) => s.ran)).toEqual([false, false, false, false, false]);
    expect(cached()).not.toBeNull();
  });

  it("a refusal forgets nothing", () => {
    seed();
    refused("RELEASE_NOT_HOLDER", { self: PREDECESSOR });
    expect(cached()).not.toBeNull();
  });

  it("a release drops the local copy of the scope the lease declared", () => {
    seed();
    allowed();
    expect(cached()).toBeNull();
  });

  it("says what is left when gh fails after the comment: the lease is released and the row is not finished", () => {
    seed();
    const { result, error, sent } = attempt({ failAt: 2, lastVerified: "2026-10-03" });
    expect(result).toBeNull();
    expect(error.code).toBe("RELEASE_HALF_RUN");
    expect(sent.map((s) => s.describe)).toEqual([`comment on #${ISSUE}`, "set F_status=Review"]);
    expect(error.ran.map((s) => s.describe)).toEqual(sent.map((s) => s.describe));
    expect(error.remaining.map((s) => s.describe)).toEqual(["set F_gate=None", "set F_next", "clear F_exp", "set F_ver"]);
    expect(error.message).toContain("GraphQL: Could not resolve to a ProjectV2Item");
    expect(error.message).not.toContain("Command failed");
    expect(error.message).not.toContain("second line");
    expect(cached()).toBeNull();
  });

  it("says the comment never went when gh fails on it, and edits no board field", () => {
    seed();
    const error = refused("RELEASE_POST_FAILED", { failAt: 0 });
    expect(error.message).toMatch(/No board field was edited/);
    expect(error.message).toContain("GraphQL: Could not resolve to a ProjectV2Item");
    expect(error.message).not.toContain("Command failed");
    expect(cached()).not.toBeNull();
  });
});

describe("there is no unguarded way to release (#643)", () => {
  const sources = (dir) =>
    readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(rel);
      return /\.(?:mjs|cjs|js|ts)$/.test(entry.name) && !/\.test\.[a-z]+$/.test(entry.name) ? [rel] : [];
    });

  it("claim.mjs exports the guarded release, and not the plan it runs", () => {
    const names = Object.keys(claimModule);
    expect(names).toContain("postRelease");
    expect(names).toContain("releaseDecision");
    expect(names).not.toContain("planRelease");
  });

  it("no other program builds a release plan", () => {
    const files = [...sources("tools/entry"), ...sources("scripts"), ...sources(".claude/hooks")];
    expect(files.length).toBeGreaterThan(60);
    expect(files.filter((f) => readFileSync(join(ROOT, f), "utf8").includes("planRelease"))).toEqual(["tools/entry/claim.mjs"]);
  });

  it("the gate's live-lease blocker names the command", () => {
    const { blockers } = evaluateWorkControl(
      { transition: "close-issue", issue: ISSUE },
      {
        resolveHead: () => null,
        headProvenance: () => ({ ok: true, why: "not under test" }),
        issueComments: () => claimedBy(),
        closingIssues: () => [],
      },
    );
    const lease = blockers.filter((b) => b.includes("still has a live lease"));
    expect(lease).toHaveLength(1);
    expect(lease[0]).toContain(`node tools/entry/release.mjs --issue ${ISSUE} --handoff <file>`);
  });

  it("docs/WORK_CONTROL.md points the release step at the command", () => {
    expect(readFileSync(join(ROOT, "docs/WORK_CONTROL.md"), "utf8")).toContain("node tools/entry/release.mjs --issue N --handoff <file>");
  });
});

describe("release.mjs: the command (#643)", () => {
  const ARGS = ["--issue", String(ISSUE), "--handoff", "handoff.md"];
  const BOARD = { reachable: true, items: [{ number: ISSUE, itemId: "PVTI_x" }], error: null };
  const gone = () => {
    throw new Error("gh: HTTP 502");
  };

  /** The command with EVERY seam supplied, so no test here can reach gh, git or the real caches. */
  const runCli = (argv, { thread = INCIDENT, seat = HOLDER, handoffText = RELEASED, failAt = null, ...seams } = {}) => {
    const { sent, exec } = recorder(failAt);
    const out = [];
    const errs = [];
    let dropped = 0;
    const exit = cmdRelease(argv, {
      seat: () => seat,
      board: () => BOARD,
      projectIds: () => IDS,
      read: () => thread,
      liveness: () => "none",
      file: () => handoffText,
      dropBoardCache: () => {
        dropped += 1;
      },
      exec,
      cacheDir: tmp,
      now: NOW,
      log: (s) => out.push(String(s)),
      err: (s) => errs.push(String(s)),
      ...seams,
    });
    return { exit, sent, out: out.join("\n"), err: errs.join("\n"), dropped };
  };

  it.each([
    ["no --issue", ["--handoff", "h.md"], /--issue N is required/],
    ["no --handoff", ["--issue", "5"], /--handoff <file> is required/],
    ["an argument it does not know", [...ARGS, "--force"], /unknown argument "--force"/],
    ["a misspelt --dry-run", [...ARGS, "--dryrun"], /unknown argument "--dryrun"/],
    ["a stray word", [...ARGS, "now"], /unknown argument "now"/],
    ["--folder", [...ARGS, "--folder", HOLDER.folder], /--folder is not an argument/],
    ["a flag given twice", [...ARGS, "--issue", "6"], /--issue is given twice/],
    ["a switch given twice", [...ARGS, "--dry-run", "--dry-run"], /--dry-run is given twice/],
    ["a flag with no value", ["--issue", String(ISSUE), "--handoff"], /--handoff needs a value/],
    ["a flag whose value is a flag", ["--issue", String(ISSUE), "--handoff", "--dry-run"], /--handoff needs a value/],
    ["an issue that is not a number", ["--issue", "abc", "--handoff", "h.md"], /takes an issue number, not "abc"/],
    ["issue 0", ["--issue", "0", "--handoff", "h.md"], /takes an issue number, not "0"/],
    ["an issue number with a tail", ["--issue", "12x", "--handoff", "h.md"], /takes an issue number, not "12x"/],
  ])("exits 2 on %s, and runs nothing", (_, argv, said) => {
    const { exit, sent, err, dropped } = runCli(argv);
    expect(exit).toBe(2);
    expect(err).toMatch(said);
    expect(err).toContain("node tools/entry/release.mjs --issue N --handoff <file>");
    expect(sent).toEqual([]);
    expect(dropped).toBe(0);
  });

  it("parses what it is given, and keeps an empty --takeover apart from none", () => {
    expect(parseArgs(ARGS)).toEqual({ issue: ISSUE, handoff: "handoff.md", status: "Review", gate: "None", takeover: null, dryRun: false, asJson: false });
    expect(parseArgs([...ARGS, "--status", "Needs Kuya", "--gate", "Kuya", "--takeover", "", "--dry-run", "--json"])).toEqual({
      issue: ISSUE,
      handoff: "handoff.md",
      status: "Needs Kuya",
      gate: "Kuya",
      takeover: "",
      dryRun: true,
      asJson: true,
    });
  });

  it.each([
    [["--status", "Reveiw"], /--status "Reveiw" is not an option on the board\. It has: Active, Needs Kuya, Review\./],
    [["--gate", "none"], /--gate "none" is not an option on the board\. It has: None, Kuya\./],
  ])("exits 2 on %j: a misspelt option would end the lease and leave the row as it was", (extra, said) => {
    const { exit, sent, err } = runCli([...ARGS, ...extra]);
    expect(exit).toBe(2);
    expect(err).toMatch(said);
    expect(sent).toEqual([]);
  });

  it("exits 2 when the Handoff file cannot be read", () => {
    const file = () => {
      throw new Error("ENOENT: no such file or directory, open 'handoff.md'");
    };
    const { exit, sent, err } = runCli(ARGS, { file });
    expect(exit).toBe(2);
    expect(err).toMatch(/--handoff handoff\.md could not be read: ENOENT/);
    expect(sent).toEqual([]);
  });

  it.each([
    ["the board cannot be reached", { board: () => ({ reachable: false, items: [], error: "gh: HTTP 502" }) }, "RELEASE_BOARD_UNREADABLE"],
    ["the board's field ids cannot be read", { projectIds: gone }, "RELEASE_BOARD_UNREADABLE"],
    ["the issue has no row on the board", { board: () => ({ reachable: true, items: [{ number: 12, itemId: "PVTI_other" }], error: null }) }, "RELEASE_NO_BOARD_ROW"],
    ["the thread cannot be read", { read: gone }, "RELEASE_THREAD_UNREADABLE"],
    ["the caller is not the holder (the incident)", { seat: PREDECESSOR }, "RELEASE_NOT_HOLDER"],
    ["the holding folder is on another branch", { seat: { ...HOLDER, branch: "main" } }, "RELEASE_BRANCH_MISMATCH"],
    ["the lease was already released", { thread: [A_CLAIM, A_RELEASE] }, "RELEASE_NO_LIVE_CLAIM"],
    ["the Handoff does not release", { handoffText: "### Handoff\n\n- Claim: HELD" }, "RELEASE_WOULD_NOT_RELEASE"],
  ])("exits 1 and writes nothing when %s", (_, seams, code) => {
    const { exit, sent, err, dropped } = runCli(ARGS, seams);
    expect(exit).toBe(1);
    expect(err).toContain(`REFUSE — ${code}`);
    expect(err).toContain("Nothing was written.");
    expect(sent).toEqual([]);
    expect(dropped).toBe(0);
  });

  it("links the live claim when it refuses the incident", () => {
    const { err } = runCli(ARGS, { seat: PREDECESSOR });
    expect(err).toContain(B_CLAIM.url);
    expect(err).toContain(`${HOLDER.folder} @ ${HOLDER.branch}`);
  });

  it("a dry run writes nothing, and shows the comment and the board steps in words", () => {
    const { exit, sent, out, dropped } = runCli([...ARGS, "--dry-run"]);
    expect(exit).toBe(0);
    expect(sent).toEqual([]);
    expect(dropped).toBe(0);
    expect(out).toContain("nothing was written");
    expect(out).toContain("- Claim: released");
    for (const words of ["set Status=Review", "set Gate=None", "set Next action = Kuya reviews.", "clear Claim expires", "set Last verified = 2026-10-03"]) {
      expect(out).toContain(words);
    }
  });

  it("a release sends the comment and the board row, then drops the stale copy of the board", () => {
    const { exit, sent, out, dropped } = runCli([...ARGS, "--status", "Needs Kuya", "--gate", "Kuya"]);
    expect(exit).toBe(0);
    expect(sent.map((s) => s.describe)).toEqual([`comment on #${ISSUE}`, "set F_status=Needs Kuya", "set F_gate=Kuya", "set F_next", "clear F_exp", "set F_ver"]);
    expect(sent.at(-1).argv).toContain("2026-10-03");
    expect(dropped).toBe(1);
    expect(out).toContain("lease released");
    expect(out).toContain("6 steps run");
  });

  it("takes over only with --takeover and its reason, measures the holder, and says so", () => {
    const asked = [];
    const seams = {
      thread: LAPSED,
      seat: PREDECESSOR,
      liveness: (...args) => {
        asked.push(args);
        return "dead";
      },
    };
    expect(runCli(ARGS, seams).err).toContain("REFUSE — RELEASE_NOT_HOLDER");
    expect(runCli([...ARGS, "--takeover", ""], seams).err).toContain("REFUSE — RELEASE_TAKEOVER_NO_REASON");
    expect(asked).toEqual([]);
    const { exit, sent, out } = runCli([...ARGS, "--takeover", "worktree removed; no process has it open"], seams);
    expect(exit).toBe(0);
    expect(sent[0].argv.at(-1)).toContain(`\n\n${TAKEOVER_HEADER}\n`);
    expect(sent[0].argv.at(-1)).toContain("- Worktree/process evidence checked: worktree removed; no process has it open");
    expect(out).toContain("by takeover");
    expect(asked).toEqual([[HOLDER.folder, { now: NOW }]]);
  });

  it("never takes over a holder it finds live, whatever the reason and the clock say", () => {
    const { exit, sent, err } = runCli([...ARGS, "--takeover", "it looked idle"], { thread: LAPSED, seat: PREDECESSOR, liveness: () => "live" });
    expect(exit).toBe(1);
    expect(err).toContain("REFUSE — RELEASE_HOLDER_LIVE");
    expect(sent).toEqual([]);
  });

  it("exits 3 when the comment went and the board row did not, and lists what is left to run", () => {
    const { exit, sent, err, dropped } = runCli(ARGS, { failAt: 3 });
    expect(exit).toBe(3);
    expect(sent).toHaveLength(3);
    expect(err).toContain("RELEASED, BOARD ROW INCOMPLETE — RELEASE_HALF_RUN");
    for (const words of ["set Next action = Kuya reviews.", "clear Claim expires", "set Last verified = 2026-10-03"]) expect(err).toContain(words);
    expect(err).toContain('"--clear"');
    expect(err).not.toContain("REFUSE");
    expect(dropped).toBe(1);
  });

  it("exits 1 when the comment itself failed, and does not call it a refusal", () => {
    const { exit, sent, err, dropped } = runCli(ARGS, { failAt: 0 });
    expect(exit).toBe(1);
    expect(err).toContain("FAILED — RELEASE_POST_FAILED");
    expect(err).not.toContain("REFUSE");
    expect(sent).toEqual([]);
    expect(dropped).toBe(0);
  });

  it("posts the Handoff file's text, without its byte-order mark or its carriage returns", () => {
    const { exit, sent } = runCli(ARGS, { handoffText: String.fromCharCode(0xfeff) + RELEASED.replace(/\n/g, "\r\n") });
    expect(exit).toBe(0);
    expect(sent[0].argv.at(-1)).toBe(RELEASED);
  });

  it("--json answers in JSON, for a release and for a refusal", () => {
    const ok = runCli([...ARGS, "--dry-run", "--json"]);
    expect(ok.exit).toBe(0);
    expect(JSON.parse(ok.out)).toMatchObject({ ok: true, issue: ISSUE, via: "holder", dryRun: true, body: RELEASED });
    expect(JSON.parse(ok.out).steps.map((s) => s.ran)).toEqual([false, false, false, false, false, false]);
    const no = runCli([...ARGS, "--json"], { seat: PREDECESSOR });
    expect(no.exit).toBe(1);
    expect(JSON.parse(no.out)).toMatchObject({ ok: false, issue: ISSUE, code: "RELEASE_NOT_HOLDER" });
    expect(no.err).toBe("");
    expect(no.sent).toEqual([]);
  });

  it("does not dress an unexpected failure as a refusal", () => {
    const release = () => {
      throw new TypeError("boom");
    };
    expect(() => runCli(ARGS, { release })).toThrow("boom");
  });

  it("measures its seat as the worktree's top level, from wherever inside it the command runs", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    const seat = measureSeat({ env: {}, cwd: HERE });
    expect(samePath(seat.folder, ROOT)).toBe(true);
    expect(seat.branch).not.toBe("HEAD");
  });
});
