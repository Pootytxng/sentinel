import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { ROOM_ACCENT_SWATCHES, defaultRoomAccent, swatchKey } from "./room-identity";
import { RoomAccentPicker, ACCENT_MENU_ITEM_COUNT } from "./RoomAccentPicker";

// BACKLOG C-13 residual (b) / issue #150. `RoomAccentPicker` declared `role="menu"` from the day it
// shipped and honoured none of that role's keyboard contract: no roving tabindex, no arrow keys, no
// focus restoration on close.
//
// WHY THIS FILE EXISTS AND AXE DOES NOT COVER IT. axe reads the accessibility TREE — roles, names,
// required children. Every one of those was already correct here, which is why the C-13 sweep that
// landed axe-core (49 mounted cases, this component among them) passed the day the defect was
// filed. What was missing is BEHAVIOUR, and behaviour has to be driven to be measured. So these are
// real key events against a real mount, asserting real `document.activeElement` — the only tier that
// can see this class at all.
//
// The bug→guard law wants the CLASS, not the instance, so the last describe block holds the static
// side: a NEW `role="menu"` anywhere under `src/` fails until it carries the same contract.

const SWATCHES = ROOM_ACCENT_SWATCHES.length;
const APPLY_ALL_INDEX = SWATCHES; // "apply to all rooms"
const RESET_INDEX = SWATCHES + 1; // "reset to default" — disabled while the room has no pick

const items = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"], [role="menuitem"]'));

const openByMouse = (container: HTMLElement) => {
  const trigger = within(container).getAllByRole("button")[0];
  fireEvent.click(trigger);
  return trigger;
};

const focusedIndex = (container: HTMLElement) => items(container).indexOf(document.activeElement as HTMLButtonElement);

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("room accent menu: the tab order the roving tabindex exists to collapse", () => {
  it("exposes exactly ONE tabbable item — the whole popover is a single tab stop", () => {
    const { container } = render(<RoomAccentPicker room="fix" roomLabel="Fix" />);
    openByMouse(container);

    const tabbable = items(container).filter((el) => el.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
  });

  it("every other item is reachable by arrow only (tabIndex -1), never by Tab", () => {
    const { container } = render(<RoomAccentPicker room="fix" roomLabel="Fix" />);
    openByMouse(container);

    const all = items(container);
    expect(all).toHaveLength(ACCENT_MENU_ITEM_COUNT);
    // This is the regression in one number: before the fix every one of these was tabbable, so
    // crossing the topbar by keyboard cost ACCENT_MENU_ITEM_COUNT stops instead of one.
    expect(all.filter((el) => el.tabIndex === -1)).toHaveLength(ACCENT_MENU_ITEM_COUNT - 1);
  });

  it("the tabbable item is the one holding focus — the ring and the tab stop never disagree", () => {
    const { container } = render(<RoomAccentPicker room="fix" roomLabel="Fix" />);
    openByMouse(container);

    const tabbable = items(container).findIndex((el) => el.tabIndex === 0);
    expect(tabbable).toBe(focusedIndex(container));
  });
});

describe("room accent menu: arrow-key navigation the role promises", () => {
  it("opens onto the CURRENT pick, not blindly onto the first swatch", () => {
    const { container } = render(<RoomAccentPicker room="fix" roomLabel="Fix" />);
    const trigger = within(container).getAllByRole("button")[0];
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const expected = ROOM_ACCENT_SWATCHES.findIndex(
      (s) => swatchKey(s) === defaultRoomAccent("fix").toLowerCase(),
    );
    expect(expected).toBeGreaterThanOrEqual(0);
    expect(focusedIndex(container)).toBe(expected);
  });

  it("ArrowDown and ArrowRight both step forward; ArrowUp and ArrowLeft both step back", () => {
    const { container } = render(<RoomAccentPicker room="fix" roomLabel="Fix" />);
    openByMouse(container);
    const start = focusedIndex(container);

    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(focusedIndex(container)).toBe(start + 1);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(focusedIndex(container)).toBe(start + 2);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(focusedIndex(container)).toBe(start + 1);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(focusedIndex(container)).toBe(start);
  });

  it("Home and End jump to the ends of the ring", () => {
    const { container } = render(<RoomAccentPicker room="fix" roomLabel="Fix" />);
    openByMouse(container);

    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(focusedIndex(container)).toBe(0);
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    // Not RESET_INDEX: with no pick yet, "reset to default" is disabled and must be skipped.
    expect(focusedIndex(container)).toBe(APPLY_ALL_INDEX);
  });

  it("the ring WRAPS at both ends rather than dead-ending", () => {
    const { container } = render(<RoomAccentPicker room="fix" roomLabel="Fix" />);
    openByMouse(container);

    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(focusedIndex(container)).toBe(APPLY_ALL_INDEX); // wrapped back past the disabled reset

    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(focusedIndex(container)).toBe(0);
  });

  it("the two COMMANDS are in the same ring as the swatches — arrowing past the last swatch reaches them", () => {
    const { container } = render(<RoomAccentPicker room="fix" roomLabel="Fix" />);
    openByMouse(container);

    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    for (let i = 0; i < SWATCHES; i++) fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(focusedIndex(container)).toBe(APPLY_ALL_INDEX);
    expect(document.activeElement).toHaveProperty("className", expect.stringContaining("v2-accent-all"));
  });

  it.each([["ArrowUp"], ["End"]])(
    "%s from the trigger opens onto the LAST ENABLED item, never onto the disabled reset",
    (key) => {
      // Caught while reviewing this very change: both keys open onto the last INDEX, which is
      // "reset to default" — disabled while the room has no pick. Focus would have landed nowhere,
      // leaving the menu open with the tab stop parked on an unfocusable item.
      const { container } = render(<RoomAccentPicker room="fix" roomLabel="Fix" />);
      const trigger = within(container).getAllByRole("button")[0];
      fireEvent.keyDown(trigger, { key: key as string });

      expect(items(container)[RESET_INDEX].disabled).toBe(true);
      expect(focusedIndex(container)).toBe(APPLY_ALL_INDEX);
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).not.toBe(trigger);
    },
  );

  it("a DISABLED item is skipped, and becomes reachable once it is enabled", () => {
    // With a pick saved, "reset to default" is live and must join the ring.
    const { container } = render(<RoomAccentPicker room="fix" roomLabel="Fix" />);
    openByMouse(container);
    const notCurrent = items(container).findIndex(
      (el, i) => i < SWATCHES && el.getAttribute("aria-checked") === "false",
    );
    fireEvent.click(items(container)[notCurrent]); // choose → sets a pick and closes

    openByMouse(container);
    expect(items(container)[RESET_INDEX].disabled).toBe(false);
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(focusedIndex(container)).toBe(RESET_INDEX);
  });
});

describe("room accent menu: focus is restored, never dropped on <body>", () => {
  it("Escape returns focus to the trigger", () => {
    const { container } = render(<RoomAccentPicker room="fix" roomLabel="Fix" />);
    const trigger = openByMouse(container);
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    // The precise regression: before the fix the focused item unmounted and focus fell to <body>,
    // so a keyboard user lost their place in the topbar entirely.
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(trigger);
  });

  it("choosing a swatch returns focus to the trigger", () => {
    const { container } = render(<RoomAccentPicker room="fix" roomLabel="Fix" />);
    const trigger = openByMouse(container);

    fireEvent.click(items(container)[0]);
    expect(document.activeElement).toBe(trigger);
  });

  it("apply-to-all returns focus to the trigger", () => {
    const { container } = render(<RoomAccentPicker room="fix" roomLabel="Fix" />);
    const trigger = openByMouse(container);

    fireEvent.click(items(container)[APPLY_ALL_INDEX]);
    expect(document.activeElement).toBe(trigger);
  });

  it("Tab closes the menu and hands focus back, so the menu is one tab stop and not a trap", () => {
    const { container } = render(<RoomAccentPicker room="fix" roomLabel="Fix" />);
    const trigger = openByMouse(container);

    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("an OUTSIDE click closes without stealing focus back — it must not fight what was clicked", () => {
    const { container } = render(<RoomAccentPicker room="fix" roomLabel="Fix" />);
    const trigger = openByMouse(container);

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    fireEvent.mouseDown(outside);

    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
    outside.remove();
  });
});

// ── The class, not just this instance ──────────────────────────────────────────────────────────
// Today RoomAccentPicker is the only `role="menu"` under src/. That is exactly when to put the
// ratchet in: the defect was "a role declared without the behaviour it promises", and the next menu
// someone writes is where it recurs. A file that opts into the role opts into the contract.

// Repo-relative, like every other static guard in this tree (vitest runs from the repo root).
const SRC = "src";

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry !== "node_modules") tsxFiles(p, out);
    } else if (entry.endsWith(".tsx") && !entry.includes(".test.")) {
      out.push(p);
    }
  }
  return out;
}

describe("class guard: a role=menu must carry the keyboard contract that role promises", () => {
  const declaring = tsxFiles(SRC).filter((f) => /role="menu"/.test(readFileSync(f, "utf8")));

  it("finds the menus (fails loudly if the scan itself breaks and silently covers nothing)", () => {
    expect(declaring.length).toBeGreaterThan(0);
    expect(declaring.some((f) => f.endsWith("RoomAccentPicker.tsx"))).toBe(true);
  });

  it.each(declaring.map((f) => [f.slice(SRC.length + 1).replace(/\\/g, "/"), f]))(
    "%s declares arrow-key handling, a roving tabindex, and focus restoration",
    (_label, file) => {
      const src = readFileSync(file as string, "utf8");
      // Arrow navigation: the role's own movement contract.
      expect(src, "no onKeyDown — the menu's arrow keys do nothing").toMatch(/onKeyDown/);
      expect(src, "no ArrowDown/ArrowUp handling").toMatch(/ArrowDown|ArrowUp/);
      // Roving tabindex: without it every item is a tab stop.
      expect(src, "no tabIndex — every menu item sits in the tab order").toMatch(/tabIndex/);
      expect(src, "no tabIndex of -1 — nothing is being taken OUT of the tab order").toMatch(/-1/);
      // Focus restoration: the drop-to-<body> class Picker.tsx warns about in its header.
      expect(src, "nothing calls .focus() — focus is never restored on close").toMatch(/\.focus\(\)/);
    },
  );
});
