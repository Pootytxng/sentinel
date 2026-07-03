import { describe, it, expect, afterEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { readV2, applyV2 } from "./theme";

// V2-1 foundation guards (spec 2026-07-02-v2-shell-sourcing-and-plan) — the V2 shell laws,
// mechanized (bug→guard tier 1):
//   1. compy_v2 defaults OFF and gates via <html data-v2="on"> only.
//   2. Every rule in tokens-v2.css is scoped under [data-v2="on"] — THE flag-off
//      byte-identity mechanism: no attribute → no rule can match → the app is untouched.
//   3. The v2 palette clears the same WCAG floors as the instrument themes (4.5 body,
//      3.0 muted-caption, 4.5 ink-on-accent) — extends theme-contrast.test.ts to v2.
//   4. Type discipline: Geist families are referenced ONLY via the v2 token layer, and
//      --v2-font-mono exists so machine values have their one sanctioned mono source.
//   5. Vendor hygiene: every vendored React Bits file carries its license header and is
//      listed in THIRD_PARTY.md (MIT + Commons Clause requires the notice travel along).

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.v2;
});

describe("compy_v2 flag", () => {
  it("defaults OFF (flag-off IS the shipped app)", () => {
    expect(readV2()).toBe(false);
    localStorage.setItem("compy_v2", "ludicrous"); // junk → OFF
    expect(readV2()).toBe(false);
  });

  it("applies + removes data-v2 on <html> and persists", () => {
    applyV2(true);
    expect(document.documentElement.dataset.v2).toBe("on");
    expect(localStorage.getItem("compy_v2")).toBe("1");
    expect(readV2()).toBe(true);
    applyV2(false);
    expect(document.documentElement.dataset.v2).toBeUndefined();
    expect(readV2()).toBe(false);
  });
});

// ── source-level guards (read the real files, like theme-literal-guard) ──

const loadV2Css = (...path: string[]): string =>
  readFileSync(join("src", ...path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const tokensCss = loadV2Css("design", "tokens-v2.css");
const shellCss = loadV2Css("design", "shell-v2.css");
const homeCss = loadV2Css("surfaces", "home-v2.css");

// EVERY v2 stylesheet must obey the scoping law. New v2 CSS files get added here (V2-2+).
const V2_CSS: [string, string][] = [
  ["tokens-v2.css", tokensCss],
  ["shell-v2.css", shellCss],
  ["home-v2.css", homeCss],
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
            // every comma-separated selector in the header must carry the scope
            for (const part of sel.split(",")) {
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

describe("type discipline (Geist law)", () => {
  it("v2 token layer defines both font tokens", () => {
    expect(v2Token("font-sans")).toContain("Geist Sans");
    expect(v2Token("font-mono")).toContain("Geist Mono");
  });

  it('"Geist" appears in src CSS only in fonts-v2.css (@font-face) + tokens-v2.css (tokens)', () => {
    const allowed = new Set(["fonts-v2.css", "tokens-v2.css"]);
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

  it("vendor kit is present (the V2-1 adopt list)", () => {
    expect(components.length).toBeGreaterThanOrEqual(12);
  });

  const thirdParty = readFileSync(join(vendorDir, "THIRD_PARTY.md"), "utf8");

  for (const comp of components) {
    it(`${comp}: every source file carries the header + THIRD_PARTY.md lists it`, () => {
      const files = (readdirSync(join(vendorDir, comp)) as string[]).filter(
        (f) => f.endsWith(".tsx") || f.endsWith(".ts") || f.endsWith(".css"),
      );
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        const head = readFileSync(join(vendorDir, comp, f), "utf8").slice(0, 300);
        expect(head, `${comp}/${f} missing license header`).toContain("Vendored from React Bits");
        expect(head, `${comp}/${f} missing copyright line`).toContain("David Haz");
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
