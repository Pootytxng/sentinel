// The six-home rail — THE single source of truth for the app's primary navigation (one-rail pass §1).
// Both the CommandCenter rail and the app-shell rail render from this list, so they're identical by
// construction (the rail-parity guard test asserts this list stays the blessed set/order/labels).
// Settings is a separate gear at the bottom of the rail; Export is a header action — neither lives here.

export type HomeRailId = "home" | "check" | "play" | "fix" | "learn" | "lab";

export const HOME_RAIL: { id: HomeRailId; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "gauge" },
  { id: "check", label: "Check", icon: "check" },
  { id: "play", label: "Play", icon: "play" },
  { id: "fix", label: "Fix", icon: "fix" },
  { id: "learn", label: "Learn", icon: "learn" },
  { id: "lab", label: "Lab", icon: "lab" },
];
