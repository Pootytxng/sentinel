import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import en from "../i18n/locales/en/app.json";
import zh from "../i18n/locales/zh-CN/app.json";
import { keptOutsideUndoBody } from "./kept-outside-undo";

// A t() over one locale's app.json, enough to read the real words.
const tFor = (bag: { dialogs: Record<string, string> }) =>
  ((key: string, opts?: Record<string, string>) => {
    const k = key.replace("app.dialogs.", "");
    let s = bag.dialogs[k] ?? key;
    for (const [n, v] of Object.entries(opts ?? {})) s = s.split(`{{${n}}}`).join(v);
    return s;
  }) as unknown as TFunction;

const SYNEZ = "22222222-2222-2222-2222-222222222222";
const BALANCED = "381b4222-f694-41f0-9685-ff5bb260df2e";
const kept = (guid: string | undefined, name = "Synez Power Plan") => ({
  schema: 1,
  recorded_at: "2026-11-11T04:15:43Z",
  observed: { kind: "power-plan", guid, name },
});

describe("Undo after Keep <plan> names the plan the undo switches to", () => {
  it("a stock saved plan is named, and the kept plan is named as the one left behind", () => {
    const body = keptOutsideUndoBody({ snapshot: { kind: "power-plan", prior_guid: BALANCED }, changed_outside: kept(SYNEZ) }, tFor(en));
    expect(body).toBe(
      "You chose to keep “Synez Power Plan”, set outside Compy. Rolling back switches your power plan to “Balanced”, the plan Compy saved before it changed anything, away from “Synez Power Plan”.",
    );
    expect(keptOutsideUndoBody({ snapshot: { kind: "power-plan", prior_guid: BALANCED }, changed_outside: kept(SYNEZ) }, tFor(zh))).toContain("“平衡”");
  });

  // CR-range3-nits (a): Windows' stock Power saver is a stock plan too, so a saved Power saver is named.
  it("a saved Power saver plan is named, en and zh-CN", () => {
    const POWER_SAVER = "a1841308-3541-4fab-bc81-f71556f20b4a";
    const change = { snapshot: { kind: "power-plan", prior_guid: POWER_SAVER }, changed_outside: kept(SYNEZ) };
    expect(keptOutsideUndoBody(change, tFor(en))).toContain("switches your power plan to “Power saver”");
    expect(keptOutsideUndoBody(change, tFor(zh))).toContain("“节能”");
  });

  it("a saved plan that is the kept plan says the plan stays the same", () => {
    const body = keptOutsideUndoBody({ snapshot: { kind: "power-plan", prior_guid: SYNEZ.toUpperCase() }, changed_outside: kept(SYNEZ) }, tFor(en));
    expect(body).toContain("which is “Synez Power Plan” too, so your plan stays the same.");
  });

  it("a saved custom plan Compy can't name says so, never a guessed name", () => {
    const body = keptOutsideUndoBody({ snapshot: { kind: "power-plan", prior_guid: "11111111-1111-1111-1111-111111111111" }, changed_outside: kept(SYNEZ) }, tFor(en));
    expect(body).toContain("(Compy didn't save its name), away from “Synez Power Plan”.");
    expect(tFor(zh)("app.dialogs.rollbackKeptOutsideUnnamed", { kept: "x" })).toContain("没有保存它的名称");
  });

  it("every other row keeps the generic confirm", () => {
    expect(keptOutsideUndoBody({ snapshot: { kind: "power-plan", prior_guid: BALANCED }, changed_outside: null }, tFor(en))).toBeNull();
    expect(keptOutsideUndoBody({ snapshot: {}, changed_outside: { ...kept(SYNEZ), schema: 2 } }, tFor(en))).toBeNull();
  });
});
