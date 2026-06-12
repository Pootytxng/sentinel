// Library→web exporter — Receipts Doctrine Phase 1 (docs/RECEIPTS_DOCTRINE.md §4).
// Renders EVERY Learn/Library entry + the verdict glossary to standalone static HTML.
// Thin CLI over the SHARED rendering core (scripts/lib/library-render.mjs — R3 Lane A1):
// the curated dark-site pages (site/generate.mjs) come from the same core, so the two
// outputs can never drift from each other or from the in-app Library.
//
// BUILD TOOLING ONLY: zero new dependencies, zero app-runtime change, zero IPC, zero outbound
// network (see the core's header). Usage: node scripts/export-library.mjs  (npm run export:library)
// Output: dist-web/library/<id>.html per entry + index.html (gitignored artifact).
// HOSTING IS OWNER-GATED — building publishes nothing.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertExportableIds,
  loadLibrary,
  repoRoot,
  standaloneEntryPage,
  standaloneIndexPage,
} from "./lib/library-render.mjs";

export { loadLibrary };

const DEFAULT_OUT = join(repoRoot, "dist-web", "library");

/** Render every entry + the index to outDir. Returns { outDir, pageCount, entryCount }. */
export async function exportLibrary({ lib, outDir = DEFAULT_OUT } = {}) {
  lib ??= await loadLibrary();
  const { entries } = lib;
  assertExportableIds(entries);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const entry of entries) {
    const html = standaloneEntryPage(entry, lib);
    if (!/<h1>\S/.test(html)) throw new Error(`empty title rendered for '${entry.id}'`);
    writeFileSync(join(outDir, `${entry.id}.html`), html);
  }
  writeFileSync(join(outDir, "index.html"), standaloneIndexPage(entries, lib));
  return { outDir, pageCount: entries.length + 1, entryCount: entries.length };
}

const invokedAsMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) {
  const { outDir, pageCount, entryCount } = await exportLibrary();
  console.log(`exported ${entryCount} Library entries + index → ${outDir} (${pageCount} pages)`);
}
