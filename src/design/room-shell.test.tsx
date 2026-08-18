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
