// R3 Lane C3 — the consent surface stays DARK while the backend gate is false, and the
// inspect-your-receipt preview renders EXACTLY what the backend would share when (in a future
// owner-signed build) the gate is up.
//
// Q9a (2026-08-25) added the send path, so this now also pins the two things that stand between a
// built path and a byte leaving the machine: the FIRST-RUN DISCLOSURE and a REAL off switch. Both
// are obligations under the Capability Exception Gate's Tier 2 record, and the owner's #207 ruling
// makes the third — opt-in, default OFF, and it STAYS off after arming — pinned here too. The
// backend refuses in the order gate → disclosure → switch (receipts::send_decision); these tests
// assert the UI cannot present a state that order would not honour.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";

// `consent` is the backend's stored ConsentState. `null` disclosed_at = a fresh install.
const gateMock = vi.hoisted(() => ({
  enabled: false,
  consent: { disclosed_at: null as string | null, enabled: null as boolean | null },
}));

const ENDPOINT = "https://compy-bd6.pages.dev/api/usage";

const PAYLOAD = {
  schema_version: 1,
  hw_class: { gpu_vendor: "amd", gpu_model: "radeon rx 9070 xt", cpu_family: "ryzen x3d-class", ram_gb_bucket: "25-32" },
  outcome: {
    kind: "session",
    game: "game",
    avg_fps: 141.2,
    low1_fps_est: 118,
    duration_bucket: "30-60min",
    active_change_ids: ["hags"],
  },
};

// The mock is a small STATE MACHINE, not a stub bag: the consent commands mutate `gateMock.consent`
// the way the Rust ones mutate receipts-consent.json. A stub returning a fixed object would pass
// even if the UI never sent the user's choice anywhere.
const invokeSpy = vi.hoisted(() => ({ calls: [] as { cmd: string; args?: unknown }[] }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string, args?: Record<string, unknown>) => {
    invokeSpy.calls.push({ cmd, args });
    if (cmd === "get_receipts_gate") return Promise.resolve(gateMock.enabled);
    if (!gateMock.enabled) return Promise.reject("Receipts sharing isn't part of this build yet.");
    if (cmd === "get_receipts_consent") return Promise.resolve({ ...gateMock.consent });
    if (cmd === "get_receipts_endpoint") return Promise.resolve(ENDPOINT);
    if (cmd === "acknowledge_receipts_disclosure") {
      gateMock.consent.disclosed_at ??= "2026-08-25T00:00:00Z";
      return Promise.resolve({ ...gateMock.consent });
    }
    if (cmd === "set_receipts_sharing_enabled") {
      gateMock.consent.enabled = args?.enabled as boolean;
      return Promise.resolve({ ...gateMock.consent });
    }
    if (cmd === "preview_receipt_payload") return Promise.resolve(PAYLOAD);
    return Promise.resolve(null);
  }),
}));

import ReceiptsConsent from "./ReceiptsConsent";

afterEach(() => {
  cleanup();
  gateMock.enabled = false;
  gateMock.consent = { disclosed_at: null, enabled: null };
  invokeSpy.calls = [];
});

/** Arm the gate with a consent state already stored, as a returning user would have. */
function armed(consent: Partial<{ disclosed_at: string | null; enabled: boolean | null }> = {}) {
  gateMock.enabled = true;
  gateMock.consent = { disclosed_at: null, enabled: null, ...consent };
}

describe("ReceiptsConsent (dark)", () => {
  it("renders NOTHING while the backend gate is hard-false (every shipped build today)", async () => {
    const { container } = render(<ReceiptsConsent />);
    // Settle the gate probe, then assert total darkness.
    await waitFor(() => expect(container.innerHTML).toBe(""));
    expect(screen.queryByTestId("receipts-consent")).toBeNull();
  });

  it("asks the backend NOTHING about the user while dark", async () => {
    const { container } = render(<ReceiptsConsent />);
    await waitFor(() => expect(container.innerHTML).toBe(""));
    // A dark build probes the gate and stops. Reading consent — even to render a switch nobody
    // sees — would be the app taking an interest in a decision it has no right to act on.
    expect(invokeSpy.calls.map((c) => c.cmd)).toEqual(["get_receipts_gate"]);
  });

  it("when a future build flips the gate: consent copy + the exact inspectable payload render", async () => {
    armed();
    render(<ReceiptsConsent />);
    expect(await screen.findByTestId("receipts-consent")).toBeInTheDocument();
    expect(screen.getByText(/Off by default, anonymous by design/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Inspect your receipt" }));
    // What you see is what would send — the rendered preview IS the payload, verbatim.
    const pre = await screen.findByText(/"schema_version": 1/);
    expect(pre.textContent).toBe(JSON.stringify(PAYLOAD, null, 2));
    expect(pre.textContent).not.toContain("Users");
  });
});

describe("ReceiptsConsent — first-run disclosure", () => {
  it("shows the disclosure, names the one endpoint, and offers no switch yet", async () => {
    armed();
    render(<ReceiptsConsent />);
    expect(await screen.findByTestId("receipts-disclosure")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(ENDPOINT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeInTheDocument();
    // The switch belongs to a user who has been told. Painting it here would let someone flip
    // sharing on having read nothing.
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByTestId("receipts-switch")).toBeNull();
  });

  it("declining still records that you were told, and leaves sharing OFF", async () => {
    armed();
    render(<ReceiptsConsent />);
    fireEvent.click(await screen.findByRole("button", { name: "No thanks — keep it off" }));
    await screen.findByTestId("receipts-switch");
    // Disclosed and off: the two facts are separate, and declining sets exactly one of them.
    expect(gateMock.consent.disclosed_at).not.toBeNull();
    expect(gateMock.consent.enabled).toBeNull();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(invokeSpy.calls.some((c) => c.cmd === "set_receipts_sharing_enabled")).toBe(false);
  });

  it("accepting records BOTH facts, and acknowledges before it opts in", async () => {
    armed();
    render(<ReceiptsConsent />);
    fireEvent.click(await screen.findByRole("button", { name: "Share anonymous results" }));
    await waitFor(() => expect(gateMock.consent.enabled).toBe(true));
    expect(gateMock.consent.disclosed_at).not.toBeNull();
    // Order matters: a failure between the two calls must leave the user disclosed-but-off, never
    // opted-in-but-undisclosed.
    const cmds = invokeSpy.calls.map((c) => c.cmd);
    expect(cmds.indexOf("acknowledge_receipts_disclosure")).toBeLessThan(
      cmds.indexOf("set_receipts_sharing_enabled"),
    );
  });
});

describe("ReceiptsConsent — the off switch is real", () => {
  it("a disclosed user who never opted in is still OFF (default-OFF survives arming, #207)", async () => {
    armed({ disclosed_at: "2026-08-25T00:00:00Z" });
    render(<ReceiptsConsent />);
    expect(await screen.findByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/Off\. Nothing about your PC or your sessions is sent\./)).toBeInTheDocument();
  });

  it("turns sharing off again — it is not a one-way door", async () => {
    armed({ disclosed_at: "2026-08-25T00:00:00Z", enabled: true });
    render(<ReceiptsConsent />);
    const sw = await screen.findByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    await waitFor(() => expect(gateMock.consent.enabled).toBe(false));
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    // The last write is what the backend will read at send time.
    const last = invokeSpy.calls.filter((c) => c.cmd === "set_receipts_sharing_enabled").pop();
    expect(last?.args).toEqual({ enabled: false });
  });

  it("a backend refusal never paints an ON switch the backend would not honour", async () => {
    armed({ disclosed_at: "2026-08-25T00:00:00Z" });
    render(<ReceiptsConsent />);
    const sw = await screen.findByRole("switch");
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockRejectedValueOnce("consent store is read-only");
    fireEvent.click(sw);
    expect(await screen.findByText(/consent store is read-only/)).toBeInTheDocument();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });
});
