// bug→guard (issue #213 A4 + A5, 2026-08-24) — the two shell-chrome defects that a green
// type-check and 5000 green assertions could not see, because neither is a wrong value. Both are
// the same mistake in two costumes: **the product saying the same thing twice in one glance.**
//
// A4 — every rail nav item carried `title={railLabel(item)}` alongside the <span> that renders the
// identical string. Hovering summoned the OS tooltip (white ground, black hairline, system font)
// over a dark rail, to announce a word already on screen an inch away. `title` is not banned here:
// on an icon-only control it is the only name a pointer user gets, and the titlebar buttons keep
// theirs. What is banned is a `title` that repeats the element's own visible text — a native
// control nobody styled, adding nothing.
//
// A5 — the custom titlebar printed "Compy" in the system font 40px above the rail's designed
// <Wordmark> printing "Compy" again. One product, two hands, one glance. **A5 was SUPERSEDED
// 2026-08-27 (#224 round 3):** the owner's literal-parity instruction for the approved comps —
// which draw the small "Compy" caption beside the gear, designed wordmark and all — is the later
// ruling, and the round-2 Codex review confirmed the supersession explicitly rather than leaving
// it an open fork. So the A5 half of this guard now pins the caption's PRESENCE: losing it again
// would un-ship the approved picture, not re-earn A5.
//
// The amendment these earned (Cowork lane, 2026-08-24, adopted): **a clipped element, an
// overlapping glyph, or an unstyled native control is a correctness failure, not a matter of
// taste.** Correctness failures get guards. This is that guard — A4's half unchanged, A5's half
// inverted by the later ruling.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// Same file-scoped IPC mocks as `console/hud-readout-no-duplicate-guard.test.tsx`: the shell reaches
// for the window chrome and the updater, neither of which exists under jsdom.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) =>
    cmd === "get_build_stamp" ? Promise.resolve("ab12cd3 · dev") : Promise.resolve(null),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
    minimize: () => Promise.resolve(),
    toggleMaximize: () => Promise.resolve(),
    close: () => Promise.resolve(),
    startDragging: () => Promise.resolve(),
    startResizeDragging: () => Promise.resolve(),
  }),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { ShellV2 } from "./ShellV2";
import { WindowChrome } from "./WindowChrome";
import { railFor, type HomeRailItem } from "./homeRail";

afterEach(cleanup);

const ITEMS: HomeRailItem[] = railFor(false, true);

/**
 * Every element whose `title` repeats text the element already renders. Equality is deliberately
 * NOT the test — a rail button's visible text is "Health1" (the label plus its keyboard digit), so
 * an equality check would have let the exact defect this guard exists for walk straight through.
 * Containment in either direction is the honest question: does the tooltip tell the reader anything
 * the element is not already showing them?
 */
function duplicateTitleOffenders(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>("[title]")]
    .filter((el) => {
      const title = (el.getAttribute("title") ?? "").trim();
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!title || !text) return false; // an icon-only control is exactly what `title` is FOR
      return text.includes(title) || title.includes(text);
    })
    .map((el) => `<${el.tagName.toLowerCase()} class="${el.className}" title="${el.getAttribute("title")}">`);
}

function renderShell() {
  return render(
    <ShellV2 items={ITEMS} activeId="home" onNavigate={() => {}} ledger={[]} rig="Ryzen 7 · RX 9070 XT">
      <p>Room content</p>
    </ShellV2>,
  );
}

describe("no native tooltip repeats text the shell already shows (#213 A4)", () => {
  it("leaves no element in the shell carrying a title it also renders", () => {
    const { container } = renderShell();
    expect(
      duplicateTitleOffenders(container),
      "a `title` that repeats the element's own visible text summons an unstyled OS tooltip to say " +
        "nothing new — remove the attribute, or give the element no visible text",
    ).toEqual([]);
  });

  it("still finds the rail items, so the check above cannot pass on an empty tree", () => {
    const { container } = renderShell();
    expect(container.querySelectorAll(".v2-nav-item").length).toBeGreaterThan(0);
  });

  it("does NOT object to the titlebar's icon-only buttons, which is what title is for", () => {
    const { container } = render(<WindowChrome />);
    expect(duplicateTitleOffenders(container)).toEqual([]);
    // The anti-vacuous half: those buttons really do carry titles, so the rule above is passing
    // because it is narrow, not because nothing was examined.
    expect(container.querySelectorAll("[title]").length).toBeGreaterThan(0);
  });
});

describe("the titlebar carries the app-name caption (literal parity, supersedes #213 A5)", () => {
  it("renders the small Compy caption beside the gear, as every approved comp draws it", () => {
    const { container } = render(<WindowChrome />);
    const caption = container.querySelector(".wc-title");
    expect(
      caption?.textContent ?? "",
      "the approved comps draw a small 'Compy' caption in the titlebar; the owner's literal-parity " +
        "instruction (2026-08-27) supersedes #213 A5's removal — losing it un-ships the approved picture",
    ).toMatch(/compy/i);
  });

  it("keeps the caption a label, not a control — no title attr for A4 to object to", () => {
    const { container } = render(<WindowChrome />);
    expect(container.querySelector(".wc-title")?.hasAttribute("title")).toBe(false);
  });

  it("keeps exactly one DESIGNED wordmark in the shell — the caption is plain text, not a second mark", () => {
    const { container } = renderShell();
    expect(container.querySelectorAll(".cmp-wordmark").length).toBe(1);
  });
});
