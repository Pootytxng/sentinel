import { describe, it, expect, afterEach } from "vitest";
import i18n from "../i18n";
import { activeChangesNote, undoTallyWords } from "./undo-tally-words";

// CR-home-reversible-note: Home's Active changes card and the footer share these words.
// C7: every count here is of SETTINGS, and the words say so ("setting(s)"), never "changes".
afterEach(async () => {
  await i18n.changeLanguage("en");
});

const t = i18n.t.bind(i18n);
const tally = (undoable: number, noSavedUndo = 0, offOutside = 0, unchecked = 0) => ({
  undoable,
  noSavedUndo,
  offOutside,
  unchecked,
  settings: undoable + noSavedUndo + offOutside + unchecked,
  records: undoable + noSavedUndo + offOutside + unchecked,
});

describe("undoTallyWords", () => {
  it("counts what can be undone, then each kind that can't, never an absolute", () => {
    expect(undoTallyWords(tally(2), t)).toBe("2 settings can be undone");
    expect(undoTallyWords(tally(1, 1, 1), t)).toBe(
      "1 setting can be undone · 1 setting has no saved undo · 1 setting changed outside Compy, no undo",
    );
    expect(undoTallyWords(tally(0, 0, 0, 2), t)).toBe("2 settings not checked");
    expect(undoTallyWords(tally(0), t)).toBe("Nothing in effect to undo");
    expect(undoTallyWords(tally(3, 2), t)).not.toMatch(/every/i);
    // C7: never "changes" for a count of settings.
    expect(undoTallyWords(tally(2, 2, 2, 2), t)).not.toMatch(/\bchanges?\b(?! outside)/);
  });

  // CR-home-unchecked-once: Home's card shows one unchecked count, never the ledger's beside the model's.
  it("Home's note names one unchecked count: the model's when it has one, else the ledger's", () => {
    expect(activeChangesNote(tally(1, 0, 0, 2), 1, t)).toBe("1 setting can be undone · 1 more setting couldn't be checked just now");
    expect(activeChangesNote(tally(0, 0, 0, 2), 1, t)).toBe("1 more setting couldn't be checked just now");
    expect(activeChangesNote(tally(1, 0, 0, 2), 0, t)).toBe("1 setting can be undone · 2 settings not checked");
    expect(activeChangesNote(tally(0), 0, t)).toBe("Nothing in effect to undo");
    expect(activeChangesNote(tally(3), 2, t, "LEAD")).toBe("LEAD · 2 more settings couldn't be checked just now");
    // The footer's words are unchanged.
    expect(undoTallyWords(tally(1, 0, 0, 2), t)).toBe("1 setting can be undone · 2 settings not checked");
  });

  it("zh-CN says the same counts in its own words", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(undoTallyWords(tally(1, 0, 1), t)).toBe("1 项设置可撤销 · 1 项设置已在 Compy 之外更改，无法撤销");
    expect(undoTallyWords(tally(0), t)).toBe("没有生效中的更改需要撤销");
  });
});