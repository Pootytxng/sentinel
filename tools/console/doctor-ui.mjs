import { renderCheckup, renderProblems, renderRepairs } from "./doctor-view.mjs";

export const LIGHT_SCAN_MS = 60_000;
export const SLOW_EVERY = 5;

export function createDoctorController({ scan, render, announce, visible, onError = () => {}, setTimer = setInterval, clearTimer = clearInterval }) {
  let snapshot = null, receipts = [], scanCount = 0, inFlight = false, timer = null;
  const run = async ({ forceSlow = false } = {}) => {
    if (inFlight || !visible()) return { skipped: true };
    inFlight = true;
    const slow = forceSlow || scanCount % SLOW_EVERY === 0;
    try {
      const next = await scan({ slow });
      if (next.busy) return next;
      const attention = next.findings.filter((item) => item.state === "new" || item.state === "worsened");
      const firstRender = snapshot === null;
      snapshot = next; scanCount += 1;
      render({ snapshot, receipts });
      if (!firstRender && attention.length) announce(`${attention.length} ${attention.length === 1 ? "thing needs" : "things need"} attention.`);
      return next;
    } catch (error) {
      onError(error);
      return { error: true };
    } finally { inFlight = false; }
  };
  return {
    start: async () => { await run({ forceSlow: true }); timer = setTimer(() => run(), LIGHT_SCAN_MS); },
    stop: () => { if (timer) clearTimer(timer); timer = null; },
    scanNow: () => run({ forceSlow: true }),
    scanLight: () => run(),
    snapshot: () => snapshot,
  };
}

export function mountDoctor() {
  const status = document.querySelector("#scanStatus");
  const announcer = document.querySelector("#doctorAnnouncer");
  const sourceDetails = document.querySelector("#sourceDetails");
  const problemCount = document.querySelector("#problemCount");
  const repairCount = document.querySelector("#repairCount");
  const scanNow = document.querySelector("#scanNow");
  let activeView = "checkup";

  const setView = (view) => {
    activeView = view;
    document.body.dataset.view = view;
    document.querySelectorAll("[data-pane]").forEach((pane) => { pane.hidden = pane.dataset.pane !== view; });
    document.querySelectorAll("nav [data-view]").forEach((button) => {
      if (button.dataset.view === view) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  };

  const render = ({ snapshot, receipts }) => {
    const findings = snapshot.findings ?? [];
    document.querySelector("#checkup").innerHTML = renderCheckup({ snapshot });
    document.querySelector("#problems").innerHTML = renderProblems(findings);
    document.querySelector("#repairs").innerHTML = renderRepairs(findings, receipts);
    problemCount.textContent = String(findings.length);
    repairCount.textContent = String(receipts.length);
    status.textContent = `Checked ${new Date(snapshot.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
    sourceDetails.textContent = snapshot.generatedAt ? `Scan recorded ${snapshot.generatedAt}.` : "No scan details are available.";
  };

  const scan = async ({ slow }) => {
    status.textContent = "Scanning…";
    scanNow.disabled = true;
    try {
      const response = await fetch(`/api/doctor/scan?slow=${slow ? 1 : 0}`);
      if (response.status === 409) return { busy: true };
      if (!response.ok) throw new Error(`scan failed (${response.status})`);
      return response.json();
    } finally { scanNow.disabled = false; }
  };

  const controller = createDoctorController({
    scan,
    render,
    announce: (message) => { announcer.textContent = message; },
    visible: () => document.visibilityState === "visible",
    onError: () => {
      status.textContent = "Project Doctor could not complete this scan.";
      if (!controller.snapshot()) document.querySelector("#checkup").innerHTML = renderCheckup({ error: true });
    },
  });

  document.querySelectorAll("nav [data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  scanNow.addEventListener("click", async () => {
    try {
      const result = await controller.scanNow();
      if (result.busy) status.textContent = "A scan is already in progress.";
    } catch { status.textContent = "Project Doctor could not complete this scan."; }
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") controller.scanLight(); });
  controller.start().catch(() => { status.textContent = "Project Doctor could not complete this scan."; });
  return { controller, activeView: () => activeView };
}

if (typeof document !== "undefined" && document.querySelector("#doctorMain")) mountDoctor();
