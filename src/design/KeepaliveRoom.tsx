import type { ReactNode } from "react";
import { RoomActiveContext } from "../data/use-room-active";

// A room that is HIDDEN rather than unmounted when you leave it.
//
// Optimize is the one room worth keeping warm: it used to live in a branch that unmounted on every
// trip to Home, so coming back re-mounted the heavy Check+Fix tree and re-fired Check's on-mount
// scan — the profiled Optimize-enter hitch. Mounted once and toggled with `display: none`,
// returning is free.
//
// The bargain has a second half that is easy to forget: a hidden room's effects keep running.
// Timers don't stop, and `useDocumentVisible` is no help — the WINDOW is visible, only the room
// isn't. So the hiding div and the RoomActiveContext provider ship together, in here, rather than
// being paired by hand at each call site. One `active` prop drives both; there is no way to hide a
// room and forget to tell it. (CSS animations need no gate — a `display: none` ancestor generates
// no boxes, so they're already free. JS timers are what survive, which is why the signal exists.)
export function KeepaliveRoom({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <RoomActiveContext.Provider value={active}>
      <div style={active ? undefined : { display: "none" }}>{children}</div>
    </RoomActiveContext.Provider>
  );
}
