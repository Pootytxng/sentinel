import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// bug → guard (2026-07-08, owner clip: docs/superpowers/specs/assets/2026-07-07-holo-flicker/).
// The vendored holographic material's upstream "blink" is a PER-FRAME time-hash — flicker() at
// HolographicMaterial.tsx re-rolls blink ∈ [0.6−signalSpeed, 1] on every rendered frame. Every
// Compy mount is a DoubleSide ADDITIVE translucent box shell, and a translucent box shows its
// BACK faces everywhere — which sit at max fresnel across the whole silhouette — so the upstream
// "rim blink" actually pumps the WHOLE case: irregular single-frame luma jumps (measured ±2-4
// mean-Y, ~5-8%, Bloom-amplified) that wash out the parts inside whenever the frameloop runs
// continuously (orbit on). Second flicker defect on this surface (T1.5 was idle-repaint churn;
// this one is in-frame shader randomness) → the class is mechanized here:
//
//   NO mount of HolographicMaterial may enable the per-frame blink term. A shell that should
//   feel alive animates via the smooth scanline terms (signalSpeed), never the frame hash.

const VENDOR_DIR = join("src", "design", "vendor");

function tsxFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFilesUnder(p));
    else if (name.endsWith(".tsx") && !name.includes(".test.")) out.push(p);
  }
  return out;
}

describe("holo shell blink guard — no per-frame random luma term on any shell", () => {
  it("every <HolographicMaterial> mount pins enableBlinking={false}", () => {
    const files = tsxFilesUnder("src").filter((f) => !f.startsWith(VENDOR_DIR));
    const mounts: { file: string; openingTag: string }[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      // Opening tag = everything up to the first `>` (no prop here contains `>`; if one ever
      // does, this match truncates and the assert below fails loudly — which forces a look).
      for (const m of src.match(/<HolographicMaterial\b[\s\S]*?>/g) ?? []) {
        mounts.push({ file, openingTag: m });
      }
    }
    // The bay shell + the Two Futures "Now" shell exist today; zero matches would mean the
    // component moved/renamed and this guard went blind — fail loudly instead of passing.
    expect(
      mounts.length,
      "guard must see every HolographicMaterial mount (bay + Two Futures) — found fewer than 2",
    ).toBeGreaterThanOrEqual(2);
    for (const { file, openingTag } of mounts) {
      expect(
        openingTag,
        `${file}: HolographicMaterial must pass enableBlinking={false} — the upstream blink is a ` +
          "per-frame random whole-shell luma pump on additive DoubleSide shells (owner clip 2026-07-08)",
      ).toMatch(/enableBlinking=\{false\}/);
    }
  });

  it("vendored off-switch semantics hold: enableBlinking=false pins blink to a constant 1.0", () => {
    const vendor = readFileSync(
      join(VENDOR_DIR, "HolographicMaterial", "HolographicMaterial.tsx"),
      "utf8",
    );
    // The off-branch must stay `: 1.0` so blink = clamp(x, 1.0, 1.0) ≡ 1.0 — a constant, i.e.
    // NO time-random term when disabled. If a vendor update reshapes this, re-audit the class.
    expect(vendor).toMatch(/enableBlinking\s*\?\s*0\.6\s*-\s*signalSpeed\s*:\s*1\.0/);
    expect(vendor).toMatch(/clamp\(\s*fract\(\s*cos\(\s*time\s*\)/);
  });
});
