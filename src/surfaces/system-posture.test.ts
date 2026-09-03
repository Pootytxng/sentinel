import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — same pattern as voice-guard.test.ts.)
import { deriveSystemPosture as deriveSystemPostureRaw } from "./system-posture";
import type { GameReadiness, ReadinessCheck } from "../types";
// i18n update (2026-07-23): deriveSystemPosture's headline/sub now come from t(...) (Simplified
// Chinese translation pass) instead of literal English strings, so it takes a TFunction as its
// last param. This test-local wrapper resolves it through the real i18next instance (English is
// the default language, matching what every assertion below already expects) so every call site
// stays exactly as written — same text, just sourced from locale JSON instead of a .ts literal.
import i18n from "../i18n";

const deriveSystemPosture = (input: Parameters<typeof deriveSystemPostureRaw>[0]) =>
  deriveSystemPostureRaw(input, i18n.t);

const check = (status: ReadinessCheck["status"], label: string, detail = ""): ReadinessCheck =>
  ({ id: label, label, status, detail, value: null });

const readiness = (checks: ReadinessCheck[], dismissed: string[] = []): GameReadiness => {
  const d = new Set(dismissed);
  return {
    checks,
    ready_count: checks.filter((c) => c.status === "ready").length,
    // attention_count excludes dismissed (mirrors the backend).
    attention_count: checks.filter((c) => c.status === "attention" && !d.has(c.id)).length,
    unknown_count: checks.filter((c) => c.status === "unknown").length,
    advisory_count: checks.filter((c) => c.status === "advisory").length,
    advisory: "",
    dismissed_ids: dismissed,
    drifts: [],
  };
};

describe("deriveSystemPosture", () => {
  it("is 'scanning' before readiness loads", () => {
    expect(deriveSystemPosture({ readiness: null, activeChanges: 0, monitoringAvailable: false }).state).toBe("scanning");
  });

  // bug→guard (owner regression 2026-07-17): the vague "N thing(s) need(s) your attention"
  // count had crept back onto Home's verdict strip. The verdict must NAME the flagged thing
  // (name-it-and-fix-it-inline law) and never render a bare count headline again.
  const VAGUE_COUNT = /\bthings?\b[^.]*\bneeds?\b[^.]*attention/i;

  it("attention names the specific thing — one flagged check ⇒ the verdict IS that check", () => {
    const r = readiness([check("ready", "SSD"), check("attention", "Monitor below max refresh")]);
    const p = deriveSystemPosture({ readiness: r, activeChanges: 2, monitoringAvailable: true });
    expect(p.state).toBe("attention");
    expect(p.attentionCount).toBe(1);
    expect(p.reasons).toEqual(["Monitor below max refresh"]);
    expect(p.headline).toBe("Monitor below max refresh");
    expect(p.headline).not.toMatch(VAGUE_COUNT);
  });

  // bug→guard (owner ruling 2026-08-26, issue #219): the headline used to append "· and N more".
  // That tail was measured as what pushed the 40px verdict onto a third line, and it was the only
  // part of the headline naming nothing. It is gone — the headline is the flagged check's label and
  // stops there. This pins BOTH directions: the label must survive whole, and no count may return.
  const COUNT_TAIL = /·|\band\b|\bmore\b|\b\d+\b/;

  it("attention with several flagged checks names the first and stops — no '· and N more' tail", () => {
    const r = readiness([
      check("attention", "Monitor below max refresh"),
      check("attention", "GPU driver age"),
      check("attention", "Power profile"),
    ]);
    const p = deriveSystemPosture({ readiness: r, activeChanges: 0, monitoringAvailable: true });
    // The count did not disappear from the product — it moved down a level. `attentionCount` and
    // the full `reasons` list still carry every flagged check, and HomeConsole's sub prints the
    // honest proportion beneath the verdict. Only the HEADLINE stopped counting.
    expect(p.attentionCount).toBe(3);
    expect(p.reasons).toEqual(["Monitor below max refresh", "GPU driver age", "Power profile"]);
    expect(p.headline).toBe("Monitor below max refresh");
    expect(p.headline).not.toMatch(COUNT_TAIL);
    expect(p.headline).not.toMatch(VAGUE_COUNT);
  });

  it("a label that legitimately contains a number is not mangled by the no-count rule", () => {
    // Falsification in the other direction: the rule is "append nothing", not "strip digits". A
    // real catalog label like "2 startup apps slow your boot" must still render verbatim.
    const r = readiness([
      check("attention", "2 startup apps slow your boot"),
      check("attention", "GPU driver age"),
    ]);
    const p = deriveSystemPosture({ readiness: r, activeChanges: 0, monitoringAvailable: true });
    expect(p.headline).toBe("2 startup apps slow your boot");
  });

  // bug -> guard (independent review, 2026-08-26). The #219 change was correct, but the sentence
  // written ABOUT it was not: code comment, BACKLOG, RELEASE_STATE and the owner's own checklist all
  // said the remaining flagged checks were "listed in full in the body below". They are not. Home
  // renders this headline, the proportion, and the #1 limiter tile — one flagged thing plus a door;
  // the full per-check list lives in Check and Fix, one press away. `reasons` below carries every
  // flagged label and NOTHING consumes it, which is exactly what made the false sentence plausible
  // to four readers. A claim about what a screen shows is a claim, and an unverified claim is the
  // same defect in a comment as in a doc — so the comment is now pinned to the code.
  const POSTURE_SRC = "src/surfaces/system-posture.ts";
  const DERIVATION_ONLY = "it is derivation-only";

  // A file can only put `reasons` on screen if the value reaches it, and there are exactly two
  // routes: it imports the posture module, or the one module that does carries the field outward.
  // Both are checked, because a text grep for the word alone cannot tell the posture field from
  // `ev.reasons` on an evidence object or `c.reasons` on a case — the two unrelated reads that live
  // in HardwareGrid.tsx and WhatChangedPanel.tsx today and would otherwise BOTH read as consumers,
  // turning this guard's vacuous pass into a false fail. That is why restoring the word boundary
  // was not, on its own, the repair (#304).
  function sourceFiles(): string[] {
    return (readdirSync("src", { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
      .map((f) => join("src", f));
  }

  // Rough on purpose and stated rather than papered over: this also strips a `//` inside a string
  // literal, so a URL sharing a line with a real `.reasons` read would be missed. No such line
  // exists in the tree, and the alternative is a TypeScript parse for a grep-shaped question.
  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const readsField = (text: string) => /\.reasons\b/.test(stripComments(text));
  // The second route: an importer that spreads the derived posture outward ships `reasons` without
  // ever naming it. Every postureLine return is field-by-field today; this keeps it that way.
  const spreadsPosture = (text: string) => /\.\.\.\s*(p|posture)\b/.test(stripComments(text));

  it("`reasons` is derivation-only, and the comment says so — neither may drift alone", () => {
    const files = sourceFiles();
    // Non-vacuity: if the walk stops finding files, or stops finding the landmarks, nothing below
    // is earned. command-center-data.ts is named because the whole check reduces to `no importer
    // reads the field`, which is trivially true of an empty importer list.
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith("HomeConsole.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("command-center-data.ts"))).toBe(true);

    const importers = files.filter(
      (f) =>
        !f.endsWith("system-posture.ts") &&
        /from\s+["'][^"']*system-posture["']/.test(readFileSync(f, "utf8")),
    );
    expect(
      importers,
      "nothing imports system-posture — the walk or the import pattern is broken, not the invariant",
    ).not.toEqual([]);
    expect(importers.some((f) => f.endsWith("command-center-data.ts"))).toBe(true);

    // The detector, falsified LIVE. Without this the `someone wired it up` branch below is dead
    // code and the test collapses to `the comment is still present` — which is exactly what the
    // raw-backspace regex this replaces had quietly become. A guard that cannot reach its own
    // second outcome is not a guard.
    expect(readsField('const x = posture.reasons.join(", ");')).toBe(true);
    expect(spreadsPosture("return { ...p, tone };")).toBe(true);
    expect(readsField("// the reasons are listed on the evidence object")).toBe(false);
    // ...and the two unrelated `.reasons` readers must not be importers, which is what keeps the
    // restored word boundary from turning a vacuous pass into a false fail.
    expect(importers.some((f) => f.endsWith("HardwareGrid.tsx"))).toBe(false);
    expect(importers.some((f) => f.endsWith("WhatChangedPanel.tsx"))).toBe(false);

    const consumers = importers.filter((f) => {
      const text = readFileSync(f, "utf8");
      return readsField(text) || spreadsPosture(text);
    });
    const saysDerivationOnly = readFileSync(POSTURE_SRC, "utf8").includes(DERIVATION_ONLY);

    if (consumers.length === 0) {
      // Still unrendered: the comment MUST keep saying so, so nobody describes it as on-screen.
      expect(saysDerivationOnly, `${POSTURE_SRC} must keep the "${DERIVATION_ONLY}" note`).toBe(true);
    } else {
      // Someone wired it up — good, but then the note is now false and has to go with the change.
      expect(
        saysDerivationOnly,
        `${consumers.join(", ")} now carry posture reasons outward; drop the "${DERIVATION_ONLY}" note`,
      ).toBe(false);
    }
  });

  it("the retired 'listed in full below' claim is gone from code AND from the live docs", () => {
    // The exact false sentence, grep-banned in both places it landed. Falsified by re-adding it.
    const RETIRED = ["listed in full in the body below", "list below still names every check"];
    const targets = [
      POSTURE_SRC,
      "src/surfaces/HomeConsole.tsx",
      "docs/BACKLOG.md",
      "docs/RELEASE_STATE.md",
      "docs/OWNER_ACTION_CHECKLIST.md",
    ];
    const offenders: string[] = [];
    for (const file of targets) {
      const text = readFileSync(file, "utf8");
      for (const phrase of RETIRED) if (text.includes(phrase)) offenders.push(`${file}: "${phrase}"`);
    }
    expect(offenders).toEqual([]);
  });

  it("no locale still ships the retired count-tail string", () => {
    // The key is gone from en and zh-CN. If someone re-adds it, this fails before it can reach a
    // headline again — a live translation string is a standing invitation to wire it back up.
    expect(i18n.exists("home.posture.attentionMore")).toBe(false);
  });

  it("attention sub carries the flagged check's own detail — the fix travels with the name", () => {
    const r = readiness([
      check("attention", "Variable refresh rate", "It's OFF — turn it on for smoother pacing."),
    ]);
    const p = deriveSystemPosture({ readiness: r, activeChanges: 0, monitoringAvailable: true });
    expect(p.sub).toBe("It's OFF — turn it on for smoother pacing.");
  });

  it("is 'dialed-in' when all checks pass", () => {
    const r = readiness([check("ready", "SSD"), check("ready", "Refresh")]);
    const p = deriveSystemPosture({ readiness: r, activeChanges: 4, monitoringAvailable: true });
    expect(p.state).toBe("dialed-in");
    expect(p.attentionCount).toBe(0);
    expect(p.reasons).toEqual([]);
  });

  it("treats 'advisory' as not-attention, so posture stays dialed-in", () => {
    const r = readiness([check("ready", "SSD"), check("advisory", "Variable refresh rate")]);
    const p = deriveSystemPosture({ readiness: r, activeChanges: 0, monitoringAvailable: true });
    expect(p.state).toBe("dialed-in");
    expect(p.attentionCount).toBe(0);
  });

  it("a dismissed attention check no longer drives the posture (stays dialed-in)", () => {
    const r = readiness([check("ready", "SSD"), check("attention", "HDR")], ["HDR"]);
    const p = deriveSystemPosture({ readiness: r, activeChanges: 0, monitoringAvailable: true });
    expect(p.state).toBe("dialed-in");
    expect(p.attentionCount).toBe(0);
    expect(p.reasons).toEqual([]);
  });

  it("is 'unknown' when readiness has no usable checks", () => {
    expect(deriveSystemPosture({ readiness: readiness([]), activeChanges: 0, monitoringAvailable: false }).state).toBe("unknown");
  });
});
