import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUBMAP_REL,
  compare,
  declaredCount,
  declaredModules,
  delegatesToSubmap,
  extractMapSection,
  mergeDeclared,
  productionSource,
  verifyRepo,
} from "./verify-module-map.mjs";

// TWO kinds of test live here, and neither substitutes for the other. Delete either and the guard
// stops guarding:
//
//   * everything down to the last describe tests the DETECTOR against synthetic input. A guard that
//     only asserts "the current map passes" goes green the moment someone edits the map to match a
//     broken tree.
//   * the last describe runs the detector against THIS tree. A detector nobody points at the repo is
//     the failure that actually happened: verify-module-map.mjs was written 2026-08-02 and `main`
//     was red by 2026-08-04, because nothing ran it. Being a vitest file is the whole fix - vitest
//     runs on every local verify pass and in CI's frontend job, for no extra CI minutes.

const disk = (entries) => new Map(Object.entries(entries));

describe("module-map drift detector", () => {
  it("catches the 2026-08-02 defect: a module on disk that the map never names", () => {
    const declared = declaredModules("- `lib.rs` (~1585) — wiring.\n");
    const { failures } = compare(declared, disk({
      "lib.rs": { lines: 1585, mutates: [] },
      "intelligence.rs": { lines: 3614, mutates: [] },
    }), 2);
    expect(failures).toEqual([
      "MISSING: intelligence.rs (3614 lines) is on disk but absent from the map",
    ]);
  });

  it("catches a stale file count even when every named module resolves", () => {
    const declared = declaredModules("- `lib.rs` — wiring.\n");
    const { failures } = compare(declared, disk({ "lib.rs": { lines: 10, mutates: [] } }), 35);
    expect(failures).toEqual(["COUNT: map declares 35 .rs files, tree has 1"]);
  });

  it("catches a ghost: a module named in the map that no longer exists", () => {
    const declared = declaredModules("- `lib.rs` — wiring.\n- `deleted.rs` — gone.\n");
    const { failures } = compare(declared, disk({ "lib.rs": { lines: 10, mutates: [] } }), 1);
    expect(failures).toContain("GHOST: deleted.rs is named in the map but not on disk");
  });

  it("catches an unstarred module that writes Windows state", () => {
    const declared = declaredModules("- `lib.rs` — wiring.\n");
    const { failures } = compare(declared, disk({
      "lib.rs": { lines: 10, mutates: ["set_raw_value"] },
    }), 1);
    expect(failures).toEqual([
      "UNSTARRED-MUTATOR: lib.rs touches Windows state (set_raw_value) but carries no star in the map",
    ]);
  });

  it("accepts a starred mutator", () => {
    const declared = declaredModules("- ★ `actions.rs` — the boundary.\n");
    const { failures } = compare(declared, disk({
      "actions.rs": { lines: 10, mutates: ["run_elevated_powershell"] },
    }), 1);
    expect(failures).toEqual([]);
  });

  it("inherits the star per line, so multi-module bullets are attributed correctly", () => {
    const declared = declaredModules("- ★ `a.rs` (~10), `b.rs` (~20) — two on one line.\n");
    expect(declared.get("a.rs")).toEqual({ starred: true, loc: 10 });
    expect(declared.get("b.rs")).toEqual({ starred: true, loc: 20 });
  });

  it("warns, not fails, on line-count drift beyond tolerance", () => {
    const declared = declaredModules("- `fps.rs` (~625) — IPC.\n");
    const { failures, warnings } = compare(declared, disk({
      "fps.rs": { lines: 1092, mutates: [] },
    }), 1);
    expect(failures).toEqual([]);
    expect(warnings).toEqual(["STALE-LOC: fps.rs map says ~625, tree has 1092"]);
  });
});

describe("production-source filter (why the detector stopped crying wolf)", () => {
  it("ignores a marker that only appears in a comment", () => {
    // main.rs's sole hit on the first run was this: a comment naming the elevation helper.
    const src = "// the ticket minted by actions::run_elevated_powershell or nothing runs\nfn main() {}\n";
    expect(productionSource(src)).not.toContain("run_elevated_powershell");
  });

  it("ignores a marker inside a #[cfg(test)] module", () => {
    const src = [
      "fn real() {}",
      "#[cfg(test)]",
      "mod tests {",
      "  fn t() { let _ = key.set_value(\"x\"); }",
      "}",
      "fn after() {}",
    ].join("\n");
    const production = productionSource(src);
    expect(production).not.toContain("set_value");
    expect(production).toContain("fn after()");
  });

  it("keeps a marker in real code", () => {
    expect(productionSource("fn go() { key.create_subkey(\"Run\"); }")).toContain("create_subkey");
  });
});

describe("gutted-contract guard", () => {
  it("returns null when the map heading is gone, so the check cannot pass vacuously", () => {
    expect(extractMapSection("# CLAUDE.md\n\nno map here\n")).toBeNull();
  });

  it("stops the section at the next h2 rather than swallowing the LOCKED rules", () => {
    const section = extractMapSection("### Rust module map\n- `a.rs` — x.\n\n## LOCKED safety rules\n- `zzz.rs` — not a module bullet.\n");
    expect(section).toContain("a.rs");
    expect(section).not.toContain("zzz.rs");
  });

  it("reads the declared file count out of the header line", () => {
    expect(declaredCount("\n\nComplete as of 2026-08-02 (44 `.rs` files; rough).\n")).toBe(44);
  });
});

// The map was split across two files on 2026-08-04 so the read-only half stops loading into every
// session. The split is only honest while both halves are enforced together — otherwise deleting the
// half that no longer auto-loads would make 19 modules invisible AND leave the gate green.
describe("split map (root ★ half + src-tauri read-only half)", () => {
  it("arms the submap requirement only when the root actually delegates", () => {
    expect(delegatesToSubmap(`the remainder is in \`${SUBMAP_REL}\`, which auto-loads`)).toBe(true);
    // Folding both halves back into one file is a legal configuration, not a failure: there is then
    // no second half to go missing, so nothing to enforce.
    expect(delegatesToSubmap("- `lib.rs` — everything is right here.\n")).toBe(false);
  });

  it("verifies the union, so a module declared only in the submap is not MISSING", () => {
    const { merged } = mergeDeclared(
      declaredModules("- ★ `actions.rs` — the boundary.\n"),
      declaredModules("- `fps.rs` — IPC.\n"),
    );
    const { failures } = compare(merged, disk({
      "actions.rs": { lines: 10, mutates: ["run_elevated_powershell"] },
      "fps.rs": { lines: 20, mutates: [] },
    }), 2);
    expect(failures).toEqual([]);
  });

  it("reports overlap, because two halves that both declare a module can contradict each other", () => {
    const { merged, duplicates } = mergeDeclared(
      declaredModules("- ★ `actions.rs` — the boundary.\n"),
      declaredModules("- `actions.rs` — a stale copy left behind by the split.\n"),
    );
    expect(duplicates).toEqual(["actions.rs"]);
    expect(merged.size).toBe(1);
  });

  it("lets the root win a star disagreement, so an unstarred mutator still trips the check", () => {
    // Fail-safe direction on purpose: the root is the half every session loads. If it says unstarred
    // and the submap says starred, the loud outcome is the correct one.
    const { merged } = mergeDeclared(
      declaredModules("- `services.rs` — moved out of the starred block by mistake.\n"),
      declaredModules("- ★ `services.rs` — still starred over here.\n"),
    );
    const { failures } = compare(merged, disk({
      "services.rs": { lines: 10, mutates: ["set_value"] },
    }), 1);
    expect(failures).toEqual([
      "UNSTARRED-MUTATOR: services.rs touches Windows state (set_value) but carries no star in the map",
    ]);
  });

  it("finds a map section in the submap under its own continued-from heading", () => {
    const submap = "# src-tauri\n\n### Rust module map — read-only modules (continued from the root `CLAUDE.md`)\n\n- `fps.rs` (~1092) — IPC.\n";
    const section = extractMapSection(submap);
    expect(section).not.toBeNull();
    expect(declaredModules(section).has("fps.rs")).toBe(true);
  });

  it("keeps the .rs count in the root alone, so the halves cannot disagree about the total", () => {
    // The submap deliberately restates no count; reading one out of it would create a second source
    // of truth for the same number.
    expect(declaredCount("### Rust module map — read-only modules (continued)\n- `fps.rs` — IPC.\n")).toBeNull();
  });
});

// A miniature repo on disk, because verifyRepo()'s job is reading two files and a directory - the
// part compare() never sees, and the part that broke.
function fixtureRepo(files) {
  const root = mkdtempSync(join(tmpdir(), "module-map-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, ...rel.split("/"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
  return root;
}

const CLEAN_FIXTURE = {
  "CLAUDE.md": [
    "### Rust module map",
    "",
    "Complete as of today (2 `.rs` files). The read-only remainder is in `src-tauri/CLAUDE.md`.",
    "",
    "- ★ `actions.rs` (~10) — the mutation boundary.",
    "",
  ].join("\n"),
  "src-tauri/CLAUDE.md": "### Rust module map — read-only (continued)\n\n- `fps.rs` (~20) — IPC.\n",
  "src-tauri/src/actions.rs": 'fn apply() { key.set_value("x"); }\n',
  "src-tauri/src/fps.rs": "fn read() {}\n",
};

describe("verifyRepo against a repo on disk (the wiring, not the comparison)", () => {
  it("assembles both halves into one map and passes when they cover the tree", () => {
    const root = fixtureRepo(CLEAN_FIXTURE);
    try {
      const result = verifyRepo(root);
      expect(result.failures).toEqual([]);
      // Proof it read the submap rather than passing vacuously: fps.rs is declared only there.
      expect(result.declared).toBe(2);
      expect(result.starred).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("goes red on the exact defect that sat on main for two days: a new .rs file, no map entry", () => {
    // 7c8a03f, reproduced in miniature - support_evidence.rs landed and the map still said 44.
    const root = fixtureRepo({ ...CLEAN_FIXTURE, "src-tauri/src/support_evidence.rs": "fn record() {}\n" });
    try {
      expect(verifyRepo(root).failures).toEqual([
        "MISSING: support_evidence.rs (2 lines) is on disk but absent from the map",
        "COUNT: map declares 2 .rs files, tree has 3",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("names SUBMAP-MISSING first when the delegated half is gone, instead of burying it in MISSING lines", () => {
    const { "src-tauri/CLAUDE.md": _gone, ...withoutSubmap } = CLEAN_FIXTURE;
    const root = fixtureRepo(withoutSubmap);
    try {
      const { failures } = verifyRepo(root);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain("SUBMAP-MISSING");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// The live check. Everything above proves the detector works; this is the one that fails when the
// map and the tree part company, on the next test run rather than at the next audit.
describe("the map as it stands, against the tree it describes", () => {
  it("has no drift", () => {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const { failures, actual } = verifyRepo(repo);
    expect(failures).toEqual([]);
    // Line-count drift stays a WARN here as it does at the CLI - `--strict` is a release-gate
    // concern, and failing `npm test` on a rounded line count would get this muted rather than fixed.
    expect(actual).toBeGreaterThan(0);
  });
});
