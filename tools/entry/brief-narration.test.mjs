// #362 (P0-H case 6): a real launch of writer B printed `launch brief written to [object Object]`.
// writeBrief returns { file, hash, truncated }; the narration interpolated the record. The log
// still carried the path (effects.record took `brief.file`), so nothing was lost but the one line
// the owner reads. Pinned here so the terminal line and the log line name the same file.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { briefWrittenLine } from "./launch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("the brief narration names the file", () => {
  it("renders the path of the brief record, never the record itself", () => {
    const line = briefWrittenLine({ file: "C:\\Users\\Kuya\\AppData\\Local\\CompyEntry\\briefs\\363.md", hash: "abc", truncated: false });
    expect(line).toContain("briefs\\363.md");
    expect(line).not.toContain("[object");
  });
  it("launch.mjs narrates through the helper, not a bare template on the record", () => {
    const src = readFileSync(join(HERE, "launch.mjs"), "utf8");
    expect(src).not.toMatch(/written to \$\{brief\}/);
    expect(src).toMatch(/say\(briefWrittenLine\(brief\)\)/);
  });
});
