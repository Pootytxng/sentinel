// How the console starts an agent — and, more importantly, what it refuses to let an agent become.
//
// THE BILLING INVARIANT (owner, 2026-08-01, #39): this machine has a Max subscription and a
// ChatGPT subscription. It must never spend Anthropic API credit or OpenAI API credit. Not as a
// fallback, not on a flag, not because an environment variable drifted back. The owner has already
// been billed once by accident and that is not allowed to happen through this console.
//
// A promise in a document does not survive a refactor, so the invariant is enforced in three places
// and guarded by tests:
//
//   1. `SUBSCRIPTION_KILL_LIST` is deleted from the child environment on EVERY spawn. Inheriting
//      `process.env` is the default in node, so an API key set later in Windows — or exported by a
//      parent shell — would silently flow into the agent. It is stripped rather than trusted absent.
//   2. `--bare` is refused. Its own help text says Anthropic auth becomes "strictly ANTHROPIC_API_KEY
//      or apiKeyHelper ... OAuth and keychain are never read". That flag IS the accident.
//   3. `assertSubscription()` asks the CLI what it is actually logged in as and refuses to start a
//      thread on anything but a first-party subscription. Configuration is checked, never assumed.
//
// Nothing here is a preference the user can turn off, because a switch that disables a spend guard
// is the same defect wearing a different hat.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Anything that could route a request to metered API billing instead of the logged-in subscription. */
export const SUBSCRIPTION_KILL_LIST = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "AWS_BEARER_TOKEN_BEDROCK",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "AZURE_OPENAI_API_KEY",
];

/** Flags that change WHO PAYS. Refused with a named reason, never quietly dropped. */
export const FORBIDDEN_FLAGS = new Map([
  ["--bare", "--bare forces ANTHROPIC_API_KEY auth and never reads your subscription login."],
  ["--betas", "--betas is API-key-only and implies metered billing."],
  ["--max-budget-usd", "--max-budget-usd is an API-dollar cap; on a subscription it is meaningless, so its presence means something switched to API billing."],
]);

/**
 * Where each CLI actually lives on this machine.
 *
 * `codex` is deliberately NOT required on PATH: it ships inside the desktop app's plugin directory
 * and the owner should not have to repair his PATH for the console to work. Ordered newest-known
 * first; `existsSync` decides, so a reinstall that moves one binary cannot silently select a stale
 * copy that is still on disk.
 */
export function resolveAgent(agent, { home = homedir(), exists = existsSync, env = process.env } = {}) {
  const candidates =
    agent === "claude"
      ? [env.CLAUDE_CLI_PATH, join(home, ".local", "bin", "claude.exe"), "claude.exe", "claude"]
      : [
          env.CODEX_CLI_PATH,
          join(home, ".codex", "plugins", ".plugin-appserver", "codex.exe"),
          join(home, ".codex", ".sandbox-bin", "codex.exe"),
          "codex.exe",
          "codex",
        ];
  for (const c of candidates) {
    if (!c) continue;
    if (c.includes("\\") || c.includes("/")) {
      if (exists(c)) return { ok: true, agent, path: c, onPath: false };
    } else {
      return { ok: true, agent, path: c, onPath: true };
    }
  }
  return { ok: false, agent, path: null, error: `no ${agent} executable found` };
}

/**
 * The child environment: the parent's, minus every way to pay by the token.
 *
 * Returns the stripped names as well as the env so the console can SHOW that it stripped them.
 * A guard the owner cannot see is a guard he has to take on faith, and this is the one thing he
 * asked not to have to take on faith.
 */
export function safeEnv(parent = process.env) {
  const out = { ...parent };
  const stripped = [];
  for (const key of SUBSCRIPTION_KILL_LIST) {
    if (out[key] !== undefined) {
      delete out[key];
      stripped.push(key);
    }
  }
  return { env: out, stripped };
}

/**
 * Build the exact spawn for one turn of a thread.
 *
 * Both CLIs are driven the same way on purpose: run inside the task's folder, stream events as
 * JSON, resume by id. That symmetry is why the console can offer "hand this to the other agent"
 * as a button rather than as a copy-paste.
 *
 *   claude  -p --input-format stream-json --output-format stream-json --session-id <uuid>
 *   codex   exec --json -C <folder> [resume <id>]
 *
 * @returns {{ok:true, file, args, cwd, env, stripped, agent}|{ok:false, code, reason}}
 */
export function planAgentSpawn({
  agent,
  folder,
  threadId = null,
  prompt = null,
  model = null,
  effort = null,
  extraArgs = [],
  env = process.env,
  resolve = resolveAgent,
  exists = existsSync,
} = {}) {
  if (agent !== "claude" && agent !== "codex") {
    return { ok: false, code: "UNKNOWN_AGENT", reason: `"${agent}" is not an agent this console drives.` };
  }
  if (!folder || !exists(folder)) {
    return { ok: false, code: "NO_FOLDER", reason: `${folder ?? "(none)"} does not exist — a thread always runs somewhere real.` };
  }
  for (const flag of extraArgs) {
    const why = FORBIDDEN_FLAGS.get(String(flag).split("=")[0]);
    if (why) return { ok: false, code: "FORBIDDEN_FLAG", reason: why };
  }

  const found = resolve(agent, { env, exists });
  if (!found.ok) return { ok: false, code: "AGENT_MISSING", reason: found.error };

  const { env: childEnv, stripped } = safeEnv(env);

  let args;
  if (agent === "claude") {
    args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--include-partial-messages",
      "--verbose",
    ];
    if (threadId) args.push("--resume", threadId);
    else if (extraArgs.sessionId) args.push("--session-id", extraArgs.sessionId);
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);
  } else {
    args = ["exec", "--json", "-C", folder];
    if (threadId) args = ["exec", "resume", threadId, "--json", "-C", folder];
    if (model) args.push("--model", model);
    if (prompt) args.push(prompt);
  }
  args.push(...extraArgs.filter((a) => typeof a === "string"));

  return { ok: true, agent, file: found.path, args, cwd: folder, env: childEnv, stripped };
}

/**
 * Refuse to start anything until the CLI confirms it is on a subscription.
 *
 * `claude auth status` reports `apiProvider` and `subscriptionType`. `firstParty` with a
 * subscription is the only accepted answer: `apiProvider` naming a metered provider, or a logged-in
 * account with no subscription, both mean the next turn would be billed per token.
 *
 * Fail-closed: an unreadable or unparseable answer is NOT permission. The console shows the reason
 * and starts nothing.
 */
export function assertSubscription(rawStatus) {
  let s;
  try {
    s = typeof rawStatus === "string" ? JSON.parse(rawStatus) : rawStatus;
  } catch {
    return { ok: false, code: "AUTH_UNREADABLE", reason: "claude auth status did not return JSON — refusing rather than guessing who pays." };
  }
  if (!s || typeof s !== "object") return { ok: false, code: "AUTH_UNREADABLE", reason: "no auth status to read." };
  if (!s.loggedIn) return { ok: false, code: "NOT_LOGGED_IN", reason: "not signed in. Run `claude auth login` — do not set an API key." };
  if (s.apiProvider && s.apiProvider !== "firstParty") {
    return { ok: false, code: "METERED_PROVIDER", reason: `auth is routed through "${s.apiProvider}", which bills per token.` };
  }
  if (!s.subscriptionType) {
    return { ok: false, code: "NO_SUBSCRIPTION", reason: "signed in, but no subscription is attached — usage would be billed to the API account." };
  }
  return { ok: true, plan: s.subscriptionType, account: s.email ?? null };
}
