import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Drift guard (bug -> guard, see CLAUDE.md "bug becomes guard").
//
// The set of one-click-APPLIABLE rec ids is hand-maintained in two places that are kept in
// sync only by a code comment:
//   - frontend  : `const APPLIABLE_REC_IDS = new Set<string>([...])` in src/App.tsx
//   - backend   : `pub(crate) const APPLIABLE_REC_IDS: &[&str] = &[...]` in src-tauri/src/history.rs
//                 (also exposed verbatim by the `get_appliable_rec_ids` IPC command)
// If they silently diverge, the UI will offer (or withhold) an Apply button for a rec the backend
// disagrees about. This test reads BOTH source files and fails loudly the moment they drift apart.
//
// This is the cheapest fix for the dual-maintenance hazard an external audit flagged: it changes no
// runtime behavior, it just makes divergence impossible to merge unnoticed. (The fuller fix — having
// App.tsx fetch get_appliable_rec_ids at startup and drop the literal Set — can come later.)

function quotedIds(block: string): string[] {
  return [...block.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
}

function extractList(src: string, startMarker: RegExp, endToken: string): string[] {
  const start = src.search(startMarker);
  if (start === -1) throw new Error(`start marker ${startMarker} not found`);
  const tail = src.slice(start);
  const endIdx = tail.indexOf(endToken);
  if (endIdx === -1) throw new Error(`end token "${endToken}" not found after start marker`);
  return quotedIds(tail.slice(0, endIdx));
}

const frontendSrc = readFileSync(join("src", "App.tsx"), "utf8");
const backendSrc = readFileSync(join("src-tauri", "src", "history.rs"), "utf8");

const frontendIds = extractList(
  frontendSrc,
  /APPLIABLE_REC_IDS = new Set<string>\(\[/,
  "])",
);
const backendIds = extractList(
  backendSrc,
  /APPLIABLE_REC_IDS: &\[&str\] = &\[/,
  "];",
);

describe("APPLIABLE_REC_IDS frontend/backend parity", () => {
  it("parses a non-trivial list from each source", () => {
    expect(frontendIds.length).toBeGreaterThan(10);
    expect(backendIds.length).toBeGreaterThan(10);
  });

  it("the frontend Set and the backend const contain exactly the same ids", () => {
    expect([...frontendIds].sort()).toEqual([...backendIds].sort());
  });

  it("neither list contains duplicate ids", () => {
    expect(new Set(frontendIds).size).toBe(frontendIds.length);
    expect(new Set(backendIds).size).toBe(backendIds.length);
  });
});
