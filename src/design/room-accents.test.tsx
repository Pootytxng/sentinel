import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import {
  ROOM_ACCENT_SWATCHES,
  PICKABLE_ROOMS,
  defaultRoomAccent,
  isSwatchHex,
  swatchInk,
  swatchText,
  swatchKey,
  splitSwatchKey,
  swatchDotCss,
  ROOM_IDENTITY,
  HOME_ACCENT,
  type PickableRoom,
} from "./room-identity";
import { readRoomAccents, setRoomAccent } from "./theme";
import { RoomAccentPicker } from "./RoomAccentPicker";
import { ShellV2 } from "./ShellV2";
import { railFor } from "./homeRail";

// Per-room accent PICKS (owner 2026-07-12b: per-page colour freedom). These guards keep the feature
// honest across its three risk surfaces: (1) the curated palette can never break the dark-ink-on-
// accent legibility law, (2) the persisted store only ever yields whitelisted swatches, (3) the
// managed <style> reuses the SAME scoped selector + same-element washes as the presets (so flag-off
// stays inert and the var()-declaring-element gotcha stays handled), and (4) the picker only exists
// when the room-identity flag is on (topbar byte-identity with it off).

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) =>
    cmd === "get_build_stamp" ? Promise.resolve("ab12cd3 · dev") : Promise.resolve(null),
}));

// ── WCAG contrast (same math as theme-contrast.test.ts) ──
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
  const lin = (c: number) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (fg: RGB, bg: RGB): number => {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

// The real dark ink used on accent fills — read from the token so a token change re-validates here.
const tokensCss = readFileSync(join("src", "design", "tokens-v2.css"), "utf8");
const ACCENT_INK = tokensCss.match(/--v2-accent-ink:\s*(#[0-9a-fA-F]{6})/)![1];
// The LIGHTEST room panel surface accent-TEXT can render on (worst case for a light foreground) —
// read from the token so a palette change re-validates the accent-text legibility here.
const PANEL_LIGHTEST = tokensCss.match(/--v2-panel-2:\s*(#[0-9a-fA-F]{6})/)![1];

describe("room-accents: curated palette is legible + sound", () => {
  // The button-legibility law, extended for the adaptive-ink palette (owner 2026-07-13 "bright/dark
  // tone mixed"): every swatch must clear WCAG 4.5:1 against the ink it is actually read against —
  // a BRIGHT swatch under the default dark ink #1a0a2e, a DARK swatch under ITS OWN paired light ink.
  it("every swatch clears WCAG 4.5:1 against ITS effective ink (bright→dark ink, dark→paired light ink)", () => {
    for (const s of ROOM_ACCENT_SWATCHES) {
      const inkHex = s.ink ?? ACCENT_INK;
      const ratio = contrast(parseHex(inkHex), parseHex(s.hex));
      expect(
        ratio,
        `${s.name} ${s.hex} on ink ${inkHex} = ${ratio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  // The paired ink must be LOAD-BEARING, not decorative: a swatch only carries an `ink` because it is
  // too dark for the default dark ink. This stops a bright swatch being mislabelled "dark" (which
  // would silently give it a needless light ink). NOTE (2026-07-16 palette rework): the last dark
  // singles (Slate/Plum/Wine) retired on the owner's spectrum+duo directive, so this set is currently
  // EMPTY — the guard stays so any future dark swatch is still held to the law.
  it("dark swatches (paired ink) genuinely FAIL the default dark ink — the adaptive ink is required", () => {
    const darkInk = parseHex(ACCENT_INK);
    const darks = ROOM_ACCENT_SWATCHES.filter((s) => s.ink);
    for (const s of darks) {
      const ratio = contrast(darkInk, parseHex(s.hex));
      expect(
        ratio,
        `${s.name} ${s.hex} vs #1a0a2e = ${ratio.toFixed(2)} — a paired-ink swatch must be too dark for the default ink`,
      ).toBeLessThan(4.5);
    }
  });

  it("bright swatches carry NO paired ink and pass the default dark ink on their own", () => {
    const darkInk = parseHex(ACCENT_INK);
    for (const s of ROOM_ACCENT_SWATCHES.filter((s) => !s.ink)) {
      const ratio = contrast(darkInk, parseHex(s.hex));
      expect(ratio, `${s.name} ${s.hex} vs #1a0a2e = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("swatchInk() returns the paired ink for dark swatches, undefined for bright ones", () => {
    for (const s of ROOM_ACCENT_SWATCHES) {
      expect(swatchInk(s.hex), s.name).toBe(s.ink ? s.ink.toLowerCase() : undefined);
    }
    expect(swatchInk("#000000"), "a non-swatch hex has no ink").toBeUndefined();
  });

  // ── The accent-as-TEXT legibility law (dark-pick fix, owner 2026-07-13). The accent also renders as
  // foreground text/glyphs on the dark room panel (Lab station labels, the Home dock, Blackbook's change
  // tag, session meta). A bright swatch is legible as-is; a DARK swatch's deep hue renders ~2.5:1, so it
  // carries a paired light `text` tint that theme.ts emits as --ix-accent-text/--v2-accent-text. Three
  // invariants, mirroring the ink guards: legibility · load-bearing · coverage.
  it("every DARK swatch's accent-TEXT clears WCAG 4.5:1 against the lightest room panel", () => {
    // (Set currently empty — darks retired 2026-07-16; the guard holds for any future dark swatch.)
    const panel = parseHex(PANEL_LIGHTEST);
    const darks = ROOM_ACCENT_SWATCHES.filter((s) => s.text);
    for (const s of darks) {
      const ratio = contrast(parseHex(s.text!), panel);
      expect(
        ratio,
        `${s.name} text ${s.text} on panel ${PANEL_LIGHTEST} = ${ratio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  // Load-bearing: a swatch only carries `text` because its RAW accent is too dark to read as text on
  // the panel. This stops a bright swatch being needlessly given a light text (and proves the fix is
  // required, not decorative) — the mirror of the ink load-bearing check.
  it("dark swatches' RAW accent genuinely FAILS 4.5:1 as text on the panel — the light accent-text is required", () => {
    const panel = parseHex(PANEL_LIGHTEST);
    for (const s of ROOM_ACCENT_SWATCHES.filter((s) => s.text)) {
      const ratio = contrast(parseHex(s.hex), panel);
      expect(
        ratio,
        `${s.name} raw ${s.hex} vs panel = ${ratio.toFixed(2)} — a text-paired swatch must be too dark for raw text`,
      ).toBeLessThan(4.5);
    }
  });

  // Coverage: NO swatch may be left text-broken. Any swatch whose raw accent fails as text on the panel
  // MUST carry a paired `text` — so adding a new dark swatch without one fails CI here.
  it("every swatch too dark for raw text on the panel carries a paired accent-text (no dark swatch left broken)", () => {
    const panel = parseHex(PANEL_LIGHTEST);
    for (const s of ROOM_ACCENT_SWATCHES) {
      if (contrast(parseHex(s.hex), panel) < 4.5) {
        expect(
          s.text,
          `${s.name} ${s.hex} is too dark to read as text on the panel but has no paired accent-text`,
        ).toBeDefined();
      }
    }
  });

  it("swatchText() returns the paired accent-text for dark swatches, undefined for bright ones", () => {
    for (const s of ROOM_ACCENT_SWATCHES) {
      expect(swatchText(s.hex), s.name).toBe(s.text ? s.text.toLowerCase() : undefined);
    }
    expect(swatchText("#000000"), "a non-swatch hex has no accent-text").toBeUndefined();
  });

  it("all swatch colours are valid 6-digit hexes; swatches are pairwise-distinct by KEY", () => {
    for (const s of ROOM_ACCENT_SWATCHES) {
      expect(s.hex).toMatch(/^#[0-9a-fA-F]{6}$/);
      if (s.hex2) expect(s.hex2, `${s.name} hex2`).toMatch(/^#[0-9a-fA-F]{6}$/);
      if (s.ink) expect(s.ink, `${s.name} ink`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    // Distinctness is keyed on swatchKey (two duos may deliberately share a colour — Lime / Cyan's
    // SECONDARY is Cyan / Midnight's PRIMARY — but no two swatches may be the same swatch).
    expect(new Set(ROOM_ACCENT_SWATCHES.map(swatchKey)).size).toBe(ROOM_ACCENT_SWATCHES.length);
  });

  // ── DUO swatches (owner 2026-07-13b "double color options"). The duo sidesteps both legibility
  // floors BY CONSTRUCTION, and these guards enforce that construction stays true:
  it("every DUO's PRIMARY is genuinely BRIGHT (≥4.5:1 vs the dark ink) and carries no ink/text pairing", () => {
    const darkInk = parseHex(ACCENT_INK);
    const duos = ROOM_ACCENT_SWATCHES.filter((s) => s.hex2);
    expect(duos.length, "the palette must carry duo swatches").toBeGreaterThan(0);
    for (const s of duos) {
      expect(s.ink, `${s.name} — a duo must not need an adaptive ink (bright primary only)`).toBeUndefined();
      expect(s.text, `${s.name} — a duo must not need an adaptive text (bright primary only)`).toBeUndefined();
      const ratio = contrast(darkInk, parseHex(s.hex));
      expect(
        ratio,
        `${s.name} primary ${s.hex} vs ${ACCENT_INK} = ${ratio.toFixed(2)} — duo primaries must be bright`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("every retired swatch is really gone — earth-tone darks, all singles, and the two unnamed duos", () => {
    const names = ROOM_ACCENT_SWATCHES.map((s) => s.name);
    // 2026-07-13b retired the earth-tone darks. 2026-08-27 (the five-hybrid freeze) retired every
    // single swatch plus the two duos the owner did not name.
    const gone = [
      "Rust",
      "Olive",
      "Pine",
      "Slate",
      "Plum",
      "Wine",
      "Violet",
      "Teal",
      "Amber",
      "Emerald",
      "Sky",
      "Red",
      "Yellow",
      "Magenta",
      "Red / Blue",
      "Amber / Wine",
    ];
    for (const name of gone) expect(names, `${name} must not be offered`).not.toContain(name);
    // …and their persisted KEYS must no longer whitelist, so a stored pick naming one is rejected.
    const retiredKeys = [
      "#a78bfa",
      "#3fd9c2",
      "#f0b878",
      "#27e08a",
      "#46a8ff",
      "#ff6b6b",
      "#ffe14a",
      "#f45cc6",
      "#ff6b6b+#2f6bff",
      "#f0b878+#9e1f46",
    ];
    for (const key of retiredKeys) {
      expect(isSwatchHex(key), `${key} must no longer whitelist`).toBe(false);
    }
  });

  it("swatchKey/splitSwatchKey round-trip singles (bare hex) and duos (primary+secondary)", () => {
    for (const s of ROOM_ACCENT_SWATCHES) {
      const key = swatchKey(s);
      const parts = splitSwatchKey(key);
      expect(parts.hex).toBe(s.hex.toLowerCase());
      expect(parts.hex2).toBe(s.hex2?.toLowerCase());
      expect(isSwatchHex(key), `${s.name} key must whitelist`).toBe(true);
    }
  });

  it("swatchDotCss renders a flat fill for singles and a diagonal split for duos", () => {
    expect(swatchDotCss("#a78bfa")).toBe("#a78bfa");
    const duo = ROOM_ACCENT_SWATCHES.find((s) => s.hex2)!;
    const css = swatchDotCss(swatchKey(duo));
    expect(css).toContain("linear-gradient(135deg");
    expect(css).toContain(duo.hex.toLowerCase());
    expect(css).toContain(duo.hex2!.toLowerCase());
  });

  // REPLACES "the four room presets are all in the palette". That assumption died with the
  // 2026-08-27 five-hybrid freeze: the DEFAULT and the SELECTABLE palette are now deliberately
  // separate. Pin the separation itself, so nothing quietly re-adds the default as a sixth option.
  it("the DEFAULT accent is NOT a selectable swatch — default and palette are separate on purpose", () => {
    const keys = new Set(ROOM_ACCENT_SWATCHES.map(swatchKey));
    for (const room of PICKABLE_ROOMS) {
      const def = defaultRoomAccent(room).toLowerCase();
      expect(keys.has(def), `${room}'s default ${def} must not be a swatch key`).toBe(false);
      expect(isSwatchHex(def), `${room}'s default ${def} must not whitelist as a pick`).toBe(false);
    }
    // Violet / Teal carries the default violet as its PRIMARY, but its KEY is the composite — so a
    // defaulted room reads as "nothing selected", never as a silent Violet / Teal pick.
    const vt = ROOM_ACCENT_SWATCHES.find((x) => x.name === "Violet / Teal")!;
    expect(vt.hex.toLowerCase()).toBe(HOME_ACCENT.toLowerCase());
    expect(swatchKey(vt)).not.toBe(HOME_ACCENT.toLowerCase());
  });

  it("isSwatchHex whitelists only palette hexes (case-insensitive), rejects others", () => {
    expect(isSwatchHex("#35E0E8+#3B2A7A")).toBe(true);
    expect(isSwatchHex("#000000")).toBe(false);
    expect(isSwatchHex("not-a-hex")).toBe(false);
  });
});

describe("room-accents: default + pickable set", () => {
  it("defaultRoomAccent maps home→brand violet and each room→its preset", () => {
    expect(defaultRoomAccent("home")).toBe(HOME_ACCENT);
    expect(defaultRoomAccent("play")).toBe(ROOM_IDENTITY.play);
    expect(defaultRoomAccent("learn")).toBe(ROOM_IDENTITY.learn);
    expect(defaultRoomAccent("lab")).toBe(ROOM_IDENTITY.lab);
    expect(defaultRoomAccent("fix")).toBe(ROOM_IDENTITY.fix);
  });

  it("PICKABLE_ROOMS is home + the four rooms, and NOT the legacy 'check' room", () => {
    expect(new Set(PICKABLE_ROOMS)).toEqual(new Set(["home", "play", "learn", "lab", "fix"]));
    expect((PICKABLE_ROOMS as string[]).includes("check")).toBe(false);
  });
});

describe("room-accents: persisted store round-trips + rejects junk", () => {
  beforeEach(() => {
    localStorage.clear();
    document.getElementById("compy-room-accents")?.remove();
  });

  it("setRoomAccent persists a swatch and readRoomAccents returns it; null clears", () => {
    setRoomAccent("play", "#46a8ff+#27e08a");
    expect(readRoomAccents().play).toBe("#46a8ff+#27e08a");
    setRoomAccent("play", null);
    expect(readRoomAccents().play).toBeUndefined();
  });

  // watch-item → guard (self-review 2026-07-13): the reviewer once observed one room's stored pick
  // appearing under another room during rapid probing (unreproduced). Pin the underlying invariant so
  // it can never become real: writing/clearing ONE room's pick must leave every sibling room untouched.
  it("setRoomAccent writes ONLY the target room — sibling picks are never mutated", () => {
    setRoomAccent("home", "#b6f24a+#35e0e8"); // Lime / Cyan
    setRoomAccent("learn", "#f45cc6+#6b2b9e"); // Magenta / Violet
    setRoomAccent("play", "#46a8ff+#27e08a"); // Sky / Emerald — must not disturb home/learn
    let got = readRoomAccents();
    expect(got.home).toBe("#b6f24a+#35e0e8");
    expect(got.learn).toBe("#f45cc6+#6b2b9e");
    expect(got.play).toBe("#46a8ff+#27e08a");
    setRoomAccent("play", null); // clearing one leaves the others intact
    got = readRoomAccents();
    expect(got.play).toBeUndefined();
    expect(got.home).toBe("#b6f24a+#35e0e8");
    expect(got.learn).toBe("#f45cc6+#6b2b9e");
  });

  it("a non-swatch value (tampered store) is ignored — the legibility guarantee holds", () => {
    localStorage.setItem(
      "compy_room_accents",
      JSON.stringify({ play: "#000000", learn: "#a78bfa+#3fd9c2" }),
    );
    const got = readRoomAccents();
    expect(got.play).toBeUndefined(); // #000000 not a swatch → dropped
    expect(got.learn).toBe("#a78bfa+#3fd9c2"); // a real swatch → kept
  });

  it("setRoomAccent refuses to apply a non-swatch hex (treats it as a clear)", () => {
    setRoomAccent("lab", "#123456");
    expect(readRoomAccents().lab).toBeUndefined();
  });
});

describe("room-accents: managed <style> is scoped + same-element (flag-off inert, gotcha handled)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.getElementById("compy-room-accents")?.remove();
  });

  it("applyRoomAccents emits a scoped rule with same-element --v2-accent + dim + line per pick", () => {
    setRoomAccent("play", "#46a8ff+#27e08a"); // Sky / Emerald — setRoomAccent calls applyRoomAccents
    const css = document.getElementById("compy-room-accents")!.textContent!;
    // scoped under the flag → inert when off
    expect(css).toContain(':root[data-room-identity="on"] .v2-room[data-room="play"]{');
    // all three tokens re-declared SAME element (the var()-declaring-element gotcha). Since the
    // freeze every pick is a duo, so the washes derive from the SECONDARY, not the primary.
    expect(css).toContain("--v2-accent:#46a8ff;");
    expect(css).toMatch(/--v2-accent-dim:color-mix\(in srgb, #27e08a 14%/);
    expect(css).toMatch(/--v2-accent-line:color-mix\(in srgb, #27e08a 25%/);
  });

  // Adaptive ink/text (owner 2026-07-13, "Option B"): a DARK pick emitted its paired light ink/text
  // as --v2-accent-ink/--ix-accent-ink and --v2-accent-text/--ix-accent-text. The 2026-07-16 palette
  // rework retired the last dark swatches (Slate/Plum/Wine → spectrum singles + duos), so the
  // emission path in theme.ts is DORMANT: swatchInk/swatchText return undefined for every current
  // swatch, and NO pick may emit an ink/text override (a stray one would flip a bright fill to
  // light-on-bright — illegible). If a dark swatch ever returns, restore the dark-pick emission pins
  // from git history (room-accents.test.tsx @ 8e6920f) alongside it.
  it("no current pick emits --v2-accent-ink/--ix-accent-ink (all swatches live under the default dark ink)", () => {
    for (const s of ROOM_ACCENT_SWATCHES) {
      setRoomAccent("play", swatchKey(s));
      const css = document.getElementById("compy-room-accents")!.textContent!;
      expect(css, s.name).toContain(`--v2-accent:${s.hex.toLowerCase()};`);
      expect(css, s.name).not.toContain("--v2-accent-ink:");
      expect(css, s.name).not.toContain("--ix-accent-ink:");
    }
  });

  it("no current pick emits --v2-accent-text/--ix-accent-text (every accent stays legible as raw text)", () => {
    for (const s of ROOM_ACCENT_SWATCHES) {
      setRoomAccent("play", swatchKey(s));
      const css = document.getElementById("compy-room-accents")!.textContent!;
      expect(css, s.name).not.toContain("--v2-accent-text:");
      expect(css, s.name).not.toContain("--ix-accent-text:");
    }
  });

  // DUO emission (owner 2026-07-13b): the PRIMARY is the accent proper; the SECONDARY drives ONLY
  // the dim/line washes. A duo pick must never emit ink/text (bright primary by construction).
  it("a DUO pick emits --v2-accent from the PRIMARY and dim/line washes from the SECONDARY, no ink/text", () => {
    const duo = ROOM_ACCENT_SWATCHES.find((s) => s.name === "Cyan / Midnight")!;
    setRoomAccent("play", swatchKey(duo));
    const css = document.getElementById("compy-room-accents")!.textContent!;
    expect(css).toContain(`--v2-accent:${duo.hex.toLowerCase()};`);
    expect(css).toMatch(new RegExp(`--v2-accent-dim:color-mix\\(in srgb, ${duo.hex2!.toLowerCase()} 14%`));
    expect(css).toMatch(new RegExp(`--v2-accent-line:color-mix\\(in srgb, ${duo.hex2!.toLowerCase()} 25%`));
    expect(css).not.toContain("--v2-accent-ink:");
    expect(css).not.toContain("--v2-accent-text:");
    // the raw composite key must never leak into the CSS output
    expect(css).not.toContain("+");
  });

  it("a DUO key round-trips the persisted store; a tampered composite of non-swatch parts is rejected", () => {
    const duo = ROOM_ACCENT_SWATCHES.find((s) => s.hex2)!;
    setRoomAccent("lab", swatchKey(duo));
    expect(readRoomAccents().lab).toBe(swatchKey(duo));
    localStorage.setItem(
      "compy_room_accents",
      JSON.stringify({ play: "#000000+#111111", learn: swatchKey(duo) }),
    );
    const got = readRoomAccents();
    expect(got.play).toBeUndefined(); // junk composite → dropped (whitelist is exact keys)
    expect(got.learn).toBe(swatchKey(duo)); // a real duo key → kept
  });

  it("every generated rule header carries the [data-room-identity=\"on\"] scope", () => {
    setRoomAccent("home", "#35e0e8+#3b2a7a");
    setRoomAccent("lab", "#b6f24a+#35e0e8");
    const css = document.getElementById("compy-room-accents")!.textContent!;
    const headers = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
    expect(headers.length).toBeGreaterThan(0);
    for (const h of headers) expect(h).toContain(':root[data-room-identity="on"]');
  });

  it("removes the <style> entirely when no picks remain (unused feature = zero DOM)", () => {
    setRoomAccent("play", "#46a8ff+#27e08a");
    expect(document.getElementById("compy-room-accents")).not.toBeNull();
    setRoomAccent("play", null);
    expect(document.getElementById("compy-room-accents")).toBeNull();
  });
});

describe("room-accents: picker is flag-gated (DEFAULT ON 2026-07-13; '0' failsafe removes it)", () => {
  afterEach(cleanup);
  beforeEach(() => {
    localStorage.clear();
    document.getElementById("compy-room-accents")?.remove();
    delete document.documentElement.dataset.roomIdentity;
  });

  const shell = () => (
    <ShellV2 items={railFor(true)} activeId="play" onNavigate={() => {}} ledgerCount={0}>
      <div>room</div>
    </ShellV2>
  );

  it("the accent picker renders by DEFAULT (key absent) — room identity is the build", () => {
    const { container } = render(shell());
    expect(container.querySelector(".v2-accent-pick")).not.toBeNull();
  });

  it("the explicit '0' devtools failsafe removes the picker (classic uniform topbar)", () => {
    localStorage.setItem("compy_room_identity", "0");
    const { container } = render(shell());
    expect(container.querySelector(".v2-accent-pick")).toBeNull();
  });
});

describe("room-accents: picker interaction (pick → persist → reset)", () => {
  afterEach(cleanup);
  beforeEach(() => {
    localStorage.clear();
    document.getElementById("compy-room-accents")?.remove();
  });

  it("picking a swatch persists it for the room and marks it selected; reset clears", () => {
    render(<RoomAccentPicker room={"play" as PickableRoom} roomLabel="Monitor" />);
    // open the popover
    fireEvent.click(screen.getByRole("button", { name: /Monitor accent color/ }));
    // pick Sky / Emerald
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Sky / Emerald" }));
    expect(readRoomAccents().play).toBe("#46a8ff+#27e08a");
    // re-open → Sky / Emerald is checked
    fireEvent.click(screen.getByRole("button", { name: /Monitor accent color/ }));
    expect(
      screen.getByRole("menuitemradio", { name: "Sky / Emerald" }).getAttribute("aria-checked"),
    ).toBe("true");
    // reset → cleared
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset to default" }));
    expect(readRoomAccents().play).toBeUndefined();
  });

  // bug→guard (self-review round 2): an open popover floated over the new room on nav (open state
  // wasn't reset on room change). Pin that changing the room prop closes it.
  it("closes the popover when the active room changes (never floats over the new room)", () => {
    const { rerender } = render(<RoomAccentPicker room={"lab" as PickableRoom} roomLabel="Lab" />);
    fireEvent.click(screen.getByRole("button", { name: /Lab accent color/ }));
    expect(document.querySelector(".v2-accent-pop")).not.toBeNull(); // open
    rerender(<RoomAccentPicker room={"home" as PickableRoom} roomLabel="Home" />);
    expect(document.querySelector(".v2-accent-pop")).toBeNull(); // closed on room switch
  });
});

// bug→guard (self-review 2026-07-12b, two FAIL findings fixed before ship):
describe("room-accents: bug→guard (self-review 2026-07-12b)", () => {
  const pickerCss = readFileSync(join("src", "design", "room-accent-picker.css"), "utf8");
  const sessionStackTsx = readFileSync(join("src", "surfaces", "monitor", "SessionStack.tsx"), "utf8");

  it("(a) reduced-motion rules use the COMPOUND [data-v2][data-motion] form (both attrs on <html>)", () => {
    // A descendant SPACE would demand [data-v2] be a child of :root[data-motion] — never matches, so
    // the hover-scale suppression silently died under reduced motion. Pin the no-space compound form.
    expect(pickerCss).toContain('data-motion="reduced"');
    expect(pickerCss).not.toMatch(/data-motion="reduced"\]\s+\[data-v2/);
    expect(pickerCss).not.toMatch(/data-v2="on"\]\s+\[data-motion/);
    expect(pickerCss).toMatch(
      /:root\[data-v2="on"\]\[data-motion="reduced"\]\s+\.v2-accent-swatch:hover/,
    );
  });

  it("(b) SessionStack repaints the newest trace on an in-place accent pick", () => {
    // The draw effect reads --ix-accent at paint time; without a live listener a pick only showed
    // after the room remounted. Pin the event listener AND that its tick feeds the draw deps.
    expect(sessionStackTsx).toMatch(/addEventListener\(\s*["']compy:room-identity-changed["']/);
    expect(sessionStackTsx).toMatch(/setAccentTick/);
    // 2026-07-16 (nav-mount follow-up): the listener/tick hoisted to the parent — ONE listener,
    // tick passed down + keying the shared ink cache — but it must still feed every row's draw deps.
    expect(sessionStackTsx).toMatch(/roomIdentityOn,\s*accentTick,\s*inkFor\s*\]/);
  });
});

// ── "Apply to all rooms" (owner taste call 2026-07-23: per-room freedom stays, one tap makes the
// whole app match — resolves the tester read of per-room accents as inconsistent theming) ──
describe("apply to all rooms", () => {
  it("persists the CURRENT accent to every pickable room with ONE change event, and per-room picking stays intact", () => {
    localStorage.clear();
    const events = vi.fn();
    window.addEventListener("compy:room-identity-changed", events);
    const cyanMidnight = swatchKey(ROOM_ACCENT_SWATCHES.find((s) => s.name === "Cyan / Midnight")!);
    setRoomAccent("play", cyanMidnight); // the source room's pick is what gets stamped
    events.mockClear();
    render(<RoomAccentPicker room="play" roomLabel="Monitor" />);
    fireEvent.click(screen.getByRole("button", { name: "Monitor accent color" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Apply to all rooms" }));
    const stored = readRoomAccents();
    for (const room of PICKABLE_ROOMS) expect(stored[room]).toBe(cyanMidnight);
    expect(events).toHaveBeenCalledTimes(1);
    // A later SINGLE-room pick moves only that room — apply-to-all is a one-shot, not a mode.
    const limeCyan = swatchKey(ROOM_ACCENT_SWATCHES.find((s) => s.name === "Lime / Cyan")!);
    setRoomAccent("learn", limeCyan);
    const after = readRoomAccents();
    expect(after.learn).toBe(limeCyan);
    expect(after.home).toBe(cyanMidnight);
    expect(after.play).toBe(cyanMidnight);
    window.removeEventListener("compy:room-identity-changed", events);
    localStorage.clear();
  });

  // Since the 2026-08-27 freeze the default violet is deliberately NOT a whitelisted swatch, so an
  // unpicked room cannot express "apply what I am showing" as a hex. Apply-to-all from a defaulted
  // room CLEARS every room instead — the same visible end state (the whole app on the default),
  // reached honestly rather than by persisting a value the next read would reject.
  it("closes the popover on apply; from a room with no pick it puts every room on the DEFAULT", () => {
    localStorage.clear();
    setRoomAccent("lab", swatchKey(ROOM_ACCENT_SWATCHES[0])); // a stale pick elsewhere…
    render(<RoomAccentPicker room="home" roomLabel="Home" />);
    fireEvent.click(screen.getByRole("button", { name: "Home accent color" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Apply to all rooms" }));
    expect(screen.queryByRole("menu")).toBeNull();
    const stored = readRoomAccents();
    for (const room of PICKABLE_ROOMS) expect(stored[room]).toBeUndefined(); // …is cleared too
    // and every room therefore resolves to its default accent
    for (const room of PICKABLE_ROOMS) expect(defaultRoomAccent(room)).toBe(HOME_ACCENT);
    localStorage.clear();
  });
});
