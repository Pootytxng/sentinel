import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DESIGN-DETECTOR GATE (bug→guard, owner-directed drift-lock 2026-08-25, #214).
//
// THE DEFECT THIS EXISTS FOR: the impeccable design-detector hook lived only in gitignored
// `.claude/settings.local.json`. On 2026-08-21 that file was rewritten to enable an MCP server and
// the hook silently vanished with it — three days of four-room UI work shipped with no detector
// watching, and nine anti-patterns (bounce easing, border-hack triangles, a layout transition,
// unrecorded font choices) sat in the tree until a manual run found them on 2026-08-24.
//
// A hook is advice to a session; THIS file is the law for the tree. Two halves:
//   1. THE GATE — the vendored detector runs over src/ inside the test suite, so an anti-pattern
//      in shipped styles fails `npm test` (and with it the pre-push gate) no matter which editor,
//      agent, or hookless session wrote it.
//   2. THE ARMING — the per-edit hook and its config are pinned tracked and enabled, so the
//      original silent-unwire cannot recur, and suppression stays possible but never silent.
//
// The detector is vendored at .claude/skills/impeccable/scripts (git-tracked, node-only, zero
// network), so a fresh clone carries its own gate.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const DETECT = join(".claude", "skills", "impeccable", "scripts", "detect.mjs");
const HOOK = join(".claude", "skills", "impeccable", "scripts", "hook.mjs");

type Finding = { antipattern: string; file: string; line: number; snippet: string };

/** Run the vendored detector; JSON mode prints a findings array and exits 1 when it found any,
 *  so the nonzero-exit throw is caught and its captured stdout used. Anything unparseable is a
 *  loud failure — a gate that shrugs at garbage output is not a gate. */
const runDetect = (args: string[]): Finding[] => {
  let out = "";
  try {
    out = execFileSync("node", [DETECT, "--json", ...args], { encoding: "utf8" });
  } catch (e) {
    out = (e as { stdout?: string }).stdout ?? "";
  }
  return JSON.parse(out) as Finding[];
};

describe("design law: the impeccable detector is a build gate (#214)", () => {
  it("src/ carries zero detector findings", { timeout: 120_000 }, () => {
    const findings = runDetect(["src"]);
    expect(
      findings.map((f) => `${f.file}:${f.line} [${f.antipattern}] ${f.snippet}`),
      "the design detector found anti-patterns in shipped styles — fix them (or, for a " +
        "deliberate exception, record a REASONED ignore per the suppression test below)",
    ).toEqual([]);
  });

  // Disarm probe — an empty findings list is only meaningful if the spawned detector can still
  // find anything at all (precedent 97e00fd: a guard shipped vacuous). Runs the REAL detector,
  // config ignored, over a synthetic file carrying one instance of each anti-pattern family the
  // 2026-08-24 sweep actually caught, and pins that both come back.
  it("the detector still detects: a planted bounce easing and side-stripe are caught", { timeout: 60_000 }, () => {
    const tmp = process.env.TEMP ?? process.env.TMPDIR ?? "/tmp";
    const probe = join(tmp, "compy-detector-guard-probe.css");
    // The planted defects are ASSEMBLED, never written literally: this very file sits inside the
    // src/ tree the gate above scans, and a literal bounce bezier here would fail that gate on
    // its own fixture (the same fixture-vs-scanner rule border-hygiene-guard documents).
    const bounce = ["cubic-bezier(0.34", "1.56", "0.64", "1)"].join(", ");
    const stripe = ["border", "left"].join("-") + ": 4px solid red";
    writeFileSync(
      probe,
      `.x { transition: transform 200ms ${bounce}; ${stripe}; }\n`,
      "utf8",
    );
    const caught = runDetect(["--no-config", probe])
      .map((f) => f.antipattern)
      .sort();
    expect(caught).toEqual(["bounce-easing", "side-tab"]);
  });

  // Motion-law absolutes the vendored detector does NOT cover — the gap found in the 2026-08-24
  // emilkowalski/skills comparison: `transition: all` animates unintended properties off-GPU;
  // standalone ease-in delays the exact moment the user is watching; a scale(0) entrance appears
  // from nothing (start 0.95–0.97 + opacity instead). DESIGN.md §Motion carries the law.
  it("motion-law absolutes: no transition-all, no standalone ease-in, no scale(0) in shipped CSS", () => {
    // Patterns and samples are ASSEMBLED so a future detector version that learns these rules
    // never flags this file's own fixtures (same rule as the probe above).
    const bans: Array<{ name: string; re: RegExp }> = [
      { name: "transition-all", re: new RegExp(["transition", ":\\s*all\\b"].join("")) },
      { name: "ease-in", re: new RegExp(["ease", "-in(?![-\\w])"].join("")) },
      { name: "scale-zero", re: new RegExp(["scale", "\\(0\\)"].join("")) },
    ];
    // Falsification first: each ban must catch its own planted sample before it may clear the tree.
    const samples = [
      ["transition", ": all 200ms;"].join(""),
      ["transition: opacity 200ms ease", "-in;"].join(""),
      ["transform: scale", "(0);"].join(""),
    ];
    bans.forEach((ban, i) =>
      expect(ban.re.test(samples[i]), `${ban.name} ban went vacuous`).toBe(true),
    );
    // And each must NOT catch its legitimate look-alike.
    expect(bans[1].re.test("ease-in-out")).toBe(false);
    expect(bans[2].re.test("scale(0.97)")).toBe(false);

    const hits: string[] = [];
    for (const f of (readdirSync("src", { recursive: true }) as string[]).filter((p) => p.endsWith(".css"))) {
      // Blank out comments (newlines preserved) so prose ABOUT a ban never trips it.
      const css = readFileSync(join("src", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) =>
        m.replace(/[^\n]/g, " "),
      );
      css.split("\n").forEach((line, n) => {
        for (const ban of bans) {
          if (ban.re.test(line)) {
            hits.push(`src/${f.replace(/\\/g, "/")}:${n + 1} [${ban.name}] ${line.trim()}`);
          }
        }
      });
    }
    expect(hits, "motion-law absolute violated — fix the motion, per DESIGN.md §Motion").toEqual([]);
  });

  // Suppression is allowed — the dots on Home really do need a width transition, Geist really is
  // a deliberate face — but it is NEVER silent. Every escape hatch is enumerated and argued:
  //   · config ignores live in tracked .impeccable/config.json and must carry a real reason;
  //   · whole-rule and whole-file ignores are banned outright (they hide future, unrelated hits);
  //   · inline waivers are pinned to an exact list, so adding one forces this test to change in
  //     the same reviewable diff.
  it("every suppression is reasoned, and none is rule- or file-wide", () => {
    const config = JSON.parse(readFileSync(join(".impeccable", "config.json"), "utf8")) as {
      hook?: { enabled?: boolean };
      detector?: {
        ignoreRules?: string[];
        ignoreFiles?: string[];
        ignoreValues?: Array<{ rule: string; value: string; reason?: string }>;
      };
    };
    expect(config.detector?.ignoreRules ?? []).toEqual([]);
    expect(config.detector?.ignoreFiles ?? []).toEqual([]);
    for (const entry of config.detector?.ignoreValues ?? []) {
      expect(
        (entry.reason ?? "").length,
        `${entry.rule}=${entry.value} needs a real recorded reason, not a rubber stamp`,
      ).toBeGreaterThan(40);
    }

    const inlineWaivers = (readdirSync("src", { recursive: true }) as string[])
      .filter((f) => /\.(css|tsx?)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => readFileSync(join("src", f), "utf8").includes("impeccable-disable"))
      .map((f) => f.replace(/\\/g, "/"))
      .sort();
    expect(
      inlineWaivers,
      "a new inline impeccable-disable waiver appeared — argue it here, in the same diff",
    ).toEqual([
      // Both are the same argued exception: a width that must displace/settle real layout,
      // where scaleX would visibly distort rounded caps. Reasons live at each site.
      "surfaces/Benchmark.css",
      "surfaces/home-interview.css",
    ]);
  });
});

describe("design law: the per-edit detector hook can never silently unwire again", () => {
  it("the hook is enabled in tracked config", () => {
    const config = JSON.parse(readFileSync(join(".impeccable", "config.json"), "utf8")) as {
      hook?: { enabled?: boolean };
    };
    expect(config.hook?.enabled, ".impeccable/config.json must keep hook.enabled true").toBe(true);
  });

  it("the Claude hook entry lives in TRACKED settings.json — not the gitignored local file", () => {
    const settings = JSON.parse(readFileSync(join(".claude", "settings.json"), "utf8")) as {
      hooks?: {
        PostToolUse?: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>;
      };
    };
    const entry = (settings.hooks?.PostToolUse ?? []).find((group) =>
      (group.hooks ?? []).some((h) => /skills\/impeccable\/scripts\/hook\.mjs/.test(h.command ?? "")),
    );
    expect(entry, "the impeccable PostToolUse hook is gone from .claude/settings.json — the exact " +
      "silent unwire of 2026-08-21. Re-add it (or run hook-admin.mjs on and MOVE the entry here).").toBeTruthy();
    for (const tool of ["Edit", "Write"]) {
      expect(entry?.matcher ?? "", `hook matcher must cover ${tool}`).toContain(tool);
    }
  });

  it("the Codex hook entry points at the TRACKED skill copy", () => {
    // hook-admin's own repair writes `.agents/...`, which is gitignored — on a fresh clone that
    // command resolves to nothing. The Codex manifest must point at the tracked .claude copy.
    const codex = readFileSync(join(".codex", "hooks.json"), "utf8");
    expect(codex).toMatch(/\.claude\/skills\/impeccable\/scripts\/hook\.mjs/);
    expect(codex).not.toMatch(/\.agents\/skills\/impeccable/);
  });

  it("the detector, the hook, and both configs are real files git actually ships", () => {
    for (const path of [DETECT, HOOK]) expect(existsSync(path), `${path} missing`).toBe(true);
    const tracked = execFileSync(
      "git",
      ["ls-files", "--", DETECT, HOOK, ".impeccable/config.json", ".claude/settings.json"],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
    expect(tracked.length, "all four gate files must be git-tracked so a fresh clone is gated").toBe(4);
  });

  it("the vendored skill can never be silently DOWNGRADED (npm serves 3.6.0 as 'latest')", () => {
    // `npx impeccable update` fetches the npm package, which lags the vendored 3.9.1 — running it
    // would downgrade the detector underneath every assertion above. Floor the version.
    const skill = readFileSync(join(".claude", "skills", "impeccable", "SKILL.md"), "utf8");
    const version = /^version:\s*(\d+)\.(\d+)\.(\d+)/m.exec(skill);
    expect(version, "SKILL.md lost its version line").toBeTruthy();
    const [major, minor, patch] = version!.slice(1).map(Number);
    const atLeast391 = major > 3 || (major === 3 && (minor > 9 || (minor === 9 && patch >= 1)));
    expect(atLeast391, `impeccable ${major}.${minor}.${patch} is older than the vendored 3.9.1`).toBe(true);
  });
});
