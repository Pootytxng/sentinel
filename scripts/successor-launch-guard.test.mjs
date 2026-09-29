// Guard for #632: a successor prompt launches only as successor-route.mjs prints it, for work that can
// start now. Both sides are tested: the real 2026-09-29 chain prompts are denied, ordinary chips and
// the idle launcher routine pass untouched.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { parseClaim, parseHandoff } from "../tools/entry/claim.mjs";
import { hookOutput, isSuccessorPrompt, ROUTINE_TOOL, SPAWN_TOOL } from "./successor-launch-guard.mjs";
import { SUCCESSOR_PREAMBLE, successorPrompt } from "./successor-route.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = mkdtempSync(join(tmpdir(), "successor-launch-632-"));

// The 10:14Z launch of the #620 chain, verbatim up to its self-re-spawn step (the rest is the task).
// It re-sent the pre-#626 preamble by hand, after #626 had merged. Its bare call is split so the #613
// caller sweep in successor-route.test.mjs does not read this captured history as a live instruction.
const BARE_CALL = ["node scripts/", "successor-route", ".mjs"].join("");
const CHAIN_620 = [
  "You are a Compy successor session, launched by a session that finished its part. This prompt IS the handoff; nobody pasted it. If a routine started you, nobody is watching the run: do not stop to ask questions, stop only at owner-bound steps.",
  "",
  "STEP 0 — check your folder: run `git rev-parse --show-toplevel`. If it prints the shared checkout C:/Users/Kuya/code/sentinel, every write is refused there (the launcher routine's worktree toggle is off). Write nothing: call spawn_task with this whole prompt so the owner gets a one-click worktree session, say that in one line, and stop.",
  "STEP 1 — you inherit no lease. Re-derive state (git, the issue, docs/WORK_CONTROL.md) before trusting anything below, and post your own Ownership claim before any write. Right after it, if `git config --get core.hooksPath` prints an absolute path, repoint your own folder: `git config --worktree core.hooksPath .githooks`. New app worktrees arrive pinned, and the pin reds every lane's push (#405). Anything owner-bound stops at the owner.",
  "STEP 2 — do the task below.",
  `LAST — end by launching your own successor the same way (\`${BARE_CALL}\`; if your own launcher routine is still running, use the other one), or write \`Successor: none — <why>\`.`,
  "",
  "TASK: land issue Pootytxng/sentinel#620, the read-only live probe for `startup-entry:<name>` Trust Ledger rows. Without it, on any PC where the user toggled a startup app through Compy, #611 (as of d302c9d) REFUSES every Trial start (`unverified_start_refusal`) and marks any that concludes inconclusive (`other-change-unverified-at-conclude`). #611's PR body names this residual.",
  "",
  "GATE FIRST: this work waits on PR 611 merging and #583's lease on `src-tauri/src/history.rs` + `src-tauri/src/experiment.rs` releasing. Check with REST (GraphQL is often rate-limited): `gh api repos/Pootytxng/sentinel/pulls/611 --jq '\"\\(.state) \\(.merged) \\(.draft) \\(.head.sha)\"'`, and read #583's latest comments (`gh api \"repos/Pootytxng/sentinel/issues/583/comments?per_page=100\" --jq '.[-3:][] | \"\\(.created_at) \\(.body | split(\"\\n\")[0:2] | join(\" | \"))\"'`). #583 also has a stacked crash-check lane (claim 2026-09-29T02:47:11Z, worktree optimistic-margulis-1fbb86, branch claude/optimistic-margulis-1fbb86) that touches experiment.rs; it must land/release too. Gate history: 02:00Z #611 open DRAFT at 13a4e21; 02:48Z open DRAFT at d302c9d, #583 fresh claim 02:47:11Z for the stacked crash-check PR; 02:51Z still DRAFT at d302c9d, #583 Handoff 02:45:45Z says #611 is code-complete (Codex round 6 PASS, note filed as #628) and waits on the owner's live proof + merge, so the gate is OWNER-BOUND; 02:53Z unchanged; 2026-09-29T06:22Z (session elated-hopper-2490e1) unchanged: #611 open DRAFT at d302c9d, #583's latest comment is still the 02:50:23Z crash-check coordination note (commits rebased onto d302c9d, not pushed, lease held), no release; 2026-09-29T10:13Z (session beautiful-ramanujan-c6bbff) unchanged: #611 open DRAFT at d302c9d, #583's last three comments are still the 02:45:45Z Handoff, the 02:47:11Z crash-check claim and the 02:50:23Z coordination note, no release. If #611 has not landed or #583's lease (either lane) is still held, write `Successor: chip — #611 still open` (re-spawn this same prompt, appending your gate check to the history line) and stop.",
].join("\n");
// The TASK text of the #616 chain (01:59Z), verbatim through its self-re-spawn step, without the
// preamble it was launched with: a hand-written prompt that has neither a preamble nor a Handoff.
const CHAIN_616_TASK = [
  "Land issue Pootytxng/sentinel#616, the rollback-first fix for orphaned applies in `src-tauri/src/history.rs` (★ safety boundary). Read the handoff first: https://github.com/Pootytxng/sentinel/issues/616#issuecomment-5882208975.",
  "",
  "State at handoff (2026-09-29 ~02:00Z):",
  "- The work is two LOCAL, UNPUSHED commits on branch `claude/eloquent-matsumoto-254328`:",
  "  - `8b87e3e3`: the fix.",
  "  - `b83422f7`: review follow-up W1.",
  "  - Both sit on origin/main `7d5df9ba`.",
  "- The branch lives in the shared repo, so any worktree can see it: `git log claude/eloquent-matsumoto-254328`.",
  "- Push was refused by `scripts/lease-overlap-gate.mjs`: #583 (PR #611, lane 2b) holds an earlier live lease on `src-tauri/src/history.rs`.",
  "",
  "Steps:",
  "1. Check #583's thread over REST, because GraphQL is often rate-limited:",
  "   `gh api \"repos/Pootytxng/sentinel/issues/583/comments?per_page=100\" --jq '.[-3:][] | .body[0:400]'`",
  "   If #583 has no `### Handoff` ending `Claim: released` and `node scripts/lease-overlap-gate.mjs` still REFUSES, stop. Write `Successor: chip` with this same prompt, and note in one line that you are still blocked on #583.",
].join("\n");
// Two real ordinary chips from 2026-09-29: the one that asked for this guard, and a UI fix.
const CHIP_632 = [
  "Repo Pootytxng/sentinel (Compy). Read docs/WORK_CONTROL.md first and post an Ownership claim on a new issue before any write (create it with `gh issue create --body-file`).",
  "",
  "Background: PR #626 (issue #613, merged 2026-09-29 as d439a5f5) made `scripts/successor-route.mjs` print the successor prompt only when given `--handoff <file>` holding a `### Handoff` that the lease fold (`threadLease` in tools/entry/claim.mjs) reads as released (`- Claim: released`, with no Ownership claim beside it). The exported `successorPrompt(text)` returns `{ok, prompt}` or `{ok:false, why}`. Known gap, noted on PR #626: a session can skip the script and pass a hand-written prompt straight to `mcp__ccd_session__spawn_task` or `mcp__scheduled-tasks__run_scheduled_task`. That is how #583's handoff reached its successor with no Claim line.",
  "",
  "Task: add a PreToolUse guard that inspects those two tool calls. When the prompt is a Compy successor prompt (it starts with `SUCCESSOR_PREAMBLE` from scripts/successor-route.mjs, or otherwise claims to be a handoff), deny it unless its TASK text passes `successorPrompt`. Ordinary spawn_task chips that are not successor handoffs must pass untouched. Decide carefully how to tell the two apart, and test both sides.",
  "",
  "Constraints:",
  "- Hook entrypoints that gate the assistant's authority are owner-applied. If wiring the hook needs a `.claude/settings.json` or `.claude/hooks/*-assert.mjs` change the classifier refuses, ship a patch plus skipIf-gated tests plus an apply-check test instead of attempting the edit.",
  "- Follow bug→guard: tests under scripts/ or tools/, each falsified by mutation.",
  "- Independent non-author review (Codex CLI: `codex exec -m gpt-5.6-sol -s read-only`), the native pre-push gate, gated receipts via scripts/work-control-gate.mjs, and land through scripts/land-pr.mjs.",
].join("\n");
const CHIP_BENCH = [
  "Compy repo (Pootytxng/sentinel). Observed live on 2026-09-29 by the #453 four-screen proof, on a dev build of main at 7d5df9ba, on the owner's machine. Open the Test room → Benchmark station (LabConsole `stationBody(\"benchmark\")` → `<BenchmarkTab provingGround />`, src/surfaces/Benchmark.tsx) right after switching rooms. For about 14.0 s it renders \"Run benchmark\" and a \"Set latest run as baseline\" button, as if no baseline existed. Then the baseline card (baseline dated 2026-07-23, in %APPDATA%\\Compy\\benchmark.json) and the attribution appear. A baseline existed the whole time.",
  "",
  "Why it matters: during that window the station states something false (no baseline). It also offers a control that overwrites the owner's baseline. That breaks the honest-measurement law (\"unavailable stays unknown, never fabricated\").",
  "",
  "Caveat: the 14 s was measured on a DEBUG dev build (\"dev build is not a perf test\"). The duration may be much shorter on a release build. The wrong-state-while-loading problem is independent of duration.",
  "",
  "Task:",
  "1. Start with STEP 0/1 per docs/WORK_CONTROL.md: an own worktree, an Ownership claim on a new issue (file one with `gh api repos/Pootytxng/sentinel/issues -F title=... -F body=@file`; GraphQL may be rate-limited).",
  "2. Reproduce on a dev build. Find what Benchmark renders before its baseline/latest read resolves.",
  "3. Render an honest loading/unknown state until the read resolves, and never show \"Set latest run as baseline\" before the baseline read has returned.",
  "4. Add a guard test that fails on the old behavior.",
  "5. Self-review through the self-reviewer agent (never inline), then non-author review, then land per docs/WORK_CONTROL.md.",
  "",
  "Never click \"Set latest run as baseline\" on the owner's machine. Stop every compy and free port 1420 before a dev launch, and check that no peer lane's dev build is up first (WORK_CONTROL rule 7).",
].join("\n");
// The launcher routine as the app stores it (C:\Users\Kuya\.claude\scheduled-tasks\compy-successor-a\SKILL.md).
const IDLE_LAUNCHER = [
  "---",
  "name: compy-successor-a",
  "description: Launcher for Compy successor sessions (#466): a finishing session loads its successor's task here and runs it.",
  "---",
  "",
  'Launcher routine for Compy successor sessions (issue #466 in Pootytxng/sentinel). A finishing Compy session replaces this prompt with its successor\'s task right before it runs this routine. If this text is what you were started with, no task was loaded: reply with the one line "no task loaded" and stop. Write nothing.',
  "",
].join("\n");
const FRONTMATTER = IDLE_LAUNCHER.slice(0, IDLE_LAUNCHER.indexOf("---\n\n") + 5);

const released = (next) => ["### Handoff", "- Outcome: x.", `- Exact next action: ${next}`, "- Claim: released"].join("\n");
const STARTABLE = released("non-author review of PR #630.");
// #583's real Exact next action (2026-09-29T02:45:45Z).
const BLOCKED = released("#616 and #617 may rebase onto `d302c9d` now; nothing further lands on #611 before the owner's proof.");
const routed = (handoff) => {
  const built = successorPrompt(handoff);
  expect(built.ok, "the router must accept this Handoff for the test to mean anything").toBe(true);
  return built.prompt;
};

const spawnEvent = (prompt) =>
  JSON.stringify({ hook_event_name: "PreToolUse", tool_name: SPAWN_TOOL, tool_input: { title: "t", tldr: "t", prompt } });
const routineEvent = (taskId) => JSON.stringify({ hook_event_name: "PreToolUse", tool_name: ROUTINE_TOOL, tool_input: { taskId } });
const reason = (out) => {
  expect(out?.hookSpecificOutput?.hookEventName).toBe("PreToolUse");
  expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  return out.hookSpecificOutput.permissionDecisionReason;
};

describe("successor launch guard: spawn_task (#632)", () => {
  it("denies the real #620 chain prompt, a hand-sent copy of the old preamble", () => {
    const why = reason(hookOutput(spawnEvent(CHAIN_620)));
    expect(why).toContain("#632");
    expect(why).toContain("preamble");
    expect(why).toContain("Successor: none");
  });

  it("denies the #616 chain's task text, which has no preamble and no Handoff, for its self-re-spawn step", () => {
    expect(CHAIN_616_TASK).not.toContain("You are a Compy successor session");
    expect(parseHandoff(CHAIN_616_TASK)).toBeNull();
    expect(parseClaim(CHAIN_616_TASK)).toBeNull();
    reason(hookOutput(spawnEvent(CHAIN_616_TASK)));
  });

  it("denies every other way a prompt claims to be a handoff, without the preamble", () => {
    const shapes = {
      handoff: STARTABLE,
      claim: "### Ownership claim\n- Lane: lane:claude-code — #620\n- Write scope: `src-tauri/src/history.rs`",
      "Successor: chip": "Land #620. If #611 is still open, write `Successor: chip` and stop.",
      "Successor: launched": "Land #620, then end with Successor: launched.",
      "re-spawn": "Land #620. If #611 is still open, re-spawn this prompt and stop.",
      marker: "You are a Compy successor session. TASK: land #620.",
      // Codex r2 on 1234d58b: the router's re-spawn wording has to trip the guard too.
      "launch again": "Land #620. If #611 is still open, launch this task again.",
      "run again": "Land #620. If blocked, run this task again.",
      "re-run": "Land #620. If #611 is still open, re-run this prompt.",
      "same prompt": "Land #620, and if blocked, start a new chip with the same prompt.",
      // Codex r3 on 17a33ab4.
      "keep re-running": "Land #620. If blocked, keep re-running this task.",
    };
    for (const [shape, prompt] of Object.entries(shapes)) {
      expect(hookOutput(spawnEvent(prompt)), shape).not.toBeNull();
    }
  });

  it("denies a hand-written prompt even when the Handoff it carries would pass the router", () => {
    for (const prompt of [
      `Successor task for #630.\n\n${STARTABLE}`,
      `${SUCCESSOR_PREAMBLE.slice(0, 400)}\n\nTASK:\n${STARTABLE}`,
      `${SUCCESSOR_PREAMBLE.replace("never re-spawn to recheck a gate", "re-spawn to recheck a gate")}\n${STARTABLE}`,
    ]) {
      expect(reason(hookOutput(spawnEvent(prompt)))).toContain("preamble");
    }
  });

  it("denies the router's own shape around #583's blocked Handoff", () => {
    const why = reason(hookOutput(spawnEvent(`${SUCCESSOR_PREAMBLE}\n${BLOCKED}`)));
    expect(why).toContain("owner");
    expect(why).toContain("Successor: none");
  });

  it("allows exactly what the router prints for work that can start now, with LF or CRLF line ends", () => {
    const prompt = routed(STARTABLE);
    expect(hookOutput(spawnEvent(prompt))).toBeNull();
    expect(hookOutput(spawnEvent(prompt.replace(/\n/g, "\r\n")))).toBeNull();
  });

  it("passes ordinary chips untouched, including ones about successors or a respawned process", () => {
    for (const prompt of [
      CHIP_632,
      CHIP_BENCH,
      "Kill the stale tauri dev process and respawn it on port 1420, then capture the Health room.",
      "Update the successor-route docs: the preamble's LAST step now defaults to `Successor: none`.",
      // Codex r2 on 1234d58b: talking about the loop is not a claim to be part of it.
      'Update the docs to explain why the phrase "this same prompt" caused a loop.',
      "Document why the same prompt kept coming back in the #620 chain.",
      "Run the pre-push gate again, and run it again at --maxWorkers=4 if a test flakes.",
      // Codex r3 on 17a33ab4: a quoted loop phrase is a mention, not an instruction.
      'Update the docs to explain why the phrase "launch this task again" caused a loop.',
      "Document the “re-spawn this prompt” wording the router refuses.",
    ]) {
      expect(isSuccessorPrompt(prompt), prompt.slice(0, 60)).toBe(false);
      expect(hookOutput(spawnEvent(prompt)), prompt.slice(0, 60)).toBeNull();
    }
  });
});

describe("successor launch guard: run_scheduled_task reads the routine's stored prompt (#632)", () => {
  const home = join(T, "home");
  const root = join(T, "store");
  const custom = join(T, "custom", "SKILL.md");
  const fallback = (id) => join(home, ".claude", "scheduled-tasks", id, "SKILL.md");
  const put = (file, text) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  put(join(root, "claude-code-sessions", "org", "project", "scheduled-tasks.json"),
    JSON.stringify({ scheduledTasks: [{ id: "compy-successor-a", enabled: true, filePath: custom }] }));
  const run = (taskId) => hookOutput(routineEvent(taskId), { root, home });

  it("passes the idle launcher routine", () => {
    put(custom, IDLE_LAUNCHER);
    expect(run("compy-successor-a")).toBeNull();
  });

  it("judges the loaded routine's body, frontmatter removed, LF or CRLF", () => {
    put(custom, `${FRONTMATTER}${routed(STARTABLE)}\n`);
    expect(run("compy-successor-a")).toBeNull();
    put(custom, `${FRONTMATTER}${routed(STARTABLE)}\n`.replace(/\n/g, "\r\n"));
    expect(run("compy-successor-a")).toBeNull();
    put(custom, `${FRONTMATTER}${SUCCESSOR_PREAMBLE}\n${BLOCKED}\n`);
    expect(reason(run("compy-successor-a"))).toContain("Successor: none");
    put(custom, `${FRONTMATTER}${CHAIN_620}\n`);
    reason(run("compy-successor-a"));
  });

  it("reads the store's filePath first, then the app's default folder", () => {
    put(custom, IDLE_LAUNCHER);
    put(fallback("compy-successor-a"), `${FRONTMATTER}${CHAIN_620}\n`);
    expect(run("compy-successor-a"), "the store names the file to read").toBeNull();
    put(fallback("compy-successor-b"), `${FRONTMATTER}${CHAIN_620}\n`);
    reason(run("compy-successor-b"));
  });

  it("allows what it cannot judge: a malformed id, a missing file, a malformed event, another tool", () => {
    put(join(home, "escaped", "SKILL.md"), CHAIN_620);
    expect(run("../../escaped"), "an id is a name, never a path").toBeNull();
    expect(run("no-such-routine")).toBeNull();
    expect(run(42)).toBeNull();
    expect(hookOutput("not json")).toBeNull();
    expect(hookOutput(JSON.stringify({ tool_name: SPAWN_TOOL, tool_input: {} }))).toBeNull();
    expect(hookOutput(JSON.stringify({ tool_name: "Bash", tool_input: { command: CHAIN_620, prompt: CHAIN_620 } }))).toBeNull();
  });
});

describe("the owner-applied hook registration (#632 patch)", () => {
  const PATCH = join(REPO, "docs/superpowers/specs/2026-09-29-successor-launch-guard-632.patch");
  const applied = existsSync(join(REPO, ".claude/hooks/successor-launch-guard.mjs"));
  const hookOf = (settings) =>
    settings.hooks.PreToolUse.find((entry) => (entry.hooks ?? []).some((h) => String(h.command).includes("/.claude/hooks/successor-launch-guard.mjs")));
  const runHook = (hook, stdin) => spawnSync(process.execPath, [hook], { input: stdin, encoding: "utf8", windowsHide: true });
  const expectWired = (settings, hook) => {
    expect(String(hookOf(settings)?.matcher).split("|").sort()).toEqual([ROUTINE_TOOL, SPAWN_TOOL].sort());
    const denied = runHook(hook, spawnEvent(CHAIN_620));
    expect(denied.status).toBe(0);
    expect(reason(JSON.parse(denied.stdout))).toContain("#632");
    for (const stdin of [spawnEvent(CHIP_632), spawnEvent(routed(STARTABLE)), "not json"]) {
      const passed = runHook(hook, stdin);
      expect(passed.status).toBe(0);
      expect(passed.stdout).toBe("");
    }
  };

  it("still applies to the tree as it is, and is gone once applied", () => {
    if (applied) {
      expect(existsSync(PATCH), "the patch is spent: delete it in the same commit that applies it").toBe(false);
      return;
    }
    expect(existsSync(PATCH), "the patch this test names must exist").toBe(true);
    expect(() => execFileSync("git", ["apply", "--check", PATCH], { cwd: REPO, stdio: "pipe" })).not.toThrow();
  });

  it.skipIf(applied)("registers a hook for both launch tools that denies the chain and passes a chip, applied to a copy", () => {
    const dir = mkdtempSync(join(tmpdir(), "successor-launch-632-patch-"));
    mkdirSync(join(dir, ".claude"));
    writeFileSync(join(dir, ".claude", "settings.json"), readFileSync(join(REPO, ".claude", "settings.json")));
    execFileSync("git", ["apply", PATCH], { cwd: dir, stdio: "pipe" });
    // The hook imports ../../scripts/successor-launch-guard.mjs; point that at this tree's library.
    mkdirSync(join(dir, "scripts"));
    const library = pathToFileURL(join(REPO, "scripts", "successor-launch-guard.mjs")).href;
    writeFileSync(join(dir, "scripts", "successor-launch-guard.mjs"), `export * from ${JSON.stringify(library)};\n`);
    expectWired(JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf8")), join(dir, ".claude", "hooks", "successor-launch-guard.mjs"));
  });

  describe.skipIf(!applied)("once applied", () => {
    it("the live settings register the live hook for both launch tools, and it denies the chain", () => {
      expectWired(JSON.parse(readFileSync(join(REPO, ".claude", "settings.json"), "utf8")), join(REPO, ".claude", "hooks", "successor-launch-guard.mjs"));
    });
  });
});
