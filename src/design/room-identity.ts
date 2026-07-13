// Per-room identity accents (owner directive 2026-07-12: "i wanted to have it where the components
// each had their own distinguishable color scheme so they were more visible … whatever color
// schematic allows for that should be fine"). This is the SAME part-identity philosophy the rig
// hologram already uses (PART_KIND_COLORS — every component KIND keeps its own distinct hue in every
// theme so the parts are instantly tellable apart), now extended to the room chrome.
//
// Behind the `compy_room_identity` flag (DEFAULT OFF): when on, each room scopes its OWN --v2-accent
// (room-identity.css) so its chrome, HUD masthead, tags, buttons and session sparkline all read one
// distinguishable hue — theme-independent, like the hologram parts. When off (or absent), every room
// shares the global violet, byte-identical to today. Home keeps the global brand violet — it IS the
// home/brand colour, its identity unchanged.
//
// These hexes are the SINGLE SOURCE OF TRUTH; room-identity.css must carry the identical values,
// pinned by room-identity.test.ts. Presentation only — no logic, data, or backend touched.

export type RoomKey = "play" | "learn" | "lab" | "fix";

// The four in-room accents. `fix` (the Optimize station) shares the Lab family emerald — it lives
// inside the Lab now, so they read as one bench.
export const ROOM_IDENTITY: Record<RoomKey, string> = {
  play: "#3fd9c2", // Monitor — teal (live signal; echoes the rig's GPU hue)
  learn: "#f0b878", // Blackbook — amber (records / logbook warmth)
  lab: "#27e08a", // Lab — emerald (bench / measured "go")
  fix: "#27e08a", // Optimize station — shares the Lab family
};

// Home / global brand accent — unchanged; Home takes no room override.
export const HOME_ACCENT = "#a78bfa";
