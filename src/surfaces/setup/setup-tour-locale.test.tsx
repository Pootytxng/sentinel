import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";

// CR-zh-gpu (codebase review 2026-11-03): the tour's hardware lessons, its recap and the tab blurbs
// were English in zh-CN — setup-steps.ts is a pure model with no `t`. The lessons now resolve
// through i18n with the English as the fallback. This renders the tour under zh-CN with a GPU and
// two memory modules and reads the GPU lesson, the memory title and the recap.

vi.mock("./HardwareTourScene", () => ({ HardwareTourScene: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
vi.mock("../rig/rig-parts", () => ({
  buildRigParts: () => [
    { id: "gpu-0", name: "Radeon RX 7900 XT", category: "Graphics", kind: "gpu", detected: true, assembled: [0, 0, 0], exploded: [0, 0, 0], tagline: "", specs: [] },
    { id: "ram-0", name: "Memory · Slot 1", category: "Memory", kind: "ram", detected: true, assembled: [0, 0, 0], exploded: [0, 0, 0], tagline: "", specs: [], capacityBytes: 16 * 1024 ** 3 },
    { id: "ram-1", name: "Memory · Slot 2", category: "Memory", kind: "ram", detected: true, assembled: [0, 0, 0], exploded: [0, 0, 0], tagline: "", specs: [], capacityBytes: 16 * 1024 ** 3 },
  ],
}));

import { SetupTour } from "./SetupTour";
import type { HardwareInfo } from "../../App";
import { ConfirmProvider } from "../../design/ConfirmDialog";
import i18n from "../../i18n";

afterEach(cleanup);
beforeEach(() => localStorage.clear());
afterEach(async () => {
  await i18n.changeLanguage("en");
});

const renderTour = () =>
  render(
    <ConfirmProvider>
      <SetupTour hw={{} as HardwareInfo} rig={[]} onDone={() => {}} />
    </ConfirmProvider>,
  );

const next = () => fireEvent.click(screen.getByRole("button", { name: /下一步|Next/ }));

describe("the tour's lessons and recap read whole in zh-CN", () => {
  it("the GPU lesson, the memory title and the recap are Chinese, with no English fallback left", async () => {
    await i18n.changeLanguage("zh-CN");
    renderTour();
    // 4 setup steps, then the lessons in catalog order: gpu, ram (psu/storage/cpu absent).
    for (let n = 0; n < 4; n++) next();
    expect(screen.getByText("显卡")).toBeTruthy();
    expect(screen.getByText("渲染你看到的每一帧——帧率的核心。")).toBeTruthy();
    expect(screen.getByText("硬件加速 GPU 调度——让 GPU 自己管理工作")).toBeTruthy();
    expect(screen.getByText("在“实时”页实时查看这些设置带来的帧数。")).toBeTruthy();
    expect(screen.queryByText(/Renders every frame|GRAPHICS|Live tab/)).toBeNull();
    next();
    expect(screen.getByText("内存 · 32.0 GB · 2 条")).toBeTruthy();
    expect(screen.queryByText(/modules|Memory ·/)).toBeNull();
    next();
    expect(screen.getByText("Compy 的地图")).toBeTruthy();
    expect(screen.getByText(/侧栏从上到下读/)).toBeTruthy();
    expect(screen.queryByText(/The rail reads top to bottom|Your way around Compy/)).toBeNull();
    // Desk review 2026-11-03: the recap's tab cards named the rooms in English beside a Chinese
    // rail; they resolve through the rail's own keys now.
    expect(screen.getByText("测试")).toBeTruthy();
    expect(screen.getByText("健康")).toBeTruthy();
    expect(screen.queryByText(/^(Health|Games|Problems|Live|History|Test)$/)).toBeNull();
  });

  // Desk review 2026-11-03: the seatbelt step said "the Lab tab", a rail label retired for "Test"
  // (en) / 测试 (zh-CN); it names the room the rail renders, in the rail's own words.
  it("the seatbelt step names the Test room as the rail labels it, in both languages", async () => {
    renderTour();
    next(); // rig → seatbelt
    const strongEn = Array.from(document.querySelectorAll("strong")).map((e) => e.textContent);
    expect(strongEn).toContain("Test");
    expect(strongEn).not.toContain("Lab");
    cleanup();
    await i18n.changeLanguage("zh-CN");
    renderTour();
    next();
    const strongZh = Array.from(document.querySelectorAll("strong")).map((e) => e.textContent);
    expect(strongZh).toContain("测试");
    expect(strongZh).not.toContain("Lab");
  });

  // s49 fresh-PC pass: the seatbelt demo hard-coded "Current: Balanced" for the power plan, untrue on
  // any PC not on Balanced (the tour has no live plan name). It states the recommendation only.
  it("the seatbelt demo makes no claim about the PC's current power plan, in both languages", async () => {
    renderTour();
    next();
    expect(document.querySelector(".st-demo-sub")?.textContent).toBe("Recommended: High performance");
    expect(document.body.textContent).not.toMatch(/Current: |Balanced/);
    cleanup();
    await i18n.changeLanguage("zh-CN");
    renderTour();
    next();
    expect(document.querySelector(".st-demo-sub")?.textContent).toBe("推荐:高性能");
    expect(document.body.textContent).not.toMatch(/当前|平衡/);
  });

  it("the English stays byte-identical in en", () => {
    renderTour();
    for (let n = 0; n < 4; n++) next();
    expect(screen.getByText("GRAPHICS")).toBeTruthy();
    expect(screen.getByText("Renders every frame you see — the heart of your frame rate.")).toBeTruthy();
    next();
    expect(screen.getByText("Memory · 32.0 GB · 2 modules")).toBeTruthy();
    next();
    expect(screen.getByText("Your way around Compy")).toBeTruthy();
  });
});
