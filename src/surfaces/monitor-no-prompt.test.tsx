import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MonitorConsole } from "./MonitorConsole";
import i18n from "../i18n";
import en from "../i18n/locales/en/monitor.json";
import zh from "../i18n/locales/zh-CN/monitor.json";

// D1-S1 (measure without an administrator prompt when the account already allows it). The Live room
// says so in ONE place, only when the backend reports `prompt_free`; otherwise it says nothing new.

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("./monitor/DeckScope", () => ({ DeckScope: () => <div data-testid="deck-scope" /> }));
vi.mock("./monitor/SessionStack", () => ({ SessionStack: () => <div data-testid="session-stack" /> }));

const idle = { active: false, status: "idle", sample: null };

function mockPolls(fps: unknown) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "get_cpu_sensors") {
      return Promise.resolve({ usage_overall_pct: 10, frequency_mhz: 4000, ram_used_bytes: 1, ram_total_bytes: 2 });
    }
    if (cmd === "get_gpu_sensors") return Promise.resolve([]);
    if (cmd === "get_fps_status") return Promise.resolve(fps);
    return Promise.resolve(null);
  });
}

beforeEach(() => localStorage.setItem("compy_motion", "reduced"));
afterEach(async () => {
  cleanup();
  localStorage.clear();
  invokeMock.mockReset();
  await i18n.changeLanguage("en");
});

const line = () => screen.queryByTestId("mc-no-prompt");

describe("Live room: the no-prompt line (D1-S1)", () => {
  it("the shipped wording, verbatim, in both languages: the mechanism, not a forecast (A2b)", () => {
    expect(en.monitorConsole.noPromptSetUp).toBe(
      "Your sign-in is in Performance Log Users, so Compy first tries to measure without an administrator prompt.",
    );
    expect(zh.monitorConsole.noPromptSetUp).toBe(
      "你的登录账户属于 Performance Log Users 组，因此 Compy 会先尝试在不弹出管理员提示的情况下进行采集。",
    );
    // It says what Compy tries, never that it will work ("is set up to" was a forecast).
    expect(en.monitorConsole.noPromptSetUp).toMatch(/first tries/);
    expect(en.monitorConsole.noPromptSetUp).not.toMatch(/is set up|will|always|never/i);
  });

  for (const lng of ["en", "zh-CN"] as const) {
    const words = lng === "en" ? en.monitorConsole.noPromptSetUp : zh.monitorConsole.noPromptSetUp;

    it(`${lng}: the line shows when the backend says prompt_free`, async () => {
      await i18n.changeLanguage(lng);
      mockPolls({ ...idle, prompt_free: true });
      render(<MonitorConsole active sessions={[]} onFpsActive={vi.fn()} />);
      await waitFor(() => expect(line()).not.toBeNull());
      expect(line()!.textContent).toBe(words);
    });

    it(`${lng}: no line when prompt_free is false, and none from an older build that never sends it`, async () => {
      await i18n.changeLanguage(lng);
      mockPolls({ ...idle, prompt_free: false });
      const { unmount } = render(<MonitorConsole active sessions={[]} onFpsActive={vi.fn()} />);
      await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("get_fps_status"));
      await new Promise((r) => setTimeout(r, 50));
      expect(line()).toBeNull();
      expect(screen.queryByText(words)).toBeNull();
      unmount();

      mockPolls(idle); // an older backend: the field is absent
      render(<MonitorConsole active sessions={[]} onFpsActive={vi.fn()} />);
      await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("get_fps_status"));
      await new Promise((r) => setTimeout(r, 50));
      expect(line()).toBeNull();
    });
  }

  it("offers no control: the line is plain text with no button or link in it", async () => {
    mockPolls({ ...idle, prompt_free: true });
    render(<MonitorConsole active sessions={[]} onFpsActive={vi.fn()} />);
    await waitFor(() => expect(line()).not.toBeNull());
    expect(line()!.querySelector("button, a, input")).toBeNull();
    expect(line()!.textContent).not.toMatch(/group|sign out|add (me|your)/i);
  });
});
