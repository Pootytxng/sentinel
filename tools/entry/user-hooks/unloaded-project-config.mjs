// USER-LEVEL hook: warn when editing a file that belongs to a project whose config is NOT loaded.
//
// WHY THIS LIVES AT USER LEVEL AND NOT IN A PROJECT (the whole point).
// A project's CLAUDE.md, .claude/settings.json (env such as CLAUDE_CODE_AUTO_COMPACT_WINDOW) and
// .claude/hooks/* load ONLY for a session ROOTED in that project. A session rooted somewhere else
// that edits the project's files runs with none of them. A project-level guard against this cannot
// work by construction: it is one of the things that failed to load. So the check has to live in
// ~/.claude/, where it loads no matter where the session is rooted.
//
// PRECEDENT (2026-08-03). A long session rooted at C:\Users\Kuya did substantial work on
// C:\Users\Kuya\code\sentinel. All eight of that project's hooks were inert the entire time,
// including context-size-advisor (which exists to warn about exactly the runaway context that then
// happened) and session-root-assert (which exists to catch this exact mistake, and could not fire).
// The project's CLAUDE.md never auto-loaded; its laws were only in play because they happened to be
// read by hand. The code was fine; the supervision layer was simply absent, and the one gap that
// showed up in the work — an unreviewed UI change — is precisely what a loaded hook would have caught.
//
// CONTRACT. Advisory only. Never blocks, never fails a tool call, always exits 0. Fires at most once
// per (session, project) so it cannot become noise on a long editing run.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir, homedir } from "node:os";

const done = () => process.exit(0);

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  done();
}

const filePath = payload?.tool_input?.file_path;
if (!filePath || typeof filePath !== "string") done();

// The session's own root. CLAUDE_PROJECT_DIR is populated for hooks; cwd is the fallback.
const sessionRoot = resolve(process.env.CLAUDE_PROJECT_DIR || payload?.cwd || process.cwd());
const home = resolve(homedir());

// Windows paths are case-insensitive; compare case-folded and separator-normalised.
const norm = (p) => resolve(p).replace(/[\\/]+$/, "").toLowerCase();
const isInside = (child, parent) => {
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p + sep.toLowerCase()) || c.startsWith(p + "/");
};

// ~/.claude is the USER config, not a project. It loads in every session whatever the root, and its
// memory files, agents, skills and hooks are edited from wherever the session happens to be — so a
// warning about it is false by construction.
//
// This is a fix, not a precaution (2026-08-04). The exclusion below was described in the original
// comment and never implemented: the walk broke on `dir === home`, one level too LATE, because
// ~/.claude is visited before ~. With a CLAUDE.md sitting there (empty, but existsSync does not
// care), every memory write — which the memory law REQUIRES to go there — announced "PROJECT CONFIG
// NOT LOADED", named ~/.claude as the project, ordered the session to read a 0-byte file for laws it
// does not contain, and told it to inform the user that work belongs in a session rooted at
// ~/.claude. That last instruction is the dangerous one: it is false, and it is aimed at the user.
if (isInside(filePath, join(home, ".claude"))) done();

// Walk UP from the edited file for the nearest directory that carries project config.
let dir = dirname(resolve(filePath));
let projectRoot = null;
for (let i = 0; i < 40; i++) {
  if (norm(dir) === norm(home)) break;
  const hasSettings = existsSync(join(dir, ".claude", "settings.json"));
  const hasClaudeMd = existsSync(join(dir, "CLAUDE.md"));
  const hasHooks = existsSync(join(dir, ".claude", "hooks"));
  if (hasSettings || hasClaudeMd || hasHooks) {
    projectRoot = { dir, hasSettings, hasClaudeMd, hasHooks };
    break;
  }
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

if (!projectRoot) done();

// Rooted in (or under) that project → its config IS loaded. Nothing to say.
if (isInside(sessionRoot, projectRoot.dir)) done();

// A DIFFERENT CHECKOUT OF THE SAME REPOSITORY is not an unconfigured session (fix 2026-08-04).
// Git worktrees are the normal way work happens here, and a worktree carries its own tracked
// CLAUDE.md, .claude/settings.json and .claude/hooks/. A session rooted in one, editing a file in
// another, has all three loaded — so "every project hook is INERT this session" is simply false.
//
// What sharing a repository does NOT prove is that the two checkouts AGREE: different branches can
// carry different laws. That is a content question this hook cannot answer, and the honest response
// to a question you cannot answer is silence. A false "assume nothing is watching you" is worse than
// a missed drift warning — it is a fabricated claim about the session's own supervision, and it
// arrives as an instruction to repeat that claim to the user.
const gitCommonDir = (d) => {
  try {
    return norm(
      execFileSync("git", ["-C", d, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
        encoding: "utf8",
        timeout: 5_000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    );
  } catch {
    return null; // not a repo, or git unavailable — no evidence either way, fall through and warn
  }
};
const sessionCarriesConfig =
  existsSync(join(sessionRoot, "CLAUDE.md")) || existsSync(join(sessionRoot, ".claude"));
if (sessionCarriesConfig) {
  const a = gitCommonDir(sessionRoot);
  if (a && a === gitCommonDir(projectRoot.dir)) done();
}

// Fire once per session per project.
const sid = String(payload?.session_id || "x").replace(/[^a-z0-9-]/gi, "");
const key = norm(projectRoot.dir).replace(/[^a-z0-9]/gi, "");
const marker = join(tmpdir(), `unloaded-project-${sid}-${key.slice(-40)}`);
try {
  statSync(marker);
  done(); // already warned for this project in this session
} catch {
  /* first time → fire */
}
try {
  writeFileSync(marker, String(Date.now()));
} catch {
  /* non-fatal */
}

const missing = [];
if (projectRoot.hasClaudeMd) missing.push("CLAUDE.md (its standing laws did NOT auto-load)");
if (projectRoot.hasSettings) missing.push(".claude/settings.json (env such as CLAUDE_CODE_AUTO_COMPACT_WINDOW)");
if (projectRoot.hasHooks) missing.push(".claude/hooks/* (every project hook is INERT this session)");

const msg =
  `PROJECT CONFIG NOT LOADED. You just edited a file under ${projectRoot.dir}, but this session is ` +
  `rooted at ${sessionRoot}. Project config loads only for a session rooted in that project, so the ` +
  `following are NOT active right now:\n  - ${missing.join("\n  - ")}\n\n` +
  `Do BOTH of these:\n` +
  `1. Read ${join(projectRoot.dir, "CLAUDE.md")} (and any docs it points at) before acting further — ` +
  `you do not have its laws otherwise, and they are not optional just because they failed to load.\n` +
  `2. Tell the user plainly that the project's hooks are inert this session and that substantial work ` +
  `belongs in a session rooted at ${projectRoot.dir}. Do not silently work around it.\n\n` +
  `Assume nothing is watching you: no self-review nudge, no context-size advisor, no ship reminder, ` +
  `no autopilot. Whatever those would have enforced, you must do by hand.`;

process.stdout.write(
  JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msg } }),
);
process.exit(0);
