// @vitest-environment node
// Tests for the Library→web exporter (Receipts Doctrine Phase 1).
// Runs the real export once into a temp dir, then verifies the contract:
// page count == source entry count (+ index), no empty bodies, HTML smoke.
// Node environment is required: the exporter embeds vite/esbuild, whose runtime invariant
// checks fail under jsdom's patched globals.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportLibrary, loadLibrary } from "./export-library.mjs";

let outDir;
let entries;
let pages; // Map<filename, html>

beforeAll(async () => {
  const lib = await loadLibrary();
  entries = lib.entries;
  outDir = mkdtempSync(join(tmpdir(), "compy-library-export-"));
  await exportLibrary({ lib, outDir });
  pages = new Map(
    readdirSync(outDir)
      .filter((f) => f.endsWith(".html"))
      .map((f) => [f, readFileSync(join(outDir, f), "utf8")]),
  );
}, 60_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

const mainText = (html) => {
  const m = /<main>([\s\S]*?)<\/main>/.exec(html);
  return m ? m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
};

describe("export-library", () => {
  it("source corpus is non-trivial (the ~120-entry Library actually loaded)", () => {
    expect(entries.length).toBeGreaterThan(100);
  });

  it("exports exactly one page per source entry, plus the index", () => {
    expect(pages.size).toBe(entries.length + 1);
    expect(pages.has("index.html")).toBe(true);
    for (const e of entries) expect(pages.has(`${e.id}.html`), e.id).toBe(true);
  });

  it("no page has an empty body", () => {
    for (const [file, html] of pages) {
      expect(mainText(html).length, file).toBeGreaterThan(40);
    }
  });

  it("every page passes HTML smoke: doctype, title, footer line, compy.gg link, no template leftovers", () => {
    for (const [file, html] of pages) {
      expect(html.startsWith("<!doctype html>"), file).toBe(true);
      expect(html, file).toContain('<html lang="en">');
      expect(html, file).toMatch(/<title>[^<]+<\/title>/);
      expect(html, file).toContain("Measured, not promised — Compy");
      expect(html, file).toContain('href="https://compy.gg"');
      expect(html, file).not.toContain("{{");
      expect(html, file).not.toContain("undefined</");
    }
  });

  it("every tweak page carries its verdict chip; non-tweaks carry a type chip", () => {
    for (const e of entries) {
      const html = pages.get(`${e.id}.html`);
      if (e.type === "tweak") {
        expect(html, e.id).toContain(`class="chip chip-${e.verdict}"`);
      } else {
        expect(html, e.id).toContain(`class="chip chip-${e.type}"`);
      }
    }
  });

  it("the index links every entry and renders the verdict glossary", () => {
    const index = pages.get("index.html");
    for (const e of entries) expect(index, e.id).toContain(`href="${e.id}.html"`);
    expect(index).toContain("How Compy grades things");
    expect(index).toContain("Placebo");
    expect(index).toContain(`${entries.length} entries`);
  });

  it("entry copy is HTML-escaped (no raw angle brackets from data)", () => {
    for (const [file, html] of pages) {
      const text = /<main>([\s\S]*?)<\/main>/.exec(html)[1];
      // After removing legitimate tags, no stray '<' may remain from unescaped data.
      expect(text.replace(/<\/?(?:header|section|h1|h2|p|ol|li|ul|dl|dt|dd|span|a)\b[^>]*>/g, ""), file).not.toMatch(/</);
    }
  });

  it("export is destination-clean (re-export does not accumulate stale pages)", async () => {
    expect(existsSync(join(outDir, "index.html"))).toBe(true);
    const again = await exportLibrary({ outDir });
    expect(again.entryCount).toBe(entries.length);
    const files = readdirSync(outDir).filter((f) => f.endsWith(".html"));
    expect(files.length).toBe(entries.length + 1);
  }, 60_000);
});
