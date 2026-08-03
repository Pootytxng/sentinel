import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// OUTBOUND-CLAIM GUARD (2026-08-03). Replaces the receipts-only copy guard.
//
// WHY THIS EXISTS — two defects, both real:
//
//   1. The retired src/receipts-copy-guard.test.ts keyed ONLY on receipts_gate(). When the signed
//      updater armed on 2026-07-22 Compy gained a real outbound call while shipping copy still said
//      "nothing leaves your PC" — and no guard fired, because none watched the updater. Worse, that
//      guard was a WATCH-LIST: while receipts was dark it asserted the absolute phrases MUST STILL
//      EXIST, so it pinned the false copy in place and failed any attempt to reword it.
//
//   2. This guard's FIRST version fixed the logic but kept an allow-list corpus (src/ + site/ +
//      PRIVACY.md). It therefore missed site-app/ — the actual public marketing site — which still
//      told visitors the app "makes zero outbound network requests". The logic was never the weak
//      part. The CORPUS was.
//
// So the corpus is now INVERTED: walk the whole repo and exclude explicitly. A new surface is
// covered by default. Silence means covered, not skipped.
//
// Paths are repo-root-relative; vitest runs from the repo root (scripts/run-vitest.mjs). No
// __dirname — this project is ESM.

// ── Live-surface detection, read from real config rather than a hand-kept list ──────────────────

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

// ── Corpus: everything, minus explicit exclusions ───────────────────────────────────────────────

const EXT = /\.(ts|tsx|js|jsx|mjs|json|html|astro|md|css|rs)$/;

// Build output and vendored code. Nothing here is authored copy.
const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", ".github", "dist", "dist-web", "dist-site", "target",
  "coverage", "__snapshots__", ".vite", ".astro", ".claude",
]);

// docs/ is an internal record shelf: dated specs, reviews, audits and changelogs legitimately
// preserve absolutes that were TRUE when written — rewriting history would be dishonest. The two
// legal documents are the exception: they are published to the website, so they are live copy.
const DOCS_LIVE = new Set([join("docs", "PRIVACY.md"), join("docs", "EULA.md")]);

// Tests hold fixtures and quoted examples; this file plants a phrase on purpose.
const SKIP_FILE = /\.(test|spec)\.[tj]sx?$/;

// Escape hatch for text that NAMES a forbidden phrase in order to retire or forbid it (CLAUDE.md
// recording that zero-outbound is dead; RELEASE_STATE recording that the claims were removed).
// Greppable on purpose: `git grep outbound-claim-allow` lists every exemption in the repo.
const ALLOW_MARKER = "outbound-claim-allow";

function collect(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith("_")) continue; // local scratch
      const rel = dir === "." ? name : join(dir, name);
      let st;
      try { st = statSync(rel); } catch { continue; }
      if (st.isDirectory()) {
        if (!EXCLUDE_DIRS.has(name)) walk(rel);
        continue;
      }
      if (!EXT.test(name) || SKIP_FILE.test(name)) continue;
      if (/^docs[\\/]/.test(rel) && !DOCS_LIVE.has(rel)) continue;
      out.push(rel);
    }
  };
  walk(".");
  return out;
}

// Engineering comments legitimately say "zero outbound" about ONE module (BlackBox, hardware.rs)
// and are true at that scope. Only shipped copy is in scope, so comments are stripped first. The
// `(?<!:)` keeps `https://…` inside a string from reading as a line comment. Worst case that hides
// a phrase later on a URL line — a false negative, never a false positive.
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(?<!:)\/\/[^\n]*/g, " ");
}

// Absolute claims that stop being true the moment ANY outbound surface is live. Deliberately
// unconditional forms only: "Compy makes no network request unless you press Check now" is honest
// and must stay legal, so this targets the absolutes, not every use of the words.
const FORBIDDEN = [
  "nothing leaves your pc",
  "never fetches the internet",
  "no network requests",
  "no network connections",
  "zero outbound",
  "zero-outbound",
  "never sent anywhere",
  "不会离开你的电脑",
  "从不联网",
];

export function findAbsolutes(text: string): { phrase: string; line: number }[] {
  const hits: { phrase: string; line: number }[] = [];
  stripComments(text).split("\n").forEach((raw, i) => {
    if (raw.includes(ALLOW_MARKER)) return;
    const low = raw.toLowerCase();
    for (const phrase of FORBIDDEN) if (low.includes(phrase)) hits.push({ phrase, line: i + 1 });
  });
  return hits;
}

// ── The guard ───────────────────────────────────────────────────────────────────────────────────

describe("outbound-claim guard", () => {
  it("each outbound surface is detectable from config (the watch cannot silently rot)", () => {
    for (const s of SURFACES) expect(() => s.live(), s.name).not.toThrow();
  });

  it("covers every shipping surface — the corpus is what failed before, so assert it", () => {
    const files = collect();
    // Regression pins for defect #2: surfaces an allow-list corpus silently missed.
    for (const m of [
      join("site-app", "src", "pages", "index.astro"),
      join("site-app", "src", "pages", "compare.astro"),
      join("site", "privacy.html"),
      join("site", "generate.mjs"),
      join("docs", "PRIVACY.md"),
      join("src", "i18n", "locales", "zh-CN", "settings.json"),
      "CLAUDE.md",
      "COMPY_OVERVIEW.md",
    ]) {
      expect(files, `corpus must include ${m}`).toContain(m);
    }
    expect(files.length).toBeGreaterThan(200);
  });

  it("detects a planted absolute (positive control — proves the guard can actually fail)", () => {
    expect(findAbsolutes('const copy = "Nothing leaves your PC, ever";')).toEqual([
      { phrase: "nothing leaves your pc", line: 1 },
    ]);
    // Comment-stripping must not make it toothless in the other direction.
    expect(findAbsolutes("// module note: zero outbound here\nconst c = 1;")).toEqual([]);
    // The escape hatch works, and only on the line that carries it.
    expect(findAbsolutes(`zero outbound ${ALLOW_MARKER}`)).toEqual([]);
  });

  const liveSurfaces = SURFACES.filter((s) => s.live());

  if (liveSurfaces.length > 0) {
    it(`no absolute offline claim ships while [${liveSurfaces
      .map((s) => s.name)
      .join(", ")}] is live`, () => {
      const offenders: string[] = [];
      for (const file of collect()) {
        for (const { phrase, line } of findAbsolutes(readFileSync(file, "utf8"))) {
          offenders.push(`${file}:${line} → "${phrase}"`);
        }
      }
      expect(
        offenders,
        `Compy has a live outbound surface (${liveSurfaces.map((s) => s.name).join(", ")}), so ` +
          `these absolute claims are false. Reword them to state what actually leaves the machine ` +
          `and when — or, if the text names the phrase in order to retire it, put the ` +
          `${ALLOW_MARKER} marker on that line:\n  ${offenders.join("\n  ")}`,
      ).toEqual([]);
    });
  } else {
    it("no outbound surface is live, so absolutes would be permitted (nothing to enforce)", () => {
      expect(liveSurfaces).toEqual([]);
    });
  }

  // Receipts-specific. "No telemetry" is TRUE today even with the updater live — an update check is
  // not telemetry — so this claim is gated on receipts alone, not on the surface set above.
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
