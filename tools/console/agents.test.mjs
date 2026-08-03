// Guard: the console can never bill the owner's API account.
//
// This is not a style test. The owner has already been billed ~$20 by accident once, and stated the
// requirement as "i cannot afford anything like that ... not even be optional". So the guards below
// assert the three mechanisms in agents.mjs actually fire, and each one is written so that deleting
// the protection makes it RED — a guard that passes with the fix reverted protects nothing.

import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_FLAGS,
  SUBSCRIPTION_KILL_LIST,
  assertAgentSubscription,
  assertSubscription,
  authArgsFor,
  planAgentSpawn,
  resolveAgent,
  safeEnv,
  threadIdFromAgentEvent,
} from "./agents.mjs";

const FOLDER = "C:\\Users\\Kuya\\code\\sentinel-console";
const exists = (p) => p === FOLDER || String(p).endsWith(".exe");

describe("the child process cannot inherit a way to pay per token", () => {
  it("strips every metered-billing variable from the environment it hands the agent", () => {
    const parent = {
      PATH: "C:\\bin",
      ANTHROPIC_API_KEY: "sk-ant-leaked",
      OPENAI_API_KEY: "sk-openai-leaked",
      CLAUDE_CODE_USE_BEDROCK: "1",
      HOME: "C:\\Users\\Kuya",
    };
    const { env, stripped } = safeEnv(parent);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    // ...while everything the agent legitimately needs survives.
    expect(env.PATH).toBe("C:\\bin");
    expect(env.HOME).toBe("C:\\Users\\Kuya");
    expect(stripped).toEqual(expect.arrayContaining(["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CODE_USE_BEDROCK"]));
  });

  it("reports what it stripped, so the guarantee is visible rather than trusted", () => {
    expect(safeEnv({ ANTHROPIC_API_KEY: "x" }).stripped).toEqual(["ANTHROPIC_API_KEY"]);
    expect(safeEnv({ PATH: "x" }).stripped).toEqual([]);
  });

  it("carries a kill list that covers both vendors and both cloud resellers", () => {
    for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX"]) {
      expect(SUBSCRIPTION_KILL_LIST).toContain(k);
    }
  });

  it("a real spawn plan is built with the stripped environment, not process.env", () => {
    const plan = planAgentSpawn({
      agent: "claude",
      folder: FOLDER,
      env: { PATH: "C:\\bin", ANTHROPIC_API_KEY: "sk-ant-leaked" },
      exists,
    });
    expect(plan.ok).toBe(true);
    expect(plan.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(plan.stripped).toContain("ANTHROPIC_API_KEY");
  });
});

describe("flags that change who pays are refused by name", () => {
  it.each([["--bare"], ["--betas"], ["--max-budget-usd"]])("refuses %s", (flag) => {
    const plan = planAgentSpawn({ agent: "claude", folder: FOLDER, extraArgs: [flag], exists });
    expect(plan.ok).toBe(false);
    expect(plan.code).toBe("FORBIDDEN_FLAG");
    expect(plan.reason).toMatch(/API|subscription|billing/i);
  });

  it("refuses the `--flag=value` form too, not just the bare token", () => {
    const plan = planAgentSpawn({ agent: "claude", folder: FOLDER, extraArgs: ["--max-budget-usd=5"], exists });
    expect(plan.ok).toBe(false);
    expect(plan.code).toBe("FORBIDDEN_FLAG");
  });

  it("never emits --bare on the happy path either", () => {
    const plan = planAgentSpawn({ agent: "claude", folder: FOLDER, exists });
    expect(plan.args).not.toContain("--bare");
  });

  it("every forbidden flag explains WHY, so a future reader cannot mistake it for style", () => {
    for (const [, why] of FORBIDDEN_FLAGS) expect(why.length).toBeGreaterThan(30);
  });
});

describe("auth is checked, never assumed", () => {
  it("accepts a first-party subscription", () => {
    const v = assertSubscription({ loggedIn: true, apiProvider: "firstParty", subscriptionType: "max", email: "k@example.com" });
    expect(v.ok).toBe(true);
    expect(v.plan).toBe("max");
    expect(v).not.toHaveProperty("account");
    expect(JSON.stringify(v)).not.toContain("k@example.com");
  });

  it("refuses a logged-in account with no subscription — that is the API-billing case", () => {
    const v = assertSubscription({ loggedIn: true, apiProvider: "firstParty" });
    expect(v.ok).toBe(false);
    expect(v.code).toBe("NO_SUBSCRIPTION");
  });

  it("refuses a metered provider even when a subscription is present", () => {
    const v = assertSubscription({ loggedIn: true, apiProvider: "bedrock", subscriptionType: "max" });
    expect(v.ok).toBe(false);
    expect(v.code).toBe("METERED_PROVIDER");
  });

  it("refuses when not logged in", () => {
    expect(assertSubscription({ loggedIn: false }).code).toBe("NOT_LOGGED_IN");
  });

  it("FAILS CLOSED on an unreadable answer — silence is not permission", () => {
    expect(assertSubscription("not json at all").ok).toBe(false);
    expect(assertSubscription("not json at all").code).toBe("AUTH_UNREADABLE");
    expect(assertSubscription(null).ok).toBe(false);
  });

  it("accepts Codex only when its own CLI confirms the ChatGPT login", () => {
    expect(assertAgentSubscription("codex", "Logged in using ChatGPT")).toMatchObject({ ok: true, plan: "chatgpt" });
    expect(assertAgentSubscription("codex", "Logged in using an API key")).toMatchObject({ ok: false, code: "METERED_PROVIDER" });
    expect(assertAgentSubscription("codex", "")).toMatchObject({ ok: false, code: "AUTH_UNREADABLE" });
  });

  it("uses each installed CLI's real account-status command", () => {
    expect(authArgsFor("claude")).toEqual(["auth", "status", "--json"]);
    expect(authArgsFor("codex")).toEqual(["login", "status"]);
  });
});

describe("finding the two CLIs on THIS machine", () => {
  it("finds codex inside the desktop app rather than demanding it on PATH", () => {
    const home = "C:\\Users\\Kuya";
    const only = (p) => p === "C:\\Users\\Kuya\\.codex\\plugins\\.plugin-appserver\\codex.exe";
    const r = resolveAgent("codex", { home, exists: only, env: {} });
    expect(r.ok).toBe(true);
    expect(r.path).toContain(".plugin-appserver");
    expect(r.onPath).toBe(false);
  });

  it("prefers an explicit override when the owner sets one", () => {
    const r = resolveAgent("claude", { home: "C:\\Users\\Kuya", exists: () => true, env: { CLAUDE_CLI_PATH: "D:\\alt\\claude.exe" } });
    expect(r.path).toBe("D:\\alt\\claude.exe");
  });

  it("refuses to run a thread in a folder that does not exist", () => {
    const plan = planAgentSpawn({ agent: "claude", folder: "C:\\nope", exists: () => false });
    expect(plan.ok).toBe(false);
    expect(plan.code).toBe("NO_FOLDER");
  });
});

describe("both agents are driven the same way, which is what makes handoff a button", () => {
  it("claude runs as a resumable streaming thread", () => {
    const p = planAgentSpawn({ agent: "claude", folder: FOLDER, threadId: "abc-123", model: "sonnet", effort: "low", exists });
    expect(p.args).toEqual(expect.arrayContaining(["-p", "--input-format", "stream-json", "--output-format", "stream-json"]));
    expect(p.args).toEqual(expect.arrayContaining(["--resume", "abc-123"]));
    expect(p.args).toEqual(expect.arrayContaining(["--model", "sonnet", "--effort", "low"]));
    expect(p.args).toEqual(expect.arrayContaining(["--permission-mode", "plan"]));
  });

  it("codex puts outer exec flags before resume, matching the installed parser", () => {
    const p = planAgentSpawn({ agent: "codex", folder: FOLDER, threadId: "def-456", model: "gpt-5.6-sol", effort: "high", prompt: "continue", exists });
    expect(p.args).toEqual([
      "exec", "--json", "-C", FOLDER,
      "--sandbox", "read-only",
      "resume", "def-456",
      "--model", "gpt-5.6-sol",
      "-c", "model_reasoning_effort=high",
      "continue",
    ]);
  });

  it("refuses a model or effort that belongs to the other agent", () => {
    expect(planAgentSpawn({ agent: "codex", folder: FOLDER, model: "opus", exists })).toMatchObject({ ok: false, code: "UNSUPPORTED_MODEL" });
    expect(planAgentSpawn({ agent: "claude", folder: FOLDER, effort: "ultra", exists })).toMatchObject({ ok: false, code: "UNSUPPORTED_EFFORT" });
  });

  it("takes the real thread id from the CLI event instead of trusting a browser UUID", () => {
    expect(threadIdFromAgentEvent("codex", { type: "thread.started", thread_id: "real-codex-id" })).toBe("real-codex-id");
    expect(threadIdFromAgentEvent("claude", { type: "system", subtype: "init", session_id: "real-claude-id" })).toBe("real-claude-id");
    expect(threadIdFromAgentEvent("codex", { type: "item.completed" })).toBeNull();
  });

  it("does not accept a caller-minted Claude session id", () => {
    const extraArgs = Object.assign([], { sessionId: "browser-made-id" });
    const p = planAgentSpawn({ agent: "claude", folder: FOLDER, extraArgs, exists });
    expect(p.args).not.toContain("--session-id");
    expect(p.args).not.toContain("browser-made-id");
  });

  it("both always run INSIDE the task folder — that is what removes the copy-paste", () => {
    for (const agent of ["claude", "codex"]) {
      expect(planAgentSpawn({ agent, folder: FOLDER, exists }).cwd).toBe(FOLDER);
    }
  });
});
