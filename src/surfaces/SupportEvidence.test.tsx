// Q5 guard for the in-app half of the support record (spec 2026-07-29 §12). The Rust side already
// enforces "preview before export" and does its own redaction; what can only break HERE is the
// user-facing contract around it:
//   · nothing is read until the user asks for it;
//   · the save control does not exist until a preview has actually come back (the UI mirrors the
//     backend's ordering gate instead of offering a control that will be refused);
//   · the projection the user is LOOKING at is the projection that gets exported;
//   · retention numbers are rendered from the bundle, so this copy cannot drift from the caps the
//     backend enforces;
//   · a backend refusal is surfaced, not swallowed;
//   · clearing is a two-step, and the panel re-reads afterwards instead of showing the record the
//     user just deleted.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

const BUNDLE = {
  app_version: "0.9.4",
  build_stamp: "aa3c610 · release",
  generated_at: "2026-08-04T09:12:00+00:00",
  retention: { max_events: 400, max_bytes: 256000, max_record_bytes: 640 },
  location: "C:\\Users\\<user>\\AppData\\Roaming\\Compy\\support",
  events: [
    { at: "2026-08-04T09:00:00+00:00", kind: "lifecycle", operation: "app_start", code: "start", outcome: "ok", detail: "" },
    { at: "2026-08-04T09:05:00+00:00", kind: "operation", operation: "apply", code: "power_plan", outcome: "refused", detail: "declined at the admin prompt" },
  ],
  unreadable_records: 0,
};

const PREVIEW = {
  bundle: BUNDLE,
  consumer: "CONSUMER-PROJECTION-BODY",
  technical: "TECHNICAL-PROJECTION-BODY",
  support: "SUPPORT-PROJECTION-BODY",
};

const EXPORTED = {
  path: "C:\\Users\\Kuya\\AppData\\Roaming\\Compy\\exports\\compy-support-support-20260804.md",
  json_path: "C:\\Users\\Kuya\\AppData\\Roaming\\Compy\\exports\\compy-support-support-20260804.json",
  projection: "support",
  events: 2,
};

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

// Side-effect init of the shared i18n instance so t() resolves to real English copy, not raw keys.
import "../i18n";
import SupportEvidence from "./SupportEvidence";

const PREVIEW_LABEL = "What the support record contains";

function stdInvoke(preview: unknown = PREVIEW) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "preview_support_evidence") return Promise.resolve(preview);
    if (cmd === "export_support_evidence") return Promise.resolve(EXPORTED);
    return Promise.resolve(null);
  });
}

async function readIt() {
  fireEvent.click(screen.getByRole("button", { name: "Show me what's in it" }));
  await screen.findByRole("group", { name: PREVIEW_LABEL });
}

beforeEach(() => stdInvoke());
afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("SupportEvidence — inspect before export", () => {
  it("reads nothing on mount, and offers no save control until a preview came back", async () => {
    render(<SupportEvidence />);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save this as a file" })).toBeNull();

    await readIt();
    expect(invokeMock).toHaveBeenCalledWith("preview_support_evidence");
    expect(screen.getByRole("button", { name: "Save this as a file" })).toBeInTheDocument();
  });

  it("shows the plain-English projection first, and switches without re-reading the disk", async () => {
    render(<SupportEvidence />);
    await readIt();
    const pre = () => screen.getByRole("group", { name: PREVIEW_LABEL });
    expect(pre().textContent).toBe(PREVIEW.consumer);

    fireEvent.click(screen.getByRole("button", { name: "Every record" }));
    expect(pre().textContent).toBe(PREVIEW.technical);
    fireEvent.click(screen.getByRole("button", { name: "For support" }));
    expect(pre().textContent).toBe(PREVIEW.support);

    // One bundle carries all three projections, so switching is a re-render, not a second read.
    expect(invokeMock.mock.calls.filter((c) => c[0] === "preview_support_evidence")).toHaveLength(1);
  });

  it("exports the projection the user is looking at, not a fixed one", async () => {
    render(<SupportEvidence />);
    await readIt();
    fireEvent.click(screen.getByRole("button", { name: "For support" }));
    fireEvent.click(screen.getByRole("button", { name: "Save this as a file" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("export_support_evidence", { projection: "support" }),
    );
    expect(await screen.findByText(EXPORTED.path)).toBeInTheDocument();
  });

  it("renders the retention caps from the bundle rather than a hard-coded copy of them", async () => {
    stdInvoke({
      ...PREVIEW,
      bundle: { ...BUNDLE, retention: { max_events: 120, max_bytes: 61440, max_record_bytes: 320 } },
    });
    render(<SupportEvidence />);
    await readIt();
    // If a future edit tightens the caps in Rust, this copy follows on its own.
    expect(
      screen.getByText(/Compy keeps the newest 120 records \(about 60 KB\)/),
    ).toBeInTheDocument();
  });

  it("surfaces a backend refusal instead of swallowing it", async () => {
    render(<SupportEvidence />);
    await readIt();
    invokeMock.mockImplementationOnce(() => Promise.reject("Preview the support evidence first."));
    fireEvent.click(screen.getByRole("button", { name: "Save this as a file" }));

    expect(await screen.findByText(/Couldn't save the file\..*Preview the support evidence first\./))
      .toBeInTheDocument();
    expect(screen.queryByText(EXPORTED.path)).toBeNull();
  });

  it("makes clearing a two-step that states the consequence, then re-reads", async () => {
    render(<SupportEvidence />);
    await readIt();

    fireEvent.click(screen.getByRole("button", { name: "Clear the record" }));
    expect(invokeMock).not.toHaveBeenCalledWith("clear_support_evidence");
    // The consequence docs/PRIVACY.md names — clear it AFTER a support conversation, not before.
    expect(screen.getByText(/clear it after a support conversation, not before/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("button", { name: "Yes, clear it" })).toBeNull();
    expect(invokeMock).not.toHaveBeenCalledWith("clear_support_evidence");

    fireEvent.click(screen.getByRole("button", { name: "Clear the record" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, clear it" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("clear_support_evidence"));
    // Re-read: the panel must show the empty record it now is, not the one just deleted.
    await waitFor(() =>
      expect(invokeMock.mock.calls.filter((c) => c[0] === "preview_support_evidence")).toHaveLength(2),
    );
  });

  it("counts an empty record honestly rather than reporting '0 records'", async () => {
    stdInvoke({ ...PREVIEW, bundle: { ...BUNDLE, events: [] } });
    render(<SupportEvidence />);
    await readIt();
    expect(screen.getByText(/Nothing recorded yet/)).toBeInTheDocument();
  });

  it("discloses records it could not read, so a short log never reads as a clean one", async () => {
    stdInvoke({ ...PREVIEW, bundle: { ...BUNDLE, unreadable_records: 3 } });
    render(<SupportEvidence />);
    await readIt();
    expect(screen.getByText(/3 records couldn't be read and were left out\./)).toBeInTheDocument();
  });
});
