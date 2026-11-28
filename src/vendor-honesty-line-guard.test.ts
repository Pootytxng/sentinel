import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// GPU VENDOR-HONESTY REACHABILITY GUARD (LOCKED rule #5).
//
// The line — "AMD — verified · NVIDIA — implemented, not yet hardware-verified · Intel — planned"
// — is rule #5's ONE user-visible surface. It has gone dark TWICE, and the second time this guard
// was green throughout, which is the more important half of the story:
//
//   2026-07-07  It lived inside MonitoringTab's `{!embedded && (…)}` header while every call site
//               passed `embedded`. Fixed by hoisting it out of the mode gate. The guard written
//               that day pinned exactly that shape — "present, once, not wrapped in a condition".
//   2026-08-26  Still present, still once, still outside every condition — and still invisible,
//               because the COMPONENT went dark one level up. MonitorV2 returns <MonitorConsole>
//               for segment "live" and only reaches <Play> on "sessions", where Play's
//               `showLive = view !== "sessions"` is false, so the `deepMonitoring` slot holding
//               MonitoringTab never rendered on any route. Found by reading, not by a test.
//
// The lesson is the guard's new shape: "not nested under a condition" is not reachability. A
// component can satisfy every local rule and still hang off a branch nobody takes. So this guard
// now walks the ROUTE — from the room the rail actually opens down to the element — and every
// case below fails on the return of either defect.
//
// The line now lives on MonitorConsole, the Live face MonitorV2 mounts unconditionally, directly
// under the sensor strip whose coverage it qualifies.

const read = (...p: string[]) => readFileSync(join(...p), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const HOST = join("src", "surfaces", "MonitorConsole.tsx");

describe("GPU vendor-honesty line (LOCKED rule #5)", () => {
  // e3 (first-run remainder): the sentence moved from an English literal in MonitorConsole into
  // monitor.monitorConsole.gpuCoverage (en + zh-CN), so a Chinese reader gets it too. The exact
  // English wording is now pinned where it lives (the en locale), the zh-CN wording is pinned the same
  // way (review r1 F1), and the coverage-note span must render those three keys and nothing in their place.
  const COVERAGE_KEYS = ["label", "amd", "rest"] as const;
  const coverage = (lang: string) =>
    (JSON.parse(read("src", "i18n", "locales", lang, "monitor.json")) as {
      monitorConsole: { gpuCoverage: Record<(typeof COVERAGE_KEYS)[number], string> };
    }).monitorConsole.gpuCoverage;

  // e3 review r1 F1: pin the HONESTY in both languages, not only the vendor names. Each vendor's part
  // of the sentence (split on "·") must carry its exact status, and a "verified" word may stand only
  // in AMD's part (en: outside "not yet hardware-verified"; zh-CN: 已验证 only for AMD).
  const part = (sentence: string, vendor: string) => sentence.split("·").find((p) => p.includes(vendor)) ?? "";
  const STATUS = {
    en: { AMD: "AMD — verified", NVIDIA: "NVIDIA — implemented, not yet hardware-verified", Intel: "Intel — planned" },
    "zh-CN": { AMD: "AMD — 已验证", NVIDIA: "NVIDIA — 已实现，尚未经过硬件验证", Intel: "Intel — 计划中" },
  } as const;

  for (const lang of ["en", "zh-CN"] as const) {
    it(`carries the exact three-vendor wording (${lang})`, () => {
      const c = coverage(lang);
      const norm = COVERAGE_KEYS.map((k) => c[k]).join(" ").replace(/\s+/g, " ");
      for (const vendor of ["AMD", "NVIDIA", "Intel"] as const) {
        expect(part(norm, vendor), `${lang}: ${vendor}'s status`).toContain(STATUS[lang][vendor]);
      }
      if (lang === "en") {
        expect(part(norm, "NVIDIA").replace("not yet hardware-verified", ""), "en: NVIDIA called verified").not.toMatch(/verified/i);
        expect(part(norm, "Intel"), "en: Intel called verified").not.toMatch(/verified/i);
      } else {
        expect(part(norm, "NVIDIA"), "zh-CN: NVIDIA called verified (已验证)").not.toContain("已验证");
        expect(part(norm, "Intel"), "zh-CN: Intel called verified").not.toContain("验证");
      }
    });
  }

  it("renders the three coverage keys inside the coverage-note span", () => {
    const span = /className="coverage-note">([\s\S]*?)<\/span>/.exec(stripComments(read(HOST)));
    expect(span, "the coverage-note span is not on MonitorConsole").not.toBeNull();
    for (const k of COVERAGE_KEYS) expect(span![1]).toContain(`t("monitor.monitorConsole.gpuCoverage.${k}")`);
  });

  it("renders it exactly once, app-wide", () => {
    // Two copies is how a "move" turns into a duplicate that drifts apart — one gets the next
    // vendor update and the other keeps asserting last year's confidence.
    const files = ["App.tsx", join("surfaces", "MonitorConsole.tsx"), join("surfaces", "Play.tsx")];
    const total = files.reduce((n, f) => {
      try {
        return n + (read("src", f).split("coverage-note").length - 1);
      } catch {
        return n; // a deleted surface cannot host the line
      }
    }, 0);
    expect(total, "exactly one coverage-note render site across the monitor surfaces").toBe(1);
  });

  // ── The route. Each hop is the one that broke last time. ──────────────────────────────────

  it("hop 1: MonitorV2 mounts MonitorConsole for the Live segment, unconditionally", () => {
    const mv2 = stripComments(read("src", "surfaces", "MonitorV2.tsx"));
    expect(
      /if\s*\(\s*segment\s*===\s*"live"\s*\)\s*\{[\s\S]{0,400}?<MonitorConsole\b/.test(mv2),
      "MonitorV2 no longer answers the Live segment with MonitorConsole — the honesty line is " +
        "pinned to a surface users no longer land on. Re-home the line before changing this.",
    ).toBe(true);
    // "live" must stay the segment the room OPENS on, or the line is one click away at best.
    expect(
      /useState<Segment>\(\s*"live"\s*\)/.test(mv2),
      "the Monitor room no longer opens on Live — re-check that the honesty line is still on the " +
        "landing face",
    ).toBe(true);
  });

  it("hop 2: the line sits in MonitorConsole's always-rendered body, not behind a mode fork", () => {
    const src = read(HOST);
    const stripped = stripComments(src);
    expect(
      /mode\s*===/.test(stripped),
      "MonitorConsole gained a mode fork — the one-face rule (issue #180) forbids it, and a fork " +
        "is exactly how this line went dark in 2026-07",
    ).toBe(false);

    // It must be a SIBLING of the sensor strip it qualifies: same parent, no gate between them.
    const strip = stripped.indexOf('className="mc-ev-sensors"');
    const note = stripped.indexOf('className="mc-ev-coverage"');
    expect(strip, "the sensor strip vanished — update this guard with its new anchor").toBeGreaterThan(-1);
    expect(note, "the coverage note is not on MonitorConsole").toBeGreaterThan(-1);
    expect(note, "the coverage note must follow the sensor strip it qualifies").toBeGreaterThan(strip);

    const between = stripped.slice(strip, note);
    expect(
      /\{\s*!?[\w.?]+\s*&&/.test(between) || /\?\s*\(/.test(between),
      "a conditional opened between the sensor strip and the honesty line — the line must not be " +
        "reachable only in some states of this screen",
    ).toBe(false);
  });

  it("hop 3: the dead route that swallowed it cannot come back by accident", () => {
    // MonitoringTab / monitor-panels.tsx / MonitorDomainCards were the unreachable subtree the
    // line was stranded in. If a future change re-introduces a `deepMonitoring`-style slot, it
    // must not become the honesty line's only home again.
    const play = stripComments(read("src", "surfaces", "Play.tsx"));
    expect(
      /deepMonitoring/.test(play),
      "Play grew a deepMonitoring slot again. That is allowed — but it renders only while " +
        "`showLive`, which is false on the only route that reaches Play. Do not put rule #5's " +
        "sentence (or any other required disclosure) inside it.",
    ).toBe(false);
  });
});
