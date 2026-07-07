import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

// bug -> guard (2026-07-07, honesty). The GPU vendor-honesty line — "AMD — verified · NVIDIA —
// implemented, not yet hardware-verified · Intel — planned" — is LOCKED rule #5's one user-visible
// surface, and it silently vanished: it lived inside MonitoringTab's `{!embedded && (...)}` header
// while BOTH live call sites mount <MonitoringTab embedded>, so the line was structurally
// unreachable on every shipped build (self-review catch on the e350607 pass). The fix hoists it
// out of the mode gate behind a sentinel comment; this guard makes the class un-repeatable:
// the wording must exist, exactly once, in the always-rendered region the sentinel marks —
// and that region must not grow a mode gate around it.

const app = readFileSync("src/App.tsx", "utf8");
const norm = app.replace(/\s+/g, " ");

describe("GPU vendor-honesty line is present and unconditionally rendered (LOCKED rule #5)", () => {
  it("carries the exact three-vendor honesty wording", () => {
    expect(norm).toContain("AMD — verified");
    expect(norm).toContain("NVIDIA — implemented, not yet hardware-verified");
    expect(norm).toContain("Intel — planned");
  });

  it("renders it exactly once, in the sentinel-marked always-rendered region, outside any mode gate", () => {
    const occurrences = app.split("coverage-note").length - 1;
    expect(occurrences, "exactly one coverage-note render site in App.tsx").toBe(1);

    const marker = app.indexOf("vendor-honesty: always rendered");
    const span = app.indexOf("coverage-note");
    // The banner's RENDER site (searched from the span — its import line sits at the file top).
    const banner = app.indexOf("MemoryPressureBanner", span);
    expect(marker, "the sentinel comment must exist").toBeGreaterThan(-1);
    expect(span, "the line must sit after the sentinel").toBeGreaterThan(marker);
    expect(banner, "…and before the next sibling block").toBeGreaterThan(span);

    // The regression shape: someone re-nests the span under an embedded/mode gate. The slice from
    // the sentinel to the span must contain no conditional-render opener.
    const slice = app.slice(marker, span);
    expect(/\{\s*!?\w+\s*&&/.test(slice), "no mode gate may wrap the honesty line").toBe(false);
  });
});
