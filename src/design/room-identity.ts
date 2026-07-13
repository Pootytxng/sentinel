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

// Home / global brand accent — the DEFAULT for Home; Home takes no preset override in
// room-identity.css (it keeps the brand violet unless the user picks one below).
export const HOME_ACCENT = "#a78bfa";

// ── Per-room colour freedom (owner directive 2026-07-12b, after eyeballing the presets): "offer
// within the tabs themselves a … little dropdown … to individually change the color theme for each
// window … in case the user wants the freedom to shift around the colors they want on each page."
// So each room carries a small corner picker (RoomAccentPicker, topbar) that overrides its accent
// from a CURATED swatch set. Curated (not a free hex field) is deliberate: every swatch is vetted to
// keep the dark accent-ink (--v2-accent-ink #1a0a2e) legible on filled buttons/pills — the
// button-legibility law can't be broken by a bad pick. A user pick persists per room and re-skins
// that room's chrome + rig + sparkline exactly like the preset does (theme.ts applyRoomAccents).

// A room the user may recolour. "home" is included (its default is HOME_ACCENT); "check" (the legacy
// merge-off escape room) is out — it has no identity preset.
export type PickableRoom = "home" | RoomKey;
export const PICKABLE_ROOMS: PickableRoom[] = ["home", "play", "learn", "lab", "fix"];

// The room's DEFAULT accent when the user hasn't picked one (what "Reset to default" restores).
export function defaultRoomAccent(room: PickableRoom): string {
  return room === "home" ? HOME_ACCENT : ROOM_IDENTITY[room];
}

// The curated swatch palette — SINGLE SOURCE OF TRUTH for both the picker UI and the persisted-value
// whitelist (theme.ts only ever applies a hex found here, so a tampered localStorage can't inject an
// illegible colour). Every hex clears WCAG 4.5:1 against the dark ink #1a0a2e (proven in
// room-accents.test.ts — the lowest, Violet, is 6.85:1) and all ten are pairwise-distinct. The four
// room presets lead so a room's own identity hue is always one tap away.
export const ROOM_ACCENT_SWATCHES: { name: string; hex: string }[] = [
  { name: "Violet", hex: "#a78bfa" }, // Home preset
  { name: "Teal", hex: "#3fd9c2" }, // Monitor preset
  { name: "Amber", hex: "#f0b878" }, // Blackbook preset
  { name: "Emerald", hex: "#27e08a" }, // Lab preset
  { name: "Sky", hex: "#5aa9ff" },
  { name: "Rose", hex: "#ff8ac4" },
  { name: "Coral", hex: "#ff9163" },
  { name: "Gold", hex: "#ffd166" },
  { name: "Lime", hex: "#a6e85f" },
  { name: "Cyan", hex: "#5fd7f0" },
];

const SWATCH_HEXES: ReadonlySet<string> = new Set(
  ROOM_ACCENT_SWATCHES.map((s) => s.hex.toLowerCase()),
);

// Is `hex` one of the curated swatches? (The legibility guarantee — only a vetted swatch is ever
// applied.) Case-insensitive.
export function isSwatchHex(hex: string): boolean {
  return SWATCH_HEXES.has(hex.trim().toLowerCase());
}
