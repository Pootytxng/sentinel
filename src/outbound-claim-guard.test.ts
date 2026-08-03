import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// OUTBOUND-CLAIM GUARD (2026-08-03). Replaces the receipts-only copy guard.
//
// WHY THIS EXISTS — the defect it is built from:
// The previous guard (src/receipts-copy-guard.test.ts) keyed ONLY on receipts_gate(). Two failures
// followed from that single design choice:
//
//   1. When the signed updater was armed on 2026-07-22, Compy gained a real outbound call while
//      shipping copy still said "nothing leaves your PC". No guard fired, because no guard was
//      watching the updater. The contradiction shipped for ~12 days.
//   2. Worse, that guard was written as a WATCH-LIST: while receipts was dark it asserted the
//      absolute phrases MUST STILL EXIST, so it actively pinned the false copy in place and any
//      attempt to fix the wording failed the build.
//
// THE INVERSION: this guard derives the set of live outbound surfaces from CONFIG, and FORBIDS
// absolute "we never talk to the network" claims whenever any surface is live. It never requires a
// phrase to be present. Adding a new outbound surface to SURFACES is the only maintenance needed;
// forget to, and you are back to the 2026-07-22 failure mode — so add it in the same change that
// arms the surface.

// Paths are repo-root-relative: vitest runs from the repo root (see scripts/run-vitest.mjs), the
// same convention the retired receipts-copy-guard used. No __dirname — this project is ESM.

// ── Live-surface detection, read from the real config rather than a hand-kept list ──────────────

function receiptsArmed(): boolean {
  const src = readFileSync(join("src-tauri", "src", "receipts.rs"), "utf8");
  const m = src.match(/fn\s+receipts_gate\s*\(\s*\)\s*->\s*bool\s*\{\s*(true|false)\s*\}/);
  if (!m) throw new Error("could not parse receipts_gate() return literal from receipts.rs");
  return m[1] === "true";
}

function updaterArmed(): boolean {
  const conf = JSON.parse(readFileSync(join("src-tauri", "tauri.conf.json"), "utf8"));
  const endpoints = conf?.plugins?.updater?.endpoints;
  return Array.isArray(endpoints) && endpoints.length > 0;
}

const SURFACES: { name: string; live: () => boolean }[] = [
  { name: "receipts telemetry", live: receiptsArmed },
  { name: "signed update check", live: updaterArmed },
];

// ── What counts as shipped, user-facing copy ────────────────────────────────────────────────────

const COPY_ROOTS = [
  { dir: "src", exts: [".ts", ".tsx", ".json"] },
  { dir: "site", exts: [".html"] },
];
const EXTRA_FILES = [join("docs", "PRIVACY.md")];

// docs/archive/** is deliberately out of scope: historical records may keep the absolutes that were
// true when they were written. Tests are excluded so this guard's own fixtures cannot trip it.
const SKIP_DIR = /[\\/](node_modules|dist|dist-site|target|archive|__snapshots__)[\\/]/;
const SKIP_FILE = /\.(test|spec)\.[tj]sx?$/;

function collect(): string[] {
  const out: string[] = [];
  for (const { dir, exts } of COPY_ROOTS) {
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) {
          if (!SKIP_DIR.test(p + "\\")) walk(p);
          continue;
        }
        if (SKIP_FILE.test(p)) continue;
        if (exts.some((e) => p.endsWith(e))) out.push(p);
      }
    };
    walk(dir);
  }
  return [...out, ...EXTRA_FILES];
}

// Engineering comments legitimately say things like "zero outbound" about ONE module (BlackBox,
// hardware.rs) and are true at that scope. Only shipped copy is in scope here, so comments are
// stripped before matching. The `(?<!:)` guard keeps `https://…` inside a string from being read
// as a line comment. Worst case this hides a phrase later on a URL line — a false negative, never
// a false positive, which is the right way for a guard like this to fail.
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(?<!:)\/\/[^\n]*/g, " ");
}

// Absolute claims that stop being true the moment ANY outbound surface is live.
const FORBIDDEN = [
  "nothing leaves your pc",
  "never fetches the internet",
  "no network requests",
  "no network connections",
  "zero outbound",
  "never sent anywhere",
  "不会离开你的电脑",
  "从不联网",
];

export function findAbsolutes(text: string): string[] {
  const hay = stripComments(text).toLowerCase();
  return FORBIDDEN.filter((phrase) => hay.includes(phrase));
}

// ── The guard ───────────────────────────────────────────────────────────────────────────────────

describe("outbound-claim guard", () => {
  it("each outbound surface is detectable from config (the watch cannot silently rot)", () => {
    for (const s of SURFACES) expect(() => s.live(), s.name).not.toThrow();
  });

  it("actually scans a real corpus (a broken walker must not make this guard vacuously pass)", () => {
    const files = collect();
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((f) => f.endsWith("PRIVACY.md"))).toBe(true);
    expect(files.some((f) => f.includes(join("locales", "zh-CN")))).toBe(true);
    expect(files.some((f) => f.endsWith("privacy.html"))).toBe(true);
  });

  it("detects a planted absolute (positive control — proves the guard can actually fail)", () => {
    expect(findAbsolutes('const copy = "Nothing leaves your PC, ever";')).toEqual([
      "nothing leaves your pc",
    ]);
    // …and proves the comment-stripping does not make it toothless in the other direction.
    expect(findAbsolutes('// module note: zero outbound here\nconst copy = "hello";')).toEqual([]);
  });

  const liveSurfaces = SURFACES.filter((s) => s.live());

  if (liveSurfaces.length > 0) {
    it(`no absolute offline claim ships while [${liveSurfaces
      .map((s) => s.name)
      .join(", ")}] is live`, () => {
      const offenders: string[] = [];
      for (const file of collect()) {
        for (const phrase of findAbsolutes(readFileSync(file, "utf8"))) {
          offenders.push(`${file} → "${phrase}"`);
        }
      }
      expect(
        offenders,
        `Compy has a live outbound surface (${liveSurfaces.map((s) => s.name).join(", ")}), so ` +
          `these absolute claims are false. Reword them to state what actually leaves the machine ` +
          `and when:\n  ${offenders.join("\n  ")}`,
      ).toEqual([]);
    });
  } else {
    it("no outbound surface is live, so absolutes would be permitted (nothing to enforce)", () => {
      expect(liveSurfaces).toEqual([]);
    });
  }

  // Receipts-specific. "No telemetry" is TRUE today even with the updater live — an update check
  // is not telemetry — so this claim is gated on receipts alone, not on the surface set above.
  it("absolute 'no telemetry' copy is reworded in the same change that arms receipts", () => {
    if (!receiptsArmed()) return;
    const offenders = collect().filter((f) =>
      readFileSync(f, "utf8").toLowerCase().includes("no telemetry"),
    );
    expect(
      offenders,
      `receipts_gate() is TRUE but absolute "no telemetry" copy still ships in:\n  ` +
        `${offenders.join("\n  ")}\nRework it (e.g. "local-only by default; optional opt-in sharing").`,
    ).toEqual([]);
  });
});
