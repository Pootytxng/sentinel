import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the opener at the module boundary BEFORE importing guided.ts so the real
// Tauri plugin (which would throw outside a webview) is never touched. guided.ts
// imports `openUrl` from this module — match that import exactly.
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { openUrl } from "@tauri-apps/plugin-opener";
import { openGuidedUri, ALLOWED_OPEN_URIS, GUIDED_STEPS } from "./guided";

const openUrlMock = vi.mocked(openUrl);

// The exact, fixed deep links guided.ts defines on its Guide entries. This is the
// security allowlist — only these ms-settings: targets may ever be opened.
const EXPECTED_ALLOWED = [
  "ms-settings:display-advancedgraphics",
  "ms-settings:display-advanced",
  "ms-settings:storagesense",
];

beforeEach(() => {
  openUrlMock.mockReset();
});

describe("ALLOWED_OPEN_URIS (security allowlist)", () => {
  it("is non-empty", () => {
    expect(ALLOWED_OPEN_URIS.size).toBeGreaterThan(0);
  });

  it("contains exactly the fixed ms-settings: targets the code defines", () => {
    expect([...ALLOWED_OPEN_URIS].sort()).toEqual([...EXPECTED_ALLOWED].sort());
  });

  it("is derived from the GUIDED_STEPS openUri values (no extras, no drift)", () => {
    const fromSteps = Object.values(GUIDED_STEPS)
      .map((g) => g.openUri)
      .filter((u): u is string => Boolean(u));
    expect([...ALLOWED_OPEN_URIS].sort()).toEqual([...new Set(fromSteps)].sort());
  });

  it("only ever holds ms-settings: scheme entries", () => {
    for (const uri of ALLOWED_OPEN_URIS) {
      expect(uri.startsWith("ms-settings:")).toBe(true);
    }
  });
});

describe("openGuidedUri — happy path", () => {
  it("opens an allowlisted URI exactly once with that URI", async () => {
    const uri = "ms-settings:storagesense";
    expect(ALLOWED_OPEN_URIS.has(uri)).toBe(true);

    await openGuidedUri(uri);

    expect(openUrlMock).toHaveBeenCalledTimes(1);
    expect(openUrlMock).toHaveBeenCalledWith(uri);
  });

  it("opens every allowlisted URI (each defined target is reachable)", async () => {
    for (const uri of ALLOWED_OPEN_URIS) {
      openUrlMock.mockReset();
      await openGuidedUri(uri);
      expect(openUrlMock).toHaveBeenCalledTimes(1);
      expect(openUrlMock).toHaveBeenCalledWith(uri);
    }
  });

  it("swallows an opener failure without throwing (written steps still stand)", async () => {
    openUrlMock.mockRejectedValueOnce(new Error("opener unavailable"));
    await expect(openGuidedUri("ms-settings:display-advanced")).resolves.toBeUndefined();
    expect(openUrlMock).toHaveBeenCalledTimes(1);
  });
});

describe("openGuidedUri — null result (off-allowlist must NOT open)", () => {
  it("does not open an unlisted ms-settings: path", async () => {
    // Same scheme, different (unlisted) page — the kind of thing an attacker
    // would try to smuggle past a naive scheme-only check.
    await openGuidedUri("ms-settings:windowsupdate");
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  it("does not open a different / dangerous scheme", async () => {
    const offList = [
      "https://example.com",
      "file:///c:/windows/system32/cmd.exe",
      "javascript:void(0)",
      "shell:startup",
      "ms-windows-store://",
      "",
    ];
    for (const uri of offList) {
      openUrlMock.mockReset();
      expect(ALLOWED_OPEN_URIS.has(uri)).toBe(false);
      await openGuidedUri(uri);
      expect(openUrlMock).not.toHaveBeenCalled();
    }
  });

  it("treats the allowlist literally — a prefix or trailing-char mutation is rejected", async () => {
    // Membership is exact Set lookup; near-misses of a real entry must not slip through.
    const allowed = [...ALLOWED_OPEN_URIS][0];
    const mutations = [
      allowed + "x", // trailing char
      allowed.toUpperCase(), // case mismatch
      " " + allowed, // leading whitespace
      allowed + " ", // trailing whitespace
    ];
    for (const uri of mutations) {
      openUrlMock.mockReset();
      expect(ALLOWED_OPEN_URIS.has(uri)).toBe(false);
      await openGuidedUri(uri);
      expect(openUrlMock).not.toHaveBeenCalled();
    }
  });
});

describe("GUIDED_STEPS — Guide shape", () => {
  const VALID_STATES = new Set(["needs-action", "unknown"]);

  it("is non-empty", () => {
    expect(Object.keys(GUIDED_STEPS).length).toBeGreaterThan(0);
  });

  it("every entry satisfies the Guide type contract", () => {
    for (const [id, guide] of Object.entries(GUIDED_STEPS)) {
      expect(typeof guide.where, id).toBe("string");
      expect(guide.where.length, id).toBeGreaterThan(0);

      expect(Array.isArray(guide.steps), id).toBe(true);
      expect(guide.steps.length, id).toBeGreaterThan(0);
      for (const step of guide.steps) {
        expect(typeof step, id).toBe("string");
        expect(step.length, id).toBeGreaterThan(0);
      }

      expect(VALID_STATES.has(guide.state), `${id} state=${guide.state}`).toBe(true);

      // Optional fields, when present, are well-typed and an openUri is allowlisted.
      if (guide.openUri !== undefined) {
        expect(typeof guide.openUri, id).toBe("string");
        expect(ALLOWED_OPEN_URIS.has(guide.openUri), id).toBe(true);
      }
      if (guide.openLabel !== undefined) {
        expect(typeof guide.openLabel, id).toBe("string");
        expect(guide.openLabel.length, id).toBeGreaterThan(0);
      }
    }
  });

  it("any entry with an openLabel also carries an openUri (the button has a target)", () => {
    for (const [id, guide] of Object.entries(GUIDED_STEPS)) {
      if (guide.openLabel !== undefined) {
        expect(guide.openUri, id).toBeDefined();
      }
    }
  });
});
