import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HOST, createConsoleServer, launcherCommand, verifyPlanSubscription } from "./server.mjs";

const openServers = new Set();

afterEach(async () => {
  await Promise.all([...openServers].map((server) => new Promise((resolve) => server.close(resolve))));
  openServers.clear();
});

async function start(options = {}) {
  const server = createConsoleServer(options);
  openServers.add(server);
  await new Promise((resolve) => server.listen(0, HOST, resolve));
  return { server, port: server.address().port };
}

function request(port, { path = "/api/chat", method = "POST", origin, body = {} } = {}) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: HOST,
      port,
      path,
      method,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        ...(origin === undefined ? {} : { origin }),
      },
    }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    req.on("error", reject);
    req.end(payload);
  });
}

describe("browser requests cannot cross the loopback trust boundary", () => {
  it("rejects a foreign Origin before planning or starting an agent", async () => {
    const planSpawn = vi.fn(() => ({ ok: false, code: "SHOULD_NOT_RUN", reason: "wrong boundary" }));
    const { port } = await start({ planSpawn });

    const response = await request(port, { origin: "https://attacker.invalid", body: { agent: "claude" } });

    expect(response.status).toBe(403);
    expect(response.text).toMatch(/origin|console/i);
    expect(planSpawn).not.toHaveBeenCalled();
  });

  it("still supports its own page and origin-less local clients", async () => {
    const planSpawn = vi.fn(() => ({ ok: false, code: "EXPECTED_REFUSAL", reason: "planned refusal" }));
    const { port } = await start({ planSpawn });

    expect((await request(port, { origin: `http://${HOST}:${port}` })).status).toBe(400);
    expect((await request(port)).status).toBe(400);
    expect(planSpawn).toHaveBeenCalledTimes(2);
  });
});

describe("subscription entitlement is enforced where the process would start", () => {
  it("refuses the chat turn when the live account check fails", async () => {
    const planSpawn = vi.fn(() => ({
      ok: true,
      agent: "claude",
      file: "claude.exe",
      args: [],
      cwd: "C:\\fixture",
      env: {},
      stripped: [],
    }));
    const subscriptionCheck = vi.fn(async () => ({ ok: false, code: "NO_SUBSCRIPTION", reason: "subscription not confirmed" }));
    const { port } = await start({ planSpawn, subscriptionCheck });

    const response = await request(port, { body: { agent: "claude", folder: "C:\\fixture", message: "hello" } });

    expect(response.status).toBe(403);
    expect(response.text).toMatch(/subscription not confirmed/);
    expect(subscriptionCheck).toHaveBeenCalledOnce();
  });

  it("reads Codex login status from stderr, where the installed CLI actually writes it", async () => {
    const verdict = await verifyPlanSubscription({
      agent: "codex",
      file: "codex.exe",
      cwd: "C:\\fixture",
      env: {},
    }, {
      run: vi.fn(async () => ({ stdout: "", stderr: "Logged in using ChatGPT\n" })),
    });
    expect(verdict).toMatchObject({ ok: true, plan: "chatgpt" });
  });
});

describe("thread identity belongs to the agent CLI", () => {
  it("does not expose the old browser-minted thread endpoint", async () => {
    const { port } = await start();
    const response = await request(port, { path: "/api/thread/new", method: "GET" });
    expect(response.status).toBe(404);
  });

  it("exposes native chat metadata and one exact transcript without inventing another id", async () => {
    const chat = {
      id: "2594b1c6-c069-4949-8c79-bddea3f7832c",
      agent: "claude",
      folder: "C:\\fixture",
      title: "Catch me up",
      messages: [{ role: "user", text: "Catch me up", timestamp: "2026-08-01T19:54:06.366Z" }],
    };
    const chatStore = { list: vi.fn(() => [{ ...chat, messages: undefined }]), get: vi.fn(() => chat) };
    const { port } = await start({ chatStore });

    const list = await request(port, { path: "/api/chats", method: "GET" });
    const transcript = await request(port, { path: `/api/chats/claude/${chat.id}`, method: "GET" });

    expect(list.status).toBe(200);
    expect(JSON.parse(list.text)[0].id).toBe(chat.id);
    expect(transcript.status).toBe(200);
    expect(JSON.parse(transcript.text)).toEqual(chat);
  });

  it("does not expose transcripts to a foreign browser origin", async () => {
    const chatStore = { list: vi.fn(() => []), get: vi.fn(() => null) };
    const { port } = await start({ chatStore });
    const response = await request(port, { path: "/api/chats", method: "GET", origin: "https://attacker.invalid" });
    expect(response.status).toBe(403);
    expect(chatStore.list).not.toHaveBeenCalled();
  });
});

describe("the loaded owner journey can tell when a newer interface is available", () => {
  it("serves the journey projection and binds the page to the same live revision as /api/meta", async () => {
    const { port } = await start();

    const page = await request(port, { path: "/", method: "GET" });
    const meta = await request(port, { path: "/api/meta", method: "GET" });
    const journey = await request(port, { path: "/journey.mjs", method: "GET" });
    const embedded = /const PAGE_REVISION = "([0-9a-f]{12})"/.exec(page.text)?.[1];

    expect(page.status).toBe(200);
    expect(journey.status).toBe(200);
    expect(journey.text).toContain("export function projectHistory");
    expect(embedded).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.parse(meta.text).revision).toBe(embedded);
  });
});

describe("the launcher window belongs only to the handoff", () => {
  it("does not force PowerShell to remain open after the launcher exits", () => {
    const command = launcherCommand("C:\\control\\compy-entry.ps1", { issue: 39 });
    expect(command.file).toBe("pwsh");
    expect(command.args).not.toContain("-NoExit");
    expect(command.args).toEqual(expect.arrayContaining(["-File", "C:\\control\\compy-entry.ps1"]));
    expect(command.args).toEqual(expect.arrayContaining(["-Issue", "39"]));
  });

  it("does not report success when Windows refuses to start the launcher", async () => {
    const launchProcess = vi.fn(async () => ({ ok: false, error: "pwsh could not start" }));
    const { port } = await start({ launchProcess, launcherExists: () => true });

    const response = await request(port, { path: "/api/launcher", body: { issue: 39 } });

    expect(response.status).toBe(500);
    expect(response.text).toMatch(/could not start/i);
    expect(launchProcess).toHaveBeenCalledOnce();
  });
});
