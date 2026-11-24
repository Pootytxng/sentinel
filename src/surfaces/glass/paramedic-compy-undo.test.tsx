// B10 (owner decision 2026-11-24: the coordinator's recommendation, no-admin undos only): "Undo this Compy change" on
// the Something's-wrong card. The card decides only what to offer, from the ledger list it is given and the finding's
// own window; App's `undoOneRecord` (mocked here, it is App's) re-reads at the click and makes the one undo. These
// tests render the real card; nothing reaches Windows.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const answer = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(answer.value),
}));

import i18n from "../../i18n";
import type { AppliedChange, ParamedicDiagnosis } from "../../types";
import type { CardUndoResult } from "../../data/compy-undo";
import { ParamedicCard } from "./ParamedicCard";

afterEach(() => {
  cleanup();
  answer.value = null;
});

const WIN_FROM = "2026-11-19T05:00:00Z";
const WIN_TO = "2026-11-19T17:00:00Z";
const ref = (at: string) => ({ started_at: at, game: "game-a", duration_secs: 3600, samples: 3500, avg_fps: 120, low1_fps: 80 });
type F = ParamedicDiagnosis["findings"][number];
const compyFinding = (confidence: F["confidence"], from = "3", to = "4"): F => ({
  id: "compy-change",
  confidence,
  in_play: true,
  evidence: [{ kind: "known", code: "count-changed", args: { from, to }, against: false, source: "sessions" }],
  since_when: { kind: "observed-between", from: WIN_FROM, to: WIN_TO },
  fix: { kind: "steps", code: "compy-change", args: {} },
  now: null,
  now_evidence: [],
});
const other: F = {
  id: "gpu-driver-change",
  confidence: "likely",
  in_play: false,
  evidence: [{ kind: "known", code: "driver-changed", args: { from: "1.0", to: "2.0" }, against: false, source: "snapshots" }],
  since_when: { kind: "observed-between", from: WIN_FROM, to: WIN_TO },
  fix: { kind: "steps", code: "gpu-driver-change", args: { from: "1.0" } },
  now: null,
  now_evidence: [],
};
const diagnosis = (findings: F[]): ParamedicDiagnosis => ({
  complaint: "unknown",
  state: { kind: "found" },
  game: "game-a",
  game_name: "Game A",
  problem: {
    rule: "stutter-collapse",
    spikes: false,
    avg_lower: false,
    before: { ratio: 0.9, p99_ms: null, avg_fps: 120 },
    now: { ratio: 0.5, p99_ms: null, avg_fps: 110 },
    last_normal_at: "2026-11-19T04:00:00Z",
    last_full_normal_at: "2026-11-19T04:00:00Z",
    sessions_affected: [ref("2026-11-19T17:00:00Z")],
    partial_sessions: [],
    other_games_affected: [],
    later_unjudged: 0,
  },
  findings,
  not_it: [],
  unknowns: [],
  limits: [],
  seen: [],
  baseline: ref("2026-11-19T04:00:00Z"),
  first_bad: ref("2026-11-19T17:00:00Z"),
  mixed_sessions: [],
  why_first: null,
  recovery: null,
  earlier_episode: null,
  method: "paramedic-rules-v1",
});

const GM = "Enable Windows Game Mode";
const rec = (over: Partial<AppliedChange> = {}): AppliedChange =>
  ({
    id: "gm-1",
    rec_id: "game-mode",
    rec_title: GM,
    applied_at: "2026-11-19T10:00:00Z",
    snapshot: null,
    status: "applied",
    is_still_active: true,
    active_check: "on",
    undo_contract: true,
    rollback_action: { kind: "restore-game-mode-from-snapshot" },
    ...over,
  }) as AppliedChange;

const openAll = () => {
  for (let i = 0; i < 6; i++) {
    const closed = screen.queryAllByRole("button").filter((b) => b.getAttribute("aria-expanded") === "false");
    if (closed.length === 0) return;
    closed.forEach((b) => fireEvent.click(b));
  }
};

const show = async (findings: F[], changes: AppliedChange[], undo = vi.fn<(r: string, i: string, e: string) => Promise<CardUndoResult>>()) => {
  answer.value = diagnosis(findings);
  const view = render(<ParamedicCard drifts={[]} changes={changes} undoCompyChange={undo} />);
  fireEvent.click(screen.getByRole("button", { name: "Something's wrong" }));
  await waitFor(() => expect(screen.queryAllByTestId("paramedic-candidate").length).toBeGreaterThan(0));
  openAll();
  return { undo, view };
};

describe("B10: Undo this Compy change on the card", () => {
  // Break check: drop the button branch in CompyUndoRow -> no button, fails.
  it("one Compy record in the window, count +1, confirmed on, no-admin undo: one button that passes ids only", async () => {
    const undo = vi.fn<(r: string, i: string, e: string) => Promise<CardUndoResult>>().mockResolvedValue({ kind: "cancelled" });
    await show([compyFinding("likely")], [rec()], undo);
    fireEvent.click(screen.getByTestId("paramedic-undo-compy"));
    await waitFor(() => expect(undo).toHaveBeenCalledTimes(1));
    const [recId, id, extra] = undo.mock.calls[0];
    expect([recId, id]).toEqual(["game-mode", "gm-1"]);
    expect(typeof extra).toBe("string");
    expect(extra).toContain("Game A");
    expect(extra).toContain("it doesn't tell Compy whether this change was the reason");
    expect(screen.getByTestId("paramedic-undo-compy").textContent).toBe(`Undo “${GM}”`);
  });

  it("is offered on an 'also possible' row too", async () => {
    await show([other, compyFinding("possible")], [rec()]);
    expect(screen.getByTestId("paramedic-undo-compy")).toBeTruthy();
  });

  // Break check: show the button for an admin rollback action -> fails.
  it("an undo that needs admin rights is named, with where to undo it, and no button", async () => {
    await show([compyFinding("likely")], [rec({ rec_id: "hags-enable", rec_title: "Enable HAGS", rollback_action: { kind: "restore-hw-sch-mode-from-snapshot" } })]);
    expect(screen.queryByTestId("paramedic-undo-compy")).toBeNull();
    expect(screen.getByTestId("paramedic-undo-compy-none").textContent).toBe(
      "Compy doesn't offer to undo “Enable HAGS” from this card. You can see it, and undo it if you choose, in Test → Applied & history.",
    );
  });

  it("two records in the window are listed, never undone together", async () => {
    await show([compyFinding("likely", "3", "5")], [rec(), rec({ id: "vfx-1", rec_id: "visual-effects", rec_title: "Trim visual effects", applied_at: "2026-11-19T11:00:00Z", rollback_action: { kind: "restore-visual-effects-from-snapshot" } })]);
    expect(screen.queryByTestId("paramedic-undo-compy")).toBeNull();
    expect(screen.getByTestId("paramedic-undo-compy-several").textContent).toBe(
      `Compy recorded changes to 2 settings in that time: ${GM}, Trim visual effects. To check them one at a time, undo one in Test → Applied & history, then play once before undoing the next.`,
    );
  });

  // Break checks: mark the record undone on any result ("failed" -> done) -> the button goes, fails; show the dated
  // line on "unrecorded" -> fails.
  it.each([
    ["failed", null, true],
    ["cancelled", null, true],
    ["trial", "A Trial is running, or Compy can't tell whether one is, so it didn't undo anything. Check Test, then press Something's wrong again.", true],
    ["changed", "This changed since the card was drawn, so Compy didn't undo anything. Press Something's wrong again.", true],
    ["unread", "Compy couldn't read its change list just now, so it didn't undo anything. Press Something's wrong again.", true],
    ["unrecorded", "The undo worked on Windows, but Compy couldn't save it to its history, so Applied & history may still list this change. Check the setting in Windows if unsure.", false],
  ] as const)("a press that came back %s: no 'Undone' line", async (kind, line, buttonStays) => {
    const undo = vi.fn<(r: string, i: string, e: string) => Promise<CardUndoResult>>().mockResolvedValue({ kind });
    await show([compyFinding("likely")], [rec()], undo);
    fireEvent.click(screen.getByTestId("paramedic-undo-compy"));
    await waitFor(() => expect(undo).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(!!screen.queryByTestId("paramedic-undo-compy")).toBe(buttonStays));
    expect(screen.queryByTestId("paramedic-undo-compy-done")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Undone on/);
    if (line) expect(screen.getByTestId("paramedic-undo-compy-result").textContent).toBe(line);
    else expect(screen.queryByTestId("paramedic-undo-compy-result")).toBeNull();
  });

  // Break check: date the line from the click (or applied_at) instead of rolled_back_at -> the date differs, fails.
  it("once the ledger says it is undone, the line takes its date from rolled_back_at", async () => {
    const at = "2026-11-22T09:30:00Z";
    await show([compyFinding("likely")], [rec({ status: "rolled_back", rolled_back_at: at, active_check: null })]);
    const when = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(at));
    expect(screen.getByTestId("paramedic-undo-compy-done").textContent).toBe(
      `Undone on ${when}: “${GM}”. Play Game A once the way you usually do, then press Something's wrong again.`,
    );
    expect(screen.queryByTestId("paramedic-undo-compy")).toBeNull();
  });

  // Review r1 F3: once undone, the row's own steps go ("Undo the newest one" would point at another, unnamed change, and
  // "play once" repeats the undone line). Break check: keep the steps beside the undone line -> fails.
  it("an undone row shows only its dated line, not the 'undo the newest one' steps", async () => {
    await show([compyFinding("likely")], [rec({ status: "rolled_back", rolled_back_at: "2026-11-22T09:30:00Z", active_check: null })]);
    expect(screen.getByTestId("paramedic-undo-compy-done")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Undo the newest one");
    expect(document.body.textContent).not.toContain("Play Game A once, then press Something's wrong again.");
  });

  it("while the change is open, the row keeps its steps beside the button", async () => {
    await show([compyFinding("likely")], [rec()]);
    expect(document.body.textContent).toContain("Undo the newest one");
    expect(screen.getByTestId("paramedic-undo-compy")).toBeTruthy();
  });

  // ==== B10b: what was read since the undo (the engine's compy-undone-* lines) =====================================
  const UNDONE = "2026-11-22T09:30:00Z";
  const AT = "2026-11-23T20:00:00Z";
  const dayTime = (iso: string) => new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const day = (iso: string) => new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(iso));
  const withLine = (code: string, kind: "measured" | "unknown", args: Record<string, string>, against = false): F => {
    const f = compyFinding("possible");
    return { ...f, evidence: [...f.evidence, { kind, code, args: { title: GM, undone: UNDONE, ...args }, against, source: "sessions" }] };
  };
  const undoneRec = () => rec({ status: "rolled_back", rolled_back_at: UNDONE, active_check: null });

  // Review r1 FIX 3: every line but rough carries B10's own next step, word for word (rough needs none: the change is
  // off and the game is still rough). Break checks: drop the compy-undone-rough case from evidenceLine -> the line is
  // missing, fails; drop the next step from compyUndoneBetween -> fails.
  const NEXT = " Play Game A once the way you usually do, then press Something's wrong again.";
  it.each([
    ["compy-undone-rough", "measured", { at: AT, count: "1" }, true, `“${GM}” was undone on ${dayTime(UNDONE)}, and Game A still ran rough on ${day(AT)}.`],
    ["compy-undone-rough", "measured", { at: AT, count: "2" }, true, `“${GM}” was undone on ${dayTime(UNDONE)}, and Game A still ran rough in 2 sessions since, the first on ${day(AT)}.`],
    ["compy-undone-clear-once", "measured", { at: AT }, false, `“${GM}” was undone on ${dayTime(UNDONE)}, and Game A's session on ${day(AT)} ran in its usual range. One session so far; Compy says a game is back in its usual range after two.${NEXT}`],
    // b12 item 1: two clear sessions since the undo, then one (or more) Compy couldn't judge. Break check: drop the
    // compy-undone-clear-unjudged case from evidenceLine -> the line is missing, fails.
    ["compy-undone-clear-unjudged", "measured", { at: AT, count: "2", later: "1" }, false, `“${GM}” was undone on ${dayTime(UNDONE)}, and Game A ran in its usual range in 2 sessions since, the latest on ${day(AT)}. The session after that was too short, or Compy couldn't measure enough of it, so Compy can't say it is back in its usual range yet.${NEXT}`],
    ["compy-undone-clear-unjudged", "measured", { at: AT, count: "3", later: "2" }, false, `“${GM}” was undone on ${dayTime(UNDONE)}, and Game A ran in its usual range in 3 sessions since, the latest on ${day(AT)}. Each session after that was too short, or Compy couldn't measure enough of it, so Compy can't say it is back in its usual range yet.${NEXT}`],
    ["compy-undone-unread", "unknown", { count: "1" }, false, `“${GM}” was undone on ${dayTime(UNDONE)}. 1 Game A session has been recorded since, but it was too short, or Compy couldn't measure enough of it, so Compy has no reading it can judge.${NEXT}`],
    ["compy-undone-unread", "unknown", { count: "2" }, false, `“${GM}” was undone on ${dayTime(UNDONE)}. 2 Game A sessions have been recorded since, but each was too short, or Compy couldn't measure enough of it, so Compy has no reading it can judge.${NEXT}`],
    ["compy-undone-between", "unknown", {}, false, `“${GM}” was undone on ${dayTime(UNDONE)}. Of the Game A sessions since, at least one wasn't clearly in its usual range, so Compy can't tell yet.${NEXT}`],
    // b12 item 3: one judged session since: singular. Break check: drop compyUndoneBetween_one (or stop passing
    // `count`) -> the plural "sessions since weren't" shows, fails.
    ["compy-undone-between", "unknown", { count: "1" }, false, `“${GM}” was undone on ${dayTime(UNDONE)}. One Game A session since was measured well enough to read, and it wasn't clearly in its usual range, so Compy can't tell yet.${NEXT}`],
    ["compy-undone-between", "unknown", { count: "2" }, false, `“${GM}” was undone on ${dayTime(UNDONE)}. Of the Game A sessions since, at least one wasn't clearly in its usual range, so Compy can't tell yet.${NEXT}`],
  ] as const)("%s says what was read since the undo, dated from the ledger", async (code, kind, args, against, text) => {
    await show([withLine(code, kind, args, against)], [undoneRec()]);
    expect(document.body.textContent).toContain(text);
    expect(document.body.textContent).not.toMatch(/\b(fixed|caused|probably|safe|worked)\b/i);
  });

  // b12 r3 (R3-2): the state observed in the Rust build (undo, a capped session, then a normal uncapped one):
  // CantTell{RecoveryUnclear{one_clear: true}}, compy-undone-between with count "2". One of the two WAS in its usual
  // range, so the line says "at least one wasn't", never that the sessions weren't. Break check: put back "The {{game}}
  // sessions since weren't clearly in its usual range" in compyUndoneBetween_other -> fails.
  it("the observed capped-then-normal state (between, count 2) says 'at least one wasn't'", async () => {
    const f = compyFinding("possible");
    const line = { kind: "unknown" as const, code: "compy-undone-between", args: { title: GM, undone: UNDONE, count: "2" }, against: false, source: "sessions" };
    answer.value = { ...diagnosis([{ ...f, evidence: [...f.evidence, line] }]), state: { kind: "cant-tell", why: { kind: "recovery-unclear", partial: false, one_clear: true, cap_changed: false } } };
    render(<ParamedicCard drifts={[]} changes={[undoneRec()]} undoCompyChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Something's wrong" }));
    await waitFor(() => expect(screen.queryAllByTestId("paramedic-candidate").length).toBeGreaterThan(0));
    openAll();
    expect(document.body.textContent).toContain(
      `“${GM}” was undone on ${dayTime(UNDONE)}. Of the Game A sessions since, at least one wasn't clearly in its usual range, so Compy can't tell yet.${NEXT}`,
    );
    expect(document.body.textContent).not.toContain("sessions since weren't clearly");
  });

  // The card's own footer ("Check it, play Game A once, ...") is the card's, for every Possible answer; B10's sentence
  // is what the rough line must not carry. Break check: append it to compyUndoneRough_one -> fails.
  it("a rough line after the undo carries no 'play once' step", async () => {
    await show([withLine("compy-undone-rough", "measured", { at: AT, count: "1" }, true)], [undoneRec()]);
    expect(document.body.textContent).not.toContain(NEXT.trim());
  });

  // Decided: once a session was read after the undo, the evidence line says when it was undone and what was read, so
  // the "Undone on ... play once, then press again" line (and the steps) are not repeated. Break check: keep the
  // undone line when a compy-undone-* line is present -> two "was undone"/"Undone on" lines, fails.
  it("with a line read since the undo, the 'Undone on' line and the steps are not repeated", async () => {
    await show([withLine("compy-undone-clear-once", "measured", { at: AT })], [undoneRec()]);
    expect(screen.queryByTestId("paramedic-undo-compy-done")).toBeNull();
    expect(document.body.textContent).not.toContain("Undone on");
    expect(document.body.textContent).not.toContain("Undo the newest one");
  });

  // b12 item 1: the user has already played twice since the undo; the stale "Undone on ... play once" line must not
  // show beside the clear-unjudged line, and the line says it in zh-CN too. Break checks: narrow `readSince` to the
  // four B10b codes -> "Undone on" shows, fails; drop compyUndoneClearUnjudged_other from zh-CN -> en text, fails.
  it("two clear sessions then unjudged ones: the 'Undone on' line is not repeated, and zh-CN says it", async () => {
    const zDayTime = (iso: string) => new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
    const zDay = (iso: string) => new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(iso));
    try {
      await show([withLine("compy-undone-clear-unjudged", "measured", { at: AT, count: "2", later: "1" })], [undoneRec()]);
      expect(screen.queryByTestId("paramedic-undo-compy-done")).toBeNull();
      expect(document.body.textContent).not.toContain("Undone on");
      await i18n.changeLanguage("zh-CN");
      await waitFor(() =>
        expect(document.body.textContent).toContain(
          `“${GM}”已于 ${zDayTime(UNDONE)} 撤销，此后 Game A 有 2 次游戏表现在平时的范围内，最近一次在 ${zDay(AT)}。之后的游戏时间太短，或 Compy 没能测量到足够的部分，所以 Compy 还不能说它已恢复到平时的范围。照平时的方式玩一次 Game A，然后再按一次“出问题了”。`,
        ),
      );
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  // b12 r2 (R2-1): the same setting was applied again after the undo. The line says both ledger times, and the older
  // "Undone on ... play once" row (which would speak of a setting that is on again) is not shown. Break checks: drop
  // the compy-undone-reapplied case from evidenceLine -> the en text is missing, fails; drop compyUndoneReapplied from
  // zh-CN -> en text, fails.
  it("re-applied after the undo: the dated line in en and zh, and no 'Undone on' row", async () => {
    const REAPPLIED = "2026-11-23T10:15:00Z";
    const zDayTime = (iso: string) => new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
    const f = compyFinding("possible");
    const line = { kind: "known" as const, code: "compy-undone-reapplied", args: { title: GM, undone: UNDONE, reapplied: REAPPLIED }, against: false, source: "sessions" };
    try {
      await show([{ ...f, evidence: [...f.evidence, line] }], [undoneRec(), rec({ id: "gm-2", applied_at: REAPPLIED })]);
      expect(document.body.textContent).toContain(
        `“${GM}” was undone on ${dayTime(UNDONE)}, then applied again on ${dayTime(REAPPLIED)}. Compy doesn't read the sessions from then on as following the undo.`,
      );
      expect(screen.queryByTestId("paramedic-undo-compy-done")).toBeNull();
      expect(document.body.textContent).not.toContain("Undone on");
      await i18n.changeLanguage("zh-CN");
      await waitFor(() =>
        expect(document.body.textContent).toContain(`“${GM}”已于 ${zDayTime(UNDONE)} 撤销，之后又于 ${zDayTime(REAPPLIED)} 重新应用。从那时起的游戏，Compy 不会当作撤销之后的游戏来读。`),
      );
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  // b12 item 3: zh-CN has one plural form (other), so its between line must read right for ONE judged session: no
  // "几次" ("several"). Break check: put back "此后的几次游戏" in compyUndoneBetween_other -> fails.
  it("zh-CN: the between line for one judged session says no 'several'", async () => {
    const zDayTime = (iso: string) => new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
    try {
      await show([withLine("compy-undone-between", "unknown", { count: "1" })], [undoneRec()]);
      await i18n.changeLanguage("zh-CN");
      await waitFor(() =>
        expect(document.body.textContent).toContain(
          `“${GM}”已于 ${zDayTime(UNDONE)} 撤销。此后 Game A 测量充分的游戏中，至少有一次并不明确在平时的范围内，所以 Compy 暂时还无法判断。照平时的方式玩一次 Game A，然后再按一次“出问题了”。`,
        ),
      );
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  // zh-CN literal. Break check: drop compyUndoneRough_other from zh-CN -> falls back to en text, fails.
  it("zh-CN says the same lines in Chinese", async () => {
    const zDayTime = (iso: string) => new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
    const zDay = (iso: string) => new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(iso));
    // The card is opened in en (show() presses the en button), then the language is switched; the open card re-renders.
    try {
      await show([withLine("compy-undone-rough", "measured", { at: AT, count: "1" }, true)], [undoneRec()]);
      await i18n.changeLanguage("zh-CN");
      // zh-CN has one plural form (other): a count of 1 reads "仍有 1 次不顺，最早的一次在 …".
      await waitFor(() => expect(document.body.textContent).toContain(`“${GM}”已于 ${zDayTime(UNDONE)} 撤销，此后 Game A 仍有 1 次不顺，最早的一次在 ${zDay(AT)}。`));
      cleanup();
      await i18n.changeLanguage("en");
      await show([withLine("compy-undone-unread", "unknown", { count: "2" })], [undoneRec()]);
      await i18n.changeLanguage("zh-CN");
      await waitFor(() => expect(document.body.textContent).toContain(`“${GM}”已于 ${zDayTime(UNDONE)} 撤销。此后记录到 2 次 Game A 的游戏，但时间太短，或 Compy 没能测量到足够的部分，所以 Compy 没有可以判断的读数。照平时的方式玩一次 Game A，然后再按一次“出问题了”。`));
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("with no session since the undo, the 'Undone on' line stays (it is the one next step)", async () => {
    await show([compyFinding("likely")], [undoneRec()]);
    expect(screen.getByTestId("paramedic-undo-compy-done")).toBeTruthy();
  });

  it("no ledger list or no undo from App: nothing is offered", async () => {
    answer.value = diagnosis([compyFinding("likely")]);
    render(<ParamedicCard drifts={[]} changes={null} undoCompyChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Something's wrong" }));
    await waitFor(() => expect(screen.queryAllByTestId("paramedic-candidate").length).toBeGreaterThan(0));
    openAll();
    expect(screen.queryByTestId("paramedic-undo-compy")).toBeNull();
    expect(screen.queryByTestId("paramedic-undo-compy-none")).toBeNull();
  });
});