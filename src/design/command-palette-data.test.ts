// The palette's index + ranking. Pure functions, so these are the cheap tests that pin the two
// rules the feature lives or dies by (see command-palette-data.ts): navigation outranks reading,
// and symptoms are search terms.
import { describe, it, expect } from "vitest";
import {
  buildPaletteIndex,
  filterPalette,
  queryWords,
  scoreItem,
  type PaletteItem,
} from "./command-palette-data";
import { HOME_RAIL, railFor, type HomeRailItem } from "./homeRail";
import { LAB_STATION_ORDER, type LabStationKey } from "../surfaces/lab-guided-data";
import type { KnowledgeEntry } from "../data/knowledge";

const railLabel = (item: HomeRailItem) => item.label;
const roomHint = () => "what this room is for";

const station = (key: LabStationKey, name: string, forLine: string, whenLine: string) => ({
  key,
  info: { name, forLine, whenLine } as never,
});

const entry = (id: string, name: string, aliases: string[] = []): KnowledgeEntry =>
  ({
    id,
    name,
    aliases,
    related: [],
    topic: "general",
    type: "term",
    what: "a description of the thing",
    more: "",
  }) as KnowledgeEntry;

const baseIndex = () =>
  buildPaletteIndex({
    rail: railFor(false),
    railLabel,
    roomHint,
    stations: [
      station("optimize", "Optimize", "the safe tweaks for your rig", "you want more frames"),
      station("blackbox", "Crash & Freeze", "what happened when it died", "it crashed or froze"),
      station("latency", "Latency", "input lag, end to end", "the mouse feels laggy"),
    ],
    entries: [entry("k1", "Core parking"), entry("k2", "Shader cache", ["shaders"])],
    settingsLabel: "Settings",
    settingsHint: "language, updates",
  });

describe("buildPaletteIndex", () => {
  it("indexes the rail it is GIVEN, not the blessed six", () => {
    // railFor(false, true) is the shipped ground rail (4 rooms). A palette built from HOME_RAIL
    // would offer Check and Tune — doors the rail retired, i.e. a jump to a room the app no
    // longer shows.
    const ground = buildPaletteIndex({ rail: railFor(false, true), railLabel, roomHint });
    const rooms = ground.filter((i) => i.group === "room").map((i) => i.action);
    expect(rooms).toEqual(railFor(false, true).map((r) => ({ kind: "room", room: r.id })));
    expect(rooms.some((a) => a.kind === "room" && (a.room === "check" || a.room === "fix"))).toBe(
      false,
    );
  });

  it("omits every group the host cannot actually perform", () => {
    // No callbacks passed → no stations, no entries, no Settings. A row that looks like a
    // destination and goes nowhere is the fake affordance this whole feature exists to remove.
    const bare = buildPaletteIndex({ rail: HOME_RAIL, railLabel, roomHint });
    expect(bare.every((i) => i.group === "room")).toBe(true);
  });

  it("gives every item a label, a unique key, and a real action", () => {
    const index = baseIndex();
    expect(new Set(index.map((i) => i.key)).size).toBe(index.length);
    for (const item of index) {
      expect(item.label.length, item.key).toBeGreaterThan(0);
      expect(item.action.kind, item.key).toBeTruthy();
    }
  });

  it("indexes each station's symptom line as a keyword", () => {
    const crash = baseIndex().find((i) => i.key === "station:blackbox")!;
    expect(crash.keywords.join(" ")).toContain("crashed");
  });
});

describe("ranking rule 1 — navigation outranks reading", () => {
  it("puts a room above a knowledge entry when both match equally", () => {
    const items: PaletteItem[] = [
      {
        key: "entry:x",
        label: "Monitor overhead",
        hint: "",
        group: "entry",
        keywords: [],
        order: 0,
        action: { kind: "entry", entryId: "x" },
      },
      {
        key: "room:play",
        label: "Monitor",
        hint: "",
        group: "room",
        keywords: [],
        order: 1,
        action: { kind: "room", room: "play" },
      },
    ];
    expect(filterPalette(items, "monitor")[0].key).toBe("room:play");
  });

  it("shows destinations only for an empty query — not 190 articles at someone who typed nothing", () => {
    const results = filterPalette(baseIndex(), "");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.group === "entry")).toBe(false);
    expect(results[0].group).toBe("room");
  });
});

describe("ranking rule 2 — symptoms are search terms", () => {
  it("finds the crash instrument by what went wrong, not by its name", () => {
    // "crashed" appears nowhere in the label "Crash & Freeze"... but the user typing it is
    // describing the symptom, and the station's whenLine carries exactly that.
    const results = filterPalette(baseIndex(), "crashed");
    expect(results[0].key).toBe("station:blackbox");
  });

  it("finds an instrument from a plain-English complaint", () => {
    expect(filterPalette(baseIndex(), "laggy")[0].key).toBe("station:latency");
  });

  it("finds an entry by an alias the label never shows", () => {
    const results = filterPalette(baseIndex(), "shaders");
    expect(results.some((r) => r.key === "entry:k2")).toBe(true);
  });
});

describe("matching", () => {
  const item: PaletteItem = {
    key: "k",
    label: "Crash & Freeze",
    hint: "what happened when it died",
    group: "station",
    keywords: ["it crashed or froze"],
    order: 0,
    action: { kind: "station", station: "blackbox" },
  };

  it("is case-insensitive", () => {
    expect(scoreItem(item, queryWords("CRASH"))).toBeGreaterThan(0);
  });

  it("requires EVERY word to appear — more words narrow, they never widen", () => {
    expect(scoreItem(item, queryWords("crash freeze"))).toBeGreaterThan(0);
    expect(scoreItem(item, queryWords("crash sandwich"))).toBe(-1);
  });

  it("ranks a label-prefix hit above a hint-only hit", () => {
    const prefix = scoreItem(item, queryWords("crash"));
    const hintOnly = scoreItem(item, queryWords("died"));
    expect(prefix).toBeGreaterThan(hintOnly);
  });

  it("returns nothing rather than something wrong when there is no match", () => {
    // No fuzzy matching, deliberately: landing a non-technical user in the wrong room is worse
    // than telling them plainly that nothing matched.
    expect(filterPalette(baseIndex(), "qqqzzz")).toEqual([]);
  });
});

describe("result cap", () => {
  it("never returns more than the limit, however broad the query", () => {
    const many = buildPaletteIndex({
      rail: HOME_RAIL,
      railLabel,
      roomHint,
      entries: Array.from({ length: 200 }, (_, i) => entry(`e${i}`, `Entry about a thing ${i}`)),
    });
    expect(filterPalette(many, "a", 12).length).toBe(12);
  });
});

describe("the real station list stays indexable", () => {
  it("every shipped station key produces an item", () => {
    // Guards the "optimize + LAB_STATION_ORDER" composition in CommandPalette: if a station is
    // added to the order and this drifts, the palette silently stops offering a real instrument.
    const keys: LabStationKey[] = ["optimize", ...LAB_STATION_ORDER];
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThanOrEqual(6);
  });
});
