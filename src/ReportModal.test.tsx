import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// App's module graph touches Tauri APIs at import time — mock them before importing.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import { ReportModal } from "./App";

afterEach(cleanup);

const report = {
  path: "C:\\exports\\compy-report.md",
  json_path: "C:\\exports\\compy-report.json",
  markdown: "# Compy Report",
  discord: "```\nCOMPY\n```",
};

const baseProps = {
  report,
  onClose: vi.fn(),
  onOpenFolder: vi.fn(),
};

describe("ReportModal feedback capture", () => {
  it("renders the three optional feedback fields", () => {
    render(<ReportModal {...baseProps} onReexport={vi.fn()} />);
    expect(screen.getByText("In one sentence, what is Compy to you?")).toBeTruthy();
    expect(screen.getByText("Anything confuse you or feel off?")).toBeTruthy();
    expect(screen.getByText("What would you want next?")).toBeTruthy();
  });

  it("blank fields disable re-export — no empty feedback section can ever be requested", () => {
    const onReexport = vi.fn();
    render(<ReportModal {...baseProps} onReexport={onReexport} />);
    const btn = screen.getByRole("button", { name: "Add my feedback & re-export" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(onReexport).not.toHaveBeenCalled();
  });

  it("formats ONLY the filled fields and re-exports once on click", async () => {
    const onReexport = vi.fn().mockResolvedValue(undefined);
    render(<ReportModal {...baseProps} onReexport={onReexport} />);
    const boxes = screen.getAllByRole("textbox");
    fireEvent.change(boxes[0], { target: { value: "  my rig's safety net  " } });
    fireEvent.change(boxes[2], { target: { value: "per-game profiles" } });
    fireEvent.click(screen.getByRole("button", { name: "Add my feedback & re-export" }));
    await waitFor(() => expect(onReexport).toHaveBeenCalledTimes(1));
    const block = onReexport.mock.calls[0][0] as string;
    expect(block).toContain("**In one sentence:** my rig's safety net"); // trimmed
    expect(block).toContain("**Want next:** per-game profiles");
    expect(block).not.toContain("Confusing/off"); // empty field omitted
  });
});
