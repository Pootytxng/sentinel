import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// HARDWARE IDENTITY SOURCE GUARD (#451, Shared Machine Model slice 3).
//
// The six identity rows of the hardware grid — CPU name, primary GPU, GPU driver, total RAM,
// display mode, Windows edition/build — read `model.identity` and NOTHING else. Before this slice
// the grid read the bare inventory (`hw.cpu_brand`, `hw.ram_total_bytes`, `hw.windows_version`…),
// which is how "0 GB" and "—" reached the screen for a value the machine simply had not reported.
// A future edit that reaches back for the inventory would compile and pass every render test that
// happens to agree with the fixture — so the SOURCE is pinned here, mechanically:
//
//   1. the identity inventory fields are gone from HardwareGrid.tsx;
//   2. every identity card's `value=` comes from the model's Fact state, never from `hw.`;
//   3. the Driver and Display rows are Fact rows (not bare Detail rows);
//   4. all six identity fields are picked off `model.identity`;
//   5. the three Home surfaces pass `useMachineModel()` through to EVERY grid and read nothing of
//      the identity themselves (pass-through only — the issue's scope line).
//
// `hw.ram_total_bytes` is allowed to survive exactly where it is not identity: the rig-tier line
// and the "In use" percentage, both of which are the inventory's own live usage reading.

// Paths are repo-relative: vitest runs from the repo root, like every sibling source guard.
const read = (rel: string) => readFileSync(join("src", rel), "utf8");
const grid = read("surfaces/HardwareGrid.tsx");

// The opening tag of every `<Card …>` — the identity cards are the four the grid labels by these keys.
const IDENTITY_CARD_LABEL_KEYS = ["cpuLabel", "memoryLabel", "graphicsLabel", "systemLabel"];
function cardOpeningTags(src: string): string[] {
  const tags: string[] = [];
  const re = /<Card\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const end = src.indexOf(">", m.index);
    if (end < 0) throw new Error("unterminated <Card");
    tags.push(src.slice(m.index, end + 1));
  }
  return tags;
}
const propExpr = (tag: string, prop: string): string | null => {
  const at = tag.indexOf(`${prop}={`);
  if (at < 0) return null;
  // Walk to the matching close brace so a nested `{ count: … }` object does not cut the expression.
  let depth = 0;
  for (let i = at + prop.length + 1; i < tag.length; i++) {
    if (tag[i] === "{") depth++;
    else if (tag[i] === "}") {
      depth--;
      if (depth === 0) return tag.slice(at + prop.length + 2, i);
    }
  }
  throw new Error(`unterminated ${prop}= in ${tag}`);
};

describe("hardware identity source guard (#451)", () => {
  it("1. the identity inventory fields no longer appear anywhere in HardwareGrid.tsx", () => {
    for (const banned of ["cpu_brand", "windows_version", "os_name", "os_version", "family_label"]) {
      expect(grid, `HardwareGrid.tsx must not read hw.${banned} — identity comes from model.identity`).not.toContain(
        banned,
      );
    }
  });

  it("2. every identity card's value= is a model Fact state, never an hw. read", () => {
    const tags = cardOpeningTags(grid);
    const identityTags = tags.filter((tag) =>
      IDENTITY_CARD_LABEL_KEYS.some((k) => (propExpr(tag, "label") ?? "").includes(`gaming.hardwareGrid.${k}`)),
    );
    expect(identityTags, "the four identity cards must be found by their label keys").toHaveLength(4);
    for (const tag of identityTags) {
      const value = propExpr(tag, "value");
      expect(value, `identity card has no value=: ${tag}`).not.toBeNull();
      expect(value, `identity card value reads the inventory: ${value}`).not.toMatch(/\bhw\./);
      expect(value, `identity card value is not a Fact state: ${value}`).toMatch(/^stateValue\(/);
      expect(propExpr(tag, "reason"), `identity card prints no reason for a missing value: ${tag}`).toMatch(
        /^stateReason\(/,
      );
    }
  });

  it("3. the Driver and Display rows are Fact rows, and the old bare Display row is gone", () => {
    expect(grid).toMatch(/<FactDetail k=\{t\("gaming\.hardwareGrid\.driverLabel"\)\} state=\{driver\}/);
    expect(grid).toMatch(/<FactDetail k=\{t\("gaming\.hardwareGrid\.displayLabel"\)\} state=\{display\}/);
    expect(grid).not.toMatch(/<Detail\s+k=\{t\("gaming\.hardwareGrid\.displayLabel"\)\}/);
    // The Windows fact carries edition AND build in one value; a separate Build row is the old shape.
    expect(grid).not.toContain("buildLabel");
  });

  it("4. all six identity fields are picked off model.identity", () => {
    for (const field of ["cpu", "gpu", "gpu_driver", "ram_gb", "display", "windows"]) {
      expect(grid, `identity.${field} is not read`).toMatch(
        new RegExp(`identityState\\(model, \\(id\\) => id\\.${field},`),
      );
    }
  });

  it("5. ram_total_bytes survives only outside identity (tier line + In-use share)", () => {
    const hits = grid.match(/ram_total_bytes/g) ?? [];
    expect(hits.length, "an added ram_total_bytes read — is it identity?").toBeLessThanOrEqual(3);
    for (const tag of cardOpeningTags(grid)) {
      expect(propExpr(tag, "value") ?? "").not.toContain("ram_total_bytes");
    }
  });

  it("6. every Home passes useMachineModel() through to every grid and reads none of the identity itself", () => {
    for (const home of ["surfaces/HomeConsole.tsx", "surfaces/HomeHud.tsx", "surfaces/HomeV2.tsx"]) {
      const src = read(home);
      expect(src, `${home} does not import useMachineModel`).toContain('import { useMachineModel } from "../data/machine-model"');
      expect(src, `${home} does not call useMachineModel(hw)`).toContain("const model = useMachineModel(hw);");
      const grids = src.match(/<HardwareGrid\b[^>]*>/g) ?? [];
      expect(grids.length, `${home} renders no HardwareGrid`).toBeGreaterThan(0);
      for (const g of grids) {
        expect(g, `${home}: a grid without the model prop`).toMatch(/\bmodel=\{model\}/);
      }
      expect(src, `${home} reads model.identity itself — Homes are pass-through only`).not.toMatch(/model\??\.identity/);
    }
  });
});
