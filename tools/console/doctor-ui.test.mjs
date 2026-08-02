import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createDoctorController, mountDoctor } from "./doctor-ui.mjs";
import { renderCheckup, renderProblems } from "./doctor-view.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(here, "doctor.html"), "utf8");
const CSS = readFileSync(join(here, "doctor.css"), "utf8");

describe("Project Doctor owner journey", () => {
  it("has exactly Checkup, Problems, and Repairs as primary navigation", () => {
    const nav = /<nav[^>]*aria-label="Project Doctor"[^>]*>([\s\S]*?)<\/nav>/.exec(PAGE)?.[1] ?? "";
    expect(nav.match(/data-view=/g)).toHaveLength(3);
    expect(nav).toMatch(/Checkup/); expect(nav).toMatch(/Problems/); expect(nav).toMatch(/Repairs/);
    expect(nav).not.toMatch(/Continue|Start|History|Chat/);
  });

  it("renders the four-part problem grammar and exactly one primary action", () => {
    const html = renderProblems([{ code: "DIRTY_WORKTREE", fingerprint: "x", project: "sentinel", scope: "folder", priority: "broken", state: "new", subject: {}, evidence: [] }]);
    for (const copy of ["What happened", "Why it matters", "Compy recommends"]) expect(html).toContain(copy);
    expect((html.match(/data-primary-action=/g) ?? [])).toHaveLength(1);
  });

  it("runs light scans at 60 seconds and slow scans every fifth cycle without overlap", async () => {
    vi.useFakeTimers();
    const scan = vi.fn(async () => ({ generatedAt: "now", findings: [] }));
    const controller = createDoctorController({ scan, render: vi.fn(), announce: vi.fn(), visible: () => true });
    await controller.start();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(scan.mock.calls.map(([x]) => x.slow)).toEqual([true, false, false, false, false, true]);
    controller.stop(); vi.useRealTimers();
  });

  it("uses one light scan when the page becomes visible again", async () => {
    const scan = vi.fn(async () => ({ generatedAt: "now", findings: [] }));
    const controller = createDoctorController({ scan, render: vi.fn(), announce: vi.fn(), visible: () => true, setTimer: vi.fn() });
    await controller.start();
    await controller.scanLight();
    expect(scan.mock.calls.map(([x]) => x.slow)).toEqual([true, false]);
  });

  it("handles an automatic scan error without leaving the controller rejected", async () => {
    const onError = vi.fn();
    const controller = createDoctorController({ scan: vi.fn(async () => { throw new Error("offline"); }), render: vi.fn(), announce: vi.fn(), visible: () => true, onError, setTimer: vi.fn() });
    await expect(controller.start()).resolves.toEqual(undefined);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("renders a plain error state instead of initial loading copy", () => {
    expect(renderCheckup({ error: true })).toContain("Project Doctor could not complete this scan.");
  });

  it("keeps keyboard focus on the selected navigation control", () => {
    document.body.innerHTML = `<main id="doctorMain"></main><div id="scanStatus"></div><div id="doctorAnnouncer"></div><div id="sourceDetails"></div><span id="problemCount"></span><span id="repairCount"></span><button id="scanNow"></button><nav><button data-view="checkup">Checkup</button><button data-view="problems">Problems</button></nav><section id="checkup" data-pane="checkup"></section><section id="problems" data-pane="problems" hidden></section><section id="repairs" data-pane="repairs" hidden></section>`;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ generatedAt: "now", findings: [] }) })));
    mountDoctor();
    const problems = document.querySelector('[data-view="problems"]');
    problems.focus(); problems.click();
    expect(document.activeElement).toBe(problems);
    vi.unstubAllGlobals(); document.body.innerHTML = "";
  });

  it("contains no automatic agent or chat request", () => {
    const source = readFileSync(join(here, "doctor-ui.mjs"), "utf8");
    expect(source).not.toMatch(/\/api\/chat|claude(?:\.exe)?|codex(?:\.exe)?|localStorage|sessionStorage|showNotification|new Notification/i);
  });

  it("does not announce an unchanged finding again", async () => {
    const announce = vi.fn();
    const scan = vi.fn(async () => ({ generatedAt: "now", findings: [{ fingerprint: "x", priority: "owner", state: "unchanged" }] }));
    const controller = createDoctorController({ scan, render: vi.fn(), announce, visible: () => true, setTimer: vi.fn() });
    await controller.start();
    expect(announce).not.toHaveBeenCalled();
  });

  it("shows existing findings on first open without calling them newly discovered", async () => {
    const announce = vi.fn();
    const snapshots = [
      { generatedAt: "one", findings: [{ fingerprint: "old", state: "new" }] },
      { generatedAt: "two", findings: [{ fingerprint: "old", state: "unchanged" }, { fingerprint: "new", state: "new" }] },
    ];
    const controller = createDoctorController({ scan: vi.fn(async () => snapshots.shift()), render: vi.fn(), announce, visible: () => true, setTimer: vi.fn() });
    await controller.start();
    expect(announce).not.toHaveBeenCalled();
    await controller.scanNow();
    expect(announce).toHaveBeenCalledWith("1 thing needs attention.");
  });

  it("has visible focus, reduced motion, and color-independent state labels", () => {
    expect(CSS).toMatch(/:focus-visible/);
    expect(CSS).toMatch(/#doctorMain:focus\{outline:none\}/);
    expect(CSS).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(PAGE).toMatch(/id="doctorAnnouncer"[^>]*aria-live="polite"/);
    expect(PAGE).toMatch(/id="scanStatus"[^>]*role="status"/);
    expect(PAGE).toMatch(/Checking your project…/);
  });
});
