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
// whitelist (theme.ts only ever applies a value found here, so a tampered localStorage can't inject
// an illegible colour). Re-curated 2026-07-13b on the owner's finish-it directive ("is there anyway
// to just add some double color options rather than the ugly earth tones like olive … then leave that
// finished"): the EARTH-TONE darks (Rust/Olive/Pine) are pruned; three DUO swatches join — each pairs
// a bright PRIMARY (the accent proper: chrome, buttons, text) with a SECONDARY that drives the room's
// dim/line washes (borders, hover washes, glows), giving a genuine two-colour room without touching
// any foreground-legibility surface. 9 bright + 3 dark + 3 duo = 15, grid 5×3.
//
// THE LEGIBILITY LAW (non-negotiable — why this is a curated set, not a free hex field): the accent
// is consumed in TWO foreground roles, each with its own contrast floor, so every swatch is vetted
// against BOTH:
//   (1) accent-as-FILL — the accent paints a button/pill and the accent-INK is read ON it. Two kinds:
//       • BRIGHT (no `ink`) — high-luminance; legible under the DEFAULT dark ink `--v2-accent-ink #1a0a2e`.
//       • DARK (`ink` set) — a deep tone that would FAIL under the dark ink, so it carries its OWN light
//         ink; theme.ts (applyRoomAccents) emits that paired ink alongside the accent so the fill flips
//         to light-on-dark and stays legible (adaptive ink — the "bright/dark mixed" ask).
//   (2) accent-as-TEXT — the accent is read AS text/glyphs ON the dark room panel (Lab station labels,
//       the Home dock's primary node, Blackbook's change tag, session meta, …). A BRIGHT swatch is
//       already legible as text on the panel, but a DARK swatch renders ~2.5:1 — illegible. So each
//       DARK swatch also carries a paired light, hue-CARRYING `text` tint; theme.ts emits it as
//       `--ix-accent-text`/`--v2-accent-text` for dark picks, and the accent-as-text sites read that
//       token (adaptive text — the dark-tone legibility fix, 2026-07-13). A BRIGHT swatch needs no
//       `text` (its accent-text stays the raw accent, already legible).
//   DUO swatches sidestep both floors by construction: the PRIMARY must be BRIGHT (guard-enforced —
//   no ink/text pairing ever needed), and the SECONDARY only ever renders at wash alpha (14%/25%
//   decorative borders/washes — never text, never a fill under ink), so it carries no contrast floor.
// All invariants — every bright swatch/primary ≥4.5:1 vs #1a0a2e; every dark swatch's `ink`/`text`
// legible AND load-bearing; duo primaries genuinely bright — are mechanized in room-accents.test.tsx.
// The four room presets lead so a room's own identity hue is always one tap away.
export type AccentSwatch = {
  name: string;
  hex: string; // the PRIMARY accent (chrome, buttons, accent-text)
  hex2?: string; // DUO only: the SECONDARY driving the dim/line washes
  ink?: string; // DARK only: paired light on-fill ink
  text?: string; // DARK only: paired light accent-as-text tint
};

export const ROOM_ACCENT_SWATCHES: AccentSwatch[] = [
  // Row 1 — the four room presets lead + Sky (bright). Hue walk begins.
  { name: "Violet", hex: "#a78bfa" }, // Home preset (~255°)
  { name: "Teal", hex: "#3fd9c2" }, // Monitor preset (~172°)
  { name: "Amber", hex: "#f0b878" }, // Blackbook preset (~33°)
  { name: "Emerald", hex: "#27e08a" }, // Lab preset (~154°)
  { name: "Sky", hex: "#46a8ff" }, // azure blue (~210°)
  // Row 2 — the rest of the bright wheel + the first dark (all brights ≥4.5:1 vs the dark ink)
  { name: "Red", hex: "#ff6b6b" }, // (~0°)
  { name: "Yellow", hex: "#ffe14a" }, // (~53°)
  { name: "Lime", hex: "#b6f24a" }, // yellow-green (~80°)
  { name: "Magenta", hex: "#f45cc6" }, // hot fuchsia (~318°)
  { name: "Slate", hex: "#33507f", ink: "#e9f0fb", text: "#98b4e6" }, // deep steel-blue (~215°)
  // Row 3 — the remaining darks + the DUOS (owner-named pairs, 2026-07-13b). Earth tones
  // (Rust/Olive/Pine) pruned on the same directive.
  { name: "Plum", hex: "#6b2b9e", ink: "#f4e9ff", text: "#c79cef" }, // deep purple (~280°)
  { name: "Wine", hex: "#9e1f46", ink: "#ffe6ee", text: "#ef8ea8" }, // deep crimson (~338°)
  { name: "Cyan / Midnight", hex: "#35e0e8", hex2: "#3b2a7a" }, // cyan chrome over midnight-purple washes
  { name: "Red / Blue", hex: "#ff6b6b", hex2: "#2f6bff" }, // red chrome over vivid-blue washes
  { name: "Lime / Cyan", hex: "#b6f24a", hex2: "#35e0e8" }, // lime chrome over cyan washes
];

// A swatch's persisted KEY: the bare primary hex for singles (backward-compatible with every pick
// stored before duos existed), `primary+secondary` for duos. Lowercased — the whitelist, the store,
// and the picker's selected-compare all speak this one form.
export function swatchKey(s: AccentSwatch): string {
  return (s.hex2 ? `${s.hex}+${s.hex2}` : s.hex).toLowerCase();
}

// Parse a persisted key back into its primary (+ optional secondary) hexes. Junk-tolerant — callers
// whitelist with isSwatchHex first.
export function splitSwatchKey(key: string): { hex: string; hex2?: string } {
  const [hex, hex2] = key.trim().toLowerCase().split("+");
  return hex2 ? { hex, hex2 } : { hex };
}

const SWATCH_KEYS: ReadonlySet<string> = new Set(ROOM_ACCENT_SWATCHES.map(swatchKey));

// A dark swatch's paired light ink, keyed by swatch KEY. Only DARK swatches appear here — a bright
// or duo swatch has no entry and falls back to the default `--v2-accent-ink`.
const SWATCH_INK: ReadonlyMap<string, string> = new Map(
  ROOM_ACCENT_SWATCHES.filter((s) => s.ink).map((s) => [swatchKey(s), s.ink!.toLowerCase()]),
);

// A dark swatch's paired light accent-TEXT tint, keyed by swatch KEY. Only DARK swatches appear
// here — a bright or duo swatch has no entry, so its accent-text stays the raw (legible) accent.
const SWATCH_TEXT: ReadonlyMap<string, string> = new Map(
  ROOM_ACCENT_SWATCHES.filter((s) => s.text).map((s) => [swatchKey(s), s.text!.toLowerCase()]),
);

// Is `key` one of the curated swatch keys? (The legibility guarantee — only a vetted swatch is ever
// applied.) Case-insensitive; accepts bare hexes (singles) and `a+b` duo keys.
export function isSwatchHex(key: string): boolean {
  return SWATCH_KEYS.has(key.trim().toLowerCase());
}

// The paired light ink for a swatch key, or `undefined` for a bright/duo swatch (default dark ink).
// theme.ts emits this alongside the accent so a dark fill flips to legible light-on-dark.
export function swatchInk(key: string): string | undefined {
  return SWATCH_INK.get(key.trim().toLowerCase());
}

// The paired light accent-TEXT tint for a DARK swatch key, or `undefined` for a bright/duo swatch
// (whose accent-text stays the raw accent). theme.ts emits this as --ix-accent-text/--v2-accent-text
// for a dark pick so accent-as-text on the room panel flips to a legible, hue-carrying light tint.
export function swatchText(key: string): string | undefined {
  return SWATCH_TEXT.get(key.trim().toLowerCase());
}

// The CSS background that REPRESENTS a swatch in the picker UI (dot + grid): a flat fill for singles,
// a hard diagonal split for duos so both colours are visible at a glance.
export function swatchDotCss(key: string): string {
  const { hex, hex2 } = splitSwatchKey(key);
  return hex2 ? `linear-gradient(135deg, ${hex} 0 50%, ${hex2} 50% 100%)` : hex;
}
