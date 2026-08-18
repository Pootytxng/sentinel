import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// FIXTURE-PARITY GUARD (2026-08-12).
//
// WHY THIS EXISTS — the defect this forecloses is silent and it discredits evidence, which is the
// worst combination this repo has.
//
// `docs/ui-sweep/fixture/main.tsx` exists because two Lab-bench states cannot be reached without
// invoking `start_experiment`, which applies a real Windows change. It mounts the REAL component
// under a fixture banner so the self-review law has pixels to judge. To do that it HAND-COPIES two
// blocks out of `src/`:
//
//   1. App.tsx's 13-sheet CSS chain (the product entry imports no CSS — the sheets live on App).
//   2. main.tsx's pre-paint `documentElement.dataset` block (the product entry cannot be imported:
//      it calls getCurrentWindow() at module scope).
//
// Copies drift. When they drift the preview does not crash and does not look obviously wrong — it
// renders a plausible page in a palette or skin the shipped app does not have, under a banner that
// says the pixels are real. A reviewer then PASSES or FAILS a look that does not exist, and the
// self-review law's whole evidentiary value is gone. Nothing in a normal diff review catches an
// import that stopped matching a list two directories away.
//
// The predecessor of this file — a runtime shim that reassigned `window.__TAURI_INTERNALS__.invoke`
// — failed in exactly this genre: Tauri v2 freezes that property, non-strict assignment failed
// SILENTLY, and the preview mounted showing LIVE data under a fixture banner. Same lesson: a
// preview that lies quietly is worse than one that breaks loudly.

// Paths are repo-root-relative; vitest runs from the repo root (scripts/run-vitest.mjs). No
// __dirname — this project is ESM.
const read = (rel: string) => readFileSync(join(...rel.split("/")), "utf8");

const APP = "src/App.tsx";
const PRODUCT_ENTRY = "src/main.tsx";
const FIXTURE_ENTRY = "docs/ui-sweep/fixture/main.tsx";

/** Side-effect CSS imports, in source order, normalized to a repo-relative `src/...` path. */
function cssChain(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/^import\s+"([^"]+\.css)";/gm)) {
    out.push(m[1].replace(/^(?:\.\.\/)+src\//, "src/").replace(/^\.\//, "src/"));
  }
  return out;
}

/** Every `document.documentElement.dataset.<key>` the source assigns. */
function datasetKeys(source: string): string[] {
  return [
    ...new Set(
      [...source.matchAll(/documentElement\.dataset\.([A-Za-z0-9]+)\s*=/g)].map((m) => m[1]),
    ),
  ].sort();
}

describe("fixture preview parity with the product entry", () => {
  it("carries App.tsx's stylesheet chain, complete and in the same order", () => {
    const app = cssChain(read(APP));
    const fixture = cssChain(read(FIXTURE_ENTRY));

    // Sanity: if this ever reads 0, the extraction broke and every other assertion here is vacuous.
    expect(app.length).toBeGreaterThan(0);

    // Subsequence, not equality: the fixture is ALLOWED to add sheets the app loads elsewhere
    // (lab-v2.css, asserted separately below). It is not allowed to drop one or reorder them —
    // load order decides which token layer wins, so a reorder silently re-skins the screenshots.
    const positions = app.map((sheet) => fixture.indexOf(sheet));
    const missing = app.filter((_, i) => positions[i] === -1);
    expect(missing, `${FIXTURE_ENTRY} is missing stylesheets that ${APP} loads`).toEqual([]);

    const ascending = positions.every((p, i) => i === 0 || p > positions[i - 1]);
    expect(
      ascending,
      `${FIXTURE_ENTRY} loads App.tsx's stylesheets out of order — order decides which token layer wins`,
    ).toBe(true);
  });

  it("loads the Lab room token re-point, which App.tsx's chain does not carry", () => {
    // `:root[data-v2="on"] .v2-room[data-room="lab"]` in lab-v2.css is the DECLARING element for
    // the --ix-* family ExperimentBench.css resolves its palette from, and a var() chain inside a
    // custom property substitutes at its declaring element. Without this sheet the bench falls
    // back to instrument.css's :root values: a different palette from the shipped app.
    expect(cssChain(read(FIXTURE_ENTRY))).toContain("src/surfaces/lab-v2.css");
  });

  it("loads the Monitor room token re-point, for the same reason", () => {
    // The CPU-temp offer (Q9c) renders inside the Monitor room, whose --ix-* re-point lives in
    // monitor-v2.css and is imported by MonitorV2.tsx — not by App.tsx's chain. Same failure mode
    // as the Lab sheet above: without it the offer paints in instrument.css's :root palette, a
    // different accent from the shipped app, under a banner claiming fidelity.
    expect(cssChain(read(FIXTURE_ENTRY))).toContain("src/surfaces/monitor-v2.css");
  });

  it("renders inside the room elements those re-points are scoped to", () => {
    // The sheets alone are not enough — the selectors need the elements. RoomShell's real markup is
    // <section class="v2-room" data-room="{room}"> (src/design/room-shell.tsx); the Lab states
    // mount data-room="lab", the CPU-temp states data-room="play" (MonitorV2.tsx passes room="play").
    const fixture = read(FIXTURE_ENTRY);
    expect(fixture).toMatch(/className="v2-room"/);
    expect(fixture).toMatch(/data-room="lab"/);
    expect(fixture).toMatch(/data-room="play"/);
  });

  it("sets every <html> dataset attribute the product entry sets", () => {
    const product = datasetKeys(read(PRODUCT_ENTRY));
    const fixture = datasetKeys(read(FIXTURE_ENTRY));

    expect(product.length).toBeGreaterThan(0);

    const missing = product.filter((k) => !fixture.includes(k));
    expect(
      missing,
      `${FIXTURE_ENTRY} does not set: ${missing.join(", ")} — the preview would render an unskinned shell`,
    ).toEqual([]);
  });

  it("sets data-v2 unconditionally, exactly as the product entry does", () => {
    // Called out on its own because it is the single highest-consequence line: EVERY rule in
    // tokens-v2.css and in the Lab re-point is scoped under [data-v2="on"]. Losing it does not
    // error — it just renders an unskinned page that still looks like a real screenshot.
    expect(read(FIXTURE_ENTRY)).toMatch(/documentElement\.dataset\.v2\s*=\s*"on";/);
  });

  it("never imports the product entry", () => {
    // src/main.tsx calls getCurrentWindow() at module scope. Importing it here would throw outside
    // Tauri; the temptation is then to shim it, which is the exact dead end this fixture replaced.
    expect(read(FIXTURE_ENTRY)).not.toMatch(/from\s+"[^"]*\/src\/main"|import\s+"[^"]*\/src\/main"/);
  });

  it("keeps the fixture server's watcher off the cargo build tree", () => {
    // REAL FAILURE, 2026-08-12. The fixture config sets `root` to the REPO root, so vite's default
    // watcher walked src-tauri/target/. `cargo run` holds an exclusive lock on
    // target/debug/deps/compy_lib.dll; node's watcher threw EBUSY, and chokidar re-emitted it as an
    // 'error' event that took the whole server down with exit 1 — mid-capture-run.
    //
    // It reads as a flake, which is why it needs a test: the server starts fine and dies minutes
    // later, only once something else builds. And the review REQUIRES both alive at once — the
    // bench states are served here, the live rig-part click comes from the dev build.
    const cfg = read("docs/ui-sweep/fixture/vite.config.mts");
    expect(cfg, "fixture server would watch src-tauri/target and die on EBUSY").toMatch(
      /ignored:\s*\[[^\]]*src-tauri\/target/s,
    );
  });

  it("keeps the three mutating commands blocked in the stub", () => {
    // The bench's real CTAs reach the mutation boundary. The stub rejects them BY NAME rather than
    // by pattern, so a newly added mutating command fails the stub's default branch loudly instead
    // of slipping through a regex that looked broad enough.
    const stub = read("docs/ui-sweep/fixture/stub-core.ts");
    for (const cmd of ["start_experiment", "conclude_experiment", "restore_experiment"]) {
      expect(stub, `stub-core.ts stopped blocking ${cmd}`).toContain(`"${cmd}"`);
    }
    expect(stub).toMatch(/BLOCKED\.includes\(cmd\)/);
  });

  it("answers every command the CPU-temp offer sends", () => {
    // The stub's default branch rejects loudly, which is right — but for THIS component a rejected
    // get_sensor_sources is indistinguishable from "nothing installed": the offer falls back to the
    // downloads and renders a perfectly plausible page. A reviewer would then pass the install
    // branch while believing they were looking at one of the other four. So the stub must answer
    // both commands by name, and the component must not have grown a third.
    const stub = read("docs/ui-sweep/fixture/stub-core.ts");
    const component = read("src/surfaces/CpuTempOffer.tsx");
    const commands = [...component.matchAll(/invoke(?:<[^>]*>)?\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(commands.length).toBeGreaterThan(0);
    for (const cmd of new Set(commands)) {
      expect(stub, `stub-core.ts has no answer for "${cmd}" — the offer would render the wrong branch`).toContain(
        `"${cmd}"`,
      );
    }
  });
});
