// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// Quiet Pit Wall token guards — the Direction D laws, mechanized (bug→guard tier 1).
// Owner gate 2026-08-01 approved Direction D as the canonical visual specification; these
// assertions are what stops the redesign drifting away from it one convenient exception at a time.
//
//   1. Flag-off byte identity — every selector in tokens-qpw.css is scoped under [data-qpw="on"],
//      so the file cannot touch a shipped pixel until a room is deliberately ported.
//   2. The four evidence colours are EXACTLY the approved hexes, and red is reserved.
//   3. WCAG 2.2 AA contrast holds for every ink on every one of the three planes, for each
//      evidence colour used as text, and for the ink that sits on a filled accent.
//   4. Type floor — no human-language token below 13px; mono exists and is telemetry-only.
//   5. Three planes, not four.
//   6. Target sizes: 24px interactive floor, 44px filled primary.
//   7. Motion budget: micro 120–180ms, room 200–240ms.
//   8. The reduced-motion contract exists in BOTH forms, and the media-query form honours an
//      explicit "full" override instead of firing unconditionally.
//   9. Windows reduced-motion is the DEFAULT AUTHORITY — use-motion.ts must not default to "full".
//  10. !important appears only inside the reduced-motion contract.

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const tokensCss = strip(readFileSync(join("src", "design", "tokens-qpw.css"), "utf8"));
const useMotionTs = readFileSync(join("src", "design", "use-motion.ts"), "utf8");

const token = (name: string): string => {
  const m = tokensCss.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  if (!m) throw new Error(`token --${name} is missing from tokens-qpw.css`);
  return m[1].trim();
};
const px = (name: string): number => {
  const v = token(name);
  const m = v.match(/^(-?[\d.]+)px$/);
  if (!m) throw new Error(`token --${name} is "${v}", expected a px value`);
  return parseFloat(m[1]);
};
const ms = (name: string): number => {
  const m = token(name).match(/^([\d.]+)ms$/);
  if (!m) throw new Error(`token --${name} is not a ms value`);
  return parseFloat(m[1]);
};

// ── WCAG relative luminance + contrast (same maths as theme-contrast.test.ts) ──
const chan = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const lum = (hex: string): number => {
  const h = hex.replace("#", "");
  const n = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16,
  );
  return (
    0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255)
  );
};
const contrast = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("Quiet Pit Wall tokens — flag-off byte identity", () => {
  it("every selector in tokens-qpw.css is scoped under [data-qpw='on']", () => {
    // Take the text before each rule block, drop @-rule headers, and require the scope on every
    // remaining selector. This is the mechanism that keeps the file inert until a room is ported.
    const selectors = tokensCss
      .replace(/@media[^{]+\{/g, "") // the media query's own header is not a selector
      .split("}")
      .map((chunk) => chunk.split("{")[0])
      .map((s) => s.trim())
      .filter(Boolean)
      .flatMap((s) => s.split(",").map((p) => p.trim()))
      .filter(Boolean);

    expect(selectors.length).toBeGreaterThan(0);
    const unscoped = selectors.filter((s) => !s.includes('[data-qpw="on"]'));
    expect(unscoped).toEqual([]);
  });

  it("does not reference the v2/hud scopes — the layers stay independent", () => {
    expect(tokensCss).not.toMatch(/\[data-v2=/);
    expect(tokensCss).not.toMatch(/\[data-hud=/);
  });
});

describe("Quiet Pit Wall tokens — evidence semantics are exact", () => {
  it("the four evidence colours are the approved hexes", () => {
    expect(token("qpw-focus").toLowerCase()).toBe("#a78bfa"); // Compy focus
    expect(token("qpw-proof").toLowerCase()).toBe("#3fd9c2"); // measured evidence
    expect(token("qpw-judge").toLowerCase()).toBe("#f0b878"); // uncertainty / owner judgment
    expect(token("qpw-fail").toLowerCase()).toBe("#ff6b6b"); // ACTUAL failure only
  });

  it("the four evidence STATES map to those colours and nothing else", () => {
    expect(token("qpw-state-measured")).toBe("var(--qpw-proof)");
    expect(token("qpw-state-expected")).toBe("var(--qpw-focus)");
    expect(token("qpw-state-unknown")).toBe("var(--qpw-judge)");
    expect(token("qpw-state-unavailable")).toBe("var(--qpw-ink-3)");
  });

  it("red is reserved — no state, cue or ink token resolves to --qpw-fail", () => {
    const reserved = tokensCss.match(/--qpw-(state|cue|ink)[a-z0-9-]*\s*:\s*var\(--qpw-fail\)/g);
    expect(reserved).toBeNull();
  });

  it("there are exactly three planes, not four", () => {
    const planes = ["qpw-env", "qpw-work", "qpw-over"].map(token);
    expect(new Set(planes).size).toBe(3);
    expect(tokensCss).not.toMatch(/--qpw-plane-4|--qpw-deep\b/);
  });
});

describe("Quiet Pit Wall tokens — WCAG 2.2 AA contrast", () => {
  const planes = { env: token("qpw-env"), work: token("qpw-work"), over: token("qpw-over") };
  const inks = { ink: token("qpw-ink"), "ink-2": token("qpw-ink-2"), "ink-3": token("qpw-ink-3") };

  for (const [inkName, ink] of Object.entries(inks)) {
    for (const [planeName, plane] of Object.entries(planes)) {
      it(`--${inkName} on --qpw-${planeName} clears 4.5:1`, () => {
        expect(contrast(ink, plane)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  for (const name of ["qpw-focus", "qpw-proof", "qpw-judge", "qpw-fail"]) {
    it(`--${name} as text on --qpw-work clears 4.5:1`, () => {
      expect(contrast(token(name), planes.work)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("--qpw-accent-ink on a filled --qpw-focus clears 4.5:1", () => {
    expect(contrast(token("qpw-accent-ink"), token("qpw-focus"))).toBeGreaterThanOrEqual(4.5);
  });

  it("every per-room navigation cue clears 3:1 on the environment (essential non-text)", () => {
    for (const room of ["home", "lab", "monitor", "blackbook"]) {
      expect(contrast(token(`qpw-cue-${room}`), planes.env)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("Quiet Pit Wall tokens — type floor", () => {
  it("no human-language size drops below the 13px meta floor", () => {
    for (const t of ["qpw-fs-verdict", "qpw-fs-title", "qpw-fs-body", "qpw-fs-support", "qpw-fs-meta"]) {
      expect(px(t)).toBeGreaterThanOrEqual(13);
    }
  });

  it("the scale is ordered — verdict > title > body > support > meta", () => {
    const scale = ["qpw-fs-verdict", "qpw-fs-title", "qpw-fs-body", "qpw-fs-support", "qpw-fs-meta"].map(px);
    expect(scale).toEqual([...scale].sort((a, b) => b - a));
  });

  it("mono exists for machine values and never goes near the 9px prohibition", () => {
    expect(px("qpw-fs-mono")).toBeGreaterThanOrEqual(12);
    expect(token("qpw-font-mono")).toMatch(/mono/i);
  });

  it("body language is 15px or better — the panel's minimum target", () => {
    expect(px("qpw-fs-body")).toBeGreaterThanOrEqual(15);
  });
});

describe("Quiet Pit Wall tokens — action hierarchy", () => {
  it("the interactive floor is WCAG 2.2's 24px", () => {
    expect(px("qpw-h-target")).toBeGreaterThanOrEqual(24);
  });

  it("the filled primary is larger than a standard action, and at least 44px", () => {
    expect(px("qpw-h-primary")).toBeGreaterThanOrEqual(44);
    expect(px("qpw-h-primary")).toBeGreaterThan(px("qpw-h-action"));
    expect(px("qpw-h-action")).toBeGreaterThanOrEqual(px("qpw-h-target"));
  });
});

describe("Quiet Pit Wall tokens — motion budget", () => {
  it("micro-interactions stay in the 120–180ms band", () => {
    expect(ms("qpw-dur-micro")).toBeGreaterThanOrEqual(120);
    expect(ms("qpw-dur-micro")).toBeLessThanOrEqual(180);
  });

  it("room transitions stay in the 200–240ms band", () => {
    expect(ms("qpw-dur-room")).toBeGreaterThanOrEqual(200);
    expect(ms("qpw-dur-room")).toBeLessThanOrEqual(240);
  });

  it("no ambient loop primitives are tokenised", () => {
    expect(tokensCss).not.toMatch(/infinite|--qpw-(orbit|sweep|pulse|shimmer|glow-loop)/i);
  });
});

describe("Quiet Pit Wall — reduced motion follows Windows by default", () => {
  it("the attribute-driven contract exists", () => {
    expect(tokensCss).toMatch(/:root\[data-qpw="on"\]\[data-motion="reduced"\]/);
  });

  it("the media-query belt-and-braces exists", () => {
    expect(tokensCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("the media-query form honours an EXPLICIT full-motion override instead of firing blindly", () => {
    const mq = tokensCss.slice(tokensCss.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(mq).toMatch(/:root\[data-qpw="on"\]:not\(\[data-motion="full"\]\)/);
  });

  it("both forms neutralise travel: animation AND transition duration", () => {
    const hits = tokensCss.match(/transition-duration:\s*1ms\s*!important/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const anims = tokensCss.match(/animation-duration:\s*1ms\s*!important/g) ?? [];
    expect(anims.length).toBeGreaterThanOrEqual(2);
  });

  it("use-motion.ts defaults to the SYSTEM preference — Windows is the authority", () => {
    // The 2026-06-19 "motion overrides the OS" default was overturned by the Direction D gate
    // (2026-08-01): an explicit override may exist, but Compy may never SILENTLY ignore the
    // system setting. This asserts the mechanism (the returned default), not a comment.
    const fn = useMotionTs.slice(useMotionTs.indexOf("export function readMotionPref"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toMatch(/return\s+"system";/);
    expect(body).not.toMatch(/return\s+"full";/);
  });

  it("'system' still resolves through the OS media query, and 'reduced' still forces calm", () => {
    expect(useMotionTs).toMatch(/prefers-reduced-motion: reduce/);
    expect(useMotionTs).toMatch(/if \(pref === "reduced"\) return true;/);
    expect(useMotionTs).toMatch(/if \(pref === "system"\) return systemReduced\(\);/);
  });
});

describe("Quiet Pit Wall tokens — no escape hatches", () => {
  it("!important appears ONLY inside the reduced-motion contract", () => {
    const lines = tokensCss.split("\n");
    const firstContract = lines.findIndex((l) => l.includes('[data-motion="reduced"]'));
    expect(firstContract).toBeGreaterThan(0);
    const strayed = lines
      .slice(0, firstContract)
      .filter((l) => l.includes("!important"));
    expect(strayed).toEqual([]);
  });

  it("no colour or size literals leak in outside the token declarations themselves", () => {
    // Every hex in this file must be the value of a --qpw-* custom property. A raw hex in a
    // normal declaration means someone bypassed the token layer.
    const declarations = tokensCss.match(/[a-z-]+\s*:\s*[^;]+;/g) ?? [];
    const leaks = declarations.filter(
      (d) => /#[0-9a-f]{3,8}\b/i.test(d) && !d.trim().startsWith("--qpw-"),
    );
    expect(leaks).toEqual([]);
  });
});

// ── The suite must actually run ─────────────────────────────────────────────────────────
// A guard has force only if the suite executes. Proven 2026-08-01: a stray NODE_ENV=production in
// the launching shell (the release/updater lanes export it) made Vite resolve React's PRODUCTION
// build, where React 19 does not export `act` — 161 of 249 test files died with
// "React.act is not a function" and every guard in this repo was silently unenforced. Same tree,
// same test: NODE_ENV=production => FAIL, NODE_ENV=development => PASS. vitest.config.ts now pins
// it before Vite reads it. These assertions keep the pin, and keep this file runnable.
describe("the test suite itself is not silently disabled", () => {
  const vitestConfig = readFileSync("vitest.config.ts", "utf8");

  it("vitest.config.ts pins NODE_ENV so a production shell cannot kill every render test", () => {
    expect(vitestConfig).toMatch(/process\.env\.NODE_ENV\s*=\s*["'](test|development)["']/);
  });

  it("the pin runs BEFORE defineConfig reads the environment", () => {
    expect(vitestConfig.indexOf("process.env.NODE_ENV")).toBeGreaterThanOrEqual(0);
    expect(vitestConfig.indexOf("process.env.NODE_ENV")).toBeLessThan(
      vitestConfig.indexOf("defineConfig("),
    );
  });

  it("NODE_ENV is not production at runtime", () => {
    // Typed access: this repo's tsconfig does not declare the Node `process` global for tests.
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    expect(env?.NODE_ENV).not.toBe("production");
  });

  it("this source-reading guard declares the node environment", () => {
    // Files importing fs/path die under the default jsdom environment with
    // "No such built-in module: node:". The directive on line 1 is what makes this file run.
    const self = readFileSync(join("src", "design", "tokens-qpw-guard.test.ts"), "utf8");
    expect(self.split("\n")[0]).toMatch(/@vitest-environment node/);
  });
});
// ── One source of truth for motion ──────────────────────────────────────────────────────
// use-motion.ts folds the Windows setting into <html data-motion>. Any stylesheet that queries
// prefers-reduced-motion RAW bypasses that, and an explicit user choice stops working in one or
// both directions. Found 2026-08-02: ExperimentBench.css gated an infinite pulse on
// `(prefers-reduced-motion: no-preference)`, so a user who chose "Reduced" still got the loop
// whenever Windows reported no preference. Fixed to :root[data-motion="full"]; guarded here.
describe("one source of truth for motion (no raw prefers-reduced-motion in src CSS)", () => {
  const walk = (dir: string): string[] =>
    (readdirSync(dir) as string[]).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : name.endsWith(".css") ? [p] : [];
    });

  it("every prefers-reduced-motion block also keys off <html data-motion>", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      let i = text.indexOf("@media");
      while (i !== -1) {
        const head = text.slice(i, text.indexOf("{", i) + 1);
        if (head.includes("prefers-reduced-motion")) {
          // Take the block body by brace balance from the @media opening brace.
          let depth = 0;
          let j = text.indexOf("{", i);
          const start = j;
          for (; j < text.length; j++) {
            if (text[j] === "{") depth++;
            else if (text[j] === "}" && --depth === 0) break;
          }
          const body = text.slice(start, j);
          if (!body.includes("data-motion")) offenders.push(file);
        }
        i = text.indexOf("@media", i + 6);
      }
    }
    expect(offenders).toEqual([]);
  });
});