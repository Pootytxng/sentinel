// The console's local server. Loopback only, no dependencies, no build step.
//
// Why plain node with zero packages (#39): the owner's stated fear is that this becomes another
// thing to maintain. A framework means a dependency tree, an audit surface, a version to keep
// current and a build that can break. There is none of that here — `node server.mjs` is the whole
// toolchain, and it will still start unchanged in a year.
//
// Binds 127.0.0.1 explicitly rather than 0.0.0.0: this reads a private board and can start agents,
// so it must not be reachable from the network. That is not configurable either.

import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { snapshot, CODE_ROOT, CONTROL_DIR } from "./sources.mjs";
import { assertAgentSubscription, authArgsFor, planAgentSpawn, threadIdFromAgentEvent } from "./agents.mjs";
import { createNativeChatStore } from "./chats.mjs";
import { PROVIDERS, addIdea, addLink, providerOf, readNotes, remove } from "./notes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const HOST = "127.0.0.1";
export const DEFAULT_PORT = 4517;
const execFileAsync = promisify(execFile);
const TRUSTED_HOSTS = new Set([HOST, "localhost", "[::1]"]);
// Deny by default. This used to be an ALLOW-list of guarded routes, which failed twice over: a new
// route was unguarded until someone remembered to add it, and the one path prefix that was checked
// (`startsWith("/api/chats")`) was case-sensitive while its route regex was not — so
// `/API/chats/CLAUDE/<id>` walked straight past it and returned a full transcript (caught
// 2026-08-02). Inverting it means the mistake is now "forgot to make something public", which fails
// loudly in front of the owner, instead of "forgot to guard something", which fails silently in
// front of everyone else.
//
// The public set is only what a browser must fetch before it can present a token: the page itself,
// the module it imports, and the fonts.
const PUBLIC_PATHS = new Set(["/", "/index.html", "/journey.mjs"]);
const isPublicPath = (route) => PUBLIC_PATHS.has(route) || route.startsWith("/fonts/");
const SESSION_COOKIE = "compy_console";

/**
 * What the token does and does not do — stated plainly so nobody over-trusts it.
 *
 * DOES: stop an ordinary web page. A site the owner happens to have open can already fire a
 * no-Origin-exempt request at 127.0.0.1, but it cannot read this server's responses cross-origin,
 * so it can never learn the token — and without the token every /api/ route now refuses it.
 *
 * DOES NOT: stop a browser extension with loopback host permissions, or any other process running
 * as the owner. Both can simply GET / and read the cookie out of the response headers. Nothing a
 * local HTTP server can do fixes that; a process running as you has already won. The honest claim
 * is "deny-by-default against web origins", not "authenticated".
 */
function sessionTokenFrom(req) {
  const header = req.headers["x-compy-console-token"];
  if (typeof header === "string" && header) return header;
  const match = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(req.headers.cookie ?? "");
  return match ? match[1] : null;
}

/** Constant-time compare so a wrong token cannot be narrowed down by timing. */
function tokenMatches(supplied, expected) {
  if (typeof supplied !== "string" || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

const pageSource = () => readFileSync(join(HERE, "index.html"), "utf8");
const pageRevision = () => createHash("sha256").update(pageSource()).digest("hex").slice(0, 12);
const renderedPage = () => pageSource().replace("__COMPY_PAGE_REVISION__", pageRevision());

const send = (res, code, body, type = "application/json", extraHeaders = {}) => {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store", ...extraHeaders });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

/** Read the request body, with a hard cap — a local tool still does not accept unbounded input. */
function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > limit) { req.destroy(); reject(new Error("body too large")); }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/**
 * Browsers always send Origin for a cross-site request. Local scripts do not, so origin-less
 * loopback clients remain supported while a web page on another site is stopped before it can
 * reach a process-starting or state-changing route.
 */
export function trustedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const source = new URL(origin);
    const target = new URL(`http://${req.headers.host ?? ""}`);
    return source.protocol === "http:"
      && TRUSTED_HOSTS.has(source.hostname)
      && TRUSTED_HOSTS.has(target.hostname)
      && source.host.toLowerCase() === target.host.toLowerCase();
  } catch {
    return false;
  }
}

/** Verify the live CLI account immediately before a process is started. */
export async function verifyPlanSubscription(plan, { run = execFileAsync } = {}) {
  const args = authArgsFor(plan.agent);
  if (!args) return { ok: false, code: "UNKNOWN_AGENT", reason: `cannot verify billing for ${plan.agent}.` };
  try {
    const { stdout, stderr } = await run(plan.file, args, {
      cwd: plan.cwd,
      env: plan.env,
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    return assertAgentSubscription(plan.agent, `${stdout ?? ""}\n${stderr ?? ""}`);
  } catch (error) {
    return {
      ok: false,
      code: "AUTH_CHECK_FAILED",
      reason: `${plan.agent} account status could not be verified: ${String(error?.message ?? error)}`,
    };
  }
}

/**
 * Stream one agent turn to the page as Server-Sent Events.
 *
 * The transcript is NOT stored here. Both CLIs already persist their own sessions to disk, so the
 * console passes a thread id and lets them own the history — the same reason it has no database.
 * Anything else would be a second copy of the truth, which is the failure mode this whole console
 * exists to avoid.
 */
function streamTurn(res, plan, { message = null } = {}) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  emit("start", { agent: plan.agent, cwd: plan.cwd, stripped: plan.stripped, argv: [plan.file, ...plan.args] });

  const child = spawn(plan.file, plan.args, { cwd: plan.cwd, env: plan.env, windowsHide: true });
  let buf = "";

  child.stdout.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        const threadId = threadIdFromAgentEvent(plan.agent, event);
        if (threadId) emit("thread", { threadId });
        emit("event", event);
      } catch { emit("text", { text: line }); }
    }
  });
  child.stderr.on("data", (c) => emit("stderr", { text: c.toString("utf8") }));
  child.on("error", (e) => { emit("fatal", { error: String(e.message ?? e) }); res.end(); });
  child.on("close", (code) => { emit("done", { code }); res.end(); });

  if (plan.agent === "claude" && message !== null) {
    child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: message } }) + "\n");
    child.stdin.end();
  } else {
    child.stdin.end();
  }
  res.on("close", () => { if (!child.killed) child.kill(); });
}

/** Run the Q4 release gate and stream its output. Read-only against the code: it reports, never fixes. */
function streamAudit(res, { repoDir }) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const script = join(repoDir, "scripts", "verify-release.ps1");
  emit("start", { script });
  const child = spawn("pwsh", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], {
    cwd: repoDir, windowsHide: true,
  });
  child.stdout.on("data", (c) => emit("text", { text: c.toString("utf8") }));
  child.stderr.on("data", (c) => emit("text", { text: c.toString("utf8") }));
  child.on("error", (e) => { emit("fatal", { error: String(e.message ?? e) }); res.end(); });
  child.on("close", (code) => { emit("done", { code }); res.end(); });
  res.on("close", () => { if (!child.killed) child.kill(); });
}

export function launcherCommand(entry, { issue = null } = {}) {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", entry];
  if (Number.isInteger(issue) && issue > 0) args.push("-Issue", String(issue));
  return {
    file: "pwsh",
    args,
  };
}

/** Resolve only after Windows confirms that the detached launcher process exists. */
export function startDetachedProcess(command, options, { spawnProcess = spawn } = {}) {
  return new Promise((resolve) => {
    const child = spawnProcess(command.file, command.args, options);
    let settled = false;
    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve({ ok: true });
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: String(error?.message ?? error) });
    });
  });
}

export function createConsoleServer({
  repoDir = join(HERE, "..", ".."),
  planSpawn = planAgentSpawn,
  subscriptionCheck = verifyPlanSubscription,
  launchProcess = startDetachedProcess,
  launcherExists = existsSync,
  chatStore = createNativeChatStore({ codeRoot: CODE_ROOT }),
  token = randomBytes(24).toString("hex"),
} = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${HOST}`);
    // Normalized ONCE, and every routing decision below reads this rather than url.pathname. The
    // casing bypass existed because the guard and the route disagreed about what the same URL was.
    const route = url.pathname.toLowerCase();
    try {
      if (!isPublicPath(route)) {
        if (!trustedOrigin(req)) {
          return send(res, 403, { error: "This request did not come from the local Compy Console.", code: "FOREIGN_ORIGIN" });
        }
        if (!tokenMatches(sessionTokenFrom(req), token)) {
          return send(res, 403, {
            error: "This request carried no Compy Console session. Open the console page, or send the token printed at startup as x-compy-console-token.",
            code: "NO_SESSION",
          });
        }
      }

      if (route === "/" || route === "/index.html") {
        // SameSite=Strict keeps the browser from attaching this to any cross-site request; HttpOnly
        // keeps page script from reading it. Session cookie (no Max-Age) — the token dies with the
        // server, so a stale cookie from a previous run simply fails closed.
        return send(res, 200, renderedPage(), "text/html; charset=utf-8", {
          "set-cookie": `${SESSION_COOKIE}=${token}; Path=/; SameSite=Strict; HttpOnly`,
        });
      }

      if (route === "/journey.mjs") {
        return send(res, 200, readFileSync(join(HERE, "journey.mjs"), "utf8"), "text/javascript; charset=utf-8");
      }

      if (route === "/api/meta") {
        return send(res, 200, { revision: pageRevision() });
      }

      // The whole world, read fresh. No caching layer on purpose — see sources.mjs.
      if (route === "/api/state") {
        return send(res, 200, snapshot());
      }

      if (route === "/api/chats" && req.method === "GET") {
        return send(res, 200, chatStore.list());
      }

      const chatMatch = /^\/api\/chats\/(claude|codex)\/([0-9a-f-]+)$/i.exec(route);
      if (chatMatch && req.method === "GET") {
        const chat = chatStore.get(chatMatch[1].toLowerCase(), chatMatch[2]);
        return chat ? send(res, 200, chat) : send(res, 404, { error: "chat not found" });
      }

      if (route === "/api/chat" && req.method === "POST") {
        const body = JSON.parse(await readBody(req));
        const plan = planSpawn({
          agent: body.agent ?? "claude",
          folder: body.folder,
          threadId: body.threadId ?? null,
          prompt: body.message ?? null,
          model: body.model ?? null,
          effort: body.effort ?? null,
          extraArgs: [],
        });
        if (!plan.ok) return send(res, 400, { error: plan.reason, code: plan.code });
        const entitlement = await subscriptionCheck(plan);
        if (!entitlement.ok) return send(res, 403, { error: entitlement.reason, code: entitlement.code });
        return streamTurn(res, plan, { message: body.message ?? null });
      }

      if (route === "/api/audit") {
        return streamAudit(res, { repoDir });
      }

      // Hand off to the canonical launcher instead of reimplementing its safety decisions here.
      //
      // The console can start a thread in a folder that already exists, but creating one — worktree,
      // branch, hooks, the seventeen preflight checks, the claim on the board — is compy-entry.ps1's
      // job. Reimplementing that here would be a second opinion
      // about the most safety-critical path in the project, which is the one thing this console
      // refuses to do anywhere else.
      //
      // A selected issue is a complete non-interactive answer, so its terminal stays hidden and
      // exits with the launcher. The no-issue compatibility route remains visible because that path
      // genuinely presents a picker; the normal Console UI never needs it.
      if (route === "/api/launcher" && req.method === "POST") {
        const entry = join(CONTROL_DIR, "compy-entry.ps1");
        if (!launcherExists(entry)) return send(res, 404, { error: `${entry} is not there` });
        const text = await readBody(req);
        const body = text.trim() ? JSON.parse(text) : {};
        const issue = body.issue == null ? null : Number(body.issue);
        if (issue !== null && (!Number.isInteger(issue) || issue <= 0)) {
          return send(res, 400, { error: "Choose a real work item number.", code: "INVALID_ISSUE" });
        }
        const command = launcherCommand(entry, { issue });
        const launched = await launchProcess(command, {
          cwd: CONTROL_DIR,
          detached: true,
          stdio: "ignore",
          // A chosen issue needs no terminal input. Keep that plumbing invisible. The no-issue
          // fallback still opens the picker's real window because it genuinely asks a question.
          windowsHide: issue !== null,
          shell: false,
        });
        if (!launched.ok) {
          return send(res, 500, {
            error: `Compy could not start the safe launcher: ${launched.error}`,
            code: "LAUNCH_FAILED",
          });
        }
        return send(res, 200, { started: entry, issue, terminalRequired: issue === null });
      }

      // Compy's own typefaces, served from the repo. Bundled locally (OFL 1.1) — zero network,
      // which is the same promise the product itself makes about fonts.
      if (route.startsWith("/fonts/")) {
        // Name comes from the ORIGINAL pathname, not the lowercased route — the two bundled faces
        // are mixed-case filenames on disk. The strict allowlist below is what stops traversal.
        const name = url.pathname.slice("/fonts/".length);
        if (!/^Geist(Mono)?VF\.woff2$/.test(name)) return send(res, 404, { error: "no such font" });
        res.writeHead(200, { "content-type": "font/woff2", "cache-control": "max-age=31536000, immutable" });
        return res.end(readFileSync(join(repoDir, "src", "design", "fonts", name)));
      }

      if (route === "/api/notes" && req.method === "GET") {
        return send(res, 200, { ...readNotes(), providers: PROVIDERS });
      }
      if (route === "/api/notes/idea" && req.method === "POST") {
        const b = JSON.parse(await readBody(req));
        const r = addIdea({ text: b.text, folder: b.folder ?? null });
        return send(res, r.ok ? 200 : 400, r.ok ? { notes: r.notes } : { error: r.reason });
      }
      if (route === "/api/notes/link" && req.method === "POST") {
        const b = JSON.parse(await readBody(req));
        const r = addLink({ title: b.title, url: b.url, tag: b.tag ?? null });
        return send(res, r.ok ? 200 : 400, r.ok ? { notes: r.notes } : { error: r.reason });
      }
      if (route === "/api/notes/remove" && req.method === "POST") {
        const b = JSON.parse(await readBody(req));
        const r = remove({ kind: b.kind, id: b.id });
        return send(res, r.ok ? 200 : 400, r.ok ? { notes: r.notes } : { error: r.reason });
      }

      // Open a provider in its OWN chromeless window.
      //
      // Not an iframe, and not a Tauri webview: chatgpt.com and claude.ai both refuse to be framed
      // (verified 2026-08-01 — Chrome renders the blocked-content page for each), and Google's OAuth
      // policy rejects embedded user agents outright. So the console does the honest thing and hands
      // the URL to a real browser window, where login, history, projects and attachments all work
      // exactly as the provider supports. Allowlisted to provider hosts: this endpoint can start a
      // process, so it must never take an arbitrary URL from a page.
      if (route === "/api/open" && req.method === "POST") {
        const b = JSON.parse(await readBody(req));
        const target = String(b.url ?? "");
        if (!providerOf(target)) return send(res, 400, { error: "only provider URLs may be opened this way" });
        const browsers = [
          join(process.env["ProgramFiles"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
          join(process.env["ProgramFiles(x86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
          join(process.env["ProgramFiles(x86)"] ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
        ].filter((p) => p && existsSync(p));
        if (b.ownWindow !== false && browsers.length) {
          spawn(browsers[0], [`--app=${target}`], { detached: true, stdio: "ignore", windowsHide: false }).unref();
        } else {
          spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore", windowsHide: true }).unref();
        }
        return send(res, 200, { opened: target, ownWindow: b.ownWindow !== false && browsers.length > 0 });
      }

      return send(res, 404, { error: "no such endpoint" });
    } catch (e) {
      return send(res, 500, { error: String(e?.message ?? e) });
    }
  });
  // Exposed so the startup banner can print it for non-browser local callers, and so a test can
  // build a server with a known token instead of scraping one out of a response header.
  server.consoleToken = token;
  return server;
}

/** `node tools/console/server.mjs` — the only command the shortcut needs to run. */
if (process.argv[1] && process.argv[1].endsWith("server.mjs")) {
  const port = Number(process.env.COMPY_CONSOLE_PORT ?? DEFAULT_PORT);
  const server = createConsoleServer();
  server.listen(port, HOST, () => {
    console.log(`Compy Console  ->  http://${HOST}:${port}`);
    console.log(`code root      ->  ${CODE_ROOT}`);
    // Opening the page in a browser needs nothing — it gets the cookie. This line is for scripts
    // and curl, which have no cookie jar: send it as `x-compy-console-token`.
    console.log(`session token  ->  ${server.consoleToken}`);
  });
}
