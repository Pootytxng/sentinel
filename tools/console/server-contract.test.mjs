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
