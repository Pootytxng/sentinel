import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

// BUG → GUARD (self-review round 2, 2026-07-28, product-recovery train).
//
// The defect: clicking a nav pill in the Lab deck scrolled the destination section to the top of
// the room — BEHIND the sticky nav. At 1280×720 four of the five sections landed with their own H2
// clipped ~15px under the nav bar (measured: scrollport top 79.8, nav bottom 151, heading top
// 135.8). You clicked "Optimize" and could not read the word "Optimize". For a train whose whole
// point is "can a non-technical gamer tell where they are", that is a structural orientation bug,
// not a cosmetic one.
//
// The cause: `.ld-section { scroll-margin-top: 56px }` — a constant guessed from the nav's height.
// The strip the nav actually covers is the room scroller's top padding (26px on `.v2-content`) PLUS
// the nav's height (~45px, and two rows when the five names wrap). No stylesheet can know that sum.
//
// The guard: the deck MEASURES the nav's real bottom edge against the scrollport it sticks to and
// publishes `--ld-jump-inset`; the CSS consumes it. jsdom has no layout engine, so this pins the
// three things that ARE provable there — the arithmetic, the fact that the deck publishes it from
// live rects, and the CSS↔TS mirror — plus a replay of the exact recorded geometry that failed.

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
vi.mock("../rig/RigViewer", () => ({ RigViewer: () => <div data-testid="rig-hologram" /> }));

class IOStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", IOStub);

const { LabDeck } = await import("./LabDeck");
const { ConfirmProvider } = await import("../../design/ConfirmDialog");
const {
  atScrollEnd,
  computeJumpInset,
  pickHere,
  scrollportOf,
  JUMP_GAP,
  FALLBACK_JUMP_INSET,
} = await import("./jump-inset");

// The geometry the review actually measured on the installed candidate at 1280×720.
const PORT_TOP = 79.8; // .v2-content's padding-box top edge, in viewport coords
const NAV_BOTTOM = 151; // the stuck .ld-nav's bottom edge
const OLD_CONSTANT = 56; // the guess that shipped in round 1

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("compy_motion", "reduced");
});

const rect = (over: Partial<DOMRect>) =>
  ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) as unknown, ...over }) as DOMRect;

describe("a nav jump lands the destination heading below the sticky nav, not behind it", () => {
  it("the recorded 1280×720 geometry: the old constant clipped, the measured inset clears", () => {
    // What round 1 did: heading top = scrollport top + 56 → 135.8, which is ABOVE the nav's
    // bottom edge (151). Negative clearance IS the clipping the reviewer saw.
    expect(PORT_TOP + OLD_CONSTANT - NAV_BOTTOM).toBeLessThan(0);

    // What the measured inset does with the same numbers.
    const inset = computeJumpInset(NAV_BOTTOM, PORT_TOP);
    expect(inset).toBe(83); // round(151 − 79.8) + 12
    expect(PORT_TOP + inset! - NAV_BOTTOM).toBeGreaterThanOrEqual(JUMP_GAP - 1);
  });

  it("refuses to publish an inset it cannot trust", () => {
    // jsdom's all-zero rects, a nav that has not laid out, a detached deck: publishing 0 here would
    // silently restore the bug (a 0 scroll-margin puts the heading flush under the scrollport top,
    // i.e. fully behind the nav). Null means "leave the CSS fallback alone".
    expect(computeJumpInset(0, 0)).toBeNull();
    expect(computeJumpInset(120, 240)).toBeNull();
    expect(computeJumpInset(Number.NaN, 0)).toBeNull();
  });

  it("the deck publishes --ld-jump-inset from the LIVE nav and scrollport rects", () => {
    const { container } = render(
      // The room frame the deck really mounts in: a scrolling box with its own top padding.
      <div style={{ overflowY: "auto" }} data-testid="scrollport">
        <ConfirmProvider>
          <LabDeck fast={fast()} diagnostics={<div />} diagnosticsCaptured priorities={null} activeCount={0} />
        </ConfirmProvider>
      </div>,
    );
    const deck = container.querySelector<HTMLElement>(".lab-deck")!;
    const nav = container.querySelector<HTMLElement>(".ld-nav")!;
    const port = container.querySelector<HTMLElement>('[data-testid="scrollport"]')!;

    // Mount happened with jsdom's zero rects — nothing measurable, so nothing published.
    expect(deck.style.getPropertyValue("--ld-jump-inset")).toBe("");

    // The deck must find the scrolling ancestor by looking, not by assuming a shell class.
    expect(scrollportOf(deck)).toBe(port);

    nav.getBoundingClientRect = () => rect({ top: 106, bottom: NAV_BOTTOM, height: 45 });
    port.getBoundingClientRect = () => rect({ top: PORT_TOP, bottom: 720 });
    window.dispatchEvent(new Event("resize"));

    expect(deck.style.getPropertyValue("--ld-jump-inset")).toBe("83px");

    // And it tracks the nav growing to two rows when the five names wrap on a narrow stage —
    // the case a constant can never follow.
    nav.getBoundingClientRect = () => rect({ top: 106, bottom: NAV_BOTTOM + 34, height: 79 });
    window.dispatchEvent(new Event("resize"));
    expect(deck.style.getPropertyValue("--ld-jump-inset")).toBe("117px");
  });

  it("the stylesheet consumes the measured inset and mirrors the TS fallback", () => {
    const css = readFileSync(join("src", "surfaces", "lab", "LabDeck.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const section = css.match(/\.ld-section\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(section).toContain(`scroll-margin-top: var(--ld-jump-inset, ${FALLBACK_JUMP_INSET}px)`);

    // No bare-pixel scroll-margin anywhere in the deck: that is the shape of the original bug.
    expect(/scroll-margin-top:\s*\d/.test(css)).toBe(false);

    // The fallback still has to clear the worst case it can be left holding — the room scroller's
    // 26px padding plus a single-row nav (~45px) — since it is what a no-layout environment gets.
    expect(FALLBACK_JUMP_INSET).toBeGreaterThanOrEqual(26 + 45);
  });
});

// BUG → GUARD (self-review round 3, 2026-07-30). The fix above bought the last step its clearance
// with `padding-bottom: min(34vh, 280px)` on `.lab-deck` — and shipped a second defect doing it. At
// rest on the installed candidate the review measured ~380px of pure empty space between the last
// row and the window edge: no footer, no closing content, no anchor. It does not read as breathing
// room, it reads as a page that got cut off or never finished loading.
//
// Both halves are real, and they pull against each other: delete the room and step 5 loses its
// clearance; keep it bare and the deck looks broken. So the room is OCCUPIED rather than removed —
// same travel, now carrying a terminator anchored at the bottom edge the eye actually lands on.
//
// This pins the shape so neither half can be undone by a later "tidy up that whitespace":
//   · the terminator must be the deck's LAST child (delete it → fail)
//   · the travel is bounded on BOTH sides (round 4 rewrote this — see that test's own note)
//   · and it must not be re-added as bare padding on .lab-deck as well (double room → fail)
describe("the deck ends on something, and the room that ends it is not bare", () => {
  const css = () =>
    readFileSync(join("src", "surfaces", "lab", "LabDeck.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );

  it("the last thing in the deck is a visible end marker", () => {
    const { container } = render(
      <ConfirmProvider>
        <LabDeck fast={fast()} diagnostics={<div />} diagnosticsCaptured priorities={null} activeCount={0} />
      </ConfirmProvider>,
    );
    const deck = container.querySelector<HTMLElement>(".lab-deck")!;
    const last = deck.lastElementChild!;
    expect(last.className).toContain("ld-end");
    // A marker nobody can read is the same defect wearing a class name.
    expect(last.getAttribute("aria-hidden")).toBeNull();
    expect((last.textContent ?? "").trim().length).toBeGreaterThan(0);
    expect(deck.querySelectorAll(".ld-end").length).toBe(1);
  });

  it("it stays a marker, in both locales", () => {
    // Prose here would just be a footer nobody asked for; the parity guard in
    // lab-copy-contract.test.ts already forces zh-CN to exist alongside it.
    for (const locale of ["en", "zh-CN"]) {
      const label = JSON.parse(
        readFileSync(join("src", "i18n", "locales", locale, "lab.json"), "utf8"),
      ).labDeck.end.label as string;
      expect(label.trim().length).toBeGreaterThan(0);
      expect(label.length).toBeLessThanOrEqual(24);
      expect(label).not.toMatch(/[.。]/);
    }
  });

  it("the marker's ink is the AA-body token, not the AA-large one", () => {
    // Round 4 measured the first attempt at 3.6:1. --ix-text-3 is DESIGNED to sit there —
    // theme-contrast.test.ts holds it to a 3.0 floor because it is for large muted captions — so
    // reaching for it on 11px/400 text is the defect, not the token. --ix-text-2 is pinned at 4.5.
    const label = css().match(/\.ld-end-label\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(label).toMatch(/color:\s*var\(--ix-text-2/);
    expect(label).not.toMatch(/--ix-text-3/);
  });

  it("the trailing room is bounded on BOTH sides, and .lab-deck does not double it", () => {
    const sheet = css();
    const end = sheet.match(/\.ld-end\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const travel = end.match(/min-height:\s*min\((\d+)vh,\s*(\d+)px\)/);
    expect(travel).not.toBeNull();
    const [, vh, px] = [travel![0], Number(travel![1]), Number(travel![2])];

    // A floor, because 0 strands step 5's heading flush against the bottom edge — you click
    // "Advanced instruments" and nothing appears to move.
    expect(vh).toBeGreaterThanOrEqual(10);
    expect(px).toBeGreaterThanOrEqual(96);
    // A CEILING, because that is the failure this guard was rewritten for. Round 3 set 34vh/280px
    // reasoning that the travel could only ever be too small; round 4 measured 271.5px of void
    // above the marker at 1484×971 and proved the opposite. Growing it back is a regression.
    expect(vh).toBeLessThanOrEqual(18);
    expect(px).toBeLessThanOrEqual(140);

    const deck = sheet.match(/\.lab-deck\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(deck).not.toMatch(/padding-bottom/);
  });
});

// BUG → GUARD (self-review round 5, 2026-07-30). The same clamp that forced the trailing room also
// broke the "you are here" pill, and for the same reason: the page stops scrolling before the LAST
// step can own the viewport. At max scroll the tall "Diagnose a problem" section and the short
// "Advanced instruments" section are both fully in frame — intersectionRatio 1.0 each — and the
// ratio comparison keeps the earlier one. Measured at 1484×971: click step 5, the page jumps, the
// nav still says step 4. Reproduced two ways (nav pill, and scrollTop = scrollHeight).
//
// Shrinking the trailing room in d7cf825 made it MORE likely, not less, which is why it surfaced
// this round: less travel means section 4 stays fuller in view at the clamp.
//
// No ratio rule can fix this — the ratios are genuinely tied and genuinely correct. The end of the
// page is the end of the path, so that is the rule. Everything short of the end is untouched.
describe("the last step lights when the page runs out of room", () => {
  const JOURNEY = ["move", "optimize", "prove", "diagnose", "advanced"] as const;

  it("at max scroll the journey's end wins, whatever the ratios say", () => {
    // The exact tie the review measured: both fully visible, the earlier one taller.
    const tied = (k: string) => (k === "diagnose" || k === "advanced" ? 1 : 0);
    expect(pickHere(JOURNEY, tied, false)).toBe("diagnose"); // the shipped behaviour…
    expect(pickHere(JOURNEY, tied, true)).toBe("advanced"); // …and the fix, which only applies AT the end.
  });

  it("and changes nothing before the end — including ties", () => {
    // Arriving at the top with two short sections both fully in frame must still light step 1.
    // Breaking ties toward the LATER section would have "fixed" the end at the cost of the start.
    const top = (k: string) => (k === "move" || k === "optimize" ? 1 : 0);
    expect(pickHere(JOURNEY, top, false)).toBe("move");
    expect(pickHere(JOURNEY, (k) => (k === "prove" ? 0.8 : 0.2), false)).toBe("prove");
    // Nothing in frame at all (jsdom, pre-layout): no claim rather than a wrong one.
    expect(pickHere(JOURNEY, () => 0, false)).toBeNull();
    expect(pickHere([], () => 1, true)).toBeNull();
  });

  it("recognises the end of a scroller, and refuses to invent one", () => {
    expect(atScrollEnd({ scrollTop: 2903, scrollHeight: 3794, clientHeight: 891 })).toBe(true);
    expect(atScrollEnd({ scrollTop: 2902, scrollHeight: 3794, clientHeight: 891 })).toBe(true); // slack
    expect(atScrollEnd({ scrollTop: 2890, scrollHeight: 3794, clientHeight: 891 })).toBe(false);
    // A page that doesn't scroll has no end — otherwise the last pill would light on arrival.
    expect(atScrollEnd({ scrollTop: 0, scrollHeight: 900, clientHeight: 900 })).toBe(false);
    expect(atScrollEnd(null)).toBe(false);
  });

  it("the deck re-decides on scroll, not only on threshold crossings", () => {
    // The observer is why this needs a scroll listener at all: the last few pixels before the clamp
    // cross no threshold, so nothing would re-run the choice and the pill would stay stale.
    const { container } = render(
      <div style={{ overflowY: "auto" }} data-testid="scrollport">
        <ConfirmProvider>
          <LabDeck fast={fast()} diagnostics={<div />} diagnosticsCaptured priorities={null} activeCount={0} />
        </ConfirmProvider>
      </div>,
    );
    const port = container.querySelector<HTMLElement>('[data-testid="scrollport"]')!;
    const pills = Array.from(container.querySelectorAll(".ld-nav-item"));
    expect(pills).toHaveLength(JOURNEY.length);
    expect(pills.findIndex((p) => p.getAttribute("aria-current") === "true")).toBe(0);

    // jsdom has no layout, so hand it the geometry the review recorded on the real window.
    for (const [k, v] of [
      ["scrollHeight", 3794],
      ["clientHeight", 891],
      ["scrollTop", 2903],
    ] as const) {
      Object.defineProperty(port, k, { value: v, configurable: true });
    }
    act(() => {
      port.dispatchEvent(new Event("scroll"));
    });

    const lit = Array.from(container.querySelectorAll(".ld-nav-item")).findIndex(
      (p) => p.getAttribute("aria-current") === "true",
    );
    expect(lit).toBe(JOURNEY.length - 1);
  });
});

function fast() {
  return {
    recs: [],
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
    onChanged: () => {},
    sessions: [],
    gpus: [],
    vendor: "amd",
  } as never;
}
