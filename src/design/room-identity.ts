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
// illegible colour). Expanded 2026-07-13 (owner "more variety … more neon or bright/dark tone mixed")
// from ten bright hues to twenty — a big neon/saturated bright range PLUS five true DARK tones.
//
// THE LEGIBILITY LAW (non-negotiable — why this is a curated set, not a free hex field): the accent
// doubles as a button/pill FILL with the accent-INK painted on top, so every swatch must clear WCAG
// 4.5:1 against the ink it will be read against. Two kinds of swatch:
//   • BRIGHT (no `ink`) — high-luminance; legible under the DEFAULT dark ink `--v2-accent-ink #1a0a2e`.
//   • DARK (`ink` set) — a deep tone that would FAIL under the dark ink, so it carries its OWN light
//     ink; theme.ts (applyRoomAccents) emits that paired ink alongside the accent so the fill flips to
//     light-on-dark and stays legible (adaptive ink — the "bright/dark mixed" ask).
// Both invariants (every bright swatch ≥4.5:1 vs #1a0a2e; every dark swatch ≥4.5:1 vs ITS ink; the
// dark ones genuinely need it) are mechanized in room-accents.test.tsx. The four room presets lead so
// a room's own identity hue is always one tap away; all twenty hexes are pairwise-distinct.
export const ROOM_ACCENT_SWATCHES: { name: string; hex: string; ink?: string }[] = [
  // Row 1 — the four room presets lead + Sky (bright)
  { name: "Violet", hex: "#a78bfa" }, // Home preset
  { name: "Teal", hex: "#3fd9c2" }, // Monitor preset
  { name: "Amber", hex: "#f0b878" }, // Blackbook preset
  { name: "Emerald", hex: "#27e08a" }, // Lab preset
  { name: "Sky", hex: "#5aa9ff" },
  // Row 2 — the rest of the original bright set
  { name: "Cyan", hex: "#5fd7f0" },
  { name: "Lime", hex: "#a6e85f" },
  { name: "Gold", hex: "#ffd166" },
  { name: "Coral", hex: "#ff9163" },
  { name: "Rose", hex: "#ff8ac4" },
  // Row 3 — new neon / saturated brights (all still ≥4.5:1 vs the dark ink)
  { name: "Magenta", hex: "#f45cc6" },
  { name: "Azure", hex: "#33b1ff" },
  { name: "Chartreuse", hex: "#d0f14e" },
  { name: "Tangerine", hex: "#ff9a2e" },
  { name: "Hot Pink", hex: "#ff5f9e" },
  // Row 4 — DARK tones (adaptive light ink so the fill stays legible; the "bright/dark mixed" ask)
  { name: "Indigo", hex: "#4a37c4", ink: "#ece9ff" },
  { name: "Wine", hex: "#9e1f46", ink: "#ffe6ee" },
  { name: "Pine", hex: "#12694a", ink: "#e3f6ee" },
  { name: "Plum", hex: "#6b2b9e", ink: "#f4e9ff" },
  { name: "Slate", hex: "#33507f", ink: "#e9f0fb" },
];

const SWATCH_HEXES: ReadonlySet<string> = new Set(
  ROOM_ACCENT_SWATCHES.map((s) => s.hex.toLowerCase()),
);

// A dark swatch's paired light ink, keyed by (lowercased) hex. Only DARK swatches appear here — a
// bright swatch has no entry and falls back to the default `--v2-accent-ink`.
const SWATCH_INK: ReadonlyMap<string, string> = new Map(
  ROOM_ACCENT_SWATCHES.filter((s) => s.ink).map((s) => [s.hex.toLowerCase(), s.ink!.toLowerCase()]),
);

// Is `hex` one of the curated swatches? (The legibility guarantee — only a vetted swatch is ever
// applied.) Case-insensitive.
export function isSwatchHex(hex: string): boolean {
  return SWATCH_HEXES.has(hex.trim().toLowerCase());
}

// The paired light ink for a swatch, or `undefined` for a bright swatch (use the default dark ink).
// theme.ts emits this alongside the accent so a dark fill flips to legible light-on-dark.
export function swatchInk(hex: string): string | undefined {
  return SWATCH_INK.get(hex.trim().toLowerCase());
}
