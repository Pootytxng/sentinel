import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
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
  it("answers every command the Black Box sends", () => {
    // Same shape as the CPU-temp check above, and for the same reason: the stub's default branch
    // REJECTS an unknown command, so a station that asks for something the stub does not answer
    // renders its error paragraph — which reads as "the feature is broken", not "the rig is stale".
    //
    // The Tier 1 known-issue block (#220) is the reason this matters more than usual. It is
    // unreachable in every build — the gate is hard-false, the signing key is a placeholder and
    // both catalog allowlists are empty — so these three states are the ONLY route to its pixels.
    // If the station gains a command and nobody adds a stub, the next review looks at an error
    // message and cannot tell that from a real one.
    const station = read("src/surfaces/BlackBox.tsx");
    const stub = read("docs/ui-sweep/fixture/stub-core.ts");
    const asked = [...station.matchAll(/invoke<[^>]*>\(\s*["']([\w.:|]+)["']/g)].map((m) => m[1]);
    expect(asked, "found no invoke() in BlackBox.tsx — this guard went vacuous").toContain(
      "get_crash_blackbox",
    );
    const unanswered = [...new Set(asked)].filter((cmd) => !stub.includes(`"${cmd}"`)).sort();
    expect(unanswered, "stub-core.ts must answer these or the Black Box states render an error").toEqual([]);
  });

  it("answers every command FirstWin sends", () => {
    // Same shape as the two checks above. FirstWin is worse than most if it goes unanswered: the
    // stub's default branch REJECTS, and a rejected `get_recommendations` lands the card in its
    // "could not look" error — which is one of the six states, so a reviewer would be looking at a
    // real-seeming paint of the WRONG state with nothing on screen to tell them apart.
    const card = read("src/surfaces/FirstWin.tsx");
    const stub = read("docs/ui-sweep/fixture/stub-core.ts");
    const asked = [...card.matchAll(/invoke(?:<[^>]*>)?\(\s*["']([\w.:|]+)["']/g)].map((m) => m[1]);
    expect(asked, "found no invoke() in FirstWin.tsx — this guard went vacuous").toContain(
      "get_recommendations",
    );
    const unanswered = [...new Set(asked)].filter((cmd) => !stub.includes(`"${cmd}"`)).sort();
    expect(unanswered, "stub-core.ts must answer these or the FirstWin states render an error").toEqual([]);
  });

  it("keeps FirstWin's rollback answer SCOPED to its own states", () => {
    // `rollback_change` reaches the mutation boundary in the real app. The stub answers it so the
    // undone and undo-failed paints are reachable at all — but only inside the FirstWin branch,
    // where there is no backend beneath it. Hoisting it above the state branches would hand every
    // other state a silent mutation answer, which is the shape of the mistake, not a style nit.
    const stub = read("docs/ui-sweep/fixture/stub-core.ts");
    const branch = stub.indexOf("const firstwin = FIRSTWIN_STATES[current];");
    expect(branch, "the FirstWin branch is gone — its states cannot be reviewed").toBeGreaterThan(-1);
    const rollback = stub.indexOf('cmd === "rollback_change"');
    expect(rollback, "stub-core.ts stopped answering rollback_change").toBeGreaterThan(-1);
    expect(
      rollback > branch,
      "rollback_change is answered OUTSIDE the FirstWin branch — every other state now gets it too",
    ).toBe(true);
  });

  it("keeps a FirstWin state for each verdict, plus both failures", () => {
    // The six are not interchangeable, and the two error states least of all: a read that FAILED
    // and a setting that could not be FOUND are different sentences about different things, and a
    // review that only ever saw one of them cannot judge whether they read as different.
    const stub = read("docs/ui-sweep/fixture/stub-core.ts");
    for (const state of [
      "firstwin-held",
      "firstwin-reverted",
      "firstwin-unreadable",
      "firstwin-check-failed",
      "firstwin-undo-failed",
      "firstwin-latest",
    ]) {
      expect(stub, `the fixture lost the ${state} state`).toContain(`"${state}"`);
    }
  });

  it("answers every command the session debrief sends", () => {
    // Same shape as the checks above, with one addition the others do not need: the debrief card
    // ALWAYS renders <WhatChangedPanel>, whose read is not an invoke() in SessionDebrief.tsx and so
    // is invisible to a scan of that file alone. Its rejection is swallowed (`.catch(() => {})`),
    // so an unanswered command there removes a whole panel SILENTLY — the reviewer sees a shorter
    // card and has nothing on screen telling them a section is missing.
    const card = read("src/surfaces/SessionDebrief.tsx");
    const panel = read("src/surfaces/WhatChangedPanel.tsx");
    const stub = read("docs/ui-sweep/fixture/stub-core.ts");
    const asked = [...card.matchAll(/invoke(?:<[^>]*>)?\(\s*["']([\w.:|]+)["']/g)].map((m) => m[1]);
    expect(asked, "found no invoke() in SessionDebrief.tsx — this guard went vacuous").toContain(
      "arm_comparison",
    );
    expect(
      panel,
      "WhatChangedPanel stopped reading what_changed_for_session — re-derive what the card mounts",
    ).toContain("what_changed_for_session");
    const unanswered = [...new Set([...asked, "what_changed_for_session"])]
      .filter((cmd) => !stub.includes(`"${cmd}"`))
      .sort();
    expect(unanswered, "stub-core.ts must answer these or the debrief states render short").toEqual([]);
  });

  it("keeps the debrief's WRITES scoped to its own states", () => {
    // `arm_comparison` and `dismiss_comparison` write Compy's own comparison record. Neither
    // touches a Windows setting, so this is a weaker hazard than FirstWin's rollback — but the
    // failure shape is identical: hoisted above the state branches, every other fixture state
    // silently gains a write answer, and a reviewer clicking through some unrelated preview would
    // be told a comparison was armed. Same rule, same reason.
    const stub = read("docs/ui-sweep/fixture/stub-core.ts");
    const branch = stub.indexOf("const debrief = DEBRIEF_STATES[current];");
    expect(branch, "the debrief branch is gone — its states cannot be reviewed").toBeGreaterThan(-1);
    for (const cmd of ["arm_comparison", "dismiss_comparison"]) {
      const at = stub.indexOf(`cmd === "${cmd}"`);
      expect(at, `stub-core.ts stopped answering ${cmd}`).toBeGreaterThan(-1);
      expect(
        at > branch,
        `${cmd} is answered OUTSIDE the debrief branch — every other state now gets it too`,
      ).toBe(true);
    }
  });

  it("keeps the three earned-framing states, and keeps their verdict bands APART", () => {
    // DIR-1a on Live (2026-08-26). The card decides its wording from the 1%-low/avg ratio against
    // 0.75 (SessionDebrief.tsx `problemMeasured`), so the smooth and rough states are only
    // different states while their ratios straddle that line. Editing a number here — a plausible
    // tidy-up, since the two sessions are otherwise identical — would collapse both previews onto
    // the same branch, and a review comparing two screenshots of the SAME state would report that
    // the framing is consistent. Asserted arithmetically for that reason, not by name.
    const stub = read("docs/ui-sweep/fixture/stub-core.ts");
    for (const state of ["debrief-smooth-offer", "debrief-rough-fix", "debrief-clean-none"]) {
      expect(stub, `the fixture lost the ${state} state`).toContain(`"${state}"`);
    }
    const num = (re: RegExp, what: string) => {
      const m = stub.match(re);
      expect(m, `could not read ${what} out of the fixture`).not.toBeNull();
      return Number(m![1]);
    };
    // Anchored to `debriefSession`. Unanchored, both matched the FIRST session literal anywhere in
    // the stub — a bench state's, with a ratio of its own — and the check read a number no debrief
    // preview uses. It failed loudly on the way in, which is the only reason it is written down.
    const avg = num(/const debriefSession[\s\S]{0,600}?avg_fps:\s*([\d.]+)/, "the debrief session's avg_fps");
    const smoothLow = num(
      /const debriefSession[\s\S]{0,600}?low1_fps_est:\s*([\d.]+)/,
      "the smooth session's 1% low",
    );
    const roughLow = num(/"debrief-rough-fix":[\s\S]{0,300}?low1_fps_est:\s*([\d.]+)/, "the rough session's 1% low");
    expect(smoothLow / avg, "the smooth state stopped being smooth").toBeGreaterThanOrEqual(0.75);
    expect(roughLow / avg, "the rough state stopped being rough").toBeLessThan(0.75);
  });

  it("keeps the opener stubbed, so the source button can be clicked in a review", () => {
    // The Tier 1 source button hands its URL to the OS browser through @tauri-apps/plugin-opener,
    // which reaches the backend as `plugin:opener|open_url`. That is not an invoke() in src/ — it
    // is inside the plugin — so the check above cannot see it, and without a stub the click lands
    // on the default branch and rejects. The component swallows that, so the failure is SILENT:
    // the reviewer clicks, nothing happens, and "does the source open on click, and with which
    // URL" is exactly the criterion that cannot then be answered.
    //
    // Asserted as the QUOTED literal, with its quotes. A bare substring check passes against
    // `"plugin:opener|open_url_GONE"` — which is exactly how this guard failed its own
    // falsification run before shipping.
    const stub = read("docs/ui-sweep/fixture/stub-core.ts");
    expect(stub).toContain('"plugin:opener|open_url"');
  });

  it("keeps a Tier 1 state with the field ABSENT — the control", () => {
    // The three states are not interchangeable. `tier1-none` is the one that represents every
    // shipped build: `case_intelligence` omitted entirely, so nothing Tier 1 draws may appear.
    // A review that only ever looked at a match would never notice the block leaving a reserved
    // gap, a stray rule or an empty heading behind on the state 100% of users are actually in.
    const stub = read("docs/ui-sweep/fixture/stub-core.ts");
    for (const state of ["tier1-matched", "tier1-possible", "tier1-none"]) {
      expect(stub, `the fixture lost the ${state} state`).toContain(`"${state}"`);
    }
    const none = stub.slice(stub.indexOf('"tier1-none"'));
    expect(
      none.slice(0, none.indexOf("};")),
      "tier1-none must NOT carry case_intelligence — it is the absent-field control",
    ).not.toContain("case_intelligence");
  });

  it("exports every name the aliased module graph imports from @tauri-apps/api/core", () => {
    // bug→guard (self-review round 2, 2026-08-18): vite.config.mts aliases the WHOLE
    // "@tauri-apps/api/core" module to stub-core.ts. A named import it does NOT export is not a
    // degraded feature — it is a module-graph SyntaxError that blanks EVERY fixture state before
    // React paints. @tauri-apps/plugin-updater (reached via ShellV2 → UpdatePill) imports
    // { Resource, Channel, invoke }; the two missing names cost a whole review round, and the
    // failure looked like "the rig is broken", not like "a dependency changed".
    //
    // Scope note: this reads node_modules on purpose. The offending import lives in a shipped
    // dependency, not in src — a guard that only walked src would not have caught it.
    const stub = read("docs/ui-sweep/fixture/stub-core.ts");
    const exported = new Set(
      [...stub.matchAll(/export\s+(?:const|function|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
    );
    const sources: string[] = [];
    const walk = (dir: string) => {
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return; // node_modules layout varies; a missing plugin dir is not a failure
      }
      for (const name of names) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|m?js)$/.test(p)) sources.push(p);
      }
    };
    walk("src");
    for (const pkg of ["plugin-updater", "plugin-process", "plugin-opener", "api"]) {
      walk(join("node_modules", "@tauri-apps", pkg, "dist-js"));
    }
    const needed = new Set<string>();
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@tauri-apps\/api\/core['"]/g)) {
        for (const raw of m[1].split(",")) {
          const name = raw.trim().split(/\s+as\s+/)[0].trim();
          if (name && name !== "type") needed.add(name.replace(/^type\s+/, ""));
        }
      }
    }
    expect(needed.size, "found no @tauri-apps/api/core named imports — this guard went vacuous").toBeGreaterThan(0);
    const missing = [...needed].filter((n) => !exported.has(n)).sort();
    expect(
      missing,
      "stub-core.ts must export these or the fixture page blanks with a module SyntaxError",
    ).toEqual([]);
  });
  it("redirects the bare root to the fixture page", () => {
    // Two review rounds burned time on `http://localhost:5199/` serving the REAL app (repo-root
    // index.html → src/main.tsx → IPC failure → ErrorBoundary), which reads as "the rig is broken".
    // The redirect is the fix; this pins it so a config tidy-up cannot quietly reinstate the trap.
    const cfg = read("docs/ui-sweep/fixture/vite.config.mts");
    expect(cfg, "fixture root no longer redirects — `/` serves the real app and looks broken").toMatch(
      /Location.*docs\/ui-sweep\/fixture\/index\.html/,
    );
    expect(cfg).toMatch(/plugins:\s*\[react\(\),\s*redirectRootToFixture\]/);
  });
});

// ── Every import the fixture entry makes must actually resolve ────────────────────────────────
//
// REAL FAILURE, found 2026-08-25 while adding the Q9a consent states. The fixture entry still
// imported `src/Onboarding.css`, which `2baa07ef` (C-18b, #148) deleted along with the room it
// styled; App.tsx dropped it in that same commit and the fixture's hand-copy was never touched.
// Vite answered every request for main.tsx with a 500 — "Failed to resolve import" — so the page
// was blank for EVERY state: the bench, the CPU-temp offer, all of them. The rig had been dead
// since #148 and nobody knew, because the only thing that runs this server is a review, and a
// review only happens when there is UI to review.
//
// The subsequence check at the top of this file structurally cannot catch it. It compares the
// fixture's chain against App.tsx's and deliberately ALLOWS extras — lab-v2.css and monitor-v2.css
// are legitimate ones. To a string comparison, an extra that no longer exists on disk is
// indistinguishable from an extra that does.
//
// This is the cheapest possible statement of "the rig still boots": no server, no browser, no
// screenshots — just resolve what the file says it imports.
describe("fixture preview: every import resolves to a file that exists", () => {
  const FIXTURE_DIR = "docs/ui-sweep/fixture";

  /** Every RELATIVE specifier a source imports — side-effect and named alike. */
  function relativeImports(source: string): string[] {
    return [
      ...[...source.matchAll(/^import\s+"(\.[^"]+)";/gm)].map((m) => m[1]),
      ...[...source.matchAll(/from\s+"(\.[^"]+)"/g)].map((m) => m[1]),
    ];
  }

  /** Vite's resolution, narrowed to the shapes this repo actually writes. */
  function resolves(dir: string, spec: string): boolean {
    const base = join(...dir.split("/"), ...spec.split("/"));
    return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].some(
      (p) => existsSync(p),
    );
  }

  // Both hand-written fixture sources, not just the entry: a dead import in stub-core.ts blanks
  // the page by the same mechanism, one module deeper.
  for (const file of ["main.tsx", "stub-core.ts"]) {
    it(`${file} imports nothing that has been deleted or moved`, () => {
      const specs = relativeImports(read(`${FIXTURE_DIR}/${file}`));
      // Vacuity check: stub-core.ts legitimately has few relative imports, main.tsx has ~20.
      if (file === "main.tsx") expect(specs.length).toBeGreaterThan(10);
      const dead = specs.filter((s) => !resolves(FIXTURE_DIR, s));
      expect(
        dead,
        `${FIXTURE_DIR}/${file} imports files that do not exist — vite answers 500 and EVERY ` +
          `fixture state renders blank, not just the one being reviewed`,
      ).toEqual([]);
    });
  }

  it("keeps the six Tier 3 case states, and keeps their bytes coming from Rust", () => {
    // Q9b Stage 2 (#258). This screen is the one surface on this page with NO route in the shipped
    // app at all — `case_evidence_gate()` is hard-false with no caller, and nothing in src/ imports
    // the component. So the fixture is not a shortcut to a hard state here; it is the only place
    // the screen exists, and a lost state is a state that will never be reviewed again.
    const stub = read("docs/ui-sweep/fixture/stub-core.ts");
    const entry = read(FIXTURE_ENTRY);
    for (const state of [
      "case-both", // journey B, all seven §2 removals live
      "case-comment-only", // journey A, where the comment cannot be removed
      "case-empty", // no case to send — the screen refuses
      "case-unreadable", // bytes that will not parse — the screen refuses
      "case-error", // a host failure that must not cost the user their reading
      "case-working", // mid-send: the button may do nothing, twice
    ]) {
      expect(stub, `the fixture lost the ${state} state`).toContain(`"${state}"`);
    }

    // The payload must come from the committed Rust corpus. A fixture that hand-wrote a plausible
    // JSON blob would review a preview no user could ever be shown — and it would look identical
    // in a screenshot, which is what makes this worth pinning rather than trusting.
    expect(entry, "the fixture stopped reading the Rust preview corpus").toContain(
      "corpusPreview",
    );
    expect(
      entry,
      "the case branch must render the real component, not a local copy of it",
    ).toContain("<CaseEvidenceConsent");

    // And the banner has to carry the dark fact, the way it does for receipts and case intelligence.
    // A screenshot of a consent screen with no such line is a screenshot that reads as a shipped
    // feature.
    const banner = entry.slice(entry.indexOf("function FixtureBanner"), entry.indexOf("ReactDOM.createRoot"));
    expect(banner).toContain("isCaseState()");
    expect(banner).toMatch(/case_evidence_gate\(\) is hard-false/);
  });

  // ── Falsification ───────────────────────────────────────────────────────────────────────────
  // The exact shape of the 2026-08-25 defect, plus the two shapes a naive extractor gets wrong.
  it("fires on the deleted sheet, and not on the ones that survive", () => {
    const source = [
      'import "../../../src/App.css";',
      'import "../../../src/Onboarding.css";',
      'import ReceiptsConsent from "../../../src/surfaces/ReceiptsConsent";',
      'import { getState } from "./stub-core";',
    ].join("\n");
    const specs = relativeImports(source);
    expect(specs).toHaveLength(4);
    // Extensionless component and directory-index specifiers must NOT read as dead.
    expect(specs.filter((s) => !resolves("docs/ui-sweep/fixture", s))).toEqual([
      "../../../src/Onboarding.css",
    ]);
  });

  it("does not mistake a bare package specifier for a relative one", () => {
    // `react`, `@tauri-apps/api/core` and friends are resolved by node/vite, not by this check.
    // Treating them as relative paths would make every fixture source fail with a false positive.
    const source = 'import React from "react";\nimport { invoke } from "@tauri-apps/api/core";';
    expect(relativeImports(source)).toEqual([]);
  });
});
