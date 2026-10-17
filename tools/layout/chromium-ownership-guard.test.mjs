// @vitest-environment node
// Ownership guards for the real-browser layout harness (tools/layout/chromium.mjs), from the #646
// independent review's two P2 findings:
//   1. a failed setup releases every resource it had already acquired — the output directory, the
//      loopback listener, the browser it spawned, that browser's profile and its debugger socket —
//      because the caller never receives a handle to close them; and no setup step waits forever,
//      since a hung setup leaks the same resources until the worker dies;
//   2. the loopback server serves files inside its own directory only (separator-aware, so a
//      sibling sharing the directory's name prefix is outside), and a malformed or directory path
//      is a 404, never a crash of the request handler.
// Plus the teardown contract the layout test's afterAll relies on: close() is idempotent, and it
// signals only the browser this harness spawned, and only while that browser still runs.
//
// Every resource here is FAKE. fs, child_process, http, os, esbuild, fetch and WebSocket are an
// in-memory ledger, so each failure path runs the REAL helper's control flow without a browser, a
// port, a temp directory or a process signal, on fake time. The real-browser proof is
// hc-specs-grid-layout.test.mjs; this file proves what happens when its setup goes wrong.
import { EventEmitter } from "node:events";
import { join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { launchChromium, openBundledPage, serveDir } from "./chromium.mjs";

// The mock factories run when chromium.mjs is imported, before this file's body; each fake reaches
// the current test's world through this object at call time.
const { fake, forward } = vi.hoisted(() => {
  const fake = {};
  const forward = (names, at) => {
    const api = Object.fromEntries(names.map((n) => [n, (...a) => fake[at][n](...a)]));
    return { ...api, default: api };
  };
  return { fake, forward };
});
vi.mock("node:fs", () => forward(["existsSync", "mkdtempSync", "readFileSync", "rmSync", "statSync", "writeFileSync"], "fs"));
vi.mock("node:child_process", () => forward(["spawn"], "childProcess"));
vi.mock("node:http", () => forward(["createServer"], "http"));
vi.mock("node:os", () => forward(["tmpdir"], "os"));
vi.mock("esbuild", () => forward(["build"], "esbuild"));

const TMP = resolve("/compy-fake-tmp");
const CHROME = resolve("/compy-fake-browser/chrome.exe");
const PORT_FILE = "DevToolsActivePort";
const PAGE = { entry: "export {};", resolveDir: TMP, html: "<!doctype html>", plugins: [] };

const errno = (code, what) => Object.assign(new Error(`${code}: ${what}`), { code });

/** @type {ReturnType<typeof makeWorld>} */
let world;
let processKill;

/**
 * One test's machine. `knobs` chooses where setup fails; the ledger records every resource the
 * helper acquired and every release, so a leak or a double release is read off it, not inferred.
 */
function makeWorld(knobs = {}) {
  const w = {
    knobs: { chromium: true, bundle: "ok", write: "ok", listen: "ok", spawn: "ok", browser: "ok", ...knobs },
    files: new Map(), // resolved path -> Buffer | "dir"
    dirs: [], // { path, removed }
    servers: [], // { handler, open, closes }
    children: [], // { child, running, kills, strayKills, exit }
    sockets: [], // { state, closes }
    spawns: [], // [exe, args]
    reads: [], // files the loopback server read to answer a request
    unhandled: [], // errors a fake emitted with nobody listening (a real emitter would crash the worker)
  };
  const emitOrRecord = (emitter, event, error) => {
    if (emitter.listenerCount(event) === 0) w.unhandled.push(`${event}: ${error.message}`);
    else emitter.emit(event, error);
  };
  const portReady = () => {
    const c = w.children.at(-1);
    return Boolean(c?.running) && !["no-port", "exits-early"].includes(w.knobs.browser);
  };

  fake.fs = {
    existsSync: (p) => {
      const at = resolve(String(p));
      if (at === CHROME) return w.knobs.chromium;
      if (at.endsWith(sep + PORT_FILE)) return portReady();
      return w.files.has(at);
    },
    mkdtempSync: (prefix) => {
      const path = resolve(`${prefix}${String(w.dirs.length).padStart(6, "0")}`);
      w.dirs.push({ path, removed: 0 });
      w.files.set(path, "dir");
      return path;
    },
    readFileSync: (p, encoding) => {
      const at = resolve(String(p));
      if (at.endsWith(sep + PORT_FILE)) return "9222\n/devtools/browser/fake";
      const entry = w.files.get(at);
      if (entry === undefined) throw errno("ENOENT", at);
      if (entry === "dir") throw errno("EISDIR", at);
      w.reads.push(at);
      return encoding ? entry.toString(encoding) : entry;
    },
    rmSync: (p) => {
      const at = resolve(String(p));
      const dir = w.dirs.find((d) => d.path === at);
      if (dir) dir.removed++;
      for (const key of [...w.files.keys()]) if (key === at || key.startsWith(at + sep)) w.files.delete(key);
    },
    statSync: (p, options) => {
      const entry = w.files.get(resolve(String(p)));
      if (entry === undefined) {
        if (options?.throwIfNoEntry === false) return undefined;
        throw errno("ENOENT", p);
      }
      return { isFile: () => entry !== "dir", isDirectory: () => entry === "dir" };
    },
    writeFileSync: (p, data) => {
      if (w.knobs.write === "fail") throw new Error("PROBE html write failure");
      w.files.set(resolve(String(p)), Buffer.from(String(data)));
    },
  };

  fake.os = { tmpdir: () => TMP };

  fake.esbuild = {
    build: async ({ outdir }) => {
      if (w.knobs.bundle === "fail") throw new Error("PROBE bundle failure");
      w.files.set(resolve(outdir, "page.js"), Buffer.from("/* js */"));
      w.files.set(resolve(outdir, "page.css"), Buffer.from("/* css */"));
      return { errors: [], warnings: [] };
    },
  };

  fake.http = {
    createServer: (handler) => {
      const server = new EventEmitter();
      const record = { handler, open: false, closes: 0 };
      w.servers.push(record);
      server.listen = (port, host, ready) => {
        if (w.knobs.listen === "fail") process.nextTick(() => emitOrRecord(server, "error", errno("EADDRINUSE", `listen ${host}:${port}`)));
        else {
          record.open = true;
          process.nextTick(ready);
        }
        return server;
      };
      server.address = () => ({ address: "127.0.0.1", family: "IPv4", port: 51_000 });
      server.close = (done) => {
        record.closes++;
        const wasOpen = record.open;
        record.open = false;
        process.nextTick(() => done?.(wasOpen ? undefined : errno("ERR_SERVER_NOT_RUNNING", "close")));
        return server;
      };
      return server;
    },
  };

  fake.childProcess = {
    spawn: (exe, args) => {
      w.spawns.push([exe, args]);
      if (w.knobs.spawn === "throw") throw new Error("PROBE spawn threw");
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      child.exitCode = null;
      child.signalCode = null;
      const record = { child, running: w.knobs.spawn === "ok", kills: 0, strayKills: 0 };
      // Node leaves `pid` undefined for a process that never started.
      child.pid = record.running ? 40_000 + w.children.length : undefined;
      record.exit = (code, signal) => {
        if (!record.running) return;
        record.running = false;
        child.exitCode = code;
        child.signalCode = signal;
        child.emit("exit", code, signal);
      };
      child.kill = (signal = "SIGTERM") => {
        record.kills++;
        if (!record.running) {
          // Not ours any more (exited, or never started): a real pid here may belong to a peer.
          record.strayKills++;
          return false;
        }
        process.nextTick(record.exit, null, signal);
        return true;
      };
      w.children.push(record);
      if (w.knobs.spawn === "error-event") process.nextTick(() => emitOrRecord(child, "error", errno("ENOENT", `spawn ${exe}`)));
      if (w.knobs.browser === "exits-early") process.nextTick(record.exit, 1, null);
      return child;
    },
  };

  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      this.record = { state: "connecting", closes: 0 };
      w.sockets.push(this.record);
      process.nextTick(() => {
        if (w.knobs.browser === "socket-fails") {
          this.record.state = "failed";
          this.dispatch("error", { type: "error", message: "PROBE debugger refused" });
          this.dispatch("close", {});
        } else {
          this.record.state = "open";
          this.dispatch("open", {});
        }
      });
    }
    addEventListener(type, fn) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    }
    dispatch(type, event) {
      for (const fn of this.listeners.get(type) ?? []) fn(event);
    }
    reply(message) {
      process.nextTick(() => this.record.state === "open" && this.dispatch("message", { data: JSON.stringify(message) }));
    }
    send(raw) {
      const { id, method } = JSON.parse(raw);
      const mode = w.knobs.browser;
      if (mode === "dies-after-attach") {
        // The browser crashes under the debugger: its process exits and the socket closes unanswered.
        w.children.at(-1)?.exit(1, null);
        this.record.state = "closed";
        process.nextTick(() => this.dispatch("close", {}));
        return;
      }
      if (method === "Page.navigate") {
        this.reply({ id, result: { frameId: "FAKE" } });
        if (mode !== "no-load") this.reply({ method: "Page.loadEventFired", params: { timestamp: 1 } });
      } else if (method === "Runtime.evaluate") {
        if (mode === "page-throws") this.reply({ method: "Runtime.exceptionThrown", params: { exceptionDetails: { text: "PROBE page exception" } } });
        this.reply({ id, result: { result: { value: !["page-throws", "never-ready"].includes(mode) } } });
      } else {
        this.reply({ id, result: {} });
      }
    }
    close() {
      this.record.closes++;
      if (this.record.state === "open" || this.record.state === "connecting") this.record.state = "closed";
    }
  }
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("fetch", async () => ({
    json: async () => (w.knobs.browser === "no-page" ? [] : [{ type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/FAKE" }]),
  }));

  return w;
}

/** Every acquired resource still held. */
const leaks = () => [
  ...world.dirs.filter((d) => d.removed === 0).map((d) => `directory ${d.path}`),
  ...world.servers.filter((s) => s.open).map(() => "loopback listener"),
  ...world.children.filter((c) => c.running).map((c) => `browser pid ${c.child.pid}`),
  ...world.sockets.filter((s) => s.state === "open" || s.state === "connecting").map(() => "debugger socket"),
];

/** Releases that happened more than once, and signals sent to a process that was no longer ours. */
const overReleases = () => [
  ...world.dirs.filter((d) => d.removed > 1).map((d) => `directory ${d.path} removed ${d.removed}x`),
  ...world.servers.filter((s) => s.closes > 1).map((s) => `listener closed ${s.closes}x`),
  ...world.children.filter((c) => c.kills > 1).map((c) => `browser signalled ${c.kills}x`),
  ...world.children.filter((c) => c.strayKills > 0).map(() => "signalled a process that was not running"),
];

/**
 * Run `promise` to completion on fake time, past every 30s deadline in the helper. Whatever is still
 * pending afterwards would have hung the real gate.
 */
async function settle(promise) {
  const outcome = { state: "pending", value: undefined, error: undefined };
  promise.then(
    (value) => Object.assign(outcome, { state: "resolved", value }),
    (error) => Object.assign(outcome, { state: "rejected", error }),
  );
  await vi.advanceTimersByTimeAsync(45_000);
  return outcome;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.stubEnv("COMPY_CHROMIUM", CHROME);
  processKill = vi.spyOn(process, "kill").mockImplementation(() => true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a failed setup releases everything it acquired and never hangs (#646 review P2 1)", () => {
  // `acquired` is how far the real flow got before failing: proof each row reached its failure
  // point with something to release, so an empty leak list is never vacuous.
  const SETUP_FAILURES = [
    { name: "the bundle fails", knobs: { bundle: "fail" }, error: /PROBE bundle failure/, acquired: { dirs: 1, listeners: 0, browsers: 0 } },
    { name: "the page HTML cannot be written", knobs: { write: "fail" }, error: /PROBE html write failure/, acquired: { dirs: 1, listeners: 0, browsers: 0 } },
    { name: "the loopback listener cannot bind", knobs: { listen: "fail" }, error: /EADDRINUSE/, acquired: { dirs: 1, listeners: 1, browsers: 0 } },
    { name: "no Chromium is installed", knobs: { chromium: false }, error: /No local Chromium found; the layout proof is BLOCKED/, acquired: { dirs: 1, listeners: 1, browsers: 0 } },
    { name: "spawn throws", knobs: { spawn: "throw" }, error: /PROBE spawn threw/, acquired: { dirs: 2, listeners: 1, browsers: 1 } },
    { name: "the browser cannot be started", knobs: { spawn: "error-event" }, error: /ENOENT/, acquired: { dirs: 2, listeners: 1, browsers: 1 } },
    { name: "the browser exits before its debug port opens", knobs: { browser: "exits-early" }, error: /exited \(1\) before opening its debug port/, acquired: { dirs: 2, listeners: 1, browsers: 1 } },
    { name: "the debug port never opens", knobs: { browser: "no-port" }, error: /did not open its debug port within 30s/, acquired: { dirs: 2, listeners: 1, browsers: 1 } },
    { name: "the browser lists no page target", knobs: { browser: "no-page" }, error: /listed no page target/, acquired: { dirs: 2, listeners: 1, browsers: 1 } },
    { name: "the debugger socket fails", knobs: { browser: "socket-fails" }, error: /CDP socket error/, acquired: { dirs: 2, listeners: 1, browsers: 1 } },
    { name: "the browser dies under the debugger", knobs: { browser: "dies-after-attach" }, error: /CDP socket closed/, acquired: { dirs: 2, listeners: 1, browsers: 1 } },
    { name: "the page never fires its load event", knobs: { browser: "no-load" }, error: /load event/, acquired: { dirs: 2, listeners: 1, browsers: 1 } },
    { name: "the page throws before it is ready", knobs: { browser: "page-throws" }, error: /page failed before it was ready/, acquired: { dirs: 2, listeners: 1, browsers: 1 } },
    { name: "the page never becomes ready", knobs: { browser: "never-ready" }, error: /never satisfied ready expression/, acquired: { dirs: 2, listeners: 1, browsers: 1 } },
  ];

  it.each(SETUP_FAILURES)("$name", async ({ knobs, error, acquired }) => {
    world = makeWorld(knobs);
    const outcome = await settle(openBundledPage(PAGE));
    expect(outcome.state, "a failed setup must reject, not hang").toBe("rejected");
    expect(outcome.error.message).toMatch(error);
    expect({ dirs: world.dirs.length, listeners: world.servers.length, browsers: world.spawns.length }).toEqual(acquired);
    expect(leaks(), "still held after the setup failed").toEqual([]);
    expect(overReleases()).toEqual([]);
    expect(world.unhandled, "an error event nobody listened for crashes the worker").toEqual([]);
    expect(world.spawns.map(([exe]) => exe), "the only process ever started is the browser").toEqual(acquired.browsers ? [CHROME] : []);
    expect(processKill).not.toHaveBeenCalled();
  });

  it("launchChromium alone: a debug port that never opens kills the browser it spawned and removes its profile", async () => {
    world = makeWorld({ browser: "no-port" });
    const outcome = await settle(launchChromium({ exe: CHROME }));
    expect(outcome.state).toBe("rejected");
    expect(outcome.error.message).toMatch(/did not open its debug port within 30s/);
    expect(world.children.map((c) => c.kills)).toEqual([1]);
    expect(world.dirs.map((d) => d.removed)).toEqual([1]);
    expect(leaks()).toEqual([]);
  });

  it("control: the same fakes carry a healthy setup all the way to a live page", async () => {
    world = makeWorld();
    const outcome = await settle(openBundledPage(PAGE));
    expect(outcome.state).toBe("resolved");
    expect((await settle(outcome.value.evaluate("1"))).value).toBe(true);
    expect(leaks().length, "a live page holds its directories, listener, browser and socket").toBe(5);
    await settle(outcome.value.close());
    expect(leaks()).toEqual([]);
  });
});

describe("close() is idempotent and signals only its own running browser", () => {
  it("one signal, one listener close and one removal per directory, however often close() is called", async () => {
    world = makeWorld();
    const page = (await settle(openBundledPage(PAGE))).value;
    const closed = await settle(Promise.all([page.close(), page.close()]).then(() => page.close()));
    expect(closed.state).toBe("resolved");
    expect(leaks()).toEqual([]);
    expect(world.children.map((c) => c.kills)).toEqual([1]);
    expect(world.servers.map((s) => s.closes)).toEqual([1]);
    expect(world.dirs.map((d) => d.removed)).toEqual([1, 1]);
    expect(overReleases()).toEqual([]);
    expect(world.spawns.map(([exe]) => exe)).toEqual([CHROME]);
    expect(processKill).not.toHaveBeenCalled();
  });

  it("never signals a browser that already exited on its own, whose pid may now be a peer's", async () => {
    world = makeWorld();
    const page = (await settle(openBundledPage(PAGE))).value;
    world.children[0].exit(0, null);
    expect((await settle(page.close())).state).toBe("resolved");
    expect(world.children[0].kills).toBe(0);
    expect(leaks()).toEqual([]);
    expect(processKill).not.toHaveBeenCalled();
  });
});

describe("the loopback server serves its own directory and nothing else (#646 review P2 2)", () => {
  const ROOT = resolve("/compy-fake-out/layout");
  const PEER_SECRET = resolve("/compy-fake-out/layout-peer/secret.txt");

  async function serve() {
    world = makeWorld();
    world.files.set(ROOT, "dir");
    world.files.set(join(ROOT, "index.html"), Buffer.from("INDEX"));
    world.files.set(join(ROOT, "sub"), "dir");
    world.files.set(join(ROOT, "sub", "inner.txt"), Buffer.from("INNER"));
    world.files.set(resolve("/compy-fake-out/layout-peer"), "dir");
    world.files.set(PEER_SECRET, Buffer.from("PEER SECRET"));
    world.files.set(resolve("/compy-fake-out/secret.txt"), Buffer.from("PARENT SECRET"));
    expect((await settle(serveDir(ROOT))).state).toBe("resolved");
  }

  /** Drive the server's real request handler with one GET; a throw is recorded, not propagated. */
  async function get(url) {
    const res = { status: null, body: undefined };
    res.writeHead = (status) => {
      res.status = status;
      return res;
    };
    res.end = (body) => {
      res.body = body === undefined ? undefined : String(body);
      return res;
    };
    let threw = null;
    try {
      await world.servers[0].handler({ method: "GET", url, headers: {} }, res);
    } catch (e) {
      threw = e.message;
    }
    return { status: res.status, body: res.body, threw };
  }

  it("control: serves a file inside its directory", async () => {
    await serve();
    expect(await get("/index.html")).toEqual({ status: 200, body: "INDEX", threw: null });
    expect(await get("/sub/inner.txt")).toEqual({ status: 200, body: "INNER", threw: null });
    expect(world.reads).toEqual([join(ROOT, "index.html"), join(ROOT, "sub", "inner.txt")]);
  });

  it.each([
    ["an encoded sibling-prefix escape (the review's probe)", "/%2e%2e%2flayout-peer/secret.txt"],
    ["an encoded sibling-prefix escape, slashes encoded", "/..%2flayout-peer%2fsecret.txt"],
    ["an encoded-backslash sibling escape", "/..%5clayout-peer%5csecret.txt"],
    ["an encoded escape to the parent", "/%2e%2e%2fsecret.txt"],
    ["a double encoded escape back into the sibling", "/%2e%2e%2f%2e%2e%2fcompy-fake-out%2flayout-peer%2fsecret.txt"],
    ["malformed percent-encoding", "/%E0%A4%A"],
    ["a bare percent sign", "/%"],
    ["the directory itself", "/"],
    ["a subdirectory", "/sub"],
    ["a subdirectory with a trailing slash", "/sub/"],
    ["an embedded NUL", "/index.html%00.txt"],
  ])("refuses %s with a 404 and reads nothing", async (_name, url) => {
    await serve();
    expect(await get(url)).toEqual({ status: 404, body: undefined, threw: null });
    expect(world.reads).toEqual([]);
  });
});
