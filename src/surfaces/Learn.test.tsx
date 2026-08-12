import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import Learn from "./Learn";
import { AUTOPSY_MAX_CHARS } from "../data/knowledge-autopsy";

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

// Behavior parity with the classic Library (TweakEncyclopedia) — same cores, same copy, restyled.
const open = () => render(<Learn onClose={() => {}} />);
const searchBox = () => screen.getByLabelText("Search the knowledge library") as HTMLInputElement;
const title = ".lx-name"; // card titles (the same name can recur as a related chip)

describe("Learn surface (reskin)", () => {
  it("renders the Blackbook shell with type-filter chips", () => {
    open();
    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Terms" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tricks" })).toBeInTheDocument();
  });

  // bug→guard (self-review catch on the 2026-07-13 tooltip train): a deep-link (focusId — e.g. a
  // Term's "More in the Blackbook →") expanded the entry's category but never SCROLLED to the card:
  // the scroll effect's first run missed (category still collapsed ⇒ no cardRef), and without
  // `openCats` in its dependency array it never re-ran once the card actually rendered. Pin that a
  // focusId mount scrolls-into-view + flashes the focused card.
  it("a focusId deep-link scrolls the focused card into view and flashes it", () => {
    // Spy on HTMLElement.prototype — that's where src/test/setup.ts stubs it (an Element.prototype
    // spy would be shadowed and silently never see the call).
    const spy = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    try {
      render(<Learn onClose={() => {}} focusId="one-percent-lows" />);
      expect(spy).toHaveBeenCalled(); // the effect re-ran after the category expanded
      const flashed = document.querySelector(".lx-flash");
      expect(flashed).not.toBeNull(); // and it flashed the actual focused card
      expect(flashed!.textContent).toMatch(/1% low/i);
    } finally {
      spy.mockRestore();
    }
  });

  it("search narrows to matching entries (matcher unchanged)", async () => {
    open();
    fireEvent.change(searchBox(), { target: { value: "deep scan" } });
    expect(await screen.findByText("The fake deep scan", { selector: title })).toBeInTheDocument();
  });

  it("keeps the shipped honest empty state for an unknown term", async () => {
    open();
    fireEvent.change(searchBox(), { target: { value: "zxqwv" } });
    expect(await screen.findByText(/No entry for that yet/i)).toBeInTheDocument();
  });

  it("a type filter limits the visible card kinds", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Guides" }));
    expect(screen.getByText("Set up the VRR sync stack", { selector: title })).toBeInTheDocument();
    expect(screen.queryByText("XMP / EXPO memory profile", { selector: title })).not.toBeInTheDocument();
  });

  it("§7: pasting a bare YouTube link gets honest coaching — no fetch, grading disabled", () => {
    open();
    fireEvent.click(screen.getByRole("tab", { name: "Autopsy a guide" }));
    fireEvent.change(screen.getByLabelText("Paste a tweak guide to autopsy"), {
      target: { value: "https://www.youtube.com/watch?v=abc123" },
    });
    expect(screen.getByText(/Autopsy never opens or fetches one/i)).toBeInTheDocument();
    expect(screen.getByText(/Show transcript/i)).toBeInTheDocument(); // YouTube-specific path
    const grade = screen.getByRole("button", { name: "Grade this guide" }) as HTMLButtonElement;
    expect(grade.disabled).toBe(true);
  });

  it("§7: a webpage link coaches the copy-the-text path", () => {
    open();
    fireEvent.click(screen.getByRole("tab", { name: "Autopsy a guide" }));
    fireEvent.change(screen.getByLabelText("Paste a tweak guide to autopsy"), {
      target: { value: "https://example.com/best-gaming-tweaks-2026" },
    });
    expect(screen.getByText(/Ctrl\+A, Ctrl\+C/i)).toBeInTheDocument();
  });

  it("§7: a mixed paste (link + real text) still grades the text, ignoring the link", () => {
    open();
    fireEvent.click(screen.getByRole("tab", { name: "Autopsy a guide" }));
    fireEvent.change(screen.getByLabelText("Paste a tweak guide to autopsy"), {
      target: {
        value: "turn on game mode and force hpet from https://example.com to boost fps now please",
      },
    });
    expect(screen.queryByText(/Autopsy never opens or fetches one/i)).not.toBeInTheDocument();
    const grade = screen.getByRole("button", { name: "Grade this guide" }) as HTMLButtonElement;
    expect(grade.disabled).toBe(false);
  });

  it("the AMD undervolt guide is searchable and expands its rich advisory body in place (no apply button)", async () => {
    open();
    fireEvent.change(searchBox(), { target: { value: "undervolt" } });
    const card = (await screen.findByText(/Undervolt your Radeon/i, { selector: title }));
    // Expand the card in place (never teleports) — the foam-pit body is then visible.
    fireEvent.click(card.closest("button")!);
    expect(screen.getByText(/A "normal" number\?/i)).toBeInTheDocument(); // typical range, visible
    expect(screen.getByText(/silicon lottery/i)).toBeInTheDocument();
    expect(screen.getByText(/Discretion:/i)).toBeInTheDocument();
    expect(screen.getByText(/Compy never touches your voltage/i)).toBeInTheDocument();
    expect(screen.getByText(/Undo:/i)).toBeInTheDocument();
    // doorknob: advisory prose — there is nothing to apply (Compy never tunes for you).
    expect(screen.queryByRole("button", { name: /^Apply/i })).not.toBeInTheDocument();
    // "Show me the way" schematic is offered (the walkthrough resolves by the entry id).
    expect(screen.getByText("Show me the way")).toBeInTheDocument();
  });

  it("shows the full 'How we grade' key on first browse, then collapses it to a re-openable toggle", () => {
    // First-ever browse: the full key is on the page (foam-pit), and the visit is recorded.
    open();
    expect(screen.getByRole("group", { name: "How we grade" })).toBeInTheDocument();
    expect(localStorage.getItem("compy_blackbook_gradekey_seen_v1")).toBe("1");
    cleanup();
    // A later browse opens collapsed: only the quiet toggle, no full key — until the reader re-opens it.
    open();
    expect(screen.queryByRole("group", { name: "How we grade" })).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /How we grade/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("group", { name: "How we grade" })).toBeInTheDocument();
  });

  it("shows only the entry's grading key while the How-we-grade card is expanded", async () => {
    localStorage.setItem("compy_blackbook_gradekey_seen_v1", "1");
    open();
    expect(document.querySelector(".lx-gradekey-toggle")).not.toBeNull();

    fireEvent.change(searchBox(), { target: { value: "How Compy grades things" } });
    const titleEl = await screen.findByText(/How Compy grades things/i, { selector: title });
    const card = titleEl.closest<HTMLElement>('[data-kl-id="how-we-grade"]')!;
    fireEvent.click(card.querySelector<HTMLButtonElement>(".lx-card-head")!);

    expect(card.classList.contains("lx-card-open")).toBe(true);
    expect(document.querySelector(".lx-gradekey-toggle")).toBeNull();
    expect(document.querySelectorAll(".lx-gradekey")).toHaveLength(1);

    fireEvent.click(card.querySelector<HTMLButtonElement>(".lx-card-head")!);
    expect(document.querySelector(".lx-gradekey-toggle")).not.toBeNull();
  });

  it("labels the verdict-filter row so it doesn't read as a second type filter", () => {
    open();
    // Grade/Topic/Fits are power-user axes collapsed behind "More filters" by default — expand first.
    expect(screen.queryByText("Grade:")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /More filters/ }));
    expect(screen.getByText("Grade:")).toBeInTheDocument();
  });

  it("a quiet Autopsy signpost in browse switches to the Autopsy mode", () => {
    open();
    const hint = screen.getByRole("button", { name: /Got a guide to fact-check\? Try Autopsy/i });
    fireEvent.click(hint);
    // We're now in Autopsy mode — the paste box is present and the signpost is gone (autopsy-only off).
    expect(screen.getByLabelText("Paste a tweak guide to autopsy")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Got a guide to fact-check/i }),
    ).not.toBeInTheDocument();
  });

  it("autopsy grades a guide, expands rows in place, and offers a full-entry link (continuity §3)", () => {
    open();
    fireEvent.click(screen.getByRole("tab", { name: "Autopsy a guide" }));
    fireEvent.change(screen.getByLabelText("Paste a tweak guide to autopsy"), {
      target: { value: "turn on game mode\nforce hpet\nset core parking off\nrun a deep scan\nfrobnicate the doohickey" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grade this guide" }));
    expect(screen.getByText("1 real")).toBeInTheDocument();
    expect(screen.getByText("1 risky")).toBeInTheDocument();
    expect(screen.getByText("1 placebo")).toBeInTheDocument();
    expect(screen.getByText("1 thing we don't recognize")).toBeInTheDocument();
    expect(screen.getByText(/known scam pattern/i)).toBeInTheDocument();
    // The sticky context header reports the read-through.
    expect(screen.getByText(/claims? graded/i)).toBeInTheDocument();
    // Clicking a graded row expands IN PLACE — the autopsy stays (paste box remains), no redirect.
    const hitRow = screen.getByRole("button", { name: /Windows Game Mode/i });
    fireEvent.click(hitRow);
    expect(screen.getByText(/Open full entry/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Paste a tweak guide to autopsy")).toBeInTheDocument();
    const hit = hitRow.closest("li")!;
    expect(hitRow.querySelectorAll(".lx-verdict")).toHaveLength(1);
    expect(hit.querySelector(".lx-hit-detail .lx-row .lx-verdict")).toBeNull();
    expect(hit.querySelectorAll(".lx-verdict")).toHaveLength(1);
    // The quiet full-entry link is the only deliberate travel into the library.
    fireEvent.click(screen.getByText(/Open full entry/i));
    expect(screen.getByLabelText("Search the knowledge library")).toBeInTheDocument();
    expect(
      document.querySelector('[data-kl-id="game-mode"] .lx-card-body .lx-row .lx-verdict'),
    ).not.toBeNull();
  });

  it("an over-cap paste reports the SAME char count it actually graded (no hardcoded drift)", () => {
    // bug->guard: the truncation note must use AUTOPSY_MAX_CHARS — the single source the scan truncates
    // by — not a hardcoded literal. A drifted literal would tell the user we graded more (or fewer)
    // characters than we did, an honesty/accuracy violation. Pinning the rendered number to the imported
    // constant catches any re-hardcoded value (or a constant change the note fails to follow).
    open();
    fireEvent.click(screen.getByRole("tab", { name: "Autopsy a guide" }));
    const overCap = "force hpet\n" + "x".repeat(AUTOPSY_MAX_CHARS + 50); // exceeds the grading cap
    fireEvent.change(screen.getByLabelText("Paste a tweak guide to autopsy"), {
      target: { value: overCap },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grade this guide" }));
    expect(
      screen.getByText(new RegExp(`first ${AUTOPSY_MAX_CHARS.toLocaleString()} characters`)),
    ).toBeInTheDocument();
  });
});
