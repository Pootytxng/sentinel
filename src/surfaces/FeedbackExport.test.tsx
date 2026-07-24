// bug→guard for the outbound boundary of the in-app feedback surface. The whole safety claim of
// FeedbackExport is: NOTHING crosses the network. "Email it to me" must resolve to a LOCAL
// `mailto:` (the user's own mail client, they press send) and the report must be a LOCAL bundle —
// never an app-initiated POST. If a future edit swaps the mailto for a fetch/auto-send, these fail.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

const INTAKE_EMAIL = "christian.mcniel@gmail.com";

const RESULT = {
  path: "C:\\Users\\Kuya\\AppData\\Roaming\\Compy\\exports\\compy-report.md",
  json_path: "C:\\Users\\Kuya\\AppData\\Roaming\\Compy\\exports\\compy-report.json",
  markdown: "# Compy report\n\nfull body",
  discord: "**Compy** · RX 9070 XT · 16 cores · 29 GB",
};

// Capture every arg the surface hands to the two boundaries it can touch.
const invokeMock = vi.hoisted(() => vi.fn());
const openUrlMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

// Side-effect init of the shared i18n instance (English default) so the component's t() calls
// resolve to real English copy, not raw keys — the repo idiom for testing translated components.
// The setup file deliberately does NOT init i18n. This does not weaken any boundary assertion below.
import "../i18n";
import FeedbackExport from "./FeedbackExport";

beforeEach(() => {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "export_report") return Promise.resolve(RESULT);
    return Promise.resolve(null);
  });
  openUrlMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
  openUrlMock.mockReset();
});

describe("FeedbackExport — outbound boundary", () => {
  it("sends NOTHING on mount — no IPC, no URL opened until the user acts", () => {
    render(<FeedbackExport />);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  it("'Email it to me' opens a LOCAL mailto to the owner — never a network send", async () => {
    render(<FeedbackExport appVersion="0.9.4" buildStamp="aa3c610" />);
    fireEvent.change(screen.getByLabelText("Your feedback"), {
      target: { value: "coil whine on load screen" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Email it to me" }));

    await waitFor(() => expect(openUrlMock).toHaveBeenCalledTimes(1));
    const url = openUrlMock.mock.calls[0][0] as string;
    // The one boundary crossed is the OS mail handler — a local scheme, addressed to the owner.
    expect(url.startsWith(`mailto:${INTAKE_EMAIL}?`)).toBe(true);
    expect(url).not.toMatch(/^https?:/);
    // Subject/body are pre-filled; the user's note is carried (encoded).
    expect(decodeURIComponent(url)).toContain("coil whine on load screen");
    expect(decodeURIComponent(url)).toContain("v0.9.4");
    // The bundle it emailed about was built locally via export_report, feedback passed through.
    expect(invokeMock).toHaveBeenCalledWith("export_report", { feedback: "coil whine on load screen" });
  });

  it("blank note → feedback is null (backend appends no empty section), still local-only", async () => {
    render(<FeedbackExport />);
    fireEvent.click(screen.getByRole("button", { name: "Email it to me" }));
    await waitFor(() => expect(openUrlMock).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledWith("export_report", { feedback: null });
  });

  it("'Save a report file' writes the local bundle and opens NO url", async () => {
    render(<FeedbackExport />);
    fireEvent.click(screen.getByRole("button", { name: "Save a report file" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("export_report", { feedback: null }));
    // Saved path is surfaced; no mail client, no network.
    expect(await screen.findByText(RESULT.path)).toBeInTheDocument();
    expect(openUrlMock).not.toHaveBeenCalled();
  });
});
