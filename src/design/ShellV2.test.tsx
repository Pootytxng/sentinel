import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ShellV2, ROOM_CRUMB } from "./ShellV2";
import { railFor, HOME_RAIL } from "./homeRail";
import { readFileSync } from "fs";

// V2-2 shell guards: the rail renders the blessed room set with WORKING digit hints (a hint that
// does nothing is a fake affordance), the topbar carries the room title + the real build stamp
// (never a fabricated one) and NO tagline, and the footer states the outbound-honesty +
// reversibility promises with the MEASURED ledger count. (Updater ARMED 2026-07-22: the footer
// names the signed update check as the one outbound call — "zero outbound" would now be a lie.)

// `null` health = UNKNOWN, so every pre-existing test below reads the footer exactly as it did
// before the ledger-health gate existed. The block at the bottom of this file is the one that
// moves it.
const health: { value: unknown } = { value: null };

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) =>
    cmd === "get_build_stamp"
      ? Promise.resolve("ab12cd3 · dev")
      : cmd === "get_ledger_health"
        ? Promise.resolve(health.value)
        : Promise.resolve(null),
}));

afterEach(() => {
  cleanup();
  health.value = null;
});

const ITEMS = railFor(true); // merged: Health · Games · Problems · Optimize · Live · History · Test
// Rendered rail text comes from i18n (common.rail.*), not HOME_RAIL's guard-pinned literals —
// room renames (owner-approved 2026-08-12: Blackbook→History, Lab→Test, Monitor→Live) land here.
const RAIL_TEXT: Record<string, string> = { home: "Health", games: "Games", problems: "Problems", check: "Check", fix: "Optimize", play: "Live", learn: "History", lab: "Test", optimize: "Optimize" };

const shell = (over: Partial<Parameters<typeof ShellV2>[0]> = {}) => (
  <ShellV2
    items={ITEMS}
    activeId="home"
    onNavigate={() => {}}
    ledgerCount={41}
   
    {...over}
  >
    <div data-testid="room">room</div>
  </ShellV2>
);

describe("ShellV2 rail", () => {
  it("renders one tab per rail room, in rail order, with 1-based digit hints", () => {
    render(shell());
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(
      ITEMS.map((it, i) => `${RAIL_TEXT[it.id]}${i + 1}`),
    );
  });

  // bug→guard (UX audit 2026-08-11): the digit hint sat inside the tab's accessible name, so a
  // screen reader announced "Home 1" / "Blackbook 3" — the shortcut read as part of the room name,
  // and sighted users read the same pill as an unread count. The digit is now aria-hidden and the
  // shortcut is declared where it means something. Exact-name matching is the assertion: a `/Health/`
  // regex would pass again the day the digit crept back in.
  it("a rail tab's accessible name is the room name ALONE — the digit is a keyboard hint", () => {
    render(shell());
    for (const [i, item] of ITEMS.entries()) {
      const tab = screen.getByRole("tab", { name: RAIL_TEXT[item.id] });
      expect(tab.getAttribute("aria-keyshortcuts"), item.label).toBe(String(i + 1));
      expect(tab.querySelector("kbd")?.getAttribute("aria-hidden")).toBe("true");
      // and the name is exactly the label — no trailing digit, no glyph text
      expect(tab.getAttribute("aria-keyshortcuts")).not.toBe(null);
    }
  });

  // Design foundation ⑤ — instruments behind a door. The rail reads as ONE front door (Health) and a
  // signed group of instruments, not four equal tabs. Pinned structurally: Health is in the door
  // group, every other room sits after the "Look deeper" sign in the instruments group, and nothing
  // is hidden or collapsed — a door that hid Live would be the hide-behind-a-toggle the 2026-08-06
  // directive bars, and exactly the "hard to navigate" the foundation was commissioned to cure.
  it("the rail is a front door plus a signed group of instruments — grouped, never hidden", () => {
    const { container } = render(shell({ items: railFor(true, true) }));
    const door = container.querySelector(".v2-nav-door");
    const instruments = container.querySelector(".v2-nav-instruments");
    expect(door, "the door group is missing").toBeTruthy();
    expect(instruments, "the instruments group is missing").toBeTruthy();
    // Read from the VISIBLE label, not the `title` attribute these two lines used to sample. That
    // attribute is gone (#213 A4 — it summoned an unstyled OS tooltip to repeat the span beside it),
    // and sampling it was always indirect: what this test means to pin is which room sits in which
    // group, and the label span is where a reader actually finds that out.
    const railNames = (group: Element) =>
      Array.from(group.querySelectorAll('[role="tab"]')).map((t) => t.querySelector("span")?.textContent);
    expect(railNames(door!)).toEqual(["Health", "Games", "Problems"]);
    expect(railNames(instruments!)).toEqual(["Live", "History", "Test"]);
    // The sign names the group for sighted users AND the tablist (aria-labelledby) — one element, both jobs.
    const sign = container.querySelector("#v2-nav-deeper");
    expect(sign?.textContent).toBe("Look deeper");
    expect(instruments!.querySelector('[role="tablist"]')?.getAttribute("aria-labelledby")).toBe("v2-nav-deeper");
    // Door before sign, in DOM order.
    expect(door!.compareDocumentPosition(sign!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Grouped, not hidden: every rail room is still a visible, focusable tab with its GLOBAL digit.
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(6);
    expect(tabs.map((t) => t.getAttribute("aria-keyshortcuts"))).toEqual(["1", "2", "3", "4", "5", "6"]);
    for (const t of tabs) expect(t.hasAttribute("hidden") || t.getAttribute("aria-hidden") === "true").toBe(false);
  });

  it("marks the active room and navigates on click", () => {
    const onNavigate = vi.fn();
    render(shell({ onNavigate }));
    expect(screen.getByRole("tab", { name: /Health/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: /Live/ }));
    expect(onNavigate).toHaveBeenCalledWith("play");
  });

  // The crumbs outlived the topbar that used to print them: CommandPalette reads the same
  // `common.shellV2.crumb.*` keys as its per-door hint, where the room's own h1 is NOT on screen.
  // So every rail id still owes a sentence — it is just no longer shown next to the room title.
  it("every rail id has a plain-English crumb for the palette to hint with", () => {
    for (const r of HOME_RAIL) expect(ROOM_CRUMB[r.id]).toBeTruthy();
  });

  it("footer: outbound-honesty line + reversibility line with the measured ledger count", () => {
    render(shell());
    expect(screen.getByText("Outbound: signed update check only")).toBeTruthy();
    expect(screen.getByText("ledger 41")).toBeTruthy();
  });
});

// bug → guard, the app-level half of the ledger-completeness class (rooms: `b60a314`/`a1d5f53`
// Optimize, `61e092c` Blackbook, `4150eb3` Benchmark, ledger-health-home-guard.test.tsx Home).
//
// This footer is the widest instance of the class by far: it is rail chrome, so it prints on EVERY
// room — including the ones that never mounted a health check of their own. And both halves of it
// are false under an incomplete record, not just the count. "Every change reversible" is the bigger
// lie of the two: changes applied before a quarantine genuinely cannot be undone, so the incomplete
// branch has to replace the WHOLE line, not swap the number out from under a prefix that stopped
// being true. Guarded here because a later refactor that "simplifies" this back to one line would
// restore the fabrication silently, in every room at once.
describe("ShellV2 footer may not promise reversibility off a ledger it can't read", () => {
  const UNREADABLE = { complete: false, error: "failed to read history.json", quarantined: false };
  const QUARANTINED = { complete: false, error: null, quarantined: true };
  const HEALTHY = { complete: true, error: null, quarantined: false };

  const foot = (c: HTMLElement) => c.querySelector(".v2-foot")!.textContent ?? "";

  it.each([
    ["quarantined — the durable shape, clean-and-empty forever after", QUARANTINED],
    ["unreadable — the transient shape, apply and rollback both refusing", UNREADABLE],
  ])("%s: the promise is withdrawn and the count degrades to a floor", async (_n, value) => {
    health.value = value;
    const { container } = render(shell());

    await waitFor(() => expect(container.querySelector(".v2-ledger-state")).toBeTruthy());
    // The count survives as a FLOOR — 41 changes really are on record; what is unknown is whether
    // there are more. Withdrawing a real measurement would be its own dishonesty.
    expect(foot(container)).toContain("at least 41");
    expect(foot(container)).not.toContain("Every change reversible");
    expect(foot(container)).not.toContain("ledger 41");
    // The outbound-honesty line is a separate promise and stays put.
    expect(screen.getByText("Outbound: signed update check only")).toBeTruthy();
  });

  it("at zero there is no floor to name, so the count goes too", async () => {
    // Zero is where the record is indistinguishable from a genuine first run — the shape that
    // lands this defect. "ledger 0" would read as a measurement; it is an absence.
    health.value = QUARANTINED;
    const { container } = render(shell({ ledgerCount: 0 }));

    await waitFor(() => expect(container.querySelector(".v2-ledger-state")).toBeTruthy());
    expect(foot(container)).toContain("count unknown");
    expect(foot(container)).not.toContain("ledger 0");
    expect(foot(container)).not.toContain("Every change reversible");
  });

  it.each([
    ["UNKNOWN (probe returned nothing)", null],
    ["COMPLETE (the backend vouching for the record)", HEALTHY],
  ])("%s leaves the footer BYTE-IDENTICAL to today", async (_n, value) => {
    health.value = null;
    const before = render(shell()).container.querySelector(".v2-foot")!.outerHTML;
    cleanup();

    health.value = value;
    const { container } = render(shell());
    // Settle the probe before asserting nothing moved — asserting on an unsettled render would
    // pass for the wrong reason.
    await waitFor(() => expect(screen.getByText("ledger 41")).toBeTruthy());
    expect(container.querySelector(".v2-foot")!.outerHTML).toBe(before);
    expect(container.querySelector(".v2-ledger-state")).toBeNull();
  });
});

describe("ShellV2 digit shortcuts (the kbd hints must WORK)", () => {
  it("pressing a digit navigates to that room", () => {
    const onNavigate = vi.fn();
    render(shell({ onNavigate }));
    fireEvent.keyDown(window, { key: "2" });
    expect(onNavigate).toHaveBeenCalledWith(ITEMS[1].id);
  });

  it("never fires while typing or with a modifier held", () => {
    const onNavigate = vi.fn();
    render(
      <ShellV2 items={ITEMS} activeId="home" onNavigate={onNavigate} ledgerCount={0}>
        <input aria-label="field" />
      </ShellV2>,
    );
    fireEvent.keyDown(screen.getByLabelText("field"), { key: "2" });
    fireEvent.keyDown(window, { key: "2", ctrlKey: true });
    fireEvent.keyDown(window, { key: "9" }); // out of range
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("ShellV2 topbar", () => {
  // bug -> guard, and the bug was a guard. On 2026-08-22 this assertion was INVERTED to
  // "the topbar draws no room name", citing "all four approved comps draw that bar empty".
  // That citation was false, and re-measuring the PNGs is what caught it:
  // 01-health-approved.png prints "Health" in this bar and 04-test-approved.png prints "Test";
  // only Live's and History's are empty. Two comps out of four is not a rule anyone designed,
  // there is no product reason two rooms would be named in shared chrome and two nameless, and
  // the standing brief says preserve every existing control -- so the element stays and this
  // assertion is back the way it was, now with the measurement written down beside it.
  it("centres the wide-window search box WITHOUT a transform (desk review 2026-10-30)", () => {
    // The magnetic pull animates transform, and GSAP leaves its last value inline. With the box
    // centred by translateX(-50%), that inline value survived the window narrowing below 1200px
    // and painted the box over the PC pill and the room title (measured at 904px wide).
    const css = readFileSync("src/design/shell-v2.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const at = css.indexOf("@media (min-width: 1200px)");
    expect(at, "the wide-window search rule moved").toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("\n}\n", at));
    expect(block).toContain(".v2-search");
    expect(block).not.toMatch(/transform\s*:/);
    expect(block).toMatch(/margin-inline:\s*auto/);
  });

  it("names the active room, as Health's and Test's comps do", () => {
    const { container } = render(shell({ activeId: "play" }));
    const title = container.querySelector(".v2-room-title");
    expect(title, "the topbar's room title went missing again").not.toBeNull();
    expect(title!.textContent).toContain("Live");
    // …and the rail still names it too — that duplication is what the comps actually draw.
    const rail = container.querySelector(".v2-rail, nav");
    expect(rail!.textContent).toContain("Live");
  });

  // bug -> guard (2026-08-18, conformance audit C-09). Build identifiers are developer furniture:
  // the topbar carried `555e2996 · release` and the rail carried `0.9.25`, on every screen, for a
  // consumer who has no use for either. The navigation audit §4 ruled they belong in Settings →
  // About — which already shows BOTH and is itself test-pinned, so this is a move, not a deletion.
  //
  // Asserted on the whole shell, not just the topbar: the point is that no chrome prints a build
  // identifier anywhere, and a check scoped to one container would miss it reappearing in the other.
  it("prints NO build identifier in chrome — those live in Settings -> About", async () => {
    const { container } = render(shell({ activeId: "play" }));
    // Settle first: the removed probe was async, so a synchronous assertion would have passed even
    // while the stamp was still on its way, and reported green for the bug it exists to catch.
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector(".v2-stamp"), "the topbar build stamp is back").toBeNull();
    expect(container.querySelector(".v2-version"), "the rail version number is back").toBeNull();
    const shellText = container.querySelector(".v2-shell")?.textContent ?? "";
    expect(shellText, "chrome is printing the build stamp again").not.toContain("ab12cd3");
    expect(shellText, "chrome is printing a version number again").not.toMatch(/\bv?\d+\.\d+\.\d+\b/);
  });

  // The right-hand cluster is held over by an unconditional spacer. Every member of that cluster
  // (search box, update pill, accent picker) is conditional, so when `.v2-stamp` carried the
  // margin-left:auto its removal collapsed the cluster against the room title — and hanging the
  // margin on any one member would only hide the same bug behind that member's flag.
  it("keeps the right-hand cluster right-aligned with no palette, pill or picker rendered", () => {
    const { container } = render(shell({ activeId: "play" }));
    expect(container.querySelector(".v2-top > .v2-top-spacer"), "the spacer is gone").toBeTruthy();
  });

  // bug -> guard (2026-08-18). The navigation audit MEASURED this one: the topbar printed
  // `Live · watch it live` while the room below printed its own name as an h1 ~90px lower, which
  // is the title-header law violation the project had already written down. Ruling: "drop the
  // topbar tagline; keep one name per room" (docs/decisions/2026-08-11-design-navigation-audit.md
  // §3, order-of-work #3). It sat unshipped for six days. This fails if it grows back.
  it("prints NO tagline beside the room title — one name per room", () => {
    const { container } = render(shell({ activeId: "play" }));
    expect(container.querySelector(".v2-crumb"), "the topbar tagline is back").toBeNull();
    const top = container.querySelector(".v2-top")?.textContent ?? "";
    for (const r of HOME_RAIL) {
      expect(top, `the topbar is printing ${r.id}'s crumb again`).not.toContain(ROOM_CRUMB[r.id]);
    }
  });
});

// bug -> guard (DIR-1 first-timer walk, 2026-08-26, finding #1). `.v2-content` is ONE scroll
// container shared by every room, and nothing reset it between rooms — so a room could open at
// whatever offset the PREVIOUS room happened to be left at. Measured on the installed build:
// History scrolled to 300, click Health, Health opens at 300. The person it costs is the exact one
// this walk was for — Live's only button ("Start capture") is 466px above the fold on a fresh
// visit, so a first-timer arriving mid-page sees a room with nothing to press.
//
// Falsified both ways: deleting the reset effect fails the first test, and gating it on the motion
// layer fails the second.
describe("ShellV2 content lane — every room opens at its own top", () => {
  const lane = (c: HTMLElement) => c.querySelector<HTMLElement>(".v2-content")!;

  it("resets the shared scroll lane when the room changes", () => {
    const { container, rerender } = render(shell({ activeId: "learn" }));
    lane(container).scrollTop = 300;
    expect(lane(container).scrollTop, "jsdom must actually hold the offset").toBe(300);
    rerender(shell({ activeId: "home" }));
    expect(lane(container).scrollTop, "the new room inherited the old room's scroll offset").toBe(0);
  });

  it("does NOT re-scroll a room the user is already reading", () => {
    const { container, rerender } = render(shell({ activeId: "learn" }));
    lane(container).scrollTop = 300;
    // Same room, a re-render for any other reason (a probe resolving, a flag reading, a prop
    // changing). Yanking the reader back to the top here would be its own wayfinding defect.
    rerender(shell({ activeId: "learn", ledgerCount: 42 }));
    expect(lane(container).scrollTop, "a same-room re-render stole the reader's place").toBe(300);
  });

  // Navigation MECHANICS, not motion. Gating this on `jarvis` / reduced motion would leave the
  // original defect live for every user on the failsafe path — including anyone whose WebView2
  // reports prefers-reduced-motion, which on this desk it does.
  it("is not gated on the motion layer, and is not animated", () => {
    const src = readFileSync("src/design/ShellV2.tsx", "utf8");
    const effect = /lane\.scrollTop = 0;[\s\S]*?\}, \[([^\]]*)\]\);/.exec(src);
    expect(effect, "the lane-reset effect is gone").toBeTruthy();
    expect(effect![1].trim(), "the reset must depend on the room id and nothing else").toBe("activeId");
    const body = src.slice(src.indexOf("const lane = contentRef.current;"), effect!.index + effect![0].length);
    for (const gate of ["jarvis", "reducedMotion", "prefers-reduced-motion", "behavior: \"smooth\""]) {
      expect(body, `the lane reset is gated or animated by ${gate}`).not.toContain(gate);
    }
  });

  // The spine listens for the same event; without it an in-flight lerp can drag the new room back
  // down within a frame or two of paint.
  it("hands the reset to the smooth-scroll spine too", () => {
    expect(readFileSync("src/design/ShellV2.tsx", "utf8")).toContain('CustomEvent("compy:lane-reset")');
    const spine = readFileSync("src/design/jarvis/LenisSpine.tsx", "utf8");
    expect(spine).toContain('window.addEventListener("compy:lane-reset", onLaneReset)');
    expect(spine, "the listener must be removed on unmount").toContain(
      'window.removeEventListener("compy:lane-reset", onLaneReset)',
    );
    expect(spine, "the spine must jump, not ease, on a navigation").toContain(
      "lenis?.scrollTo?.(0, { immediate: true })",
    );
  });
});
