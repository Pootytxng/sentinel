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
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { snapshot, CODE_ROOT } from "./sources.mjs";
import { planAgentSpawn } from "./agents.mjs";
import { PROVIDERS, addIdea, addLink, providerOf, readNotes, remove } from "./notes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const HOST = "127.0.0.1";
export const DEFAULT_PORT = 4517;

const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
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
      try { emit("event", JSON.parse(line)); } catch { emit("text", { text: line }); }
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

export function createConsoleServer({ repoDir = join(HERE, "..", "..") } = {}) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, `http://${HOST}`);
    try {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return send(res, 200, readFileSync(join(HERE, "index.html"), "utf8"), "text/html; charset=utf-8");
      }

      // The whole world, read fresh. No caching layer on purpose — see sources.mjs.
      if (url.pathname === "/api/state") {
        return send(res, 200, snapshot());
      }

      // A new thread id, minted by the console so it owns thread identity rather than scraping it back.
      if (url.pathname === "/api/thread/new") {
        return send(res, 200, { threadId: randomUUID() });
      }

      if (url.pathname === "/api/chat" && req.method === "POST") {
        const body = JSON.parse(await readBody(req));
        const plan = planAgentSpawn({
          agent: body.agent ?? "claude",
          folder: body.folder,
          threadId: body.threadId ?? null,
          prompt: body.message ?? null,
          model: body.model ?? null,
          effort: body.effort ?? null,
          extraArgs: body.sessionId ? Object.assign([], { sessionId: body.sessionId }) : [],
        });
        if (!plan.ok) return send(res, 400, { error: plan.reason, code: plan.code });
        return streamTurn(res, plan, { message: body.message ?? null });
      }

      if (url.pathname === "/api/audit") {
        return streamAudit(res, { repoDir });
      }

      // Compy's own typefaces, served from the repo. Bundled locally (OFL 1.1) — zero network,
      // which is the same promise the product itself makes about fonts.
      if (url.pathname.startsWith("/fonts/")) {
        const name = url.pathname.slice("/fonts/".length);
        if (!/^Geist(Mono)?VF\.woff2$/.test(name)) return send(res, 404, { error: "no such font" });
        res.writeHead(200, { "content-type": "font/woff2", "cache-control": "max-age=31536000, immutable" });
        return res.end(readFileSync(join(repoDir, "src", "design", "fonts", name)));
      }

      if (url.pathname === "/api/notes" && req.method === "GET") {
        return send(res, 200, { ...readNotes(), providers: PROVIDERS });
      }
      if (url.pathname === "/api/notes/idea" && req.method === "POST") {
        const b = JSON.parse(await readBody(req));
        const r = addIdea({ text: b.text, folder: b.folder ?? null });
        return send(res, r.ok ? 200 : 400, r.ok ? { notes: r.notes } : { error: r.reason });
      }
      if (url.pathname === "/api/notes/link" && req.method === "POST") {
        const b = JSON.parse(await readBody(req));
        const r = addLink({ title: b.title, url: b.url, tag: b.tag ?? null });
        return send(res, r.ok ? 200 : 400, r.ok ? { notes: r.notes } : { error: r.reason });
      }
      if (url.pathname === "/api/notes/remove" && req.method === "POST") {
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
      if (url.pathname === "/api/open" && req.method === "POST") {
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
}

/** `node tools/console/server.mjs` — the only command the shortcut needs to run. */
if (process.argv[1] && process.argv[1].endsWith("server.mjs")) {
  const port = Number(process.env.COMPY_CONSOLE_PORT ?? DEFAULT_PORT);
  createConsoleServer().listen(port, HOST, () => {
    console.log(`Compy Console  ->  http://${HOST}:${port}`);
    console.log(`code root      ->  ${CODE_ROOT}`);
  });
}
