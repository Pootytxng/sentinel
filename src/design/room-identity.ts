// Per-room identity accents (owner directive 2026-07-12: "i wanted to have it where the components
// each had their own distinguishable color scheme so they were more visible … whatever color
// schematic allows for that should be fine"). This is the SAME part-identity philosophy the rig
// hologram already uses (PART_KIND_COLORS — every component KIND keeps its own distinct hue in every
// theme so the parts are instantly tellable apart), now extended to the room chrome.
//
// Behind the `compy_room_identity` flag (DEFAULT ON since 2026-07-13): when on, each room scopes its OWN --v2-accent
// (room-identity.css) so its chrome, HUD masthead, tags, buttons and session sparkline all read one
// distinguishable hue — theme-independent, like the hologram parts. When off (or absent), every room
// shares the global violet, byte-identical to today. Home keeps the global brand violet — it IS the
// home/brand colour, its identity unchanged.
//
// COLOR-1 (2026-08-13) superseded the preset half of this doctrine: room-identity.css now carries
// NO preset rules (pinned by room-identity.test.ts) and ROOM_IDENTITY below is the one violet
// accent for every room. The flag + picker mechanism this header describes still powers USER picks.
// Presentation only — no logic, data, or backend touched.

export type RoomKey = "play" | "learn" | "lab" | "fix";

// COLOR-1 (design foundation step ①, 2026-08-13): ROOMS GAVE UP THEIR HUE. The teal/amber/emerald
// presets collided with the status palette (Lab #27e08a vs --v2-ok #3ddc97; Blackbook #f0b878 vs
// --v2-warn #f5c542) — whole rooms glowed "good"/"warning", so colour stopped being information.
// Every room now DEFAULTS to the one violet accent; green/amber/red/blue each mean exactly one
// thing app-wide. The user's per-room accent PICKER below survives (owner freedom directive
// 2026-07-12b) — a deliberate pick is not a shipped default. room-identity.css carries no rules.
export const ROOM_IDENTITY: Record<RoomKey, string> = {
  play: "#a78bfa", // Monitor — the one accent (was teal #3fd9c2 pre-COLOR-1)
  learn: "#a78bfa", // Blackbook — the one accent (was amber #f0b878)
  lab: "#a78bfa", // Lab — the one accent (was emerald #27e08a)
  fix: "#a78bfa", // Optimize station — the one accent (was emerald #27e08a)
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
// an illegible colour).
//
// FROZEN TO FIVE HYBRIDS (owner ruling 2026-08-27). The picker offers exactly five two-colour
// hybrids and nothing else: every single swatch retires, and so do the two duos the owner did not
// name (Red / Blue, Amber / Wine). This is a deliberate temporary narrowing of the OFFER, not a new
// theme system — no engine, no gradient layer, no animation was added, and the five that remain are
// the same vetted pairs that already shipped, at the same hexes. The five app-wide Settings themes
// (Midnight · Violet · Crimson · Emerald · Hearth) are a different system entirely and are untouched.
//
// THE DEFAULT IS NOT A SIXTH OPTION. `defaultRoomAccent()` still returns plain violet #a78bfa and
// "Reset to default" still restores it — but the default is a fall-back state, not a selectable
// swatch, so it deliberately does NOT appear in this array. (Violet / Teal happens to carry #a78bfa
// as its PRIMARY; its key is the composite `#a78bfa+#3fd9c2`, so a defaulted room reads as "nothing
// selected", never as a silent Violet / Teal pick.)
//
// A PICK STORED BEFORE THIS FREEZE that named a now-removed swatch is no longer whitelisted, so
// readRoomAccents() drops it and the room falls back to the default — the same safe path a tampered
// store has always taken. It can never become "another custom pick".
//
// THE LEGIBILITY LAW (non-negotiable — why this is a curated set, not a free hex field): the accent
// is consumed in TWO foreground roles, each with its own contrast floor. DUO swatches clear BOTH by
// construction, which is exactly why an all-duo palette is safe:
//   (1) accent-as-FILL — the accent paints a button/pill and the accent-INK (`--v2-accent-ink`
//       #1a0a2e) is read ON it. Every duo PRIMARY must be BRIGHT (≥4.5:1 vs that ink), so no duo
//       ever needs the adaptive `ink` pairing.
//   (2) accent-as-TEXT — the accent is read AS text/glyphs on the dark room panel. A bright primary
//       is already legible there, so no duo needs the adaptive `text` pairing either.
//   The SECONDARY only ever renders at wash alpha (14%/25% decorative borders/washes — never text,
//   never a fill under ink), so it carries no contrast floor at all.
// The `ink`/`text` fields below stay on the TYPE, dormant: theme.ts's adaptive-ink emission path is
// still wired and guarded, so a dark swatch could return without re-deriving the mechanism. No
// current swatch uses them.
// All invariants — every primary genuinely bright, every option a duo, the exact five in order — are
// mechanized in room-accents.test.tsx.
export type AccentSwatch = {
  name: string;
  hex: string; // the PRIMARY accent (chrome, buttons, accent-text) — must be BRIGHT
  hex2?: string; // DUO only: the SECONDARY driving the dim/line washes
  ink?: string; // DARK only (none today): paired light on-fill ink
  text?: string; // DARK only (none today): paired light accent-as-text tint
};

// The five, in the owner's exact order. One row of five in the popover (`repeat(5, 1fr)`).
export const ROOM_ACCENT_SWATCHES: AccentSwatch[] = [
  { name: "Cyan / Midnight", hex: "#35e0e8", hex2: "#3b2a7a" }, // cyan chrome over midnight-purple washes
  { name: "Lime / Cyan", hex: "#b6f24a", hex2: "#35e0e8" }, // lime chrome over cyan washes
  { name: "Violet / Teal", hex: "#a78bfa", hex2: "#3fd9c2" }, // the brand pair — violet chrome, teal washes
  { name: "Magenta / Violet", hex: "#f45cc6", hex2: "#6b2b9e" }, // synthwave — hot pink over deep purple
  { name: "Sky / Emerald", hex: "#46a8ff", hex2: "#27e08a" }, // aurora — azure over emerald washes
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
