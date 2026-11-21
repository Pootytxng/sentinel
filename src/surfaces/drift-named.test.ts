// n1-drift: a drifted setting is named in plain words with what it reads now, what Compy last recorded
// and when it last saw it as expected, for every kind Drift Watch can report (drift.rs / readiness.rs),
// in en and zh-CN. What the backend doesn't know is said so; "couldn't read" is never "unchanged";
// no cause or fault is ever claimed (Constitution section 38).
import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import type { Drift } from "../types";
import { driftMore, driftSentence } from "./drift-named";

const tEn = i18n.getFixedT("en");
const tZh = i18n.getFixedT("zh-CN");
const stamp = (iso: string, lang: string) =>
  new Date(iso).toLocaleString(lang, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const SEEN = "2026-11-19T08:00:00Z";
const NOTICED = "2026-11-20T09:30:00Z";

// One row per drift-capable check id: [id, plain name (en) as first said, value then, value before].
const KINDS: [string, string, string, string][] = [
  ["power-profile", "Power plan (Control Panel > Power Options)", "Power saver", "Balanced"],
  ["monitor-refresh", "Monitor refresh rate (Windows Settings > System > Display > Advanced display)", "60 / 144 Hz", "144 Hz"],
  ["vrr", "Variable refresh rate (FreeSync / G-SYNC; Windows Settings > System > Display > Graphics)", "FreeSync: off", "FreeSync: on"],
  ["memory-speed", "Memory speed (set in your PC's BIOS, where it may be called XMP or EXPO)", "2133 of 3200 MT/s", "3200 of 3200 MT/s"],
  ["memory-channels", "Memory channels (how your RAM sticks sit on the motherboard)", "2 modules on 1 channel", "2 modules on 2 channels"],
  ["drive-health", "Drive health (the drive's own SMART report)", "Samsung SSD: Warning", "Samsung SSD: Healthy"],
  ["install-drive", "Where your games are installed (the drive your game library is on)", "HDD: D:", "Fast on C:"],
  ["gpu-driver-age", "Graphics driver age (the driver date in Device Manager > Display adapters)", "400 days", "100 days"],
];

const drift = (id: string, over: Partial<Drift> = {}): Drift => ({
  id,
  label: `${id} label`,
  detail: `${id} detail.`,
  noticed_at: NOTICED,
  ...over,
});

// Words that would claim a cause, a fix, a certainty or a count of problems.
const FORBIDDEN = /caused|fixed|guarantee|probably|issues found|outside Compy|score/i;

describe("driftSentence: every drift kind names the setting, now, before and when", () => {
  it.each(KINDS)("%s: both known", (id, name, now, before) => {
    const s = driftSentence(
      drift(id, { value_now: now, last_ready_value: before, last_ready_at: SEEN }),
      tEn,
      "en",
    );
    expect(s).toBe(
      `${name}: Now ${now}. Compy last recorded ${before} on ${stamp(SEEN, "en")}. Compy noticed this on ${stamp(NOTICED, "en")}.`,
    );
    expect(s).not.toMatch(FORBIDDEN);
  });

  it.each(KINDS)("%s: earlier value not recorded, but the ready time is", (id, name, now) => {
    const s = driftSentence(drift(id, { value_now: now, last_ready_value: null, last_ready_at: SEEN }), tEn, "en");
    expect(s).toBe(
      `${name}: Now ${now}. Compy last saw it as expected on ${stamp(SEEN, "en")}, but doesn't know what it was before. Compy noticed this on ${stamp(NOTICED, "en")}.`,
    );
  });

  it.each(KINDS)("%s: neither the earlier value nor the ready time is known", (id, name, now) => {
    const s = driftSentence(drift(id, { value_now: now, last_ready_value: null, last_ready_at: null }), tEn, "en");
    expect(s).toBe(
      `${name}: Now ${now}. Compy doesn't know what it was before, or when it last saw it as expected. Compy noticed this on ${stamp(NOTICED, "en")}.`,
    );
  });

  it.each(KINDS)("%s: couldn't read it now is never 'unchanged' and never shows a current value", (id, name, _now, before) => {
    const s = driftSentence(
      drift(id, { unreadable_now: true, value_now: null, last_ready_value: before, last_ready_at: SEEN }),
      tEn,
      "en",
    );
    expect(s).toContain(`${name}: Compy couldn't read it just now, so it can't say what it is now.`);
    expect(s).toContain(`It was last seen changed on ${stamp(NOTICED, "en")}.`);
    expect(s).not.toMatch(/unchanged|Now /);
  });

  it("a value that is blank or missing is not printed as a reading", () => {
    const s = driftSentence(drift("vrr", { value_now: "  ", last_ready_at: SEEN }), tEn, "en");
    expect(s).toContain("Compy has no short reading of it now.");
    expect(s).not.toContain("Now ");
  });

  it("an unparseable ready stamp is treated as unknown, never printed raw", () => {
    const s = driftSentence(drift("vrr", { value_now: "FreeSync: off", last_ready_value: "FreeSync: on", last_ready_at: "garbage" }), tEn, "en");
    expect(s).not.toContain("garbage");
    expect(s).toContain("Compy doesn't know what it was before, or when it last saw it as expected.");
  });

  it.each(KINDS)("%s: zh-CN says the same things, with the name and values kept as sent", (id, _name, now, before) => {
    const both = driftSentence(drift(id, { value_now: now, last_ready_value: before, last_ready_at: SEEN }), tZh, "zh-CN");
    expect(both).toContain(now);
    expect(both).toContain(before);
    expect(both).toContain(stamp(SEEN, "zh-CN"));
    expect(both).toContain(stamp(NOTICED, "zh-CN"));
    expect(both).not.toMatch(/common\.driftNamed|\{\{|undefined/);
    const unknown = driftSentence(drift(id, { value_now: now, last_ready_value: null, last_ready_at: null }), tZh, "zh-CN");
    expect(unknown).toContain("不知道");
    expect(unknown).not.toContain("上次记录");
    const unreadable = driftSentence(drift(id, { unreadable_now: true, value_now: null, last_ready_at: SEEN }), tZh, "zh-CN");
    expect(unreadable).toContain("没能读到");
    expect(unreadable).not.toContain(now);
  });
});

describe("driftSentence: a change you turned on with Compy that is now off", () => {
  const off = (over: Partial<Drift> = {}) => drift("applied-changes", { last_ready_at: SEEN, ...over });

  it("one change: named from the ledger, with when Compy last saw it on", () => {
    const s = driftSentence(off({ titles: ["Enable Windows Game Mode"] }), tEn, "en");
    expect(s).toBe(
      `A change you turned on with Compy: “Enable Windows Game Mode” is now off. You turned it on with Compy, and Compy last saw it on at ${stamp(SEEN, "en")}. Compy noticed this on ${stamp(NOTICED, "en")}.`,
    );
    expect(s).not.toMatch(FORBIDDEN);
  });

  it("several changes: all named, plural words", () => {
    const s = driftSentence(off({ titles: ["Enable Windows Game Mode", "Disable Windows Search indexer"] }), tEn, "en");
    expect(s).toContain("These are now off: Enable Windows Game Mode, Disable Windows Search indexer.");
    expect(s).toContain("You turned them on with Compy, and Compy last saw them on at");
  });

  it("no titles from the ledger: says it can't name which one, never invents one", () => {
    const s = driftSentence(off({ titles: [] }), tEn, "en");
    expect(s).toContain("It is now off, but Compy can't name which change here.");
  });

  it("no ready stamp: says it doesn't know when it last saw it on", () => {
    const s = driftSentence(off({ titles: ["Enable Windows Game Mode"], last_ready_at: null }), tEn, "en");
    expect(s).toContain("Compy doesn't know when it last saw it on.");
  });

  it("couldn't read its change history now: no title is claimed", () => {
    const s = driftSentence(off({ unreadable_now: true, titles: ["Enable Windows Game Mode"] }), tEn, "en");
    expect(s).toContain("Compy couldn't read it just now, so it can't say what it is now.");
    expect(s).not.toContain("Enable Windows Game Mode");
    expect(s).toContain("It was last seen changed on");
  });

  it("zh-CN", () => {
    const s = driftSentence(off({ titles: ["Enable Windows Game Mode"] }), tZh, "zh-CN");
    expect(s).toContain("Enable Windows Game Mode");
    expect(s).toContain("你用 Compy 打开的");
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
});

describe("driftMore", () => {
  it("counts what was cut, and says nothing when nothing was", () => {
    expect(driftMore(5, 3, tEn)).toBe("and 2 more settings");
    expect(driftMore(4, 3, tEn)).toBe("and 1 more setting");
    expect(driftMore(3, 3, tEn)).toBeNull();
    expect(driftMore(5, 3, tZh)).toBe("还有 2 项设置");
  });
});
