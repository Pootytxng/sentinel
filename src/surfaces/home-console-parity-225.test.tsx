import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { ShellV2 } from "../design/ShellV2";
import { railFor } from "../design/homeRail";
import { HomeConsole } from "./HomeConsole";
import { FIT_REF_ASPECT } from "./rig/camera-fit";
import type { GameReadiness, Priorities } from "../types";
import type { HardwareInfo } from "../App";

// ── #225 — Health room visual parity, bug -> guard ──────────────────────────────────────────
//
// The owner rejected the installed Health room against assets/approved/health.png with three
// findings: the latest-change banner owned the top of the room, the room carried decoration the
// contract does not draw, and the rig was cropped. Each fix below is pinned here so it cannot
// quietly come back. Every number in this file was MEASURED off the approved PNG (1550x1015,
// rendered from a 1500x980 window, so comp px / 1.0333 = app px); the measurement that produced
// it is named beside it, and the full derivation lives in the mismatch report the issue requires.
//
// Source-text pins, not computed-style pins, for the CSS facts: jsdom does not lay out, so a
// layout claim it could "verify" would be a claim about nothing. The real visual proof is the
// installed capture at three viewports, which is evidence for a reviewer, not a test. What this
// file guarantees is that the decisions survive the next edit.

const src = (...p: string[]): string => readFileSync(join("src", ...p), "utf8");
const homeConsoleCss = src("surfaces", "home-console.css");
const homeConsoleTsx = src("surfaces", "HomeConsole.tsx");
const homeHudCss = src("surfaces", "home-hud.css");
const shellCss = src("design", "shell-v2.css");
const tokensCss = src("design", "tokens-v2.css");

// Comments carry the measurements, so every source pin below reads the DECLARATIONS only.
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("#225 finding 2 — the room carries no treatment the comp does not draw", () => {
  it("the four HUD corner brackets are gone from the stage, markup and CSS both", () => {
    expect(homeConsoleTsx).not.toContain("hc-brk");
    expect(stripComments(homeConsoleCss)).not.toContain("hc-brk");
  });

  it("no whole-page scanline is painted over the Health room", () => {
    // The rule was `.v2-room[data-room="home"]::after` with a repeating-linear-gradient. Any
    // ::after on the room element is the same defect wearing a different gradient, so the pin is
    // on the selector, not on the gradient function.
    const declarations = stripComments(homeHudCss);
    expect(declarations).not.toMatch(/\.v2-room\[data-room="home"\]::after/);
    // hud-rooms.css still paints the OTHER rooms, and must keep excluding Health by name --
    // that exclusion is the reason removing the rule above cannot reach Test, Live or History.
    expect(stripComments(src("surfaces", "hud-rooms.css"))).toContain(':not([data-room="home"])');
  });
});

describe("#225 finding 1 — the latest-change follow-through is subordinate, not deleted", () => {
  it("renders inside the shell's below slot, after the verdict, with its handlers intact", () => {
    const c = mount().container;
    const banner = c.querySelector('[data-testid="latest-change"]');
    expect(banner, "the follow-through still renders -- demoted, never dropped").not.toBeNull();

    const below = c.querySelector(".v2-room-below");
    expect(below?.contains(banner!), "it lives in the below slot").toBe(true);

    // Document order is the real claim: the verdict and its one action come first, the
    // follow-through comes after. DOCUMENT_POSITION_FOLLOWING === 4.
    const verdict = c.querySelector(".v2-verdict");
    expect(verdict).not.toBeNull();
    expect(verdict!.compareDocumentPosition(banner!) & 4).toBeTruthy();
  });
});

describe("#225 — the split, the cards and the rules carry the comp's measured values", () => {
  it("Health has its own split family: 55.26% aside, 50px gutter", () => {
    // comp: narrative x287..771, gutter x772..823, panel x824..1485 -> 469 / 50 / 641 app px
    // inside the app's own 1160px wrap. 641 / 1160 = 55.26%.
    const rule = stripComments(shellCss).match(
      /\.v2-room\[data-layout="split"\]\[data-room="home"\]\s*\{[^}]*\}/,
    )?.[0];
    expect(rule, "the Health split override exists").toBeTruthy();
    expect(rule).toContain("column-gap: 50px");
    const m = /--v2-aside:\s*min\(\s*(\d+)px\s*,\s*([\d.]+)%\s*\)/.exec(rule!);
    expect(m, "--v2-aside stays a percentage with a cap behind it").not.toBeNull();
    expect(Math.abs(Number(m![2]) - 55.26)).toBeLessThan(0.5);
    // The cap must not bind at 1920, where the shell gives the room ~1544px: 55.26% of that is
    // 853, and a 680 cap there inverts the split (Test's own bench defect, lab-bench-framing-
    // guard.test.ts). Nor may it vanish -- an uncapped percentage has no ceiling at all.
    expect(Number(m![1])).toBeGreaterThanOrEqual(860);
    expect(Number(m![1])).toBeLessThanOrEqual(920);
    // Scoped to the room: a bare [data-layout="split"] here would move three other rooms.
    expect(stripComments(shellCss)).not.toMatch(
      /\.v2-room\[data-layout="split"\]\s*\{\s*--v2-aside/,
    );
  });

  it("the symptom cards take the comp's fill, gap, radius and glyph size", () => {
    const css = stripComments(homeConsoleCss);
    const rows = css.match(/\.hc-happening-rows\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rows, "card pitch: comp borders 12 comp px apart").toContain("gap: 12px");

    const row = css.match(/\.hc-happening-row\s*\{[^}]*\}/)?.[0] ?? "";
    expect(row, "the comp's neutral card surface, not the panel token").toContain(
      "background: var(--v2-panel-card)",
    );
    expect(row, "corner arc measures ~10 app px").toContain("border-radius: var(--v2-r)");

    // The glyph is the only thing giving these rows weight; the comp draws it at ~28.
    expect(homeConsoleTsx).toMatch(/HAPPENING_GLYPH\[c\.id\] \?\? "help"\} size=\{28\}/);

    // The new surface step is a TOKEN, in the token sheet, or the no-slop law is a dead letter.
    expect(stripComments(tokensCss)).toContain("--v2-panel-card: #15191f");
  });

  it("both narrative hairlines are drawn, with the comp's air around them", () => {
    const css = stripComments(homeConsoleCss);
    const happening = css.match(/\.hc-happening\s*\{[^}]*\}/)?.[0] ?? "";
    expect(happening).toContain("border-top: 1px solid var(--v2-line)");
    expect(happening, "comp: 36 comp px above the rule").toContain("margin-top: 35px");
    expect(happening, "comp: 33 comp px below it").toContain("padding-top: 32px");

    const care = css.match(/\.hc-care\s*\{[^}]*\}/)?.[0] ?? "";
    expect(care).toContain("border-top: 1px solid var(--v2-line)");
    expect(care, "comp: card border y799 -> rule y829").toContain("margin: 29px 0 0");
    expect(care, "comp: rule y829 -> the row's box top").toContain("padding-top: 24px");
  });
});

// ── harness ────────────────────────────────────────────────────────────────────────────────
// Deliberately the leanest mount that reaches the below slot: this file makes structural claims,
// so the fixtures only need to be shaped right, never rich.

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve(null) }));
vi.mock("../design/use-motion", () => ({ useReducedMotion: () => true }));
vi.mock("./rig/RigHologram", () => ({ RigHologram: () => <div data-testid="rig-hologram" /> }));

beforeAll(() => {
  class Obs {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as Record<string, unknown>).ResizeObserver ??= Obs;
  (globalThis as Record<string, unknown>).IntersectionObserver ??= Obs;
});
afterEach(cleanup);

const hw = {
  cpu_brand: "AMD Ryzen 7 9850X3D",
  cpu_arch: { family_label: "Ryzen 7 9850X3D", architecture: "Zen 5", generation: "9000" },
  cpu_cores_logical: 16,
  cpu_cores_physical: 8,
  cpu_frequency_mhz: 5100,
  ram_total_bytes: 32 * 1024 ** 3,
  ram_used_bytes: 16 * 1024 ** 3,
  gpus: [{ name: "AMD Radeon RX 9070 XT", vram_bytes: 16 * 1024 ** 3 }],
  disks: [
    {
      mount_point: "C:\\",
      total_bytes: 1000 * 1024 ** 3,
      available_bytes: 130 * 1024 ** 3,
      file_system: "NTFS",
    },
  ],
  memory_modules: [],
  physical_disks: [],
  display: { current_refresh_rate_hz: 165 },
  os_name: "Windows",
  os_version: "11",
} as unknown as HardwareInfo;

const readiness: GameReadiness = {
  checks: [{ id: "a", label: "A", status: "ready", detail: "", value: null }],
  ready_count: 1,
  attention_count: 0,
  unknown_count: 0,
  advisory_count: 0,
  advisory: "",
  dismissed_ids: [],
  drifts: [],
};

const priorities: Priorities = {
  limiters: [],
  already_fine: [],
  not_worth_touching: [],
  session_hint: null,
  upgrade_path: null,
};

const mount = () =>
  render(
    <ShellV2 items={railFor(true)} activeId="home" onNavigate={() => {}} ledgerCount={0}>
      <HomeConsole
        hw={hw}
        readiness={readiness}
        priorities={priorities}
        sessions={[]}
        changes={[]}
        onRunCheck={() => {}}
        onSeeInFix={() => {}}
        latestChange={<div data-testid="latest-change" />}
      />
    </ShellV2>,
  );

// ── #225 finding 3 — the rig is framed, not cropped ────────────────────────────────────────
// This one is not a pinned number: the test re-solves the projection from the geometry that is
// actually in the scene and asserts the OUTCOME the comp shows -- the whole silhouette inside the
// frame, with the comp's air above and below it. Pin the pair alone and any later change to the
// case, the ring or the camera seat would leave a green test beside a cropped rig; re-deriving it
// means the guard fails on the thing that actually broke.
//
// It also re-reads the geometry OUT of RigHologram.tsx rather than restating it, so a scene edit
// that this math no longer describes fails here instead of quietly invalidating it.
describe("#225 finding 3 — the rig sits inside its stage with the comp's air", () => {
  const hologram = src("surfaces", "rig", "RigHologram.tsx");
  const num = (re: RegExp, what: string): number[] => {
    const m = re.exec(hologram);
    expect(m, `the scene still declares ${what} where this guard reads it`).not.toBeNull();
    return m!.slice(1).map(Number);
  };
  const [bw, bh, bd] = num(/<boxGeometry args=\{\[([\d.]+), ([\d.]+), ([\d.]+)\]\}/, "the case box");
  const [, ringOuter] = num(/<ringGeometry args=\{\[([\d.]+), ([\d.]+), \d+\]\}/, "the floor ring");
  const [ringY] = num(/<mesh position=\{\[0, (-[\d.]+), 0\]\} rotation=/, "the ring's height");
  const [seatX, seatY, fovDeg] = num(
    /camera=\{\{ position: \[([\d.]+), ([\d.]+), cameraDist\], fov: (\d+) \}\}/,
    "the camera seat",
  );

  const consoleSrc = src("surfaces", "HomeConsole.tsx");
  const constant = (name: string): number => {
    const m = new RegExp(`const ${name} = (-?[0-9.]+);`).exec(consoleSrc);
    expect(m, `${name} is declared`).not.toBeNull();
    return Number(m![1]);
  };
  const dist = constant("HEALTH_CAMERA_DIST");
  const aim = constant("HEALTH_CAMERA_TARGET_Y");

  // The same arithmetic FitCamera does: scale the seat's offset from the target to `dist`
  // (fitCameraDistance leaves it alone at any aspect >= 1.2), then project.
  const project = (aspect: number) => {
    const t = Math.tan(((fovDeg * Math.PI) / 180) / 2);
    const off = [seatX, seatY - aim, dist];
    const k = dist / Math.hypot(...off);
    const cam = [off[0] * k, aim + off[1] * k, off[2] * k];
    let f = [-cam[0], aim - cam[1], -cam[2]];
    const fl = Math.hypot(...f);
    f = f.map((v) => v / fl);
    let r = [f[1] * 0 - f[2] * 1, f[2] * 0 - f[0] * 0, f[0] * 1 - f[1] * 0];
    const rl = Math.hypot(...r);
    r = r.map((v) => v / rl);
    const u = [
      r[1] * f[2] - r[2] * f[1],
      r[2] * f[0] - r[0] * f[2],
      r[0] * f[1] - r[1] * f[0],
    ];
    return (p: number[]) => {
      const v = [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]];
      const z = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
      return {
        y: (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / (z * t),
        x: (v[0] * r[0] + v[1] * r[1] + v[2] * r[2]) / (z * t * aspect),
      };
    };
  };

  const silhouette: number[][] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) silhouette.push([(sx * bw) / 2, (sy * bh) / 2, (sz * bd) / 2]);
  for (let i = 0; i < 128; i++) {
    const a = (i / 128) * 2 * Math.PI;
    silhouette.push([ringOuter * Math.cos(a), ringY, ringOuter * Math.sin(a)]);
  }

  // ROUND 2 RE-MEASURED THESE, and they moved: the stage grew 500 -> 530 (--hc-stage-max) to match
  // the approved comp, which makes the canvas TALLER without making it wider, so every aspect fell.
  // Measured on the installed build: 1.222 at 1500x980 and at 1920x1080 (canvas 599x490 -- identical
  // at both, because the room's content wrap caps at 1160 and centres), and 1.720 at 1280x720, where
  // the panel's ceiling binds and the stage gives ground to 335 (canvas 507.3x294.9).
  //
  // 1.222 is the FLOOR, not one sample of three: above 1160px of room width the wrap caps and the
  // canvas stops growing, and above ~980px of height the stage is already at its 530 ceiling, so no
  // larger window produces a narrower stage. That floor now clears fitCameraDistance's reference by
  // 0.022 -- real, but thin enough that the next person to raise --hc-stage-max could cross it
  // without noticing, and crossing it silently changes the vertical framing this whole describe
  // block exists to pin. So the margin is asserted, not assumed.
  const MEASURED_ASPECTS = [1.222, 1.5, 1.72];
  it("the stage's narrowest measured aspect still clears fitCameraDistance's reference", () => {
    expect(
      Math.min(...MEASURED_ASPECTS),
      "below FIT_REF_ASPECT the camera pulls back and the framing solved below stops holding -- " +
        "if --hc-stage-max grew again, re-solve HEALTH_CAMERA_DIST/TARGET_Y rather than widening " +
        "this band",
    ).toBeGreaterThanOrEqual(FIT_REF_ASPECT);
  });

  for (const aspect of MEASURED_ASPECTS) {
    it(`contains the case and the floor ring at a ${aspect} stage, with ~8% air`, () => {
      const p = project(aspect);
      const ys = silhouette.map((q) => p(q).y);
      const xs = silhouette.map((q) => Math.abs(p(q).x));
      const topAir = (1 - Math.max(...ys)) / 2;
      const botAir = (Math.min(...ys) + 1) / 2;

      // Nothing may leave the frame -- this is the rejection finding itself.
      expect(topAir, "case top inside the stage").toBeGreaterThan(0);
      expect(botAir, "floor ring inside the stage").toBeGreaterThan(0);
      expect(Math.max(...xs), "silhouette inside the stage's width").toBeLessThan(1);

      // And it must be FRAMED, not merely contained: the comp draws ~8.1% on both edges
      // (ring apex comp y668 against a stage floor at y713, over a 553px stage).
      expect(Math.abs(topAir - 0.081)).toBeLessThan(0.02);
      expect(Math.abs(botAir - 0.081)).toBeLessThan(0.02);
    });
  }
});
