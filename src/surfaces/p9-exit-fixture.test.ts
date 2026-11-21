import { describe, it, expect } from "vitest";
import fx from "../test/fixtures/p9-exit.json";
import i18n from "../i18n";
import type { Priorities } from "../types";
import { settingsDoneLine, softwareFirstLine } from "./settings-done";
import type { GameTestSummary } from "./test-summary";

// P9-exit-fixture (Phase 9 Exit, product/ROADMAP.md): "for a measured workload, Compy can say whether
// software settings have reached what it can test, then name the measured limiter in system context or
// say 'no upgrade recommended', never naming a part in isolation and never letting retail economics
// shape the answer." One case per branch. The payload is what priorities.rs builds from each case's
// sessions (pinned there by `p9_exit_fixture_payloads_match_the_shared_fixture`); here it drives the
// finished game summary's Phase 9 line, in the words the user reads.
type Case = (typeof fx.cases)[number];

const prioritiesOf = (c: Case): Priorities =>
  ({
    // Review r1: the check's own limiters ride the contract too (priorities.rs pins them per case).
    limiters: ((c.payload as { limiters?: { id: string; status: string; title: string }[] }).limiters ?? []).map((l) => ({
      ...l,
      reason: "",
      linked: null,
      confidence: "medium",
    })),
    already_fine: [],
    not_worth_touching: [],
    session_hint: null,
    upgrade_path: null,
    gpu_limited_games: c.payload.gpu_limited_games,
    gpu_clear_games: c.payload.gpu_clear_games,
  }) as unknown as Priorities;

const KEY = "lab.experimentBench.summary.settingsDone";
// Review r1: this mirrors ExperimentBench.tsx's kind -> key choice (the summary's renderer); the
// rendered lines themselves are pinned by ExperimentBench.test.tsx's settings-done render tests.
const words = (c: Case): string | null => {
  const line = settingsDoneLine(c.headline as GameTestSummary["headline"], prioritiesOf(c), fx.game);
  if (!line) return null;
  const game = "WARDOGS";
  switch (line.kind) {
    case "gpu-limiter":
      return i18n.t(`${KEY}.gpuLimiter`, { game, share: line.sharePct, threshold: line.thresholdPct });
    case "nothing-limiting":
      return line.gpuClear
        ? i18n.t(`${KEY}.nothingLimitingMeasured`, {
            game,
            busy: line.gpuClear.busy,
            readings: line.gpuClear.readings,
            threshold: line.gpuClear.thresholdPct,
            limitShare: line.gpuClear.limitSharePct,
          })
        : i18n.t(`${KEY}.nothingLimiting`);
    case "not-measured":
      return i18n.t(`${KEY}.notMeasured`);
    case "part-limiter":
      return `${i18n.t(`${KEY}.partLimiter`, { title: line.title })} ${i18n.t(
        `${KEY}.${line.fit === "drive" ? "partFitDrive" : "partFitUnknown"}`,
      )}`;
    default:
      return i18n.t(`${KEY}.settingLimiter`, { title: line.title });
  }
};

describe("P9-exit-fixture: each Phase 9 Exit branch, from priorities to the game summary", () => {
  it("covers every branch the Exit names", () => {
    expect(fx.cases.map((c) => c.line)).toEqual(["gpu-limiter", "nothing-limiting", "nothing-limiting", null, "part-limiter", null]);
  });

  it("with no check in hand (none cached, or the read failed), nothing is measured and no upgrade is recommended", () => {
    for (const p of [undefined, null]) {
      expect(settingsDoneLine("finished-supported-tests", p, fx.game)).toEqual({ kind: "not-measured" });
    }
    expect(i18n.t(`${KEY}.notMeasured`)).toBe(
      "Settings have reached what Compy can test here. What holds this PC back hasn't been measured, so no upgrade is recommended.",
    );
  });

  it.each(fx.cases.map((c) => [c.name, c] as const))("%s", (_n, c) => {
    const line = settingsDoneLine(c.headline as GameTestSummary["headline"], prioritiesOf(c), fx.game);
    expect(line?.kind ?? null).toBe(c.line);
    const text = words(c);
    // Never retail economics, never a product: no shop, price or purchase in any branch's words.
    if (text) expect(text).not.toMatch(/Amazon|Newegg|\$|€|£|buy|price|RTX|Radeon|GeForce/i);
    switch (c.line) {
      case "gpu-limiter":
        // The measured limiter, in system context: the share it was measured from, then what Compy
        // can't check about the rest of the system before any card.
        expect(text).toContain("80% of Compy's GPU readings were at 95% load or more");
        expect(text).toContain("the GPU is the measured limiter for this game");
        expect(text).toContain("Compy can't check your power supply, case or the rest of the system for a new card");
        break;
      case "nothing-limiting":
        expect(text).toContain("Settings have reached what Compy can test here.");
        if (c.payload.gpu_clear_games.length > 0) {
          // Measured clear: the counts it was read from, and what Compy can't measure (CPU, frame cap).
          expect(text).toContain("120 of 900 GPU readings were at 95% load or more, under the 50%");
          expect(text).toContain("Compy measures neither");
          expect(text).toMatch(/No GPU upgrade is recommended\.$/);
        } else {
          // A clean check and no measured session: the check's own rows only, and it says the game's GPU
          // load isn't measured (P9-no-session-plain-line).
          expect(text).toBe(
            "Settings have reached what Compy can test here. The last check found nothing in its rows holding this PC back; Compy has no session of this game with enough GPU readings, so its GPU load isn't measured. No upgrade is recommended.",
          );
        }
        break;
      case "part-limiter":
        // P9-part-line-context: the part the check named, then what Compy can't check before replacing it.
        expect(text).toBe(
          "Settings have reached what Compy can test here. The last check's top item is a part of this PC: Game install drive. Before any drive: Compy can't read which free M.2 slots, SATA ports or drive bays your motherboard and case have. Check those first.",
        );
        break;
      default: {
        // Settings not done: no Phase 9 verdict. A part is named only through "try these settings
        // before any upgrade", and only when the check named one.
        expect(text).toBeNull();
        const first = softwareFirstLine(
          { headline: c.headline as GameTestSummary["headline"], leftToTest: [{ id: "visual-effects", title: "Trim Windows visual effects" }], retest: [] } as unknown as Pick<GameTestSummary, "headline" | "leftToTest" | "retest">,
          prioritiesOf(c),
        );
        if ("limiters" in c.payload) {
          expect(first).toEqual({ kind: "software-first", part: "Game install drive", candidates: ["Trim Windows visual effects"] });
        } else {
          expect(first).toBeNull();
        }
      }
    }
  });
});
