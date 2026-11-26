// D3 vocabulary, slice 2: the Something's-wrong card says how sure it is in the shared words
// (common.source.* / common.strength.*), in English and in Chinese. A feature test, not a guard.
//
// What must hold:
//   - each old tag maps to its shared word (Known -> Read from your PC; the two zh words for
//     "Measured" are one; "Often causes this ..." -> Not measured on your PC);
//   - the words the card keeps on purpose are unchanged (Not recorded, Not read, Supports this, Weakens this);
//   - an evidence line never carries a strength;
//   - "Most likely" is shown for the wire value `likely` and for nothing else (no level is raised here);
//   - no old word and no moved key is left on the card.
// Every expected word is written out literally in both languages, so a wrong meaning fails here and
// not by copying the JSON.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

const answer = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(answer.value),
}));

import i18n from "../../i18n";
import type { ParamedicCertainty, ParamedicDiagnosis, ParamedicEvidence, ParamedicSessionRef } from "../../types";
import { CERTAINTY_VALUES, EVIDENCE_KIND_VALUES, SOURCES, STRENGTHS, fromCertainty, strengthFor, type Strength } from "../../data/certainty";
import { sourceWord, strengthWord } from "../../data/certainty-words";
import { candidateTag, evidenceTag } from "./paramedic-tags";
import { ParamedicCard } from "./ParamedicCard";

afterEach(async () => {
  cleanup();
  answer.value = null;
  await i18n.changeLanguage("en");
});

type Lang = "en" | "zh-CN";
const LANGS: Lang[] = ["en", "zh-CN"];
type Tree = { [k: string]: string | Tree };
const locale = (loc: Lang, file: string) => JSON.parse(readFileSync(join("src", "i18n", "locales", loc, file), "utf8")) as Tree;

/** The shared words, written out. A change to either locale file must be a change here too. */
const SOURCE_WORDS: Record<Lang, Record<string, string>> = {
  en: { read: "Read from your PC", measured: "Measured", measuredOnce: "Measured once", user: "You told Compy", general: "Not measured on your PC", unread: "Couldn't read" },
  "zh-CN": { read: "从你的电脑读取", measured: "已实测", measuredOnce: "仅测得一次", user: "你告诉 Compy 的", general: "未在你的电脑上实测", unread: "未能读取" },
};
const STRENGTH_WORDS: Record<Lang, Record<string, string>> = {
  en: { possible: "Possible", mostLikely: "Most likely" },
  "zh-CN": { possible: "有可能", mostLikely: "最有可能" },
};
/** The words the card keeps as its own (see paramedic-tags.ts for why). */
const KEPT: Record<Lang, Record<string, string>> = {
  en: { unknown: "Not recorded", notRead: "Not read", against: "Weakens this", supports: "Supports this" },
  "zh-CN": { unknown: "未记录", notRead: "未读取", against: "削弱这一判断", supports: "支持这一判断" },
};
/** The tags this slice retired from the card, as they were worded. */
const OLD_EN = /\bKnown\b|Often causes this/;
const OLD_ZH = /已知|已测得|常会导致/;

describe("the shared how-sure words (common.source / common.strength)", () => {
  it("en and zh-CN carry the same eight keys with exactly these words", () => {
    for (const loc of LANGS) {
      const common = locale(loc, "common.json");
      expect(common.source, loc).toEqual(SOURCE_WORDS[loc]);
      expect(common.strength, loc).toEqual(STRENGTH_WORDS[loc]);
    }
  });

  it("sourceWord returns the locale's word for every source, in both languages", async () => {
    const key: Record<(typeof SOURCES)[number], string> = { read: "read", measured: "measured", "measured-once": "measuredOnce", user: "user", general: "general", unread: "unread" };
    for (const loc of LANGS) {
      await i18n.changeLanguage(loc);
      for (const s of SOURCES) expect(sourceWord(s, i18n.t), `${loc}/${s}`).toBe(SOURCE_WORDS[loc][key[s]]);
    }
  });

  it("strengthWord says Possible or Most likely and nothing else, in both languages", async () => {
    const top = strengthFor({ independentSupports: 2, contradicting: 0, keySupportUnread: false }) as Strength;
    expect(STRENGTHS).toEqual(["possible", "most-likely"]);
    for (const loc of LANGS) {
      await i18n.changeLanguage(loc);
      expect(strengthWord("possible", i18n.t), loc).toBe(STRENGTH_WORDS[loc].possible);
      expect(strengthWord(top, i18n.t), loc).toBe(STRENGTH_WORDS[loc].mostLikely);
    }
  });

  it("zh-CN has one word for Measured: the tag and the older shared word are both 已实测", () => {
    const zh = locale("zh-CN", "common.json");
    expect((zh.source as Tree).measured).toBe("已实测");
    expect((zh.confidenceWord as Tree).measured).toBe("已实测");
    // Same for "Measured once": one zh wording in the app, not two.
    expect((zh.source as Tree).measuredOnce).toBe((zh.confidenceWord as Tree).measuredOnce);
  });

  it("the paramedic locale files no longer carry the moved tags, and keep the four the card owns", () => {
    for (const loc of LANGS) {
      const p = locale(loc, "paramedic.json");
      expect(p.answer, `${loc}: paramedic.answer`).toBeUndefined();
      expect((p.problem as Tree).badge, `${loc}: paramedic.problem.badge`).toBeUndefined();
      expect(p.badge, loc).toEqual(KEPT[loc]);
    }
  });
});

const line = (kind: ParamedicEvidence["kind"], over: Partial<ParamedicEvidence> = {}) => ({ kind, code: "driver-changed", against: false, ...over });

describe("evidence-line tags: each old word maps to its shared word", () => {
  it("en: Known -> Read from your PC; Measured stays; the never-sent mechanism kind -> Not measured on your PC", async () => {
    await i18n.changeLanguage("en");
    expect(evidenceTag(line("known"), i18n.t)).toEqual({ axis: "source", text: "Read from your PC" });
    expect(evidenceTag(line("measured"), i18n.t)).toEqual({ axis: "source", text: "Measured" });
    expect(evidenceTag(line("expected-mechanism"), i18n.t)).toEqual({ axis: "source", text: "Not measured on your PC" });
  });

  it("zh-CN: 已知 -> 从你的电脑读取; 已测得 -> 已实测; the mechanism kind -> 未在你的电脑上实测", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(evidenceTag(line("known"), i18n.t)).toEqual({ axis: "source", text: "从你的电脑读取" });
    expect(evidenceTag(line("measured"), i18n.t)).toEqual({ axis: "source", text: "已实测" });
    expect(evidenceTag(line("expected-mechanism"), i18n.t)).toEqual({ axis: "source", text: "未在你的电脑上实测" });
  });

  it("the words the card keeps are unchanged in both languages: Not recorded, Not read, Supports this, Weakens this", async () => {
    for (const loc of LANGS) {
      await i18n.changeLanguage(loc);
      expect(evidenceTag(line("unknown"), i18n.t), loc).toEqual({ axis: "source", text: KEPT[loc].unknown });
      expect(evidenceTag(line("unknown", { code: "whea-normal-unread" }), i18n.t), loc).toEqual({ axis: "source", text: KEPT[loc].notRead });
      expect(evidenceTag(line("supported-inference"), i18n.t), loc).toEqual({ axis: "relation", text: KEPT[loc].supports });
    }
  });

  it("a line with no record is never tagged Couldn't read, and an unread hardware log is never tagged Not recorded", async () => {
    for (const loc of LANGS) {
      await i18n.changeLanguage(loc);
      expect(evidenceTag(line("unknown"), i18n.t).text, loc).not.toBe(SOURCE_WORDS[loc].unread);
      expect(evidenceTag(line("unknown", { code: "whea-normal-unread" }), i18n.t).text, loc).not.toBe(KEPT[loc].unknown);
    }
  });

  it("a line that weakens its row says Weakens this, with the warn tone, whatever its kind", async () => {
    for (const loc of LANGS) {
      await i18n.changeLanguage(loc);
      for (const kind of EVIDENCE_KIND_VALUES)
        expect(evidenceTag(line(kind, { against: true }), i18n.t), `${loc}/${kind}`).toEqual({ axis: "relation", text: KEPT[loc].against, tone: "warn" });
    }
  });

  it("an evidence line never carries a strength: every kind, with and without `against`, in both languages", async () => {
    for (const loc of LANGS) {
      await i18n.changeLanguage(loc);
      const strengthWords = Object.values(STRENGTH_WORDS[loc]);
      for (const kind of [...EVIDENCE_KIND_VALUES, "a-kind-this-build-does-not-know" as ParamedicEvidence["kind"]])
        for (const against of [false, true])
          for (const code of ["driver-changed", "whea-normal-unread"]) {
            const tag = evidenceTag({ kind, code, against }, i18n.t);
            expect(tag.axis, `${loc}/${kind}/${against}/${code}`).not.toBe("strength");
            expect(strengthWords, `${loc}/${kind}/${against}/${code}`).not.toContain(tag.text);
            expect(tag.text.trim().length, `${loc}/${kind}: empty tag`).toBeGreaterThan(0);
          }
    }
  });
});

describe("candidate-row tags: the engine's level in the shared words", () => {
  const EXPECTED: Record<Lang, Record<ParamedicCertainty, { axis: string; text: string; tone?: string }>> = {
    en: {
      likely: { axis: "strength", text: "Most likely", tone: "accent" },
      possible: { axis: "strength", text: "Possible", tone: undefined },
      measured: { axis: "source", text: "Measured", tone: "accent" },
      mechanism: { axis: "source", text: "Not measured on your PC", tone: undefined },
      known: { axis: "source", text: "Read from your PC", tone: undefined },
      "cant-tell": { axis: "strength", text: "Possible" },
    },
    "zh-CN": {
      likely: { axis: "strength", text: "最有可能", tone: "accent" },
      possible: { axis: "strength", text: "有可能", tone: undefined },
      measured: { axis: "source", text: "已实测", tone: "accent" },
      mechanism: { axis: "source", text: "未在你的电脑上实测", tone: undefined },
      known: { axis: "source", text: "从你的电脑读取", tone: undefined },
      "cant-tell": { axis: "strength", text: "有可能" },
    },
  };

  for (const loc of LANGS)
    it(`${loc}: every wire value of Certainty has its word`, async () => {
      await i18n.changeLanguage(loc);
      for (const c of CERTAINTY_VALUES) expect(candidateTag(c, i18n.t), `${loc}/${c}`).toEqual(EXPECTED[loc][c]);
    });

  it("Most likely is said for the wire value `likely` and for no other value, known or unknown", async () => {
    for (const loc of LANGS) {
      await i18n.changeLanguage(loc);
      const top = STRENGTH_WORDS[loc].mostLikely;
      for (const c of [...CERTAINTY_VALUES, "strong", "high", "most-likely", "", "LIKELY"] as ParamedicCertainty[]) {
        const tag = candidateTag(c, i18n.t);
        if (c === "likely") expect(tag.text, loc).toBe(top);
        else {
          expect(tag.text, `${loc}/${c}`).not.toBe(top);
          expect(tag.tone === "accent" && tag.axis === "strength", `${loc}/${c}: accent strength`).toBe(false);
        }
      }
    }
  });

  it("the tag's axis is the mapper's axis: a value that is a source on the wire is never shown as a strength", () => {
    for (const c of CERTAINTY_VALUES) {
      const m = fromCertainty(c);
      const tag = candidateTag(c, i18n.t);
      if (m.axis === "source") expect(tag.axis, c).toBe("source");
      if (m.axis === "strength") expect(tag.axis, c).toBe("strength");
    }
  });
});

// ---- On the card itself. The engine's answer is mocked (codes, counts and dates only). ----
type F = ParamedicDiagnosis["findings"][number];
const ref = (at: string): ParamedicSessionRef => ({ started_at: at, game: "game-a", duration_secs: 600, samples: 600, avg_fps: 100, low1_fps: 30 });
const base: ParamedicDiagnosis = {
  complaint: "unknown",
  state: { kind: "found" },
  game: "game-a",
  game_name: "Game A",
  problem: {
    rule: "stutter-collapse",
    spikes: false,
    avg_lower: false,
    before: { ratio: 0.5, p99_ms: null, avg_fps: 100 },
    now: { ratio: 0.3, p99_ms: null, avg_fps: 100 },
    last_normal_at: "2026-10-04T10:00:00Z",
    last_full_normal_at: "2026-10-04T10:00:00Z",
    sessions_affected: [ref("2026-10-07T10:00:00Z")],
    partial_sessions: [],
    other_games_affected: [],
    later_unjudged: 0,
  },
  findings: [],
  not_it: [],
  unknowns: [],
  limits: [],
  seen: [],
  baseline: ref("2026-10-04T10:00:00Z"),
  first_bad: ref("2026-10-07T10:00:00Z"),
  mixed_sessions: [],
  why_first: null,
  recovery: null,
  earlier_episode: null,
  method: "paramedic-rules-v1",
};
const ev = (kind: ParamedicEvidence["kind"], code: string, args: Record<string, string> = {}, against = false): ParamedicEvidence => ({ kind, code, args, against, source: "sessions" });
/** One line of each kind the engine sends on a row today, plus one that weakens it. */
const LINES: ParamedicEvidence[] = [
  ev("known", "driver-changed", { from: "1.0", to: "2.0" }),
  ev("measured", "value-changed", { from: "40", to: "70" }),
  ev("unknown", "load-not-recorded"),
  ev("known", "hardware-changed", {}, true),
];
const driver = (confidence: F["confidence"], evidence: ParamedicEvidence[] = LINES): F => ({
  id: "gpu-driver-change",
  confidence,
  in_play: confidence === "possible",
  evidence,
  since_when: { kind: "observed-between", from: "2026-10-05T05:00:00Z", to: "2026-10-06T16:00:00Z" },
  fix: { kind: "steps", code: "gpu-driver-change", args: { from: "1.0" } },
  now: null,
  now_evidence: [],
});
/** A second row, Possible, as the engine sends a hardware lead (F7). */
const hardware: F = {
  id: "hardware-errors",
  confidence: "possible",
  in_play: true,
  evidence: [{ kind: "known", code: "whea-count", args: { count: "2", from: "2026-10-06T12:00:00Z", to: "2026-10-07T10:05:00Z" }, against: false, source: "windows-system-log" }],
  since_when: { kind: "observed-between", from: "2026-10-06T12:00:00Z", to: "2026-10-07T10:05:00Z" },
  fix: { kind: "hardware", code: "hardware-errors" },
  now: null,
  now_evidence: [],
};

const DOOR = { en: "Something's wrong", "zh-CN": "出问题了" } as const;
const ask = async (findings: F[], lang: Lang = "en") => {
  await i18n.changeLanguage(lang);
  answer.value = { ...base, findings };
  render(<ParamedicCard />);
  fireEvent.click(screen.getByRole("button", { name: DOOR[lang] }));
  await waitFor(() => expect(screen.queryByTestId("paramedic-verdict")).toBeTruthy());
};
const rows = () => screen.queryAllByTestId("paramedic-candidate");
const card = () => screen.getByTestId("paramedic").textContent ?? "";
const openRow = (i = 0) => fireEvent.click(within(rows()[i]).getAllByRole("button")[0]);
/** The tag in front of each evidence line of a row, as [axis, text]. */
const lineTags = (i = 0) => [...rows()[i].querySelectorAll(".gl-para-lines li > .gl-chip")].map((c) => [c.getAttribute("data-axis"), c.textContent]);
/** The row's own chips (not the ones on its evidence lines), as [axis, text]. */
const rowChips = (i = 0) => [...rows()[i].querySelectorAll(".gl-para-row-btn > .gl-chip")].map((c) => [c.getAttribute("data-axis"), c.textContent]);

describe("the Something's-wrong card renders the shared words", () => {
  it("en: the evidence lines are tagged Read from your PC, Measured, Not recorded and Weakens this", async () => {
    await ask([driver("possible")]);
    openRow();
    expect(lineTags()).toEqual([
      ["source", "Read from your PC"],
      ["source", "Measured"],
      ["source", "Not recorded"],
      ["relation", "Weakens this"],
    ]);
  });

  it("zh-CN: the evidence lines are tagged 从你的电脑读取, 已实测, 未记录 and 削弱这一判断", async () => {
    await ask([driver("possible")], "zh-CN");
    openRow();
    expect(lineTags()).toEqual([
      ["source", "从你的电脑读取"],
      ["source", "已实测"],
      ["source", "未记录"],
      ["relation", "削弱这一判断"],
    ]);
  });

  it("no old tag is left on the card: no Known, no 已知, no 已测得, in an opened answer", async () => {
    await ask([driver("likely"), hardware]);
    openRow(0);
    openRow(1);
    expect(card()).not.toMatch(OLD_EN);
    cleanup();
    await ask([driver("likely"), hardware], "zh-CN");
    openRow(0);
    openRow(1);
    expect(card()).not.toMatch(OLD_ZH);
    // Not vacuous: the card did render its tags.
    expect(lineTags(0).length).toBe(4);
  });

  it("the headline tag is the shared Measured (en) / 已实测 (zh-CN), marked as a source", async () => {
    await ask([driver("possible")]);
    const en = screen.getByTestId("paramedic-problem-source");
    expect([en.getAttribute("data-axis"), en.textContent]).toEqual(["source", "Measured"]);
    cleanup();
    await ask([driver("possible")], "zh-CN");
    const zh = screen.getByTestId("paramedic-problem-source");
    expect([zh.getAttribute("data-axis"), zh.textContent]).toEqual(["source", "已实测"]);
  });

  it("no evidence line on the card carries a strength tag, whatever level its row has", async () => {
    for (const lang of LANGS)
      for (const level of ["likely", "possible"] as const) {
        await ask([driver(level), hardware], lang);
        openRow(0);
        openRow(1);
        const tags = [...lineTags(0), ...lineTags(1)];
        expect(tags.length, `${lang}/${level}: no evidence tags rendered`).toBeGreaterThanOrEqual(5);
        for (const [axis, text] of tags) {
          expect(axis, `${lang}/${level}/${text}`).not.toBe("strength");
          expect(Object.values(STRENGTH_WORDS[lang]), `${lang}/${level}`).not.toContain(text);
        }
        cleanup();
      }
  });

  it("a Likely row and a Possible row: Most likely is on the screen exactly once, on the row the engine sent as likely", async () => {
    await ask([driver("likely"), hardware]);
    expect(rows().length).toBe(2);
    expect(rowChips(0)).toEqual([["strength", "Most likely"]]);
    expect(rowChips(1)).toEqual([["strength", "Possible"]]);
    expect(screen.getAllByText("Most likely").length).toBe(1);
    cleanup();
    await ask([driver("likely"), hardware], "zh-CN");
    expect(rowChips(0)).toEqual([["strength", "最有可能"]]);
    expect(rowChips(1)).toEqual([["strength", "有可能"]]);
    expect(screen.getAllByText("最有可能").length).toBe(1);
  });

  it("an answer whose rows are all Possible never shows Most likely, in either language", async () => {
    await ask([driver("possible"), hardware]);
    expect(rowChips(0)).toEqual([["strength", "Possible"]]);
    expect(card()).not.toMatch(/Most likely/);
    cleanup();
    await ask([driver("possible"), hardware], "zh-CN");
    expect(rowChips(0)).toEqual([["strength", "有可能"]]);
    expect(card()).not.toMatch(/最有可能/);
  });

  it("the hardware lead's Possible is the shared word, in both languages (F7)", async () => {
    await ask([hardware]);
    expect(rowChips(0)).toEqual([["strength", i18n.t("common.strength.possible")]]);
    expect(rowChips(0)[0][1]).toBe("Possible");
    cleanup();
    await ask([hardware], "zh-CN");
    expect(rowChips(0)).toEqual([["strength", "有可能"]]);
  });

  it("a Possible lead's steps are a test ('How to test this'), a Likely lead's stay 'How to fix it'", async () => {
    await ask([driver("possible")]);
    openRow();
    expect(within(rows()[0]).getByText("How to test this")).toBeTruthy();
    expect(card()).not.toMatch(/How to fix it/);
    cleanup();
    await ask([driver("likely")]);
    openRow();
    expect(within(rows()[0]).getByText("How to fix it")).toBeTruthy();
    expect(card()).not.toMatch(/How to test this/);
  });
});

describe("the card's source calls the shared keys", () => {
  const src = (f: string) => readFileSync(join("src", "surfaces", "glass", f), "utf8");

  it("ParamedicCard.tsx names no moved key and no word from the older shared list", () => {
    const text = src("ParamedicCard.tsx");
    expect(text.length).toBeGreaterThan(50_000);
    expect(text).not.toMatch(/paramedic\.answer\./);
    expect(text).not.toMatch(/paramedic\.badge\./);
    expect(text).not.toMatch(/paramedic\.problem\.badge/);
    expect(text).not.toMatch(/common\.confidenceWord\./);
    expect(text).toMatch(/t\("common\.source\.measured"\)/);
    expect(text).toMatch(/t\("common\.source\.measuredOnce"\)/);
  });

  it("paramedic-tags.ts takes every shared word from certainty-words.ts and keeps only the card's four own keys", () => {
    const text = src("paramedic-tags.ts");
    const own = [...text.matchAll(/t\("([\w.]+)"\)/g)].map((m) => m[1]).sort();
    expect(own).toEqual(["paramedic.badge.against", "paramedic.badge.notRead", "paramedic.badge.supports", "paramedic.badge.unknown"]);
    expect(text).not.toMatch(/common\.(source|strength)\./);
  });
});
