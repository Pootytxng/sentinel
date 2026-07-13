import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { ROOM_IDENTITY, HOME_ACCENT, type RoomKey } from "../design/room-identity";
import { readRoomIdentity, applyRoomIdentity } from "../design/theme";

// Per-room identity accents (owner 2026-07-12 "per-room identity"). This guard mechanizes the two
// invariants that keep the feature honest:
//   1. FLAG-OFF BYTE-IDENTITY — every rule in room-identity.css is scoped under
//      [data-room-identity="on"], so the absent/"0" state cannot touch a single pixel.
//   2. SOURCE-OF-TRUTH SYNC + DISTINCTNESS — the CSS hexes equal ROOM_IDENTITY exactly (one
//      palette, no drift) and the visible rooms are pairwise distinguishable (the whole point).

const roomCss = readFileSync(join("src", "surfaces", "room-identity.css"), "utf8");
const themeTs = readFileSync(join("src", "design", "theme.ts"), "utf8");
const mainTsx = readFileSync(join("src", "main.tsx"), "utf8");
const tokensCss = readFileSync(join("src", "design", "tokens-v2.css"), "utf8");
const rigColorsTs = readFileSync(join("src", "surfaces", "rig", "use-rig-colors.ts"), "utf8");

// Strip comments so hex/selector scans see only live CSS.
const liveCss = roomCss.replace(/\/\*[\s\S]*?\*\//g, "");

describe("room-identity: flag-off byte-identity (scoping)", () => {
  it("every rule header is scoped under :root[data-room-identity=\"on\"]", () => {
    const offenders: string[] = [];
    let depth = 0;
    let buf = "";
    for (const ch of liveCss) {
      if (ch === "{") {
        if (depth === 0) {
          const sel = buf.trim();
          if (sel && !/:root\[data-room-identity="on"\]/.test(sel)) offenders.push(sel);
        }
        depth++;
        buf = "";
      } else if (ch === "}") {
        depth--;
        buf = "";
      } else {
        buf += ch;
      }
    }
    expect(offenders).toEqual([]);
  });

  it("only ever sets accent-family custom props (never a raw color property that would paint unscoped)", () => {
    // The mechanism is scoped accent-token overrides only — no `color`/`background`/`border` here.
    const allowed = new Set(["--v2-accent", "--v2-accent-dim", "--v2-accent-line"]);
    const bodies = [...liveCss.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]);
    const props = bodies.flatMap((b) =>
      [...b.matchAll(/([a-zA-Z-][\w-]*)\s*:/g)].map((m) => m[1]),
    );
    expect(props.length).toBeGreaterThan(0);
    for (const p of props) expect(allowed.has(p), `unexpected property ${p}`).toBe(true);
  });
});

describe("room-identity: palette is the single source of truth", () => {
  const rooms: RoomKey[] = ["play", "learn", "lab", "fix"];

  it("each room's CSS hex equals ROOM_IDENTITY exactly", () => {
    for (const room of rooms) {
      const rule = new RegExp(
        `\\.v2-room\\[data-room="${room}"\\]\\s*\\{[^}]*--v2-accent:\\s*(#[0-9a-fA-F]{6})`,
      );
      const m = liveCss.match(rule);
      expect(m, `room ${room} must have a scoped --v2-accent rule`).not.toBeNull();
      expect(m![1].toLowerCase()).toBe(ROOM_IDENTITY[room].toLowerCase());
    }
  });

  it("the CSS defines exactly the four room rules and no stray rooms", () => {
    const roomsInCss = [...liveCss.matchAll(/\.v2-room\[data-room="([a-z]+)"\]/g)].map((m) => m[1]);
    expect(new Set(roomsInCss)).toEqual(new Set(rooms));
  });
});

describe("room-identity: rooms are distinguishable (the whole point)", () => {
  it("the three visible rooms (Monitor/Blackbook/Lab) are pairwise-distinct and differ from Home", () => {
    const visible = [ROOM_IDENTITY.play, ROOM_IDENTITY.learn, ROOM_IDENTITY.lab];
    expect(new Set(visible).size).toBe(3); // pairwise distinct
    for (const hue of visible) expect(hue.toLowerCase()).not.toBe(HOME_ACCENT.toLowerCase());
  });

  it("the Optimize station shares the Lab family emerald (intentional, one bench)", () => {
    expect(ROOM_IDENTITY.fix).toBe(ROOM_IDENTITY.lab);
  });
});

describe("room-identity: DEFAULT OFF wiring", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.roomIdentity;
  });

  it("readRoomIdentity is false unless the key is literally \"1\"", () => {
    expect(readRoomIdentity()).toBe(false); // absent
    localStorage.setItem("compy_room_identity", "0");
    expect(readRoomIdentity()).toBe(false);
    localStorage.setItem("compy_room_identity", "on");
    expect(readRoomIdentity()).toBe(false); // only "1" counts
    localStorage.setItem("compy_room_identity", "1");
    expect(readRoomIdentity()).toBe(true);
  });

  it("theme.ts reader is === \"1\" (opt-in), not !== \"0\" (opt-out)", () => {
    expect(themeTs).toMatch(/ROOM_IDENTITY_KEY\)\s*===\s*"1"/);
  });

  it("main.tsx sets the boot attribute ONLY when the key is \"1\"", () => {
    expect(mainTsx).toMatch(/getItem\("compy_room_identity"\)\s*===\s*"1"/);
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

// bug→guard (self-review rounds 1+2 FAIL, 2026-07-12): the derived accent washes (--v2-accent-dim/
// -line, feeding --accent-soft/-line/-glow, --ix-accent-wash, the .play-armed hairline) stayed violet
// under a room's teal/amber/emerald chrome. ROOT CAUSE (proven live): a var()-chain in a custom
// property substitutes at ITS DECLARING element, so the :root dim/line bake root's violet and a
// per-room --v2-accent override can't retro-follow them. FIX: re-declare dim/line on the SAME room
// element (same-element resolution). This guard pins that the room blocks carry all three tokens and
// that :root keeps a concrete (non-var) default so flag-off is unchanged.
describe("room-identity: derived washes are re-declared per room (same-element, so they follow)", () => {
  const rooms: RoomKey[] = ["play", "learn", "lab", "fix"];

  it("every room block re-declares --v2-accent-dim AND --v2-accent-line (not just --v2-accent)", () => {
    for (const room of rooms) {
      const block =
        liveCss.match(new RegExp(`\\.v2-room\\[data-room="${room}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      expect(block, `room ${room} block`).toMatch(/--v2-accent-dim:\s*color-mix\(/);
      expect(block, `room ${room} block`).toMatch(/--v2-accent-line:\s*color-mix\(/);
      // dim/line mix the room's OWN hex, not violet
      expect(block).toContain(ROOM_IDENTITY[room]);
      expect(block).not.toMatch(/167,\s*139,\s*250/);
    }
  });

  it(":root default dim/line stay concrete (a var()-chain there would silently not follow)", () => {
    // The default (flag-off) tokens must NOT be `var(--v2-accent)`-derived — that form bakes at :root
    // and looks like it follows when it doesn't. Concrete rgba keeps flag-off honest + byte-identical.
    expect(tokensCss).toMatch(/--v2-accent-dim:\s*rgba\(167,\s*139,\s*250/);
    expect(tokensCss).toMatch(/--v2-accent-line:\s*rgba\(167,\s*139,\s*250/);
  });
});

// bug→guard (self-review round 1 FAIL, 2026-07-12): the rig hologram bay read --ix-accent off
// documentElement, so Lab's hologram cage stayed violet while the room went emerald. It must read
// the room-scoped accent when the flag is on and re-resolve when the flag flips.
describe("room-identity: rig hologram bay follows the room accent when flagged", () => {
  it("use-rig-colors resolves from the active .v2-room when readRoomIdentity() is on", () => {
    expect(rigColorsTs).toMatch(/readRoomIdentity\(\)/);
    expect(rigColorsTs).toMatch(/querySelector<HTMLElement>\(["']\.v2-room["']\)/);
  });
  it("use-rig-colors re-resolves on the room-identity flag change (attr + event)", () => {
    expect(rigColorsTs).toMatch(/attributeFilter:\s*\[[^\]]*"data-room-identity"/);
    expect(rigColorsTs).toMatch(/compy:room-identity-changed/);
  });
});
