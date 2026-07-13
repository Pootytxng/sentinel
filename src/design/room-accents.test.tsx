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
  // would silently give it a needless light ink) — and proves the "dark tone" ask is really present.
  it("dark swatches (paired ink) genuinely FAIL the default dark ink — the adaptive ink is required", () => {
    const darkInk = parseHex(ACCENT_INK);
    const darks = ROOM_ACCENT_SWATCHES.filter((s) => s.ink);
    expect(darks.length, "the palette must actually contain dark-tone swatches").toBeGreaterThan(0);
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
    const panel = parseHex(PANEL_LIGHTEST);
    const darks = ROOM_ACCENT_SWATCHES.filter((s) => s.text);
    expect(darks.length, "the palette must carry paired accent-text tints").toBeGreaterThan(0);
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

  it("all swatches + inks are valid 6-digit hexes; swatches are pairwise-distinct", () => {
    for (const s of ROOM_ACCENT_SWATCHES) {
      expect(s.hex).toMatch(/^#[0-9a-fA-F]{6}$/);
      if (s.ink) expect(s.ink, `${s.name} ink`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    expect(new Set(ROOM_ACCENT_SWATCHES.map((s) => s.hex.toLowerCase())).size).toBe(
      ROOM_ACCENT_SWATCHES.length,
    );
  });

  it("the four room presets are all in the palette (a room's own hue is always pickable)", () => {
    const hexes = new Set(ROOM_ACCENT_SWATCHES.map((s) => s.hex.toLowerCase()));
    for (const preset of [HOME_ACCENT, ROOM_IDENTITY.play, ROOM_IDENTITY.learn, ROOM_IDENTITY.lab]) {
      expect(hexes.has(preset.toLowerCase()), `${preset} missing from palette`).toBe(true);
    }
  });

  it("isSwatchHex whitelists only palette hexes (case-insensitive), rejects others", () => {
    expect(isSwatchHex("#3FD9C2")).toBe(true);
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
    setRoomAccent("play", "#46a8ff");
    expect(readRoomAccents().play).toBe("#46a8ff");
    setRoomAccent("play", null);
    expect(readRoomAccents().play).toBeUndefined();
  });

  // watch-item → guard (self-review 2026-07-13): the reviewer once observed one room's stored pick
  // appearing under another room during rapid probing (unreproduced). Pin the underlying invariant so
  // it can never become real: writing/clearing ONE room's pick must leave every sibling room untouched.
  it("setRoomAccent writes ONLY the target room — sibling picks are never mutated", () => {
    setRoomAccent("home", "#9e1f46"); // Wine (dark)
    setRoomAccent("learn", "#f45cc6"); // Magenta (bright)
    setRoomAccent("play", "#6b2b9e"); // Plum — must not disturb home/learn
    let got = readRoomAccents();
    expect(got.home).toBe("#9e1f46");
    expect(got.learn).toBe("#f45cc6");
    expect(got.play).toBe("#6b2b9e");
    setRoomAccent("play", null); // clearing one leaves the others intact
    got = readRoomAccents();
    expect(got.play).toBeUndefined();
    expect(got.home).toBe("#9e1f46");
    expect(got.learn).toBe("#f45cc6");
  });

  it("a non-swatch value (tampered store) is ignored — the legibility guarantee holds", () => {
    localStorage.setItem("compy_room_accents", JSON.stringify({ play: "#000000", learn: "#f0b878" }));
    const got = readRoomAccents();
    expect(got.play).toBeUndefined(); // #000000 not a swatch → dropped
    expect(got.learn).toBe("#f0b878"); // a real swatch → kept
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
    setRoomAccent("play", "#46a8ff"); // setRoomAccent calls applyRoomAccents
    const css = document.getElementById("compy-room-accents")!.textContent!;
    // scoped under the flag → inert when off
    expect(css).toContain(':root[data-room-identity="on"] .v2-room[data-room="play"]{');
    // all three tokens re-declared SAME element (the var()-declaring-element gotcha)
    expect(css).toContain("--v2-accent:#46a8ff;");
    expect(css).toMatch(/--v2-accent-dim:color-mix\(in srgb, #46a8ff 14%/);
    expect(css).toMatch(/--v2-accent-line:color-mix\(in srgb, #46a8ff 25%/);
  });

  // Option B (adaptive ink, owner 2026-07-13): a DARK pick must emit its paired light ink as BOTH the
  // token (--v2-accent-ink) and the instrument ink (--ix-accent-ink, so it reaches every accent-fill
  // consumer even in a room that never re-pointed the ink, e.g. Home). A BRIGHT pick emits neither, so
  // the room keeps the default dark ink #1a0a2e. This is the mechanism that keeps a dark fill legible.
  it("a DARK pick emits the paired --v2-accent-ink AND --ix-accent-ink; a BRIGHT pick emits neither", () => {
    setRoomAccent("play", "#6b2b9e"); // Plum (dark, ink #f4e9ff)
    let css = document.getElementById("compy-room-accents")!.textContent!;
    expect(css).toContain("--v2-accent:#6b2b9e;");
    expect(css).toContain("--v2-accent-ink:#f4e9ff;");
    expect(css).toContain("--ix-accent-ink:#f4e9ff;");

    setRoomAccent("play", "#46a8ff"); // Sky (bright) — replaces the pick, no ink override
    css = document.getElementById("compy-room-accents")!.textContent!;
    expect(css).toContain("--v2-accent:#46a8ff;");
    expect(css).not.toContain("--v2-accent-ink:");
    expect(css).not.toContain("--ix-accent-ink:");
  });

  // The adaptive accent-TEXT emission (dark-pick legibility, 2026-07-13) — the MECHANISM half of the fix
  // (the swatch-data half is guarded above). A DARK pick must write its paired light text as BOTH
  // --v2-accent-text (for --v2-accent-as-text sites reading it via fallback) AND --ix-accent-text (the
  // instrument text token the room -v2 re-points map to var(--v2-accent); this same-element override wins
  // on source order). A BRIGHT pick writes neither, so its accent-text stays the raw, already-legible
  // accent. This pins theme.ts's emission — a dropped/typo'd `text` decl would slip every swatch-data test.
  it("a DARK pick emits the paired --v2-accent-text AND --ix-accent-text; a BRIGHT pick emits neither", () => {
    setRoomAccent("play", "#6b2b9e"); // Plum (dark, text #c79cef)
    let css = document.getElementById("compy-room-accents")!.textContent!;
    expect(css).toContain("--v2-accent-text:#c79cef;");
    expect(css).toContain("--ix-accent-text:#c79cef;");

    setRoomAccent("play", "#46a8ff"); // Sky (bright) — replaces the pick, no text override
    css = document.getElementById("compy-room-accents")!.textContent!;
    expect(css).not.toContain("--v2-accent-text:");
    expect(css).not.toContain("--ix-accent-text:");
  });

  it("every generated rule header carries the [data-room-identity=\"on\"] scope", () => {
    setRoomAccent("home", "#ff6b6b");
    setRoomAccent("lab", "#ffe14a");
    const css = document.getElementById("compy-room-accents")!.textContent!;
    const headers = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
    expect(headers.length).toBeGreaterThan(0);
    for (const h of headers) expect(h).toContain(':root[data-room-identity="on"]');
  });

  it("removes the <style> entirely when no picks remain (unused feature = zero DOM)", () => {
    setRoomAccent("play", "#46a8ff");
    expect(document.getElementById("compy-room-accents")).not.toBeNull();
    setRoomAccent("play", null);
    expect(document.getElementById("compy-room-accents")).toBeNull();
  });
});

describe("room-accents: picker is flag-gated (topbar byte-identity with the flag off)", () => {
  afterEach(cleanup);
  beforeEach(() => {
    localStorage.clear();
    document.getElementById("compy-room-accents")?.remove();
    delete document.documentElement.dataset.roomIdentity;
  });

  const shell = () => (
    <ShellV2 items={railFor(true)} activeId="play" onNavigate={() => {}} ledgerCount={0} version="0.1.0">
      <div>room</div>
    </ShellV2>
  );

  it("no accent picker in the topbar when room-identity is OFF", () => {
    const { container } = render(shell());
    expect(container.querySelector(".v2-accent-pick")).toBeNull();
  });

  it("the accent picker appears when room-identity is ON", () => {
    localStorage.setItem("compy_room_identity", "1");
    const { container } = render(shell());
    expect(container.querySelector(".v2-accent-pick")).not.toBeNull();
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
    // pick Sky
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Sky" }));
    expect(readRoomAccents().play).toBe("#46a8ff");
    // re-open → Sky is checked
    fireEvent.click(screen.getByRole("button", { name: /Monitor accent color/ }));
    expect(screen.getByRole("menuitemradio", { name: "Sky" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    // reset → cleared
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
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
    expect(sessionStackTsx).toMatch(/roomIdentityOn,\s*accentTick\s*\]/);
  });
});
