// bug→guard for the Codex REJECT of candidate 9bef1cc2 (2026-08-27), finding "the rig is still
// smaller and less dominant than the approved reference" and "bench width, split balance, gutter
// and visual hierarchy still do not match".
//
// Two independent things decide how large the rig reads, and the rejected build had both wrong:
//
//   HOW WIDE THE PANEL IS   `--v2-aside`. The shared token is min(680px, 56.5%). It never bound
//                           while every room sat in a fixed 1160px box, but once the lane scales
//                           (shell-v2.css) 1920 gives the room a ~1544px box, the 680 cap bites,
//                           and the split INVERTS — the narrative column measured 816 against the
//                           bench's 680, so the story became the larger surface and the rig read
//                           as the sidebar. Every approved comp has it the other way round.
//   HOW CLOSE THE CAMERA IS `cameraDist`. RigHologram has always accepted one; RigViewer did not
//                           forward it, so the bench was stuck at the Live room's 9.5 — a distance
//                           chosen for a bay that draws a control bar and caption around the model,
//                           in a panel that draws neither.
//
// The pass-through is the part worth pinning hardest, because the safe way to do it and the
// dangerous way to do it look almost identical in a diff. Optional prop, forwarded verbatim,
// default left in the hologram → every other caller is unchanged BY CONSTRUCTION. Give RigViewer
// its own default instead and you have quietly re-framed every rig in the app from one line, which
// is the "unrestricted redesign" the review ruled out, and no rendering test would flag it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const VIEWER = read("src/surfaces/rig/RigViewer.tsx");
const HOLOGRAM = read("src/surfaces/rig/RigHologram.tsx");
const CONSOLE = read("src/surfaces/LabConsole.tsx");
const LAB_CSS = read("src/surfaces/lab-console.css").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the bench frames its rig, and only its rig", () => {
  it("takes the Test room's share of a wide display from the comp, not from the shared token", () => {
    // 58.2% is measured: the comp's bench panel runs x791..1488 comp px = 675.5 app px of a 1161
    // app px content box. The 880 cap replaces 680 so the percentage still governs at 1920, and it
    // is set on the room, so Health/Live/History keep the token they ship with today.
    const at = LAB_CSS.indexOf(':root[data-v2="on"] .v2-room[data-layout="split"][data-room="lab"] {');
    expect(at, "the Test room no longer sets its own aside share — 1920 re-inverts the split").toBeGreaterThan(-1);
    const rule = LAB_CSS.slice(at, LAB_CSS.indexOf("}", at));
    const m = /--v2-aside:\s*min\(\s*(\d+)px\s*,\s*([\d.]+)%\s*\)/.exec(rule);
    expect(m, "--v2-aside must stay a percentage with a cap behind it").not.toBeNull();
    const [cap, pct] = [Number(m![1]), Number(m![2])];
    expect(Math.abs(pct - 58.2)).toBeLessThan(1.5); // the comp's own split
    // The cap must not bind at 1920 (that is the inversion) and must not vanish either: 880 wide
    // keeps stage + strip + lane cushion inside a 1080-tall viewport.
    expect(cap).toBeGreaterThanOrEqual(860);
    expect(cap).toBeLessThanOrEqual(920);
    // Scoped to the room. A bare `.v2-room[data-layout="split"]` here would move three other rooms.
    expect(LAB_CSS).not.toMatch(/\.v2-room\[data-layout="split"\]\s*\{\s*--v2-aside/);
  });

  it("forwards cameraDist through RigViewer without giving RigViewer a default of its own", () => {
    expect(VIEWER, "RigViewer must accept an optional cameraDist").toMatch(/cameraDist\?:\s*number/);
    expect(VIEWER, "…and forward it verbatim to the hologram").toMatch(/cameraDist=\{cameraDist\}/);
    expect(
      /cameraDist\s*=\s*[\d.]/.test(VIEWER),
      "RigViewer must NOT default cameraDist — the default belongs to RigHologram, which is what " +
        "makes every existing caller unchanged by construction rather than by review",
    ).toBe(false);
    expect(HOLOGRAM, "the hologram still owns the default every other caller gets").toMatch(
      /cameraDist\s*=\s*9\.5/,
    );
  });

  it("sets the bench distance from one named Test-room constant", () => {
    const m = /const BENCH_CAMERA_DIST = ([\d.]+);/.exec(CONSOLE);
    expect(m, "the bench distance must be a named constant, not a number inlined at a call site").not.toBeNull();
    const dist = Number(m![1]);
    // Round 3 (2026-08-27) inverted round 1's premise: the bench distance is measured against the
    // COMPLETE silhouette (holo case + floor ring), and containing it demands a camera FURTHER out
    // than the bay's 9.5, not closer. Measured on the live stage: the floor ring — the last part of
    // the silhouette to come inside, because the framing centers on the case — is still cropped at
    // the stage's bottom edge at 9.4 and first sits fully in frame near 10.0; past ~11 the rig
    // shrinks below the comp's 54.5%-of-stage-width parity. The band pins both failure modes.
    expect(dist).toBeGreaterThan(9.8);
    expect(dist).toBeLessThan(11);
    // Both bench mounts, or the two render paths disagree about how large the rig is.
    const passes = CONSOLE.match(/cameraDist=\{BENCH_CAMERA_DIST\}/g) ?? [];
    expect(passes.length, "every <RigViewer> in LabConsole must be framed the same").toBe(
      (CONSOLE.match(/<RigViewer/g) ?? []).length,
    );
  });

  it("aims the bench camera below the case so the floor ring keeps its bottom air", () => {
    // Round 4 (2026-08-27 Codex REJECT of 2358a52d): containment was met but the ring sat 0-5 px
    // off the stage's bottom edge at 1500×980 where the comp draws ~45-50 px. Distance stays 10.2;
    // the AIM moves instead — target y below the case center rides the composition up in frame.
    // -0.45 measured 46/561 px bottom air at 1500 (comp band), 31/371 at 1280, 60/732 at 1920 —
    // 8.2-8.4% everywhere. Above -0.38 the air falls short of the comp band (-0.35 measured
    // 39/561); below -0.6 the case top runs out of margin at 1280. Same pass-through discipline as
    // cameraDist: optional prop, forwarded verbatim, default (0.2) stays in RigHologram so every
    // other caller keeps the classic case-centered framing by construction.
    const m = /const BENCH_CAMERA_TARGET_Y = (-[\d.]+);/.exec(CONSOLE);
    expect(m, "the bench aim must be a named Test-room constant, not a number at a call site").not.toBeNull();
    const ty = Number(m![1]);
    expect(ty).toBeLessThan(-0.38);
    expect(ty).toBeGreaterThan(-0.6);
    // Both bench mounts, or the two render paths frame the ring differently.
    const passes = CONSOLE.match(/cameraTargetY=\{BENCH_CAMERA_TARGET_Y\}/g) ?? [];
    expect(passes.length, "every <RigViewer> in LabConsole must aim the same").toBe(
      (CONSOLE.match(/<RigViewer/g) ?? []).length,
    );
    expect(VIEWER, "RigViewer must accept an optional cameraTargetY").toMatch(/cameraTargetY\?:\s*number/);
    expect(VIEWER, "…and forward it verbatim to the hologram").toMatch(/cameraTargetY=\{cameraTargetY\}/);
    expect(
      /cameraTargetY\s*=\s*-?[\d.]/.test(VIEWER),
      "RigViewer must NOT default cameraTargetY — the default belongs to RigHologram",
    ).toBe(false);
    expect(HOLOGRAM, "the hologram still owns the classic aim every other caller gets").toMatch(
      /cameraTargetY\s*=\s*0\.2/,
    );
  });

  it("keeps the stage at the aspect that makes the framing window-independent", () => {
    // fitCameraDistance returns baseDist untouched at or above FIT_REF_ASPECT (1.2). Pinning the
    // stage to exactly 1.2 is what makes one measured constant true at 1280, 1500 and 1920 alike —
    // let the stage go elastic and the rig silently re-frames per window size.
    expect(read("src/surfaces/rig/camera-fit.ts")).toMatch(/FIT_REF_ASPECT\s*=\s*1\.2/);
    expect(LAB_CSS).toMatch(/aspect-ratio:\s*1\.2/);
  });
});
