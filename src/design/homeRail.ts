// The six-home rail — THE single source of truth for the app's primary navigation (one-rail pass §1).
// Both the CommandCenter rail and the app-shell rail render from this list, so they're identical by
// construction (the rail-parity guard test asserts this list stays the blessed set/order/labels).
// Settings is a separate gear at the bottom of the rail; Export is a header action — neither lives here.

export type HomeRailId = "home" | "check" | "play" | "fix" | "learn" | "lab";

export const HOME_RAIL: { id: HomeRailId; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "gauge" },
  { id: "check", label: "Check", icon: "check" },
  // Label "Monitor" + a pulse glyph (owner rename 2026-06-15): the room is live monitoring + session
  // debriefs, so "Play" undersold it. The id stays "play" — it's the persisted nav key (location
  // history / parity guard); renaming the id would orphan stored history for zero user value.
  { id: "play", label: "Monitor", icon: "monitor" },
  // Label "Tune" (owner-approved 2026-06-12, naming-proposals B3): "Fix" framed the PC as broken —
  // a fear frame the doctrine retired. The id stays "fix": it's the persisted nav key (location
  // history / parity guard) — renaming the id would orphan stored history for zero user value.
  { id: "fix", label: "Tune", icon: "fix" },
  // Label "Blackbook" (owner-approved 2026-06-12): the Library brand, doorknob descriptor lives in
  // the room header ("what actually works — measured"). The id stays "learn" — persisted nav key.
  { id: "learn", label: "Blackbook", icon: "learn" },
  { id: "lab", label: "Lab", icon: "lab" },
];
