// The palette's BEHAVIOUR — what a user does with it, not what it looks like.
// The visual side is the self-review law's job; these pin the contracts that break silently:
// it routes through the host's writers, keyboard and mouse agree, and it never offers a dead door.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import { railFor, type HomeRailItem } from "./homeRail";

const railLabel = (item: HomeRailItem) => item.label;

function setup(overrides: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    rail: railFor(false, true),
    railLabel,
    onNavigate: vi.fn(),
    onOpenStation: vi.fn(),
    onOpenEntry: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  render(<CommandPalette {...props} />);
  return props;
}

const input = () => screen.getByRole("combobox") as HTMLInputElement;
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const rows = () => screen.getAllByRole("option");

beforeEach(() => cleanup());

describe("mounting", () => {
  it("renders nothing at all when closed", () => {
    const { container } = render(
      <CommandPalette
        open={false}
        onClose={() => {}}
        rail={railFor(false, true)}
        railLabel={railLabel}
        onNavigate={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("opens on the rooms, so the first thing you see is the map", () => {
    setup();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(rows().length).toBeGreaterThan(0);
    expect(rows()[0].textContent).toContain("Home");
  });
});

describe("it routes through the host's writers — never its own navigation", () => {
  it("a room row calls onNavigate with the rail id", () => {
    const p = setup();
    type("monitor");
    fireEvent.click(rows()[0]);
    expect(p.onNavigate).toHaveBeenCalledWith("play");
  });

  it("an instrument row calls onOpenStation — App's single station-intent writer", () => {
    const p = setup();
    type("crashed");
    fireEvent.click(rows()[0]);
    expect(p.onOpenStation).toHaveBeenCalledWith("blackbox");
  });

  it("Settings calls onOpenSettings", () => {
    const p = setup();
    type("settings");
    fireEvent.click(rows()[0]);
    expect(p.onOpenSettings).toHaveBeenCalled();
  });

  it("a Blackbook row calls onOpenEntry with the entry id", () => {
    const onOpenEntry = vi.fn();
    setup({ onOpenEntry });
    // A real corpus entry, reached the way a user would: by typing part of its name.
    type("shader");
    fireEvent.click(rows()[0]);
    expect(onOpenEntry).toHaveBeenCalledTimes(1);
    expect(typeof onOpenEntry.mock.calls[0][0]).toBe("string");
  });

  it("closes BEFORE it navigates, so the overlay is never left over the destination", () => {
    const order: string[] = [];
    const p = setup({
      onClose: vi.fn(() => order.push("close")),
      onNavigate: vi.fn(() => order.push("navigate")),
    });
    type("monitor");
    fireEvent.click(rows()[0]);
    expect(order).toEqual(["close", "navigate"]);
    expect(p.onClose).toHaveBeenCalled();
  });
});

describe("no dead doors", () => {
  it("omits instruments, entries and Settings when the host cannot open them", () => {
    setup({ onOpenStation: undefined, onOpenEntry: undefined, onOpenSettings: undefined });
    type("crashed");
    // The crash INSTRUMENT is unreachable here, so nothing may claim to take you there.
    expect(screen.queryByText("Crash & Freeze")).toBeNull();
  });
});

describe("keyboard", () => {
  it("arrows move the selection and Enter opens the selected row", () => {
    const p = setup();
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    expect(rows()[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(p.onNavigate).toHaveBeenCalledWith(railFor(false, true)[1].id);
  });

  it("arrow-up from the top wraps to the bottom", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "ArrowUp" });
    const all = rows();
    expect(all[all.length - 1].getAttribute("aria-selected")).toBe("true");
  });

  it("Escape closes", () => {
    const p = setup();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(p.onClose).toHaveBeenCalled();
  });

  it("Enter does nothing when nothing matches — it never opens a stale row", () => {
    const p = setup();
    type("zzzqqqnothing");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(p.onNavigate).not.toHaveBeenCalled();
    expect(p.onOpenStation).not.toHaveBeenCalled();
    expect(p.onOpenEntry).not.toHaveBeenCalled();
  });

  it("keeps the selection inside the list as typing narrows it", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    type("settings"); // collapses to one row
    const selected = rows().filter((r) => r.getAttribute("aria-selected") === "true");
    expect(selected.length).toBe(1);
  });
});

describe("pointer and keyboard agree", () => {
  it("hovering a row makes it the row Enter would open", () => {
    const p = setup();
    fireEvent.mouseMove(rows()[2]);
    expect(rows()[2].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(p.onNavigate).toHaveBeenCalledWith(railFor(false, true)[2].id);
  });

  it("exactly one row is selected at a time", () => {
    setup();
    fireEvent.mouseMove(rows()[1]);
    expect(rows().filter((r) => r.getAttribute("aria-selected") === "true").length).toBe(1);
  });
});

describe("the empty state names what was searched", () => {
  it("quotes the query and suggests a next move rather than shrugging", () => {
    setup();
    type("qqqzzz");
    expect(screen.getByText(/qqqzzz/)).toBeTruthy();
    expect(screen.queryAllByRole("option").length).toBe(0);
    // A dead end with no next move is the thing this feature exists to remove.
    expect(screen.getByText(/stutter/i)).toBeTruthy();
  });
});

describe("the kbd hints out-specify the shell rule that would grey them out", () => {
  // bug → guard, twice over. The palette's CSS said `color: var(--v2-muted)` and the live app
  // painted --v2-faint anyway: shell-v2.css's `:root[data-v2="on"] .v2-shell kbd` is more
  // specific, and both the topbar box and the overlay mount inside .v2-shell. Five 10.5px labels
  // (Ctrl K, Esc, ↑, ↓, ↵) shipped at ~3.45:1 while every file-level check was green.
  //
  // Round 2 of the same defect: matching that specificity STILL lost, because a tie goes to
  // whichever stylesheet was inserted last, and ShellV2 imports CommandPalette (and therefore this
  // CSS) above its own. So the guard cannot ask "is the token right" or even "is the prefix
  // there" — it has to compare the two rules the way a browser does. It computes specificity and
  // demands the palette's rule be STRICTLY greater, which is the only outcome that does not
  // depend on import order.
  const read = (f: string) => readFileSync(join("src", "design", f), "utf8");

  /** (ids, classes+attrs+pseudo-classes, elements) — enough of the real algorithm for these two
   *  rules, which use only classes, one attribute, `:root`, and element names. */
  const specificity = (selector: string): [number, number, number] => {
    const s = selector.trim();
    const ids = (s.match(/#[\w-]+/g) ?? []).length;
    const classish =
      (s.match(/\.[\w-]+/g) ?? []).length +
      (s.match(/\[[^\]]+\]/g) ?? []).length +
      (s.match(/:(?!:)[\w-]+/g) ?? []).length;
    const elements = (s.replace(/\[[^\]]+\]/g, "").match(/(^|[\s>+~])[a-z][\w-]*/g) ?? []).length;
    return [ids, classish, elements];
  };
  const beats = (a: [number, number, number], b: [number, number, number]) =>
    a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

  /** Every selector, across all rules in `css`, whose declaration block matches `body`. */
  const selectorsOf = (css: string, body: RegExp): string[] =>
    [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, , decls]) => body.test(decls))
      .flatMap(([, sel]) => sel.split(",").map((s) => s.trim()))
      .filter(Boolean);

  it("beats shell-v2's blanket kbd rule on specificity, not on import order", () => {
    const shell = selectorsOf(read("shell-v2.css"), /color:\s*var\(--v2-faint\)/).filter((s) =>
      /\.v2-shell\s+kbd$/.test(s),
    );
    // If the shell stops painting kbds faint, this whole selector prefix is dead weight rather
    // than a fix — whoever removes it should be told why it was ever there.
    expect(shell, "shell-v2.css no longer paints .v2-shell kbd faint — re-read this guard").toHaveLength(1);

    const ours = selectorsOf(read("command-palette.css"), /color:\s*var\(--v2-muted\)/).filter((s) =>
      /\bkbd\b/.test(s),
    );
    expect(ours.some((s) => s.includes(".cp-panel kbd"))).toBe(true);
    expect(ours.some((s) => s.includes(".v2-search kbd"))).toBe(true);
    for (const sel of ours) {
      expect(beats(specificity(sel), specificity(shell[0])), `${sel} does not beat ${shell[0]}`).toBe(
        true,
      );
    }
  });
});

describe("accessibility wiring", () => {
  it("points aria-activedescendant at the selected row's real id", () => {
    setup();
    const active = input().getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    expect(document.getElementById(active!)?.getAttribute("aria-selected")).toBe("true");
  });

  it("is a modal dialog with an accessible name", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBeTruthy();
  });
});
