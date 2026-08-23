import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { RoomShell, ForwardDoor, DOOR_MAP, doorFor } from "./room-shell";
import { ShellV2 } from "./ShellV2";
import { railFor } from "./homeRail";

// RoomShell guards (V2-2 — re-scoping the P6 journey spec onto the V2 shell, bug→guard tier 1):
// the door map is pinned LITERALLY so a copy/destination drift fails CI; the slot order is fixed
// (verdict → primaryAction → body → quiet → door); Lab gets NO door; doors navigate through the
// same handler the rail uses (the V2Nav context ShellV2 provides).

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) =>
    cmd === "get_build_stamp" ? Promise.resolve("ab12cd3 · dev") : Promise.resolve(null),
}));

afterEach(cleanup);

describe("DOOR_MAP — the journey pinned literally (P6 spec table)", () => {
  it("matches the spec: Home→Optimize, Optimize→Monitor, Monitor→Blackbook, Blackbook→Lab, Lab none", () => {
    expect(DOOR_MAP).toEqual({
      home: { to: "fix", label: "Find what's worth fixing" },
      fix: { to: "play", label: "Watch it live" },
      play: { to: "learn", label: "See what changed" },
      learn: { to: "lab", label: "Open the instruments" },
      lab: null,
      check: null,
    });
  });
});

describe("doorFor — the ground-aware door (proving-ground rail, 2026-07-10 flip)", () => {
  it("ground: home's door leads to the Lab (the Optimize station's room), same invitation", () => {
    expect(doorFor("home", true)).toEqual({ to: "lab", label: "Find what's worth fixing" });
  });

  it("ground: every other room keeps its DOOR_MAP entry; Lab stays doorless", () => {
    for (const room of ["fix", "play", "learn", "lab", "check"] as const) {
      expect(doorFor(room, true), `room ${room}`).toEqual(DOOR_MAP[room]);
    }
  });

  it("classic ('0' failsafe): doorFor is DOOR_MAP verbatim for every room", () => {
    for (const room of ["home", "fix", "play", "learn", "lab", "check"] as const) {
      expect(doorFor(room, false), `room ${room}`).toEqual(DOOR_MAP[room]);
    }
  });
});

describe("RoomShell — one skeleton, five slots, fixed order", () => {
  const renderFull = () =>
    render(
      <RoomShell
        room="home"
        verdict="Your PC is healthy."
        sub="2 small wins available"
        measured="last full check 14 min ago"
        primaryAction={<button>Apply</button>}
        quiet={<button className="v2-quiet">Nothing else needs attention</button>}
      >
        <div data-testid="body">room content</div>
      </RoomShell>,
    );

  it("renders slots in fixed DOM order: verdict → primaryAction → body → quiet → door", () => {
    const { container } = renderFull();
    const order = [
      container.querySelector(".v2-verdict h1"),
      container.querySelector(".v2-verdict-action"),
      container.querySelector(".v2-room-body"),
      container.querySelector(".v2-quiet-slot"),
      container.querySelector(".v2-door"),
    ];
    for (const el of order) expect(el).toBeTruthy();
    for (let i = 0; i < order.length - 1; i++) {
      // eslint-disable-next-line no-bitwise
      expect(
        order[i]!.compareDocumentPosition(order[i + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING,
        `slot ${i} must precede slot ${i + 1}`,
      ).toBeTruthy();
    }
  });

  it("exactly ONE verdict line and ONE forward door per room", () => {
    const { container } = renderFull();
    expect(container.querySelectorAll(".v2-verdict h1").length).toBe(1);
    expect(container.querySelectorAll(".v2-door").length).toBe(1);
  });

  // V2-8 (P6 §2 placement): a room may CLOSE its door while its chapter is unfinished —
  // Optimize until all-clear, Monitor during a live capture. Default stays open, and the
  // destination/label still come from DOOR_MAP alone.
  it("doorOpen={false} hides the door; doorOpen={true} and the default both show it", () => {
    for (const [props, doors] of [
      [{ doorOpen: false }, 0],
      [{ doorOpen: true }, 1],
      [{}, 1],
    ] as const) {
      const { container, unmount } = render(
        <RoomShell room="fix" verdict="v" {...props}>
          <div>body</div>
        </RoomShell>,
      );
      expect(container.querySelectorAll(".v2-door").length, JSON.stringify(props)).toBe(doors);
      unmount();
    }
  });

  it("Lab (last chapter) renders NO door; the legacy check room renders none either", () => {
    for (const room of ["lab", "check"] as const) {
      const { container, unmount } = render(
        <RoomShell room={room} verdict="v">
          <div>body</div>
        </RoomShell>,
      );
      expect(container.querySelectorAll(".v2-door").length, `room ${room}`).toBe(0);
      unmount();
    }
  });

  it("optional slots absent → nothing rendered for them (no empty chrome)", () => {
    const { container } = render(
      <RoomShell room="lab" verdict="v">
        <div>body</div>
      </RoomShell>,
    );
    expect(container.querySelector(".v2-verdict-action")).toBeNull();
    expect(container.querySelector(".v2-measured")).toBeNull();
    expect(container.querySelector(".v2-quiet-slot")).toBeNull();
  });
});

describe("ForwardDoor — navigates via the rail handler, labels from the rail", () => {
  it("clicking the door navigates through the ShellV2 nav context (never a parallel path)", () => {
    const onNavigate = vi.fn();
    render(
      <ShellV2
        items={railFor(true)}
        activeId="home"
        onNavigate={onNavigate}
        ledgerCount={3}
       
      >
        <ForwardDoor to="fix" label="Find what's worth fixing" />
      </ShellV2>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Find what's worth fixing/ }));
    expect(onNavigate).toHaveBeenCalledWith("fix");
  });

  it("the arrow names the destination by its CURRENT rail label (merged: fix → 'Optimize')", () => {
    render(
      <ShellV2
        items={railFor(true)}
        activeId="home"
        onNavigate={() => {}}
        ledgerCount={0}
       
      >
        <ForwardDoor to="fix" label="Find what's worth fixing" />
      </ShellV2>,
    );
    expect(screen.getByText("→ Optimize")).toBeTruthy();
  });
});

// ── THE SPLIT — approved four-room visual direction (issue #49, 2026-08-22) ──────────────
// The split is opt-in and DERIVED: supplying an evidence column is the only way a room gets the
// geometry. These guards pin the two properties the whole slice rests on — a room that does not
// supply one is byte-identical to before, and a room that does keeps the fixed slot order with
// the story still ahead of the instrument panel in reading order.
describe("RoomShell split layout — the evidence column (issue #49)", () => {
  it("no aside → NO data-layout attribute and no split elements (non-split DOM unchanged)", () => {
    const { container } = render(
      <RoomShell room="lab" verdict="v">
        <div>body</div>
      </RoomShell>,
    );
    const room = container.querySelector(".v2-room")!;
    expect(room.hasAttribute("data-layout")).toBe(false);
    expect(container.querySelector(".v2-room-aside")).toBeNull();
    expect(container.querySelector(".v2-room-below")).toBeNull();
  });

  it("aside supplied → data-layout='split' and the evidence column renders its content", () => {
    const { container } = render(
      <RoomShell room="home" verdict="v" aside={<div>the rig</div>}>
        <div>body</div>
      </RoomShell>,
    );
    const room = container.querySelector(".v2-room")!;
    expect(room.getAttribute("data-layout")).toBe("split");
    expect(container.querySelector(".v2-room-aside")!.textContent).toBe("the rig");
  });

  it("`below` alone does NOT trigger the split — the evidence column is the only trigger", () => {
    const { container } = render(
      <RoomShell room="home" verdict="v" below={<div>under</div>}>
        <div>body</div>
      </RoomShell>,
    );
    expect(container.querySelector(".v2-room")!.hasAttribute("data-layout")).toBe(false);
    expect(container.querySelector(".v2-room-below")!.textContent).toBe("under");
  });

  it("every slot present → fixed document order, narrative BEFORE the instrument panel", () => {
    const { container } = render(
      <RoomShell
        room="home"
        notice={<div>notice</div>}
        verdict="v"
        sub="s"
        measured="m"
        primaryAction={<button>go</button>}
        quiet={<button className="v2-quiet">q</button>}
        aside={<div>rig</div>}
        below={<div>under</div>}
      >
        <div>body</div>
      </RoomShell>,
    );
    const room = container.querySelector(".v2-room")!;
    expect([...room.children].map((el) => el.className)).toEqual([
      "v2-notice-slot",
      "v2-verdict",
      "v2-measured",
      "v2-room-body",
      "v2-quiet-slot",
      "v2-room-aside",
      "v2-room-below",
      "v2-door",
    ]);
  });

  it("split geometry is token-driven — the column template references --v2-aside, never a px", () => {
    const css = readFileSync(join("src", "design", "shell-v2.css"), "utf8");
    const block = css.slice(css.indexOf('.v2-room[data-layout="split"] {'));
    const template = block.slice(0, block.indexOf("}"));
    expect(template).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, var(--v2-aside))");
    expect(readFileSync(join("src", "design", "tokens-v2.css"), "utf8")).toContain("--v2-aside:");
  });
});
