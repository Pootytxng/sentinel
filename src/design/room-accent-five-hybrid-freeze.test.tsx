import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import {
  ROOM_ACCENT_SWATCHES,
  PICKABLE_ROOMS,
  defaultRoomAccent,
  isSwatchHex,
  splitSwatchKey,
  swatchDotCss,
  swatchKey,
  HOME_ACCENT,
} from "./room-identity";
import { readRoomAccents, setRoomAccent, INSTRUMENT_THEMES } from "./theme";
import { RoomAccentPicker } from "./RoomAccentPicker";

// ── THE FIVE-HYBRID FREEZE (owner ruling 2026-08-27) ──────────────────────────────────────────
//
// The visible per-room accent popover offers EXACTLY these five two-colour hybrids, in this order,
// at these hexes — and nothing else. Every single swatch and the two duos the owner did not name
// (Red / Blue, Amber / Wine) are gone, labels included.
//
// WHY A DEDICATED FILE. room-accents.test.tsx guards the palette's PROPERTIES (legibility floors,
// round-trips, emission) and is written to survive the palette changing. This file guards the
// palette's IDENTITY — the exact contents the owner named. Those are different jobs with different
// lifetimes: a property guard should not have to be edited when the offer is re-opened, and the
// offer must not be able to drift while every property guard stays green.
//
// The freeze is a narrowing of the OFFER only. It adds no theme engine, no gradient system and no
// animation, it does not touch the semantic status palette, and it leaves the five APP-WIDE
// Settings themes (Midnight · Violet · Crimson · Emerald · Hearth) alone — all three pinned below.

/** The owner's list, verbatim, in order. Hard-coded on purpose: reading it from the source it is
 *  meant to constrain would guard nothing. */
const FROZEN: ReadonlyArray<readonly [name: string, primary: string, secondary: string]> = [
  ["Cyan / Midnight", "#35e0e8", "#3b2a7a"],
  ["Lime / Cyan", "#b6f24a", "#35e0e8"],
  ["Violet / Teal", "#a78bfa", "#3fd9c2"],
  ["Magenta / Violet", "#f45cc6", "#6b2b9e"],
  ["Sky / Emerald", "#46a8ff", "#27e08a"],
];

/** Values a user could still have persisted from before the freeze. Each must now be REJECTED. */
const RETIRED_KEYS = [
  "#a78bfa", // Violet (single) — and the current default, which is why it must not sneak back in
  "#3fd9c2", // Teal
  "#f0b878", // Amber
  "#27e08a", // Emerald
  "#46a8ff", // Sky — the accent persisted on the owner's own Health room before this freeze
  "#ff6b6b", // Red
  "#ffe14a", // Yellow
  "#f45cc6", // Magenta
  "#ff6b6b+#2f6bff", // Red / Blue
  "#f0b878+#9e1f46", // Amber / Wine
];

const RETIRED_LABEL_KEYS = [
  "violet",
  "teal",
  "amber",
  "emerald",
  "sky",
  "red",
  "yellow",
  "magenta",
  "redBlue",
  "amberWine",
];

const locale = (lang: string) =>
  JSON.parse(readFileSync(join("src", "i18n", "locales", lang, "common.json"), "utf8"));

// ── WCAG contrast, same math as theme-contrast.test.ts / room-accents.test.tsx ──
type RGB = { r: number; g: number; b: number };
const parseHex = (hex: string): RGB => {
  const m = hex.trim().replace("#", "");
  return {
    r: parseInt(m.slice(0, 2), 16),
    g: parseInt(m.slice(2, 4), 16),
    b: parseInt(m.slice(4, 6), 16),
  };
};
const luminance = ({ r, g, b }: RGB): number => {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: RGB, b: RGB): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** The dark ink read ON a filled accent button/pill (`--v2-accent-ink`), and the lightest room
 *  panel an accent is read AS TEXT on — the two floors the project's contrast contract sets at
 *  4.5:1 for this surface. */
const ACCENT_INK = "#1a0a2e";
const LIGHTEST_PANEL = "#141726";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
  document.getElementById("compy-room-accents")?.remove();
});

describe("accent freeze: the exact five, in order, at the owner's hexes", () => {
  it("offers exactly five swatches", () => {
    expect(ROOM_ACCENT_SWATCHES).toHaveLength(5);
  });

  it("names, ORDER and both hexes match the ruling exactly", () => {
    expect(ROOM_ACCENT_SWATCHES.map((s) => s.name)).toEqual(FROZEN.map(([n]) => n));
    ROOM_ACCENT_SWATCHES.forEach((s, i) => {
      const [name, primary, secondary] = FROZEN[i];
      expect(s.hex.toLowerCase(), `${name} primary`).toBe(primary);
      expect(s.hex2?.toLowerCase(), `${name} secondary`).toBe(secondary);
    });
  });

  it("EVERY visible choice is a duo — not one single swatch survives", () => {
    for (const s of ROOM_ACCENT_SWATCHES) {
      expect(s.hex2, `${s.name} must be a two-colour hybrid`).toBeDefined();
      expect(swatchKey(s), `${s.name} key must be a composite`).toContain("+");
      const { hex, hex2 } = splitSwatchKey(swatchKey(s));
      expect(hex2, `${s.name} key must split back into two hexes`).toBeDefined();
      expect(hex).toBe(s.hex.toLowerCase());
      // …and the picker must PAINT both halves, so a duo is visibly a duo.
      const css = swatchDotCss(swatchKey(s));
      expect(css).toContain("linear-gradient(135deg");
      expect(css).toContain(s.hex.toLowerCase());
      expect(css).toContain(s.hex2!.toLowerCase());
    }
  });

  it("the whitelist is exactly the five keys — nothing more whitelists", () => {
    for (const s of ROOM_ACCENT_SWATCHES) expect(isSwatchHex(swatchKey(s))).toBe(true);
    for (const key of RETIRED_KEYS) {
      expect(isSwatchHex(key), `${key} must no longer whitelist`).toBe(false);
    }
  });
});

describe("accent freeze: removed values and obsolete labels are absent", () => {
  it("no retired swatch NAME remains in the palette", () => {
    const names = new Set(ROOM_ACCENT_SWATCHES.map((s) => s.name));
    for (const gone of ["Violet", "Teal", "Amber", "Emerald", "Sky", "Red", "Yellow", "Magenta", "Red / Blue", "Amber / Wine"]) {
      expect(names.has(gone), `${gone} must not be offered`).toBe(false);
    }
  });

  it("the picker's name→i18n-key map holds exactly the five, in order", () => {
    const src = readFileSync(join("src", "design", "RoomAccentPicker.tsx"), "utf8");
    const block = src.slice(
      src.indexOf("const SWATCH_NAME_KEYS"),
      src.indexOf("export const ACCENT_MENU_ITEM_COUNT"),
    );
    const mapped = [...block.matchAll(/"([^"]+)":\s*"([a-zA-Z]+)"/g)].map((m) => m[1]);
    expect(mapped).toEqual(FROZEN.map(([n]) => n));
    for (const dead of RETIRED_LABEL_KEYS) {
      expect(block, `${dead} label mapping must be gone`).not.toMatch(
        new RegExp(`"${dead}"`),
      );
    }
  });

  it("both locales carry exactly the five swatch labels — no orphaned copy for a removed swatch", () => {
    const expected = ["cyanMidnight", "limeCyan", "violetTeal", "magentaViolet", "skyEmerald"];
    for (const lang of ["en", "zh-CN"]) {
      const names = locale(lang).roomAccentPicker.swatchNames;
      expect(Object.keys(names), `${lang} swatch label keys`).toEqual(expected);
      for (const dead of RETIRED_LABEL_KEYS) {
        expect(names[dead], `${lang} must not still ship a ${dead} label`).toBeUndefined();
      }
    }
  });

  it("English and zh-CN are both COMPLETE for the picker — every key present and non-empty", () => {
    const en = locale("en").roomAccentPicker;
    const zh = locale("zh-CN").roomAccentPicker;
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(zh.swatchNames).sort()).toEqual(Object.keys(en.swatchNames).sort());
    for (const [k, v] of Object.entries(zh.swatchNames as Record<string, string>)) {
      expect(String(v).trim().length, `zh-CN ${k} must be translated`).toBeGreaterThan(0);
      // a zh label that is byte-identical to the English one is an untranslated placeholder
      expect(v, `zh-CN ${k} is still the English string`).not.toBe(en.swatchNames[k]);
    }
    for (const [, v] of Object.entries(en.swatchNames as Record<string, string>)) {
      expect(String(v).trim().length).toBeGreaterThan(0);
    }
  });
});

describe("accent freeze: all five meet the contrast contract", () => {
  it("every PRIMARY clears 4.5:1 against the accent ink it is read under as a FILL", () => {
    const ink = parseHex(ACCENT_INK);
    for (const s of ROOM_ACCENT_SWATCHES) {
      const ratio = contrast(ink, parseHex(s.hex));
      expect(
        ratio,
        `${s.name} primary ${s.hex} vs ${ACCENT_INK} = ${ratio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("every PRIMARY clears 4.5:1 as TEXT on the lightest room panel", () => {
    const panel = parseHex(LIGHTEST_PANEL);
    for (const s of ROOM_ACCENT_SWATCHES) {
      const ratio = contrast(panel, parseHex(s.hex));
      expect(
        ratio,
        `${s.name} primary ${s.hex} on ${LIGHTEST_PANEL} = ${ratio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("no swatch needs the adaptive ink/text pairing — an all-duo palette clears both floors raw", () => {
    for (const s of ROOM_ACCENT_SWATCHES) {
      expect(s.ink, `${s.name} must not need an adaptive ink`).toBeUndefined();
      expect(s.text, `${s.name} must not need an adaptive text`).toBeUndefined();
    }
  });

  it("a pick never emits an ink/text override, and never leaks the composite key into CSS", () => {
    for (const s of ROOM_ACCENT_SWATCHES) {
      setRoomAccent("play", swatchKey(s));
      const css = document.getElementById("compy-room-accents")!.textContent!;
      expect(css, s.name).toContain(`--v2-accent:${s.hex.toLowerCase()};`);
      expect(css, s.name).not.toContain("--v2-accent-ink:");
      expect(css, s.name).not.toContain("--ix-accent-ink:");
      expect(css, s.name).not.toContain("--v2-accent-text:");
      expect(css, s.name).not.toContain("--ix-accent-text:");
      expect(css, `${s.name}: the raw composite key must never reach CSS`).not.toContain("+");
    }
  });
});

describe("accent freeze: persistence round-trips, and a removed value falls back safely", () => {
  it("each of the five persists and round-trips, per room", () => {
    for (const s of ROOM_ACCENT_SWATCHES) {
      const key = swatchKey(s);
      for (const room of PICKABLE_ROOMS) {
        setRoomAccent(room, key);
        expect(readRoomAccents()[room], `${room} ← ${s.name}`).toBe(key);
        setRoomAccent(room, null);
        expect(readRoomAccents()[room]).toBeUndefined();
      }
    }
  });

  it.each(RETIRED_KEYS)(
    "a store holding the REMOVED value %s is rejected — the room falls back to the default",
    (dead) => {
      localStorage.setItem("compy_room_accents", JSON.stringify({ home: dead, play: dead }));

      // rejected, not silently re-mapped onto some other custom pick
      const got = readRoomAccents();
      expect(got.home).toBeUndefined();
      expect(got.play).toBeUndefined();

      // …and no rule is emitted at all, so the rooms render on the default accent
      expect(document.getElementById("compy-room-accents")).toBeNull();

      // the picker mounts without crashing, shows the DEFAULT, and marks nothing selected
      const { container } = render(<RoomAccentPicker room="home" roomLabel="Home" />);
      const dot = container.querySelector<HTMLElement>(".v2-accent-dot")!;
      // The dot must paint the DEFAULT as a flat fill — not a gradient, and not the retired colour.
      // Since the glass redesign (2026-10-30) an un-picked room follows the theme, so the default
      // is the theme accent token itself rather than a fixed hex.
      expect(dot.style.background).toBe("var(--v2-accent)");
      fireEvent.click(within(container).getAllByRole("button")[0]);
      for (const item of screen.getAllByRole("menuitemradio")) {
        expect(item.getAttribute("aria-checked")).toBe("false");
      }
      // and "reset to default" is correctly inert — there is no pick to clear
      expect(screen.getByRole("menuitem", { name: "Reset to default" })).toBeDisabled();
    },
  );

  it("a removed value never survives a WRITE either — setRoomAccent treats it as a clear", () => {
    for (const dead of RETIRED_KEYS) {
      setRoomAccent("lab", swatchKey(ROOM_ACCENT_SWATCHES[0])); // a good pick first…
      setRoomAccent("lab", dead); // …then the retired one
      expect(readRoomAccents().lab, `${dead} must not persist`).toBeUndefined();
    }
  });
});

describe("accent freeze: apply-to-all and reset still work", () => {
  it("apply-to-all stamps the picked hybrid on every room", () => {
    const pick = swatchKey(ROOM_ACCENT_SWATCHES[3]); // Magenta / Violet
    setRoomAccent("play", pick);
    render(<RoomAccentPicker room="play" roomLabel="Monitor" />);
    fireEvent.click(screen.getByRole("button", { name: "Monitor accent color" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Apply to all rooms" }));

    const stored = readRoomAccents();
    for (const room of PICKABLE_ROOMS) expect(stored[room], room).toBe(pick);
    expect(screen.queryByRole("menu"), "the popover closes on apply").toBeNull();
  });

  it("reset clears the room's pick and returns it to the plain violet default", () => {
    render(<RoomAccentPicker room="home" roomLabel="Home" />);
    fireEvent.click(screen.getByRole("button", { name: "Home accent color" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Lime / Cyan" }));
    expect(readRoomAccents().home).toBe("#b6f24a+#35e0e8");

    fireEvent.click(screen.getByRole("button", { name: "Home accent color" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset to default" }));
    expect(readRoomAccents().home).toBeUndefined();
    expect(defaultRoomAccent("home")).toBe(HOME_ACCENT);
    expect(HOME_ACCENT).toBe("#a78bfa"); // plain violet, unchanged by the freeze
    expect(document.getElementById("compy-room-accents"), "no picks ⇒ no rule").toBeNull();
  });

  it("the default is NOT offered as a sixth option", () => {
    render(<RoomAccentPicker room="home" roomLabel="Home" />);
    fireEvent.click(screen.getByRole("button", { name: "Home accent color" }));
    const options = screen.getAllByRole("menuitemradio");
    expect(options).toHaveLength(5);
    expect(options.map((o) => o.getAttribute("aria-label"))).toEqual(FROZEN.map(([n]) => n));
    // the popover's only other items are the two commands — nothing else crept in
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });
});

describe("accent freeze: what it must NOT have touched", () => {
  it("the five APP-WIDE Settings themes are unchanged — this is the per-room popover only", () => {
    expect(INSTRUMENT_THEMES.map((t) => t.id)).toEqual([
      "midnight",
      "violet",
      "crimson",
      "emerald",
      "hearth",
    ]);
    expect(INSTRUMENT_THEMES.map((t) => t.label)).toEqual([
      "Midnight",
      "Violet",
      "Crimson",
      "Emerald",
      "Hearth",
    ]);
  });

  it("the SEMANTIC status colours are untouched — an accent never recolours meaning", () => {
    const tokens = readFileSync(join("src", "design", "tokens-v2.css"), "utf8");
    // ok / warn / bad / info each keep exactly one meaning, app-wide, independent of any accent.
    for (const [name, hex] of [
      ["--v2-ok", "#3ddc97"],
      ["--v2-warn", "#f5c542"],
      ["--v2-bad", "#f3716f"],
      ["--v2-info", "#6cb8ff"],
    ] as const) {
      expect(tokens, `${name} must still be ${hex}`).toMatch(
        new RegExp(`${name}\\s*:\\s*${hex}\\b`, "i"),
      );
    }
    // and no status token may be defined FROM the accent
    for (const m of tokens.matchAll(/--v2-(ok|warn|bad|info)[a-z-]*\s*:\s*([^;]+);/gi)) {
      expect(m[2], `${m[1]} must not derive from the accent`).not.toContain("--v2-accent");
    }
  });

  it("no theme engine, gradient system or animation was added by the freeze", () => {
    const identity = readFileSync(join("src", "design", "room-identity.ts"), "utf8");
    // the palette source stays a plain data table: no CSS generation, no keyframes, no timers
    expect(identity).not.toMatch(/@keyframes|requestAnimationFrame|setInterval|transition:/);
    // the ONE gradient in this feature is the pre-existing two-colour swatch chip, and it lives in
    // swatchDotCss — nowhere else.
    expect([...identity.matchAll(/linear-gradient|radial-gradient|conic-gradient/g)]).toHaveLength(1);
  });
});
