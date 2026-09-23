// Guard: migrating the board to the canonical `Worktree / branch` form must be a reviewable diff,
// and must refuse ambiguity rather than resolve it.
//
// The fixture is the ACTUAL board, read 2026-07-30. If a future board value stops migrating cleanly,
// this test is where that shows up — before `--apply` touches Kuya's board.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as gather from "./gather.mjs";
// Through the namespace too, so an export that does not exist yet fails its own case, not the file.
import * as migrate from "./migrate-board.mjs";
import { planMigration } from "./migrate-board.mjs";

const CODE_ROOT = "C:\\Users\\Kuya\\code";

/** Verbatim board values, 2026-07-30. */
const BOARD = [
  { number: 10, value: "sentinel-work-control-codex \u00B7 codex/work-control" },
  { number: 12, value: "sentinel + sentinel-feedback \u00B7 exact active folder unknown/locked" },
  { number: 13, value: "sentinel-codex-hygiene \u00B7 codex/tool-shed-hygiene (preserve)" },
  { number: 14, value: "C:\\Users\\Kuya\\code\\sentinel-feedback / feat/user-feedback-lab-recovery" },
  { number: 15, value: "C:\\Users\\Kuya\\code\\sentinel-feedback / feat/user-feedback-lab-recovery" },
  { number: 16, value: "C:\\Users\\Kuya\\code\\sentinel-feedback / feat/user-feedback-lab-recovery" },
  { number: 17, value: "C:\\Users\\Kuya\\code\\sentinel-rel / codex/product-quality-blueprint" },
  { number: 18, value: "C:\\Users\\Kuya\\code\\sentinel-workflow @ feat/single-entry-workflow" },
];

const plan = () => planMigration(BOARD, { codeRoot: CODE_ROOT });

describe("planMigration over the real board", () => {
  it("classifies every item as changed, unchanged, or refused — never silently dropped", () => {
    const rows = plan();
    expect(rows).toHaveLength(BOARD.length);
    expect(rows.every((r) => ["change", "same", "refuse"].includes(r.action))).toBe(true);
  });

  it("rewrites the six legacy values and leaves the already-canonical one alone", () => {
    const rows = plan();
    const changed = rows.filter((r) => r.action === "change").map((r) => r.number);
    expect(changed).toEqual([10, 13, 14, 15, 16, 17]);
    expect(rows.find((r) => r.number === 18).action).toBe("same");
  });

  it("refuses item 12 and reports why, instead of picking one of its two folders", () => {
    const row = plan().find((r) => r.number === 12);
    expect(row.action).toBe("refuse");
    expect(row.code).toBe("AMBIGUOUS_MULTI_FOLDER");
    expect(row.reason).toMatch(/unknown means locked/i);
    expect(row.after).toBeNull();
  });

  it("carries item 13's `(preserve)` note out as a note, not into the branch", () => {
    const row = plan().find((r) => r.number === 13);
    expect(row.after).toBe("C:\\Users\\Kuya\\code\\sentinel-codex-hygiene @ codex/tool-shed-hygiene");
    expect(row.notes).toEqual(["preserve"]);
  });

  it("resolves bare leaf names against the code root", () => {
    expect(plan().find((r) => r.number === 10).after).toBe(
      "C:\\Users\\Kuya\\code\\sentinel-work-control-codex @ codex/work-control",
    );
  });

  it("keeps #17's preserved worktree pointing at exactly the same folder and branch", () => {
    // #17 is preserved work under another lane. Migration may reformat the field; it may never
    // change which folder or branch that field designates.
    const row = plan().find((r) => r.number === 17);
    expect(row.after).toBe("C:\\Users\\Kuya\\code\\sentinel-rel @ codex/product-quality-blueprint");
    expect(row.entries).toEqual([
      { path: "C:\\Users\\Kuya\\code\\sentinel-rel", branch: "codex/product-quality-blueprint" },
    ]);
  });

  it("is idempotent — migrating the migrated board changes nothing", () => {
    const once = plan().map((r) => ({ number: r.number, value: r.after ?? r.before }));
    const twice = planMigration(once, { codeRoot: CODE_ROOT });
    expect(twice.filter((r) => r.action === "change")).toEqual([]);
  });
});

// Guard for #514: the migration's `gh` reads carry gather's bound (#474), and a GitHub that stops
// answering ends the run before it writes. The PR #476 review found migrate-board.mjs running `gh`
// through execFileSync with no `timeout`. Off the push path, but a hung read held the migration forever.
//
// Each layer fails against the migrate-board.mjs before #514:
//   1. the default reads, on the dry run and on --apply, hand execFileSync the bound;
//   2. a real child that never answers is killed at an injected bound, and nothing is written.

// The literal, not gather's export: a bound that drifted would move both sides of the comparison.
const BOUND_MS = 20_000;
const BOARD_PAYLOAD = JSON.stringify({
  items: [{ id: "PVTI_10", content: { number: 10 }, "worktree / branch": BOARD[0].value }],
  totalCount: 1,
});

// Layer 1 runs in a child node, as gh-read-bound.test.mjs does: vi.mock never reaches a natively loaded
// .mjs's own `node:child_process` import. A resolve hook hands gather.mjs and migrate-board.mjs, and only
// them, a child_process whose execFileSync records what each gh call was handed and answers from a
// fixture. The child's PATH holds node alone, so if the hook ever misses, the real gh cannot be found.
const MIGRATE_URL = pathToFileURL(join(gather.HERE, "migrate-board.mjs")).href;
const STUB = `
import * as real from "node:child_process";
export * from "node:child_process";
const ANSWERS = {
  "project item-list": ${JSON.stringify(BOARD_PAYLOAD)},
  "project view": JSON.stringify({ id: "PVT_stub" }),
  "project field-list": JSON.stringify({ fields: [{ name: "Worktree / branch", id: "PVTF_stub" }] }),
  "project item-edit": "",
};
export function execFileSync(file, args, opts) {
  if (file !== "gh") return real.execFileSync(file, args, opts);
  const verb = args.slice(0, 2).join(" ");
  globalThis.ghCalls.push({ verb, timeout: opts?.timeout });
  if (verb in ANSWERS) return ANSWERS[verb];
  throw new Error("gh stub: no answer");
}`;
const PROBE = `
import { registerHooks } from "node:module";
const stub = "data:text/javascript," + encodeURIComponent(${JSON.stringify(STUB)});
const stubbed = ["/tools/entry/gather.mjs", "/tools/entry/migrate-board.mjs"];
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "node:child_process" && stubbed.some((p) => String(context.parentURL).endsWith(p))) {
      return { url: stub, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const migrate = await import(${JSON.stringify(MIGRATE_URL)});
console.log = () => {};
const out = {};
for (const [name, argv] of Object.entries({ dryRun: [], apply: ["--apply"] })) {
  globalThis.ghCalls = [];
  try {
    migrate.main(argv);
  } catch {}
  out[name] = globalThis.ghCalls;
}
process.stdout.write(JSON.stringify(out));
`;

describe("the migration's default gh reads hand execFileSync the bound", () => {
  let calls;
  beforeAll(() => {
    const env = { ...process.env, PATH: dirname(process.execPath) };
    delete env.Path;
    calls = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", PROBE], { encoding: "utf8", env, timeout: 30_000 }));
  });

  it("the dry run reads the board with the bound, and writes nothing", () => {
    expect(calls.dryRun).toEqual([{ verb: "project item-list", timeout: BOUND_MS }]);
  });

  it("--apply reads the board, the project and its fields with the bound; the item-edit writer stays unbounded (#474 fix item 2)", () => {
    expect(calls.apply).toEqual([
      { verb: "project item-list", timeout: BOUND_MS },
      { verb: "project view", timeout: BOUND_MS },
      { verb: "project field-list", timeout: BOUND_MS },
      { verb: "project item-edit" },
    ]);
  });
});

// A `gh` that never answers: gather's reader and the real execFileSync, with a node that sleeps 5 s where
// gh would have run. Only the program is swapped; every option is the one the reader hands gh.
const SLEEP_5S = "setTimeout(() => {}, 5000)";
const silentGh = (timeout, errors) =>
  gather.ghReader({
    timeout,
    exec: (_gh, _args, opts) => {
      try {
        return execFileSync(process.execPath, ["-e", SLEEP_5S], opts);
      } catch (e) {
        errors.push(e);
        throw e;
      }
    },
  });

describe("a gh read that never answers ends the migration at the bound, before any write", () => {
  it("the dry run: the board read is killed, and the run throws instead of holding", () => {
    const errors = [];
    const writes = [];
    const t = performance.now();
    expect(() => migrate.main([], { read: silentGh(300, errors), write: (args) => writes.push(args) })).toThrow();
    expect(errors.map((e) => e.code)).toEqual(["ETIMEDOUT"]);
    expect(writes).toEqual([]);
    expect(performance.now() - t).toBeLessThan(4_500);
  });

  it("--apply: the board answers, the project read is killed, and no item-edit is issued", () => {
    const errors = [];
    const writes = [];
    const slow = silentGh(300, errors);
    const read = (args) => (args[1] === "item-list" ? BOARD_PAYLOAD : slow(args));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const t = performance.now();
      expect(() => migrate.main(["--apply"], { read, write: (args) => writes.push(args) })).toThrow();
      expect(errors.map((e) => e.code)).toEqual(["ETIMEDOUT"]);
      expect(writes).toEqual([]);
      expect(performance.now() - t).toBeLessThan(4_500);
    } finally {
      log.mockRestore();
    }
  });
});
