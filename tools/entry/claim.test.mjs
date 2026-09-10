// Guards for the only component that writes to Work Control.
//
// The load-bearing refusal: postClaim throws unless it is handed a PASS verdict. A claim is a
// statement that the invariant holds, so a claim that can be posted without a verdict is a claim
// that can describe a state nobody verified — which is exactly the failure mode #14 exposed.
//
// Every board mutation goes through a PLAN of `gh` invocations, so the field quirks that cost real
// time are pinned here rather than rediscovered: date fields need `--date` (`--text` fails with
// "Did not receive a date value"), and clearing an expiry needs `--clear`.

import { describe, expect, it } from "vitest";
import {
  claimExpiry,
  parseClaim,
  parseHandoff,
  planPostClaim,
  planRelease,
  postClaim,
  renderClaim,
  renderHandoff,
  threadLease,
} from "./claim.mjs";

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

describe("release", () => {
  const plan = planRelease({
    issue: 18,
    ids: IDS,
    handoff: { outcome: "done", nextAction: "Kuya reviews.", claim: "released" },
    status: "Needs Kuya",
    gate: "Kuya",
    lastVerified: "2026-07-30",
  }).map((s) => s.argv.join(" "));

  it("clears the expiry with --clear, because an empty --text is not empty", () => {
    const step = plan.find((s) => s.includes("F_exp"));
    expect(step).toMatch(/--clear/);
  });

  it("sets Last verified as a date", () => {
    expect(plan.find((s) => s.includes("F_ver"))).toMatch(/--date 2026-07-30/);
  });

  it("moves Status and Gate to what the handoff declares, not to a default", () => {
    expect(plan.join("\n")).toContain("o_needs");
    expect(plan.join("\n")).toContain("o_kuya");
  });

  it("posts the handoff comment first — the durable record precedes the index", () => {
    expect(plan[0]).toMatch(/^issue comment/);
  });

  it("sets Next action to the handoff's exact next action, so guard 7 passes by construction", () => {
    const step = plan.find((s) => s.includes("F_next"));
    expect(step).toContain("Kuya reviews.");
  });
});
