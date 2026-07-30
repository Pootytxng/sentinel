// SessionStart hook wrapper for session-assert (spec §4.3).
//
// Claude Code hands a hook its payload on stdin — including `cwd` — and populates
// CLAUDE_PROJECT_DIR. That is the only place the REAL project root can be observed rather than
// inferred, which is why the assert lives behind a hook rather than in the launcher.
//
// On disagreement it emits a blocking message. A session that started in the wrong folder must be
// told before it writes, not after.

import { assertSessionRoot, consumeToken, readToken } from "./session-assert.mjs";

const readStdin = async () => {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const hookInput = await readStdin();
const result = assertSessionRoot({ token: readToken(), env: process.env, hookInput, cwd: process.cwd() });

if (result.ok) {
  consumeToken();
  console.log(`compy-entry: session root verified — ${result.root} (#${result.issue}, ${result.branch})`);
  process.exit(0);
}

console.error(
  [
    "",
    `compy-entry: STOP — ${result.code}`,
    result.reason,
    "",
    "This session does not match the claim it was launched under. Do not write anything.",
    "Close this window and relaunch from the Compy entrypoint.",
    "",
  ].join("\n"),
);
process.exit(2);
