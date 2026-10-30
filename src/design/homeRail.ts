// The six-home rail — THE single source of truth for the app's primary navigation (one-rail pass §1).
// The app-shell rail renders from this list, so a private second map can't drift (the rail-parity
// guard test asserts this list stays the blessed set/order/labels).
// Settings is a separate gear at the bottom of the rail; Export is a header action — neither lives here.

export type HomeRailId = "home" | "games" | "problems" | "check" | "play" | "fix" | "learn" | "lab";

export type HomeRailItem = { id: HomeRailId; label: string; icon: string };

export const HOME_RAIL: HomeRailItem[] = [
  // Label "Health" (owner rename 2026-08-19; previously "Home"): UX-1 decision ① third clause —
  // the front door must answer a question ("is my PC OK?"), and "Home" answered none. "Diagnosis"
  // was offered and not chosen: it frames the machine as already broken, the same fear frame that
  // retired "Fix" in 2026-06. Id stays "home" — the persisted nav key, same rule as every rename
  // below. THE SHIPPED LABEL IS `common.rail.home`; this literal is its English source and
  // `rail-label-locale-guard.test.ts` fails the build if the two ever disagree.
  { id: "home", label: "Health", icon: "gauge" },
  // THE TWO FLAGSHIP JOURNEYS GET THEIR OWN DOORS (glass redesign, owner decision 2026-10-30).
  // Constitution: MAKE THIS PC BETTER and FIGURE OUT WHAT WENT WRONG are equal and neither is
  // subordinate. Games is where "better" starts (per game, from real sessions); Problems is where
  // "what went wrong" starts (Crash & Freeze Rescue, promoted out of the Test room's dock).
  { id: "games", label: "Games", icon: "games" },
  { id: "problems", label: "Problems", icon: "problems" },
  { id: "check", label: "Check", icon: "check" },
  // Label "Live" (owner rename 2026-08-12; previously "Monitor" 2026-06-15): the room is live
  // monitoring + session debriefs. The id stays "play" — it's the persisted nav key (location
  // history / parity guard); renaming the id would orphan stored history for zero user value.
  { id: "play", label: "Live", icon: "monitor" },
  // Label "Tune" (owner-approved 2026-06-12, naming-proposals B3): "Fix" framed the PC as broken —
  // a fear frame the doctrine retired. The id stays "fix": it's the persisted nav key (location
  // history / parity guard) — renaming the id would orphan stored history for zero user value.
  { id: "fix", label: "Tune", icon: "fix" },
  // Label "History" (owner rename 2026-08-12; previously "Blackbook" 2026-06-12): the doorknob
  // descriptor lives in the room header ("what actually works — measured"). Id stays "learn".
  { id: "learn", label: "History", icon: "learn" },
  // Label "Test" (owner rename 2026-08-12; previously "Lab"). Id stays "lab" — persisted nav key.
  { id: "lab", label: "Test", icon: "lab" },
];

// railFor — THE single source for the rendered rail (the app-shell rail and the Home console's
// room dock both resolve through it). When the Optimize merge (phase 1a) is off, this is
// HOME_RAIL verbatim (the blessed six-home set). When on, Check + Tune collapse into ONE room: the
// standalone `check` entry drops and the `fix` entry is relabeled "Optimize" AND moves into Check's
// slot (position 2) — the spec order Health · Optimize · Live · History · Test (5), keeping the
// diagnose-first surface near the top where Check was. The id stays "fix" (the persisted nav key —
// location history and routing are untouched). Pure: no DOM/localStorage reads here.
//
// `ground` (the Lab proving-ground merge, owner decision 2026-07-10 — ships WITH the
// compy_lab_ground default-ON flip): the standalone Optimize room drops from the rail entirely —
// the Lab's Optimize station is the ONE door to the safe-tweak toggles. Rail = Health · Live ·
// History · Test (4), relative order preserved so the Lab stays the last chapter (no reorder,
// no new door — smallest visual delta from the shipped rail). Ground wins over `merged`; the
// classic rails stay reachable via the compy_lab_ground="0" failsafe.
export function railFor(merged: boolean, ground = false): HomeRailItem[] {
  if (ground) return HOME_RAIL.filter((r) => r.id !== "check" && r.id !== "fix");
  if (!merged) return HOME_RAIL;
  const out: HomeRailItem[] = [];
  for (const r of HOME_RAIL) {
    if (r.id === "check") continue; // collapsed into the merged room
    if (r.id === "fix") continue; // re-inserted at Check's slot below
    out.push(r);
    if (r.id === "home") {
      const fix = HOME_RAIL.find((x) => x.id === "fix")!;
      out.push({ ...fix, label: "Optimize" }); // Optimize takes the slot Check held (position 2)
    }
  }
  return out;
}

// railGroups — the rail's HIERARCHY (design foundation ⑤ "instruments behind a door",
// docs/decisions/2026-08-11-design-foundation.md decision 6). Health is the front door: the room
// that answers "is my PC OK?". Live · History · Test are instruments — they stay, one step away,
// under their own sign, and stop being four equal doors a first-time user has to choose between.
// Grouping, not hiding: every instrument stays rendered, clickable and digit-addressable (the
// 2026-08-06 directive bars a hide-behind-a-toggle). Pure; order within each group is rail order.
export type RailGroups = { door: HomeRailItem[]; instruments: HomeRailItem[] };

// The door group is the front door plus the two flagship journeys (glass redesign 2026-10-30);
// Live · History · Test stay the instruments, one step away under their own sign.
const DOOR_IDS: HomeRailId[] = ["home", "games", "problems"];

export function railGroups(items: HomeRailItem[]): RailGroups {
  return {
    door: items.filter((r) => DOOR_IDS.includes(r.id)),
    instruments: items.filter((r) => !DOOR_IDS.includes(r.id)),
  };
}
