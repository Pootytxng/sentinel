import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// V2 shell guards — the V2 shell laws, mechanized (bug→guard tier 1):
//   1. V2 is the SHIPPED shell — main.tsx sets <html data-v2="on"> unconditionally; the compy_v2
//      opt-in flag + the classic-surface escape hatch were removed when V2 became the default build
//      (spec 2026-07-03-v2-default-and-polish-sweep). This guard locks the flip in (no re-introduced
//      opt-in, no reachable classic shell).
//   2. Every rule in tokens-v2.css is STILL scoped under [data-v2="on"] — now purely as namespacing
//      (the attribute is always present, so every v2 rule matches).
//   3. The v2 palette clears the same WCAG floors as the instrument themes (4.5 body,
//      3.0 muted-caption, 4.5 ink-on-accent) — extends theme-contrast.test.ts to v2.
//   4. Type discipline: Geist families are referenced ONLY via the v2 token layer, and
//      --v2-font-mono exists so machine values have their one sanctioned mono source.
//   5. Vendor hygiene: every vendored React Bits file carries its license header and is
//      listed in THIRD_PARTY.md (MIT + Commons Clause requires the notice travel along).

describe("V2 shell is the shipped default (opt-in gate removed)", () => {
  const mainTsx = readFileSync(join("src", "main.tsx"), "utf8");
  const themeTs = readFileSync(join("src", "design", "theme.ts"), "utf8");

  it("main.tsx sets data-v2='on' unconditionally — no compy_v2 opt-in", () => {
    // The attribute MUST always be present so tokens-v2.css scoping (law #2) resolves.
    expect(mainTsx).toMatch(/document\.documentElement\.dataset\.v2\s*=\s*["']on["']/);
    // No opt-in flag READ: the escape hatch is gone, not merely defaulted on. (Comments may still
    // name the retired flag; we assert on the mechanism — a localStorage access — not the string.)
    expect(mainTsx).not.toMatch(/localStorage\.getItem\(\s*["']compy_v2["']/);
  });

  it("theme.ts no longer exposes a compy_v2 opt-in flag (readV2/applyV2 removed)", () => {
    expect(themeTs).not.toMatch(/localStorage\.\w+\(\s*["']compy_v2["']/);
    expect(themeTs).not.toMatch(/function readV2\b/);
    expect(themeTs).not.toMatch(/function applyV2\b/);
  });
});

// ── source-level guards (read the real files, like theme-literal-guard) ──

const loadV2Css = (...path: string[]): string =>
  readFileSync(join("src", ...path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const tokensCss = loadV2Css("design", "tokens-v2.css");
const hudTokensCss = loadV2Css("design", "tokens-hud.css");
const shellCss = loadV2Css("design", "shell-v2.css");
const roomAccentPickerCss = loadV2Css("design", "room-accent-picker.css");
const homeCss = loadV2Css("surfaces", "home-v2.css");
const homeHudCss = loadV2Css("surfaces", "home-hud.css");
const homeConsoleCss = loadV2Css("surfaces", "home-console.css");
// optimize-v2.css went with OptimizeV2 in the 2026-08-06 generation prune (Optimize's live home is
// lab/OptimizeStation inside LabGround, styled by lab-console.css).
const monitorCss = loadV2Css("surfaces", "monitor-v2.css");
const blackbookCss = loadV2Css("surfaces", "blackbook-v2.css");
const labCss = loadV2Css("surfaces", "lab-v2.css");
const labConsoleCss = loadV2Css("surfaces", "lab-console.css");
const monitorConsoleCss = loadV2Css("surfaces", "monitor-console.css");
const blackbookConsoleCss = loadV2Css("surfaces", "blackbook", "blackbook-console.css");
const patternsTileCss = loadV2Css("surfaces", "blackbook", "patterns-tile.css");
const hudRoomsCss = loadV2Css("surfaces", "hud-rooms.css");
const ambientHudCss = loadV2Css("surfaces", "ambient-hud.css");
const consoleArcGaugeCss = loadV2Css("design", "console", "arc-gauge.css");
const consoleOscilloscopeCss = loadV2Css("design", "console", "oscilloscope.css");
const consoleDockCss = loadV2Css("design", "console", "dock.css");
const consoleReticleCss = loadV2Css("design", "console", "reticle.css");
const gamingConsoleCss = loadV2Css("surfaces", "gaming-console.css");
const hudFrameCss = loadV2Css("design", "console", "hud-frame.css");
const rerunBandCss = loadV2Css("surfaces", "RerunCheckBand.css");

// EVERY v2 stylesheet must obey the scoping law. New v2 CSS files get added here (V2-2+).
const V2_CSS: [string, string][] = [
  ["tokens-v2.css", tokensCss],
  ["tokens-hud.css", hudTokensCss],
  ["shell-v2.css", shellCss],
  ["room-accent-picker.css", roomAccentPickerCss],
  ["home-v2.css", homeCss],
  ["home-hud.css", homeHudCss],
  ["home-console.css", homeConsoleCss],
  ["monitor-v2.css", monitorCss],
  ["blackbook-v2.css", blackbookCss],
  ["lab-v2.css", labCss],
  ["lab-console.css", labConsoleCss],
  ["monitor-console.css", monitorConsoleCss],
  ["blackbook-console.css", blackbookConsoleCss],
  ["patterns-tile.css", patternsTileCss],
  ["hud-rooms.css", hudRoomsCss],
  ["ambient-hud.css", ambientHudCss],
  ["console/arc-gauge.css", consoleArcGaugeCss],
  ["console/oscilloscope.css", consoleOscilloscopeCss],
  ["console/dock.css", consoleDockCss],
  ["console/reticle.css", consoleReticleCss],
  ["gaming-console.css", gamingConsoleCss],
  ["console/hud-frame.css", hudFrameCss],
  ["RerunCheckBand.css", rerunBandCss],
];

describe("v2 CSS scoping (flag-off byte-identity mechanism)", () => {
  for (const [name, css] of V2_CSS) {
    it(`${name}: every selector is scoped under [data-v2="on"]`, () => {
      // Split into rule headers: text before each '{' at nesting depth 0.
      const offenders: string[] = [];
      let depth = 0;
      let buf = "";
      for (const ch of css) {
        if (ch === "{") {
          if (depth === 0) {
            const sel = buf.trim();
            // @keyframes are the one sanctioned unscoped header, and ONLY with the v2- prefix:
            // a keyframes block is inert unless a rule references it, and every referencing rule
            // is itself scoped — so flag-off byte-identity holds. (Inner 0%/100% headers sit at
            // depth ≥ 1 and are never selector-checked.)
            if (/^@keyframes\s+v2-/.test(sel)) {
              depth++;
              buf = "";
              continue;
            }
            // every comma-separated selector in the header must carry the scope. Split on
            // TOP-LEVEL commas only — a comma inside :is()/:where()/:not() is not a selector-list
            // separator (hud-rooms.css scopes the fix-room instrument skin to also match the merged
            // Lab proving-ground fast path via `:is(.v2-room[data-room="fix"], .v2-room[data-room="lab"]
            // :where(.lg-fast))`; that whole rule is still under the leading :root[data-v2="on"]).
            const parts: string[] = [];
            let cur = "";
            let paren = 0;
            for (const c of sel) {
              if (c === "(") paren++;
              else if (c === ")") paren--;
              if (c === "," && paren === 0) {
                parts.push(cur);
                cur = "";
              } else {
                cur += c;
              }
            }
            parts.push(cur);
            for (const part of parts) {
              if (!part.includes('[data-v2="on"]')) offenders.push(part.trim());
            }
          }
          depth++;
          buf = "";
        } else if (ch === "}") {
          depth--;
          buf = "";
        } else if (depth === 0) {
          buf += ch;
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});

describe("v2 surface CSS consumes the token layer only (no-slop law)", () => {
  const SURFACE_CSS: [string, string][] = [
    ["shell-v2.css", shellCss],
    ["home-v2.css", homeCss],
    ["home-hud.css", homeHudCss],
    ["monitor-v2.css", monitorCss],
    ["blackbook-v2.css", blackbookCss],
    ["lab-v2.css", labCss],
    ["hud-rooms.css", hudRoomsCss],
    ["ambient-hud.css", ambientHudCss],
    ["RerunCheckBand.css", rerunBandCss],
  ];
  for (const [name, css] of SURFACE_CSS) {
    it(`${name}: no color literals — every color comes from a --v2-* token`, () => {
      expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
      expect(css.match(/\brgba?\(/g) ?? []).toEqual([]);
      expect(css.match(/\bhsla?\(/g) ?? []).toEqual([]);
    });

    it(`${name}: font/font-family declarations reference only var(--v2-font-*)`, () => {
      const offenders: string[] = [];
      for (const m of css.matchAll(/(?:^|[;{])\s*(font(?:-family)?)\s*:\s*([^;}]+)/g)) {
        if (!/var\(--v2-font-/.test(m[2]) && !/^\s*inherit\s*$/.test(m[2])) {
          offenders.push(`${m[1]}: ${m[2].trim()}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});

// ── contrast floors on the v2 palette (same math as theme-contrast.test.ts) ──

type RGB = { r: number; g: number; b: number };
const parseHex = (hex: string): RGB => {
  const m = hex.trim().replace("#", "");
  return {
    r: parseInt(m.slice(0, 2), 16),
    g: parseInt(m.slice(2, 4), 16),
    b: parseInt(m.slice(4, 6), 16),
  };
};
const compositeRgba = (rgba: string, base: RGB): RGB => {
  const m = rgba.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`not an rgba: ${rgba}`);
  const [r, g, b, a = 1] = m[1].split(",").map((s) => parseFloat(s.trim()));
  return {
    r: Math.round(r * a + base.r * (1 - a)),
    g: Math.round(g * a + base.g * (1 - a)),
    b: Math.round(b * a + base.b * (1 - a)),
  };
};
const luminance = ({ r, g, b }: RGB): number => {
  const lin = (c: number) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (fg: RGB, bg: RGB): number => {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

function v2Token(name: string): string {
  const m = tokensCss.match(new RegExp(`--v2-${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`--v2-${name} not defined in tokens-v2.css`);
  return m[1].trim();
}

describe("v2 palette contrast (legibility floors)", () => {
  const bg = parseHex(v2Token("bg"));
  const panel = parseHex(v2Token("panel"));
  const panel2 = parseHex(v2Token("panel-2"));
  const surfaces: [string, RGB][] = [
    ["bg", bg],
    ["panel", panel],
    ["panel-2", panel2],
  ];

  it("text tokens clear their floors on every surface", () => {
    const checks: [string, number][] = [
      ["text", 4.5],
      ["muted", 4.5],
      ["faint", 3.0], // caption tier → AA-large
    ];
    for (const [name, floor] of checks) {
      const fg = parseHex(v2Token(name));
      for (const [sName, s] of surfaces) {
        const ratio = contrast(fg, s);
        expect(
          ratio,
          `--v2-${name} on ${sName} = ${ratio.toFixed(2)} (floor ${floor})`,
        ).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  it("accent-ink on accent clears 4.5 (the muted-on-accent bug class)", () => {
    const ratio = contrast(parseHex(v2Token("accent-ink")), parseHex(v2Token("accent")));
    expect(ratio, `ink on accent = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
  });

  it("status text clears 4.5 on its own dim fill (pill pattern)", () => {
    for (const status of ["ok", "warn", "info"]) {
      const text = parseHex(v2Token(status));
      const fill = compositeRgba(v2Token(`${status}-dim`), panel);
      const ratio = contrast(text, fill);
      expect(
        ratio,
        `--v2-${status} on its dim fill = ${ratio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// ── type discipline: Geist only via the token layer ──

const listCss = (dir: string): string[] => {
  const out: string[] = [];
  for (const f of readdirSync(dir, { recursive: true }) as string[]) {
    const p = join(dir, f);
    if (f.endsWith(".css") && statSync(p).isFile()) out.push(p);
  }
  return out;
};

// ── caption-token USAGE guard (bug→guard, self-review FAIL 2026-08-06) ──
//
// --v2-faint is declared a caption token above and held to the 3.0 AA-LARGE floor. That floor is
// only honest if faint text actually IS large text. It is not: when this guard was written, all 29
// rules under src/ that declare BOTH a font size and `color: var(--v2-faint)` set that size below
// the AA-large threshold — so they ship small text at ~3.6:1 on the page background, under AA's 4.5.
//
// The defect that produced this guard: .hc-specs-eyebrow (Home's new detected-record label) was
// written 10px/600 on --v2-faint. The pairwise palette test above cannot catch that — it checks
// TOKENS against SURFACES and never sees which class uses which token at which size.
//
// This is a RATCHET, not an allowlist. The pre-existing sites are frozen below; a 30th fails, and
// so does a baselined entry that gets fixed without being deleted — the list can only shrink.
// Raising --v2-faint itself past 4.5:1 is a palette change and therefore an owner taste call
// (logged in docs/UI_VISION_BACKLOG.md). The day it lands this guard self-retires: the contrast
// precondition below stops holding and the suite passes without asserting anything.
const FAINT_SMALL_TEXT_BASELINE: string[] = [
  'src/design/shell-v2.css :: :root[data-v2="on"] .v2-version',
  'src/design/shell-v2.css :: :root[data-v2="on"] .v2-shell kbd',
  'src/design/shell-v2.css :: :root[data-v2="on"] .v2-foot',
  'src/design/shell-v2.css :: :root[data-v2="on"] .v2-stamp',
  'src/design/shell-v2.css :: :root[data-v2="on"] .v2-measured',
  'src/design/shell-v2.css :: :root[data-v2="on"] .v2-update-notes',
  'src/design/shell-v2.css :: :root[data-v2="on"] .v2-update-fine',
  'src/surfaces/home-console.css :: :root[data-v2="on"] .hc-masthead-eyebrow',
  'src/surfaces/home-console.css :: :root[data-v2="on"] .hc-stage-loading',
  'src/surfaces/home-console.css :: :root[data-v2="on"] .hc-limiter-label',
  'src/surfaces/home-console.css :: :root[data-v2="on"] .hc-limiter-tag',
  'src/surfaces/home-hud.css :: :root[data-v2="on"][data-hud="on"] .hud-masthead-eyebrow',
  'src/surfaces/home-hud.css :: :root[data-v2="on"][data-hud="on"] .hud-eyebrow',
  'src/surfaces/home-hud.css :: :root[data-v2="on"][data-hud="on"] .hud-stage-loading',
  'src/surfaces/home-hud.css :: :root[data-v2="on"][data-hud="on"] .hud-stage-hint',
  'src/surfaces/home-hud.css :: :root[data-v2="on"][data-hud="on"] .hud-unit',
  'src/surfaces/home-hud.css :: :root[data-v2="on"][data-hud="on"] .hud-ring-cap',
  'src/surfaces/home-hud.css :: :root[data-v2="on"][data-hud="on"] .hud-trace-cap',
  'src/surfaces/home-hud.css :: :root[data-v2="on"][data-hud="on"] .hud-docket-note',
  'src/surfaces/home-hud.css :: :root[data-v2="on"][data-hud="on"] .hud-rank',
  'src/surfaces/home-hud.css :: :root[data-v2="on"][data-hud="on"] .hud-pill',
  'src/surfaces/home-v2.css :: :root[data-v2="on"] .hv2-stage-loading',
  'src/surfaces/home-v2.css :: :root[data-v2="on"] .hv2-stat-d',
  'src/surfaces/home-v2.css :: :root[data-v2="on"] .hv2-card-hd-right',
  'src/surfaces/hud-rooms.css :: :root[data-v2="on"][data-hud="on"] .v2-room:not([data-room="home"]):not([data-room="check"]) .hud-masthead-eyebrow',
  'src/surfaces/hud-rooms.css :: :root[data-v2="on"][data-hud="on"] :is(.v2-room[data-room="fix"], .v2-room[data-room="lab"] :where(.lg-fast)) .check-section-label:not(.check-collapse-head), :root[data-v2="on"][data-hud="on"] :is(.v2-room[data-room="fix"], .v2-room[data-room="lab"] :where(.lg-fast)) .fix-section-label',
  'src/surfaces/hud-rooms.css :: :root[data-v2="on"][data-hud="on"] :is(.v2-room[data-room="fix"], .v2-room[data-room="lab"] :where(.lg-fast)) .check-collapse-head',
  'src/surfaces/monitor-v2.css :: :root[data-v2="on"] .mv2-quiet-hint',
  'src/surfaces/RerunCheckBand.css :: :root[data-v2="on"] .rcb-tag',
];

// WCAG "large text": >=24px, or >=18.66px when bold. Anything smaller owes the full 4.5:1.
const isLargeText = (px: number, weight: number): boolean =>
  px >= 24 || (px >= 18.66 && weight >= 700);

/** Every rule that declares BOTH an explicit size and `color: var(--v2-faint)` on small text. */
function faintOnSmallText(): string[] {
  const found: string[] = [];
  for (const p of listCss("src")) {
    const css = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/color:\s*var\(--v2-faint\)/.test(body)) continue;
      let px: number | null = null;
      let weight = 400;
      // `font: 600 10px var(--v2-font-sans)` shorthand, then longhand overrides.
      const shorthand = body.match(/(?:^|[;\s])font:\s*([^;]+)/);
      if (shorthand) {
        weight = parseInt(shorthand[1].match(/\b([1-9]00)\b/)?.[1] ?? "400", 10);
        const s = shorthand[1].match(/\b([\d.]+)px\b/);
        if (s) px = parseFloat(s[1]);
      }
      const size = body.match(/font-size:\s*([\d.]+)px/);
      if (size) px = parseFloat(size[1]);
      const fw = body.match(/font-weight:\s*([1-9]00|bold)/);
      if (fw) weight = fw[1] === "bold" ? 700 : parseInt(fw[1], 10);
      // A rule with no size of its own inherits one this parser cannot resolve — out of scope.
      if (px === null || isLargeText(px, weight)) continue;
      found.push(`${p.replace(/\\/g, "/")} :: ${sel.replace(/\s+/g, " ").trim()}`);
    }
  }
  return found;
}

describe("caption-token usage (--v2-faint on small text)", () => {
  const faintOnBg = contrast(parseHex(v2Token("faint")), parseHex(v2Token("bg")));
  // Precondition: this guard only has teeth while faint is genuinely sub-AA on the page.
  const stillSubAA = faintOnBg < 4.5;

  it("no NEW rule pairs --v2-faint with text below the AA-large threshold", () => {
    if (!stillSubAA) return; // palette lifted past 4.5 — the whole class is fixed, guard retires
    const baseline = new Set(FAINT_SMALL_TEXT_BASELINE);
    const added = faintOnSmallText().filter((k) => !baseline.has(k));
    expect(
      added,
      `--v2-faint is ${faintOnBg.toFixed(2)}:1 on --v2-bg, under AA's 4.5 — so it may only carry ` +
        `LARGE text (>=24px, or >=18.66px bold). These rules put it on smaller text:\n  ` +
        `${added.join("\n  ")}\nUse --v2-muted (the tier that owes and clears 4.5), or make the ` +
        `text large. Do not add to the baseline: it is a ratchet and only shrinks.`,
    ).toEqual([]);
  });

  it("the baseline has no stale entries — fixing a site must delete its line", () => {
    if (!stillSubAA) return;
    const live = new Set(faintOnSmallText());
    const stale = FAINT_SMALL_TEXT_BASELINE.filter((k) => !live.has(k));
    expect(
      stale,
      `these baselined sites no longer violate (fixed, renamed, or deleted) — remove them from ` +
        `FAINT_SMALL_TEXT_BASELINE so the ratchet tightens:\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("type discipline (Geist law)", () => {
  it("v2 token layer defines both font tokens", () => {
    expect(v2Token("font-sans")).toContain("Geist Sans");
    expect(v2Token("font-mono")).toContain("Geist Mono");
  });

  it('"Geist" appears in src CSS only in fonts-v2.css (@font-face) + tokens-v2.css (tokens)', () => {
    const allowed = new Set(["fonts-v2.css", "tokens-v2.css", "tokens-qpw.css"]);
    const offenders: string[] = [];
    for (const p of listCss("src")) {
      const base = p.replace(/\\/g, "/").split("/").pop() as string;
      if (allowed.has(base)) continue;
      if (readFileSync(p, "utf8").includes("Geist")) offenders.push(p);
    }
    expect(offenders).toEqual([]);
  });
});

// ── vendor hygiene: the license notice travels with the code ──

describe("vendor hygiene (MIT + Commons Clause notice)", () => {
  const vendorDir = join("src", "design", "vendor");
  const components = (readdirSync(vendorDir) as string[]).filter((f) =>
    statSync(join(vendorDir, f)).isDirectory(),
  );

  it("vendor kit is present (the adopted list)", () => {
    // Floor tracks the ADOPTED components only. Dead-code sweep 2026-07-13 removed 7 never-wired
    // React Bits vendored dirs (DotField, GlareHover, GooeyNav, Grainient, Noise, PillNav, Radar —
    // 0 importers, verified) from the original bulk-vendor add; the 7 that remain are all in use.
    // 2026-08-06 generation prune: MagicBento went with LabBento.tsx (its last importer) — 6 remain.
    expect(components.length).toBeGreaterThanOrEqual(6);
  });

  const thirdParty = readFileSync(join(vendorDir, "THIRD_PARTY.md"), "utf8");

  // The shelf now holds more than React Bits (T4d added ektogamat's holographic material) —
  // each component's header must name its TRUE origin + author; React Bits stays the default.
  const ORIGINS: Record<string, { from: string; author: string }> = {
    HolographicMaterial: {
      from: "Vendored from threejs-holographic-material",
      author: "Anderson Mancini",
    },
  };
  const DEFAULT_ORIGIN = { from: "Vendored from React Bits", author: "David Haz" };

  for (const comp of components) {
    it(`${comp}: every source file carries the header + THIRD_PARTY.md lists it`, () => {
      const files = (readdirSync(join(vendorDir, comp)) as string[]).filter(
        (f) => f.endsWith(".tsx") || f.endsWith(".ts") || f.endsWith(".css"),
      );
      expect(files.length).toBeGreaterThan(0);
      const origin = ORIGINS[comp] ?? DEFAULT_ORIGIN;
      for (const f of files) {
        const head = readFileSync(join(vendorDir, comp, f), "utf8").slice(0, 300);
        expect(head, `${comp}/${f} missing license header`).toContain(origin.from);
        expect(head, `${comp}/${f} missing copyright line`).toContain(origin.author);
      }
      expect(thirdParty, `THIRD_PARTY.md missing row for ${comp}`).toContain(`| ${comp} |`);
    });
  }

  it("no vendored component references react-router-dom (router-less app)", () => {
    const offenders: string[] = [];
    for (const comp of components) {
      for (const f of readdirSync(join(vendorDir, comp)) as string[]) {
        if (!f.endsWith(".tsx") && !f.endsWith(".ts")) continue;
        if (/from\s+['"]react-router-dom['"]/.test(readFileSync(join(vendorDir, comp, f), "utf8"))) {
          offenders.push(`${comp}/${f}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
