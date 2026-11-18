import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

// §C: the build stamp arrives over the existing IPC probe pattern; everything else resolves null
// (ReceiptsConsent stays dark, toggles no-op) — same graceful paths as the no-mock days.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_build_stamp") return Promise.resolve("ab12cd3 · dev");
    if (cmd === "get_receipts_gate") return Promise.resolve(false);
    return Promise.resolve(null);
  }),
}));

import Settings from "./Settings";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const baseProps = {
  appVersion: "0.1.0",
  rulesSourceLabel: "Rules: Built-in",
  onBack: vi.fn(),
  canGoBack: false,
  onForward: vi.fn(),
  canGoForward: false,
  onRerunSetup: vi.fn(),
  onClose: vi.fn(),
};

describe("Settings", () => {
  it("renders the sections + the honest 'changes pixels only' tagline + privacy line", () => {
    render(<Settings {...baseProps} />);
    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByText("Behavior")).toBeInTheDocument();
    expect(screen.getByText(/None of this touches what Compy measures/)).toBeInTheDocument();
    // Privacy line names the ONE outbound call (updater armed 2026-07-22). An absolute
    // "nothing leaves your PC" here would be false — src/outbound-claim-guard.test.ts enforces it.
    expect(screen.getByText(/no telemetry — nothing about your rig is ever uploaded/)).toBeInTheDocument();
    expect(screen.getByText(/signed update check, and you can turn it off/)).toBeInTheDocument();
    expect(screen.getByText("v0.1.0")).toBeInTheDocument();
  });

  it("Motion is a Full/System/Reduced control (default Full, overrides OS)", () => {
    render(<Settings {...baseProps} />);
    const motion = screen.getByRole("group", { name: "Motion" });
    expect(motion).toBeInTheDocument();
    const full = within(motion).getByRole("button", { name: "Full" });
    expect(full.getAttribute("aria-pressed")).toBe("true");
    expect(within(motion).getByRole("button", { name: "Follow system" })).toBeInTheDocument();
    expect(within(motion).getByRole("button", { name: "Reduced" })).toBeInTheDocument();
    expect(screen.getByText(/living motion is on by default/i)).toBeInTheDocument();
  });

  it("Expert view is a genuine preference — present, default OFF, persists on toggle", () => {
    render(<Settings {...baseProps} />);
    const toggle = screen.getByRole("switch", { name: "Expert view" });
    // Default OFF: the default face stays the recovering-skeptic's simple one (spec 2026-07-11).
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    // Honest copy: says what it reveals AND that nothing new becomes appliable.
    expect(screen.getByText(/nothing new becomes appliable/)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem("compy_expert_view")).toBe("1");
    fireEvent.click(toggle);
    expect(localStorage.getItem("compy_expert_view")).toBe("0");
  });

  it("Done calls onClose", () => {
    const onClose = vi.fn();
    render(<Settings {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByText("Done"));
    expect(onClose).toHaveBeenCalled();
  });

  it("§C: About carries the compile-time build stamp (review hygiene / receipts-for-builds)", async () => {
    render(<Settings {...baseProps} />);
    expect(await screen.findByText(/ab12cd3 · dev/)).toBeInTheDocument();
  });
});

// s44 tester pass: the Support-record preview scrolled sideways in a ~300 px tile, and the Motion
// row's text was squeezed into a narrow column beside its three-way picker.
describe("Settings layout (CSS contract)", () => {
  const css = readFileSync(join("src", "surfaces", "Settings.css"), "utf8");
  const rule = (selector: string) => {
    const open = css.indexOf(`\n${selector} {`); // at a line start: not the tile-scoped `.v2-tile-third .set-row {`
    expect(open, `${selector} rule missing from Settings.css`).toBeGreaterThan(-1);
    return css.slice(open, css.indexOf("}", open));
  };

  it("the support-record preview wraps its lines and has no horizontal scrollbar", () => {
    const pre = rule(".receipts-preview.sev-text");
    expect(pre).toContain("white-space: pre-wrap");
    expect(pre).toContain("overflow-x: hidden");
  });

  it("a row lets a wide control drop under its text, and its text keeps a readable column", () => {
    expect(rule(".set-row")).toContain("flex-wrap: wrap");
    expect(rule(".set-row-text")).toMatch(/flex:\s*1 1 \d+px/);
  });

  it("in a narrow tile, where the row is a column, the text has no flex-basis (it would become a height)", () => {
    expect(rule(".v2-tile-third .set-row,\n.v2-tile-quarter .set-row")).toContain("flex-direction: column");
    expect(css).toContain(".v2-tile-third .set-row-text,\n.v2-tile-quarter .set-row-text {");
    const narrow = rule(".v2-tile-quarter .set-row-text");
    expect(narrow).toMatch(/flex:\s*0 1 auto/);
    // It must come AFTER the base rule, or equal-or-lower specificity order would let the 220px win.
    expect(css.indexOf(".v2-tile-quarter .set-row-text {")).toBeGreaterThan(css.indexOf("\n.set-row-text {"));
  });
});