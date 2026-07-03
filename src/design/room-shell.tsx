// RoomShell (V2-2, re-scoping the P6 journey spec onto the V2 shell) — ONE skeleton every room
// composes, five slots in FIXED order: verdict → primaryAction → body → quiet → forward door.
// The rail already reads in story order (Home → Optimize → Monitor → Blackbook → Lab); the door
// makes that order *felt*: one quiet forward door per room, none in Lab (the last chapter — a
// loop-back door would teach circles, not order). Rooms migrate onto this in V2-3..V2-7.
//
// Slot contracts (P6 spec, test-pinned in room-shell.test.tsx):
//   verdict       ONE plain-English line, measured facts only (honesty law). Required.
//   primaryAction ONE affordance, never two. Optional.
//   children      the room body (ranked list / room content). Required.
//   quiet         the "nothing else needs attention" expander. Optional.
//   door          derived from DOOR_MAP by room id — rooms cannot pick their own destination.
//   doorOpen      P6 §2 placement rules (V2-8): a room may CLOSE its door while its chapter is
//                 unfinished — Optimize opens it only in the apply-complete/all-clear state (the
//                 door is the reward for finishing, not a bypass); Monitor closes it during a
//                 live capture session. Rooms still never pick the destination or label.
import type { ReactNode } from "react";
import type { HomeRailId } from "./homeRail";
import { useV2Nav } from "./ShellV2";

// The journey door map — copy + destinations are the P6 spec table, pinned literally by
// room-shell.test.tsx so a copy/destination drift fails CI. Keyed by rail id (home/fix/play/
// learn are the persisted nav keys for Home/Optimize/Monitor/Blackbook).
export const DOOR_MAP: Record<HomeRailId, { to: HomeRailId; label: string } | null> = {
  home: { to: "fix", label: "Find what's worth fixing" },
  fix: { to: "play", label: "Watch it live" },
  play: { to: "learn", label: "See what changed" },
  learn: { to: "lab", label: "Open the instruments" },
  lab: null, // last chapter — the rail is the way home
  check: null, // legacy escape-hatch room (merge-off only) — outside the journey, no door
};

// The forward door: quiet chrome (text + arrow, no accent fill — a doorknob, not a CTA), and it
// navigates via the SAME rail handler (V2Nav context) — navigation never teleports.
export function ForwardDoor({ to, label }: { to: HomeRailId; label: string }) {
  const nav = useV2Nav();
  return (
    <button type="button" className="v2-door" onClick={() => nav.navigate(to)}>
      {label}
      <span className="v2-door-arrow" aria-hidden="true">→ {nav.labelFor(to)}</span>
    </button>
  );
}

export function RoomShell({
  room,
  verdict,
  sub,
  measured,
  primaryAction,
  quiet,
  doorOpen = true,
  children,
}: {
  room: HomeRailId;
  verdict: ReactNode;
  sub?: ReactNode;
  measured?: ReactNode;
  primaryAction?: ReactNode;
  quiet?: ReactNode;
  /** P6 §2 placement: false hides the room's door while its chapter is unfinished. Default open. */
  doorOpen?: boolean;
  children: ReactNode;
}) {
  const door = doorOpen ? DOOR_MAP[room] : null;
  return (
    <section className="v2-room" data-room={room}>
      <header className="v2-verdict">
        <h1>{verdict}</h1>
        {sub != null && <span className="v2-verdict-sub">{sub}</span>}
        {primaryAction != null && <div className="v2-verdict-action">{primaryAction}</div>}
      </header>
      {measured != null && <div className="v2-measured">{measured}</div>}
      <div className="v2-room-body">{children}</div>
      {quiet != null && <div className="v2-quiet-slot">{quiet}</div>}
      {door && <ForwardDoor to={door.to} label={door.label} />}
    </section>
  );
}
