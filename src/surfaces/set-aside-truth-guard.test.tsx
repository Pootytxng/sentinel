import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import Fix from "./Fix";
import { OptimizeStation, type LabFastPathProps } from "./lab/OptimizeStation";
import { ConfirmProvider } from "../design/ConfirmDialog";
import type { Recommendation, SessionSummary } from "../types";

// bug→guard (self-review round 10, 2026-07-29). Two defects, one root: "set aside" was a word with
// two owners, and the empty state couldn't see either of them.
//
//  (1) CONTRADICTION. Set your only tweak aside in the Lab and the Optimize panel said BOTH
//      "Nothing waiting — the last one is set aside. Restore it below anytime." (the gauge caption,
//      which counts declines) and, two lines under it, "Nothing waiting — no changes to make on
//      this rig right now." (Fix's empty line, which had never heard of declines). The second one
//      is a lie about the rig: there IS a change to make, the user declined it.
//
//  (2) HOMONYM. "set aside" named the user's decline (Dismissed pile, gauge caption) AND Compy's
//      hardware read ("Not for this rig" intro, and the button that undid an override) on the same
//      screen — two different things, one phrase, no way for a reader to tell which.
//
// Round 8's fix made the Lab agree with itself about the COUNT; this one makes it agree about the
// SENTENCE, and gives each meaning its own word.

const ipc = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    ipc.calls.push(cmd);
    return Promise.resolve(cmd === "get_build_stamp" ? "ab12cd3 · dev" : []);
  },
}));

beforeAll(() => {
  class Obs {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as Record<string, unknown>).ResizeObserver ??= Obs;
  (globalThis as Record<string, unknown>).IntersectionObserver ??= Obs;
});

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
  ipc.calls.length = 0;
});

const gameMode: Recommendation = {
  id: "game-mode",
  title: "Enable Windows Game Mode",
  category: "system",
  severity: "safe",
  description: "d",
  impact: "i",
  downside: null,
  applies_to: "all",
  currently_applied: false,
  provenance: "verified",
  eligible: true,
} as Recommendation;

const fixProps = {
  recs: [gameMode] as never[],
  startup: [],
  changes: [],
  busyId: null,
  isAppliable: () => true,
  activeChangeFor: () => undefined,
  onToggleRec: () => {},
  onToggleStartup: () => {},
  onRollback: () => {},
  onApplyBatch: async () => ({ applied: 0, skipped: [] }),
  onOpenLibrary: () => {},
  vendor: "amd" as const,
};

const stationProps: LabFastPathProps = {
  ...fixProps,
  onChanged: () => {},
  sessions: [] as SessionSummary[],
  gpus: [],
};

// The real decline journey, not a state poke: open the slim row, press "Not for me".
const setAsideFirstRow = (container: HTMLElement) => {
  fireEvent.click(container.querySelector(".slimrow-toggle") as HTMLButtonElement);
  const notForMe = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Not for me"),
  ) as HTMLButtonElement;
  expect(notForMe).toBeTruthy();
  fireEvent.click(notForMe);
};

const LIE = "no changes to make on this rig";

// OptimizeStation mounts TWO <Fix>es: the fixes panel, and a ledger one folded inside
// <details class="lab-optimize-ledger">. The ledger has its own legitimate empty line
// ("Nothing active on this PC") — a different sentence about a different list. These
// assertions are about the FIXES panel, so the ledger's nodes must not answer for it.
const inFixesPanel = (container: HTMLElement, sel: string) =>
  [...container.querySelectorAll(sel)].filter((el) => !el.closest(".lab-optimize-ledger"));

describe("the empty state never contradicts the panel above it", () => {
  it("in the Lab panel, the gauge caption is the ONLY voice — Fix stays quiet", () => {
    const { container } = render(
      <ConfirmProvider>
        <OptimizeStation {...stationProps} />
      </ConfirmProvider>,
    );
    setAsideFirstRow(container);

    const caption = container.querySelector(".lab-gauge-caption")!.textContent!;
    expect(caption).toContain("Nothing waiting — the last one is set aside.");
    // One phrase, one owner: no second paragraph under the caption…
    expect(inFixesPanel(container, ".fix-empty").map((p) => p.textContent)).toEqual([]);
    // …and nowhere in the panel does anything claim the rig has nothing to change.
    expect(container.textContent).not.toContain(LIE);
    // The ready label doesn't hang over an empty list either.
    expect(inFixesPanel(container, ".fix-section-label").map((p) => p.textContent)).toEqual([]);
  });

  it("standalone Fix (no caption above) still speaks — and tells the truth about the decline", () => {
    const { container } = render(
      <ConfirmProvider>
        <Fix {...fixProps} view="fixes" />
      </ConfirmProvider>,
    );
    expect(container.querySelector(".fix-empty")).toBeNull(); // one rec waiting, nothing empty yet

    setAsideFirstRow(container);

    const empty = container.querySelector(".fix-empty");
    expect(empty, "with no caption above it, Fix owns the sentence and must print one").toBeTruthy();
    expect(empty!.textContent).toContain("set aside");
    expect(empty!.textContent).not.toContain(LIE);
  });

  it("with nothing declined and nothing to do, the plain line is still the right one (control)", () => {
    const { container } = render(
      <ConfirmProvider>
        <Fix {...fixProps} recs={[] as never[]} view="fixes" />
      </ConfirmProvider>,
    );
    expect(container.querySelector(".fix-empty")!.textContent).toContain(LIE);
  });
});

describe("'set aside' means the user declined it — nothing else", () => {
  const locales = ["en", "zh-CN"];
  // Everything Compy says about its own HARDWARE read. None of it may borrow the decline word.
  const HARDWARE_KEYS = [
    "notForThisRig",
    "notForThisRigIntro",
    "notApplicableFallback",
    "notApplicableFallbackLower",
    "myHardwareSupportsThis",
    "overriddenByYou",
    "compysReadWasPrefix",
    "notForThisRigAfterAll",
  ];
  // "set aside" in English — the object may sit inside the verb ("you set these aside"), so the
  // pattern has to see the split form too, or the hardware copy could smuggle the word back in.
  // "搁置" in Chinese.
  const DECLINE_WORD: Record<string, RegExp> = {
    en: /set\s+(?:\w+\s+)?aside/i,
    "zh-CN": /搁置/,
  };

  const fixCopy = (locale: string) =>
    JSON.parse(
      readFileSync(join("src", "i18n", "locales", locale, "optimize.json"), "utf8"),
    ).fix as Record<string, string>;

  for (const locale of locales) {
    it(`${locale}: the "not for this rig" pile never says it`, () => {
      const copy = fixCopy(locale);
      const offenders = HARDWARE_KEYS.filter((k) => {
        expect(copy[k], `optimize.fix.${k} is missing from ${locale}`).toBeTruthy();
        return DECLINE_WORD[locale].test(copy[k]);
      });
      expect(offenders, `hardware-ineligible copy must not reuse the decline word`).toEqual([]);
    });

    it(`${locale}: the Dismissed pile does say it (the word still has an owner)`, () => {
      expect(fixCopy(locale).dismissedIntro).toMatch(DECLINE_WORD[locale]);
    });
  }
});
