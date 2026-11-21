// n1-drift: a drifted setting is named in plain words with what it reads now, what Compy last recorded
// and when it last saw it as expected, for every kind Drift Watch can report (drift.rs / readiness.rs),
// in en and zh-CN. What the backend doesn't know is said so; "couldn't read" is never "unchanged";
// no cause or fault is ever claimed (Constitution section 38). Home gets the short form, Check the full.
// The values below are the strings readiness.rs really produces (pinned by the Rust test
// `drift_values_match_what_each_kind_really_produces`), not invented ones. Non-ASCII zh-CN text is
// written as escapes so this file never depends on an editor's encoding.
import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import enCommon from "../i18n/locales/en/common.json";
import zhCommon from "../i18n/locales/zh-CN/common.json";
import type { Drift } from "../types";
import { driftMore, driftSentence, driftShort, stampOf } from "./drift-named";

const tEn = i18n.getFixedT("en");
const tZh = i18n.getFixedT("zh-CN");
const stamp = (iso: string, lang: string) => stampOf(iso, lang) as string;

const SEEN = "2026-11-19T08:00:00Z";
const NOTICED = "2026-11-20T09:30:00Z";
const APPLIED = "2026-11-02T18:15:00Z";

// zh-CN fragments (escaped): 不知道, 上次记录, 没能读到, 第一次注意到, 你用 Compy 打开的, 这些, 现在是
const ZH_UNKNOWN = "不知道";
const ZH_RECORDED = "上次记录";
const ZH_COULDNT = "没能读到";
const ZH_FIRST = "第一次注意到";
const ZH_APPLIED = "你用 Compy 打开的";
const ZH_THESE = "这些";
const ZH_NOW_IS = "现在是";

const MIDDOT = "·";

// One row per drift-capable check id: [id, full plain name (en), short name (en), value now, value
// before (null where readiness.rs gives a Ready check no value)].
const KINDS: [string, string, string, string, string | null][] = [
  ["power-profile", "Power plan (Control Panel > Power Options)", "Power plan", "Power saver", "Balanced"],
  [
    "monitor-refresh",
    "Monitor refresh rate (Windows Settings > System > Display > Advanced display)",
    "Monitor refresh rate",
    "60 / 144 Hz",
    "144 Hz",
  ],
  [
    "vrr",
    "Variable refresh rate (FreeSync / G-SYNC; set in your graphics driver's control panel, for example AMD Software > Display)",
    "Variable refresh rate",
    "FreeSync: off",
    "FreeSync: on",
  ],
  [
    "memory-speed",
    "Memory speed (set in your PC's BIOS, where it may be called XMP or EXPO)",
    "Memory speed",
    "4800 of 6000 MT/s",
    null,
  ],
  [
    "memory-channels",
    "Memory channels (how your RAM sticks sit on the motherboard)",
    "Memory channels",
    "2 modules on 1 channel",
    "2 modules on 2 channels",
  ],
  ["drive-health", "Drive health (the drive's own SMART report)", "Drive health", "CT1000: Warning", null],
  [
    "install-drive",
    "Where your games are installed (the drive your game library is on)",
    "Game install location",
    "HDD: D:",
    `Fast ${MIDDOT} C:`,
  ],
];
const WITH_BEFORE = KINDS.filter((k) => k[4] !== null) as [string, string, string, string, string][];

const drift = (id: string, over: Partial<Drift> = {}): Drift => ({
  id,
  label: `${id} label`,
  detail: `${id} detail.`,
  noticed_at: NOTICED,
  ...over,
});

// Words that would claim a cause, a fix, a certainty or a count of problems.
const FORBIDDEN = /caused|fixed|guarantee|probably|issues found|outside Compy|score/i;

describe("driftSentence (Check, the full form): every drift kind names the setting, now, before and when", () => {
  it.each(WITH_BEFORE)("%s: both known", (id, name, _short, now, before) => {
    const s = driftSentence(drift(id, { value_now: now, last_ready_value: before, last_ready_at: SEEN }), tEn, "en");
    expect(s).toBe(
      `${name}: Now ${now}. Compy last recorded ${before} on ${stamp(SEEN, "en")}. Compy noticed this on ${stamp(NOTICED, "en")}.`,
    );
    expect(s).not.toMatch(FORBIDDEN);
  });

  it.each(KINDS)("%s: earlier value not recorded, but the ready time is", (id, name, _short, now) => {
    const s = driftSentence(drift(id, { value_now: now, last_ready_value: null, last_ready_at: SEEN }), tEn, "en");
    expect(s).toBe(
      `${name}: Now ${now}. Compy last saw it as expected on ${stamp(SEEN, "en")}, but doesn't know what it was before. Compy noticed this on ${stamp(NOTICED, "en")}.`,
    );
  });

  it.each(KINDS)("%s: neither the earlier value nor the ready time is known", (id, name, _short, now) => {
    const s = driftSentence(drift(id, { value_now: now, last_ready_value: null, last_ready_at: null }), tEn, "en");
    expect(s).toBe(
      `${name}: Now ${now}. Compy doesn't know what it was before, or when it last saw it as expected. Compy noticed this on ${stamp(NOTICED, "en")}.`,
    );
  });

  // B3: an unreadable drift's timestamp is when Compy first noticed it changed, not "last seen changed".
  it.each(KINDS)("%s: couldn't read it now is never 'unchanged' and never shows a current value", (id, name, _short, _now, before) => {
    const s = driftSentence(
      drift(id, { unreadable_now: true, value_now: null, last_ready_value: before, last_ready_at: SEEN }),
      tEn,
      "en",
    );
    expect(s).toContain(`${name}: Compy couldn't read it just now, so it can't say what it is now.`);
    expect(s).toContain(`Compy first noticed it changed on ${stamp(NOTICED, "en")}.`);
    expect(s).not.toMatch(/unchanged|Now |last seen changed/);
  });

  it("a value that is blank or missing is not printed as a reading", () => {
    const s = driftSentence(drift("vrr", { value_now: "  ", last_ready_at: SEEN }), tEn, "en");
    expect(s).toContain("Compy has no short reading of it now.");
    expect(s).not.toContain("Now ");
  });

  it("an unparseable ready stamp is treated as unknown, never printed raw", () => {
    const s = driftSentence(
      drift("vrr", { value_now: "FreeSync: off", last_ready_value: "FreeSync: on", last_ready_at: "garbage" }),
      tEn,
      "en",
    );
    expect(s).not.toContain("garbage");
    expect(s).toContain("Compy doesn't know what it was before, or when it last saw it as expected.");
  });

  it("an unparseable noticed stamp says 'an unknown time', never the raw text", () => {
    const s = driftSentence(drift("vrr", { value_now: "FreeSync: off", noticed_at: "2026-garbage" }), tEn, "en");
    expect(s).toContain("Compy noticed this on an unknown time.");
    expect(s).not.toContain("garbage");
    const zh = driftSentence(drift("vrr", { value_now: "FreeSync: off", noticed_at: "" }), tZh, "zh-CN");
    expect(zh).toContain("未知时间");
  });

  it("the vrr name does not send the reader to a Windows Settings page", () => {
    const s = driftSentence(drift("vrr", { value_now: "FreeSync: off", last_ready_at: SEEN }), tEn, "en");
    expect(s).toContain("set in your graphics driver's control panel, for example AMD Software > Display");
    expect(s).not.toMatch(/Windows Settings/);
  });

  it.each(WITH_BEFORE)("%s: zh-CN says the same things, with the name and values kept as sent", (id, _name, _short, now, before) => {
    const both = driftSentence(drift(id, { value_now: now, last_ready_value: before, last_ready_at: SEEN }), tZh, "zh-CN");
    expect(both).toContain(now);
    expect(both).toContain(before);
    expect(both).toContain(stamp(SEEN, "zh-CN"));
    expect(both).toContain(stamp(NOTICED, "zh-CN"));
    expect(both).not.toMatch(/common\.driftNamed|\{\{|undefined/);
    const unknown = driftSentence(drift(id, { value_now: now, last_ready_value: null, last_ready_at: null }), tZh, "zh-CN");
    expect(unknown).toContain(ZH_UNKNOWN);
    expect(unknown).not.toContain(ZH_RECORDED);
    const unreadable = driftSentence(drift(id, { unreadable_now: true, value_now: null, last_ready_at: SEEN }), tZh, "zh-CN");
    expect(unreadable).toContain(ZH_COULDNT);
    expect(unreadable).toContain(ZH_FIRST);
    expect(unreadable).not.toContain(now);
  });
});

describe("stampOf: the year shows when it is not this year", () => {
  const NOW = new Date("2026-11-21T12:00:00Z");
  it("an earlier year carries the year; this year does not; junk is null", () => {
    expect(stampOf("2025-03-01T10:00:00Z", "en", NOW)).toContain("2025");
    expect(stampOf("2026-03-01T10:00:00Z", "en", NOW)).not.toContain("2026");
    expect(stampOf("garbage", "en", NOW)).toBeNull();
    expect(stampOf("", "en", NOW)).toBeNull();
    expect(stampOf(null, "en", NOW)).toBeNull();
  });
});

describe("driftShort (Home, the short form): the short name and what it reads now, nothing else", () => {
  it.each(KINDS)("%s: '{short name}: now {value}', no menu path, no date", (id, name, short, now, before) => {
    const s = driftShort(drift(id, { value_now: now, last_ready_value: before, last_ready_at: SEEN }), tEn);
    expect(s).toBe(`${short}: now ${now}`);
    expect(s).not.toContain(">");
    expect(s).not.toContain(stamp(SEEN, "en"));
    expect(s).not.toContain(stamp(NOTICED, "en"));
    expect(s).not.toContain("recorded");
    expect(s).not.toMatch(FORBIDDEN);
    expect(s).not.toContain(name); // the full name (with where it is set) stays in Check
  });

  it.each(KINDS)("%s: couldn't read it is said, never a value, never 'unchanged'", (id, _name, short, now) => {
    const s = driftShort(drift(id, { unreadable_now: true, value_now: null }), tEn);
    expect(s).toBe(`${short}: Compy couldn't read it just now`);
    expect(s).not.toMatch(/unchanged/);
    expect(s).not.toContain(now);
  });

  it("no short reading: says so, no invented value", () => {
    expect(driftShort(drift("memory-speed", { value_now: null }), tEn)).toBe("Memory speed: Compy has no short reading of it");
  });

  it("an id this file doesn't know shows its own label", () => {
    expect(driftShort(drift("something-new", { label: "Game Mode" }), tEn)).toBe("Game Mode");
  });

  it("applied changes: the change's name, now off; unnamed and unreadable are said plainly", () => {
    expect(driftShort(drift("applied-changes", { titles: ["Enable Windows Game Mode", "Turn off Xbox Game Bar"] }), tEn)).toBe(
      "Enable Windows Game Mode, Turn off Xbox Game Bar: now off",
    );
    expect(driftShort(drift("applied-changes", { titles: [] }), tEn)).toBe("A change you turned on with Compy: now off");
    const unreadable = driftShort(drift("applied-changes", { unreadable_now: true, titles: ["Enable Windows Game Mode"] }), tEn);
    expect(unreadable).toBe("A change you turned on with Compy: Compy couldn't read it just now");
    expect(unreadable).not.toContain("Enable Windows Game Mode");
  });

  it.each(KINDS)("%s: zh-CN short form keeps the value as sent and has no raw keys", (id, _name, _short, now) => {
    const s = driftShort(drift(id, { value_now: now }), tZh);
    expect(s).toContain(`${ZH_NOW_IS} ${now}`);
    expect(s).not.toMatch(/common\.driftNamed|\{\{|undefined/);
    const unreadable = driftShort(drift(id, { unreadable_now: true }), tZh);
    expect(unreadable).toContain(ZH_COULDNT);
    expect(unreadable).not.toContain(now);
  });
});

describe("driftSentence: a change you turned on with Compy that is now off", () => {
  const off = (over: Partial<Drift> = {}) => drift("applied-changes", { last_ready_at: SEEN, ...over });
  const TITLE = "Enable Windows Game Mode";

  // B1: the date is the ledger's own stamp for that change; the row's last-ready scan time is never it.
  it("one change with the ledger's own stamp: says when you turned it on, with THAT stamp", () => {
    const s = driftSentence(off({ titles: [TITLE], applied_at: [APPLIED] }), tEn, "en");
    expect(s).toBe(
      `A change you turned on with Compy: “${TITLE}” is now off. You turned it on with Compy on ${stamp(APPLIED, "en")}. Compy noticed this on ${stamp(NOTICED, "en")}.`,
    );
    expect(s).not.toContain(stamp(SEEN, "en"));
    expect(s).not.toMatch(FORBIDDEN);
  });

  it("one change with no applied stamp: no date at all, and never the last-ready time", () => {
    for (const applied_at of [undefined, [], [""], ["garbage"]]) {
      const s = driftSentence(off({ titles: [TITLE], applied_at }), tEn, "en");
      expect(s).toContain("You turned it on with Compy. Compy noticed this on");
      expect(s).not.toContain("with Compy on ");
      expect(s).not.toContain(stamp(SEEN, "en"));
      expect(s).not.toContain("last saw");
    }
  });

  it("several changes: all named, plural words, no single date", () => {
    const s = driftSentence(
      off({ titles: [TITLE, "Disable Windows Search indexer"], applied_at: [APPLIED, APPLIED] }),
      tEn,
      "en",
    );
    expect(s).toContain(`These are now off: ${TITLE}, Disable Windows Search indexer.`);
    expect(s).toContain("You turned them on with Compy.");
    expect(s).not.toContain(stamp(APPLIED, "en"));
  });

  it("no titles from the ledger: says it can't name which one, never invents one", () => {
    const s = driftSentence(off({ titles: [] }), tEn, "en");
    expect(s).toContain("It is now off, but Compy can't name which change here.");
  });

  it("couldn't read its change history now: no title is claimed, and the wording is the first-noticed one", () => {
    const s = driftSentence(off({ unreadable_now: true, titles: [TITLE], applied_at: [APPLIED] }), tEn, "en");
    expect(s).toContain("Compy couldn't read it just now, so it can't say what it is now.");
    expect(s).not.toContain(TITLE);
    expect(s).toContain("Compy first noticed it changed on");
  });

  it("zh-CN: one change uses singular wording, not 'these'; the stamp is kept", () => {
    const s = driftSentence(off({ titles: [TITLE], applied_at: [APPLIED] }), tZh, "zh-CN");
    expect(s).toContain(TITLE);
    expect(s).toContain(ZH_APPLIED);
    expect(s).toContain(stamp(APPLIED, "zh-CN"));
    expect(s).not.toContain(ZH_THESE);
    expect(s).not.toContain(stamp(SEEN, "zh-CN"));
    expect(s).not.toMatch(/common\.driftNamed|\{\{|undefined/);
  });
});

describe("driftSentence: a check this file doesn't know falls back to its own label and detail", () => {
  it("keeps the older wording, and the unreadable wording", () => {
    expect(driftSentence(drift("something-new", { label: "Game Mode", detail: "Off." }), tEn, "en")).toBe("Game Mode: Off.");
    expect(driftSentence(drift("something-new", { label: "Game Mode", unreadable_now: true }), tEn, "en")).toBe(
      "Game Mode: last seen changed; Compy can't read it now.",
    );
    expect(driftSentence(drift("something-new", { label: "Game Mode", detail: "" }), tEn, "en")).toBe("Game Mode");
  });

  // B2: a driver getting older is time passing, not a change: it is never a drift, so it has no wording.
  it("graphics driver age has no drift wording of its own", () => {
    const s = driftSentence(drift("gpu-driver-age", { label: "Graphics driver age", detail: "400 days old." }), tEn, "en");
    expect(s).not.toMatch(/Compy last recorded|Now /);
  });
});

// The shipped wording itself (every string in the driftNamed block, both languages) never claims a
// cause, a fix, a guarantee, a guess, a score or a count of problems (CLAUDE.md honesty rules, §38),
// and has no key for a graphics driver ageing (time passing is not a drift).
describe("the driftNamed wording", () => {
  const leaves = (v: unknown): string[] =>
    typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(leaves) : [];
  const BAD = /caused|fixed|guarantee|probably|issues? found|score|导致|修复|保证|可能是|分数|发现 \d+ 个问题/i;
  it("has no cause, fix, guarantee, guess or score wording in en or zh-CN", () => {
    for (const block of [enCommon.driftNamed, zhCommon.driftNamed]) {
      const all = leaves(block);
      expect(all.length).toBeGreaterThan(30);
      for (const s of all) expect(s, s).not.toMatch(BAD);
    }
  });
  it("has no graphics-driver-age entry", () => {
    expect(JSON.stringify(enCommon.driftNamed)).not.toMatch(/gpuDriverAge|driver age/i);
    expect(JSON.stringify(zhCommon.driftNamed)).not.toMatch(/gpuDriverAge/);
  });
});

describe("driftMore", () => {
  it("counts what was cut, and says nothing when nothing was", () => {
    expect(driftMore(5, 3, tEn)).toBe("and 2 more settings");
    expect(driftMore(4, 3, tEn)).toBe("and 1 more setting");
    expect(driftMore(3, 3, tEn)).toBeNull();
    expect(driftMore(5, 3, tZh)).toBe("还有 2 项设置");
  });
});
