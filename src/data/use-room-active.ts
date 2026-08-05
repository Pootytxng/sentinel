import { createContext, useContext } from "react";

// Is the subtree I'm in the room the user is actually LOOKING at?
//
// This exists because of the Optimize keepalive (App.tsx). Optimize is mounted once and then kept
// alive behind `display: none` for the rest of the session — a deliberate perf win (returning is a
// display toggle instead of a re-mount + re-scan). The cost is that "unmounted" stopped being the
// signal a room-scoped timer could rely on: a component in a hidden room still has running effects,
// and `useDocumentVisible` reads TRUE the whole time, because the WINDOW is perfectly visible. Only
// the room isn't.
//
// So this is the second half of the idle-cost pair, and the two are not interchangeable:
//   useDocumentVisible() — can the user see this WINDOW? (minimized, alt-tabbed into a game)
//   useRoomActive()      — can the user see this ROOM?   (kept alive behind display:none)
// Continuous work — an animation loop, a poll — should stand down when EITHER is false.
//
// Default TRUE: a subtree with no provider is being rendered normally, so the honest answer is
// "yes, you're on screen". A default that fails OPEN is the safe one for a UI signal — but it means
// a keepalive that forgot its provider goes wrong silently. So nobody hand-pairs them: the hiding
// div and the provider ship as one component, `src/design/KeepaliveRoom.tsx`, and
// `src/keepalive-idle-guard.test.ts` fails the build if a raw hand-rolled keepalive reappears.
export const RoomActiveContext = createContext(true);

export function useRoomActive(): boolean {
  return useContext(RoomActiveContext);
}
