import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { ROOM_IDENTITY, HOME_ACCENT, type RoomKey } from "../design/room-identity";
import { readRoomIdentity, applyRoomIdentity } from "../design/theme";

// COLOR-1 (design foundation step ①, docs/decisions/2026-08-11-design-foundation.md, 2026-08-13):
// rooms gave up their hue. This guard's job FLIPPED on that date — it used to pin that the four
// per-room preset accents existed, were distinct, and matched ROOM_IDENTITY; it now pins that the
// presets STAY DELETED and every room defaults to the one violet accent, because the old presets
// collided with the status palette (Lab emerald ≈ --v2-ok; Blackbook amber ≈ --v2-warn) and colour
// stopped being information. The user's per-room accent PICKER (owner 2026-07-12b) survives, so
// the flag wiring and theme.ts pick-injection mechanism keep their guards.

const roomCss = readFileSync(join("src", "surfaces", "room-identity.css"), "utf8");
const themeTs = readFileSync(join("src", "design", "theme.ts"), "utf8");
const mainTsx = readFileSync(join("src", "main.tsx"), "utf8");
const tokensCss = readFileSync(join("src", "design", "tokens-v2.css"), "utf8");
const rigColorsTs = readFileSync(join("src", "surfaces", "rig", "use-rig-colors.ts"), "utf8");

// Strip comments so scans see only live CSS.
const liveCss = roomCss.replace(/\/\*[\s\S]*?\*\//g, "");

describe("COLOR-1: room preset accents are deleted and stay deleted", () => {
  it("room-identity.css carries NO live rules at all (the deletion is the feature)", () => {
    expect(liveCss.replace(/\s/g, "")).toBe("");
  });

  it("no room preset hue survives anywhere in the file, even commented back in", () => {
    // The old teal/amber/emerald must not return as live CSS. (They MAY appear in the header
    // comment as history; liveCss has comments stripped, so this only catches live rules.)
    for (const hex of ["#3fd9c2", "#f0b878", "#27e08a"]) {
      expect(liveCss.toLowerCase()).not.toContain(hex);
    }
  });

  it("every room's DEFAULT accent is the one violet (rooms own no hue)", () => {
    const rooms: RoomKey[] = ["play", "learn", "lab", "fix"];
    for (const room of rooms) {
      expect(ROOM_IDENTITY[room].toLowerCase()).toBe(HOME_ACCENT.toLowerCase());
    }
  });

  it("the one accent is the approved violet #a78bfa, and tokens-v2 agrees", () => {
    expect(HOME_ACCENT.toLowerCase()).toBe("#a78bfa");
    expect(tokensCss).toMatch(/--v2-accent:\s*#a78bfa/);
  });

  it(":root default dim/line washes stay concrete violet (flag-off honesty, pre-existing pin)", () => {
    expect(tokensCss).toMatch(/--v2-accent-dim:\s*rgba\(167,\s*139,\s*250/);
    expect(tokensCss).toMatch(/--v2-accent-line:\s*rgba\(167,\s*139,\s*250/);
  });
});

describe("room-identity flag: DEFAULT ON wiring survives (it gates the USER'S picker, not presets)", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.roomIdentity;
  });

  it('readRoomIdentity is true unless the key is literally "0" (the devtools failsafe)', () => {
    expect(readRoomIdentity()).toBe(true);
    localStorage.setItem("compy_room_identity", "1");
    expect(readRoomIdentity()).toBe(true);
    localStorage.setItem("compy_room_identity", "0");
    expect(readRoomIdentity()).toBe(false);
  });

  it('theme.ts reader is !== "0" (default ON, opt-out), not === "1" (opt-in)', () => {
    expect(themeTs).toMatch(/ROOM_IDENTITY_KEY\)\s*!==\s*"0"/);
  });

  it('main.tsx sets the boot attribute unless the key is "0"', () => {
    expect(mainTsx).toMatch(/getItem\("compy_room_identity"\)\s*!==\s*"0"/);
  });

  it("applyRoomIdentity round-trips the attribute + localStorage", () => {
    applyRoomIdentity(true);
    expect(document.documentElement.dataset.roomIdentity).toBe("on");
    expect(localStorage.getItem("compy_room_identity")).toBe("1");
    applyRoomIdentity(false);
    expect(document.documentElement.dataset.roomIdentity).toBeUndefined();
    expect(localStorage.getItem("compy_room_identity")).toBe("0");
  });
});

// bug→guard (self-review round 1 FAIL, 2026-07-12): the rig hologram bay read --ix-accent off
// documentElement, so a room's picked accent didn't reach the hologram. The reader mechanism now
// serves USER picks (COLOR-1 removed presets), but the same resolution bugs would bite a pick.
describe("rig hologram follows a picked room accent (mechanism guards survive COLOR-1)", () => {
  it("use-rig-colors resolves from the active .v2-room when readRoomIdentity() is on", () => {
    expect(rigColorsTs).toMatch(/readRoomIdentity\(\)/);
    expect(rigColorsTs).toMatch(/querySelector<HTMLElement>\(["']\.v2-room["']\)/);
  });

  it("use-rig-colors prefers .home-console (Home's re-point element) over the .v2-room fallback", () => {
    const homeIdx = rigColorsTs.indexOf('querySelector<HTMLElement>(".home-console")');
    const roomIdx = rigColorsTs.indexOf('querySelector<HTMLElement>(".v2-room")');
    expect(homeIdx, "the .home-console querySelector call must exist").toBeGreaterThan(-1);
    expect(roomIdx, "the .v2-room querySelector call must exist").toBeGreaterThan(-1);
    expect(homeIdx, ".home-console must be tried BEFORE the .v2-room fallback").toBeLessThan(roomIdx);
    expect(rigColorsTs).not.toMatch(/Home\s+takes no --ix-accent re-point/);
  });

  it("use-rig-colors re-resolves on the room-identity flag change (attr + event)", () => {
    expect(rigColorsTs).toMatch(/attributeFilter:\s*\[[^\]]*"data-room-identity"/);
    expect(rigColorsTs).toMatch(/compy:room-identity-changed/);
  });
});
