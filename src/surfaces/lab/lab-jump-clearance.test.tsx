import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
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
const { computeJumpInset, scrollportOf, JUMP_GAP, FALLBACK_JUMP_INSET } = await import(
  "./jump-inset"
);

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
//   · the travel may grow but never shrink below the measured 34vh/280px (trim it → fail)
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

  it("the marker carries the jump travel, and .lab-deck no longer doubles it", () => {
    const sheet = css();
    const end = sheet.match(/\.ld-end\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const travel = end.match(/min-height:\s*min\((\d+)vh,\s*(\d+)px\)/);
    expect(travel).not.toBeNull();
    // The two constants the 1280×720 measurement settled on. Raising them gives step 5 MORE
    // clearance, which is safe; lowering them is the regression this guard exists to catch.
    expect(Number(travel![1])).toBeGreaterThanOrEqual(34);
    expect(Number(travel![2])).toBeGreaterThanOrEqual(280);

    const deck = sheet.match(/\.lab-deck\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(deck).not.toMatch(/padding-bottom/);
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
