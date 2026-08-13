// FOLLOW-THROUGH GUARD for the popout (owner, 2026-08-11: "bring forward a popout template in the
// forground of the app itself ... whilst all still keeping it within the app").
//
// Sheet.tsx implements a full modal contract — Escape, an Escape stand-down when a ConfirmDialog is
// on top, a focus trap, focus restore to the opening tile, backdrop-click-to-close, ARIA, and a
// `data-sheet` flag on <html> that dims the whole app. It shipped with **none of it tested**. The
// only test in src/design/bento/ was a static text scan of grid spans that never renders anything.
//
// That is a live inconsistency with this repo's own precedent: `ConfirmDialog.test.tsx` pins Escape
// AND the Escape trap explicitly, with a bug->guard comment naming the leak it was written from.
// The Sheet duplicates that exact trap logic — its source even cites ConfirmDialog as its reasoning
// — and inherited none of the guards. Everything works today. Nothing stopped it breaking tomorrow:
// any edit to Home could kill Escape, the focus trap, focus restore, or the dim-cleanup with the
// full suite green.
//
// The dim-cleanup is the one worth naming twice. `data-sheet="open"` greys out `.v2-shell` and sets
// `pointer-events: none` on it. If a sheet ever unmounts without removing that attribute, the user
// is left with an app that is visibly dimmed and accepts no clicks, with no sheet on screen to
// close. That is an unrecoverable-looking state from one missed cleanup.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { Sheet } from "./Sheet";

beforeAll(() => {
  document.documentElement.setAttribute("data-v2", "on");
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.sheet;
  document.querySelectorAll(".cmp-confirm-backdrop").forEach((n) => n.remove());
});

// jsdom runs no layout, so `offsetParent` is null for EVERY element. The Sheet's focus trap filters
// its candidates by `offsetParent !== null` (the standard "is it actually visible" test), so under
// jsdom that filter collapses the trap's candidate list to a single element and the wrap can never
// be observed — the trap looks broken when it is not. Modelling a real browser's offsetParent is
// what makes the trap testable at all; without this the two wrap tests below are untestable and
// would have been quietly dropped, which is how this contract went unguarded in the first place.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get(this: HTMLElement) {
      return this.closest(".v2-sheet") ? this.parentElement : null;
    },
  });
});

const panel = () => document.querySelector(".v2-sheet") as HTMLElement | null;
const backdrop = () => document.querySelector(".v2-sheet-backdrop") as HTMLElement | null;
const closeBtn = () => document.querySelector(".v2-sheet-close") as HTMLButtonElement | null;

function open(props: Partial<React.ComponentProps<typeof Sheet>> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const r = render(
    <Sheet title="Parts you added" onClose={onClose} {...props}>
      <button type="button">first</button>
      <button type="button">middle</button>
      <button type="button">last</button>
    </Sheet>,
  );
  return { ...r, onClose: onClose as ReturnType<typeof vi.fn> };
}

describe("the sheet stays INSIDE the app (the owner's actual ask)", () => {
  it("portals to <body> rather than rendering inside its mount point", () => {
    // Not decoration: the dim is applied to .v2-shell, so a sheet rendered inside the shell would
    // dim itself along with the room it is supposed to be sitting in front of.
    const { container } = open();
    expect(container.querySelector(".v2-sheet"), "the sheet rendered inside the shell").toBeNull();
    expect(panel(), "the sheet is not in the document at all").not.toBeNull();
    expect(document.body.contains(panel()!)).toBe(true);
  });

  it("announces itself as a modal dialog named by its title", () => {
    open({ title: "Crash & Freeze Rescue" });
    expect(panel()!.getAttribute("role")).toBe("dialog");
    expect(panel()!.getAttribute("aria-modal")).toBe("true");
    expect(panel()!.getAttribute("aria-label")).toBe("Crash & Freeze Rescue");
  });
});

describe("the dim flag is set AND cleaned up", () => {
  it("marks <html> while open", () => {
    open();
    expect(document.documentElement.dataset.sheet).toBe("open");
  });

  it("REMOVES the mark on unmount — a stale flag leaves the app dimmed and unclickable forever", () => {
    const { unmount } = open();
    expect(document.documentElement.dataset.sheet).toBe("open");
    unmount();
    expect(
      document.documentElement.dataset.sheet,
      "the app is still flagged dimmed with no sheet on screen — nothing on screen can clear this",
    ).toBeUndefined();
  });
});

describe("keyboard: trapped, not shared", () => {
  it("Escape closes", () => {
    const { onClose } = open();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape STANDS DOWN when a ConfirmDialog is open on top", () => {
    // Without this, confirming a mutation from inside a sheet and pressing Escape closes the sheet
    // out from under the dialog instead of cancelling the dialog — the user loses the panel AND
    // still has a pending confirm.
    const { onClose } = open();
    const confirm = document.createElement("div");
    confirm.className = "cmp-confirm-backdrop";
    document.body.appendChild(confirm);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose, "the sheet stole Escape from the dialog above it").not.toHaveBeenCalled();
  });

  it("focus lands on the close button when it opens", () => {
    open();
    expect(document.activeElement).toBe(closeBtn());
  });

  it("Tab from the last focusable wraps to the first (trap holds forward)", () => {
    open();
    const f = Array.from(panel()!.querySelectorAll("button")) as HTMLElement[];
    const last = f[f.length - 1];
    act(() => last.focus());
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement, "Tab escaped the sheet into the room behind it").toBe(f[0]);
  });

  it("Shift+Tab from the first focusable wraps to the last (trap holds backward)", () => {
    open();
    const f = Array.from(panel()!.querySelectorAll("button")) as HTMLElement[];
    act(() => f[0].focus());
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement, "Shift+Tab escaped the sheet").toBe(f[f.length - 1]);
  });

  it("returns focus to the element that opened it", () => {
    // A modal that drops focus on the body sends a keyboard user back to the top of the document —
    // they lose their place in the room entirely.
    const opener = document.createElement("button");
    opener.textContent = "See all parts";
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = open();
    expect(document.activeElement).toBe(closeBtn());
    unmount();
    expect(document.activeElement, "focus was dropped instead of returned to the tile").toBe(opener);
    opener.remove();
  });
});

describe("pointer: the backdrop closes, the panel does not", () => {
  it("clicking the backdrop closes", () => {
    const { onClose } = open();
    fireEvent.click(backdrop()!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking INSIDE the panel does not close it", () => {
    // The bug this prevents is the worst kind: the user is mid-interaction inside the panel, clicks
    // a control, and the whole thing vanishes.
    const { onClose } = open();
    fireEvent.click(panel()!);
    expect(onClose, "a click inside the panel closed it").not.toHaveBeenCalled();
  });

  it("the close button closes", () => {
    const { onClose } = open();
    fireEvent.click(closeBtn()!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// POPOUT CONVERGENCE (2026-08-13). Fix.tsx's hand-rolled apply-all consent popout was deleted onto
// this component, and it had exactly one behaviour the Sheet did not: while the batch it asked
// consent for is actually running, it cannot be dismissed. It enforced that by hand in two separate
// places — a `!batching` check inside its own Escape listener and another inside its backdrop
// onClick — which is precisely the shape of a rule that survives one edit and not the next.
//
// It is now `dismissible`, and it is guarded here rather than in the room, because the room can no
// longer break it and this component can. THE FAILURE IT PREVENTS: a user approves "apply all",
// the batch starts writing to their machine, and a stray Escape or a click on the scrim removes the
// only panel that says what is being applied — while the applying continues underneath.
describe("dismissible=false: a sheet mid-mutation refuses to be dismissed", () => {
  it("Escape does NOT close", () => {
    const { onClose } = open({ dismissible: false });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose, "Escape dismissed a sheet that was mid-apply").not.toHaveBeenCalled();
  });

  it("a backdrop click does NOT close", () => {
    const { onClose } = open({ dismissible: false });
    fireEvent.click(backdrop()!);
    expect(onClose, "the scrim dismissed a sheet that was mid-apply").not.toHaveBeenCalled();
  });

  it("the close button is DISABLED, not merely inert — no control that does nothing", () => {
    const { onClose } = open({ dismissible: false });
    expect(closeBtn()!.disabled).toBe(true);
    fireEvent.click(closeBtn()!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("still SWALLOWS Escape — an undismissible sheet keeps owning the keyboard", () => {
    // If the key leaked instead, a background window handler would act on an Escape aimed at a
    // modal that is deliberately refusing it — the worst of both behaviours. Dispatched from
    // document.body, exactly as ConfirmDialog.test.tsx pins its own trap: an event targeted AT
    // window fires that window's listeners in registration order regardless of capture, so it
    // cannot show a capture-phase trap at all.
    const bg = vi.fn();
    window.addEventListener("keydown", bg);
    try {
      open({ dismissible: false });
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(bg, "Escape leaked past an undismissible sheet to a background handler").not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", bg);
    }
  });

  it("all three dismissals come back when it flips true again (it is a state, not a mode)", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Sheet title="Apply these 2 changes to your rig?" onClose={onClose} dismissible={false}>
        <button type="button">only</button>
      </Sheet>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    rerender(
      <Sheet title="Apply these 2 changes to your rig?" onClose={onClose} dismissible>
        <button type="button">only</button>
      </Sheet>,
    );
    expect(closeBtn()!.disabled).toBe(false);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(backdrop()!);
    fireEvent.click(closeBtn()!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("defaults to dismissible — every existing sheet keeps closing without opting in", () => {
    const { onClose } = open();
    expect(closeBtn()!.disabled).toBe(false);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("it survives the states a real room hands it", () => {
  it("renders with no origin rect (opened by keyboard, not by a measured tile click)", () => {
    expect(() => open({ origin: null })).not.toThrow();
    expect(panel()).not.toBeNull();
  });

  it("renders a footer only when given one", () => {
    open();
    expect(document.querySelector(".v2-sheet-foot")).toBeNull();
    cleanup();
    open({ footer: <button type="button">Apply</button> });
    expect(document.querySelector(".v2-sheet-foot")).not.toBeNull();
  });

  it("renders the sub-line only when given one", () => {
    open();
    expect(document.querySelector(".v2-sheet-sub")).toBeNull();
    cleanup();
    open({ sub: "what this panel is for" });
    expect(document.querySelector(".v2-sheet-sub")?.textContent).toBe("what this panel is for");
  });
});
