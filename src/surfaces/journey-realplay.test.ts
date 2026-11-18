// P5-realplay: the words for a Trial that leaves one change on while the owner plays however he
// plays. Every phase of the progress read and every verdict of a concluded record is said here, in
// en and zh-CN, from the backend's own fields, and no line ever shows a raw key or an unfilled
// placeholder. Real play never claims High confidence.
import { describe, it, expect, afterEach } from "vitest";
import i18n from "../i18n";
import {
  asRealPlayProgress,
  collectingBeforeLine,
  isRealPlay,
  notCountedWhy,
  realPlayConfidence,
  realPlayCounts,
  realPlayFace,
  realPlayNoiseLine,
  realPlayNumbersMissing,
  realPlayOffer,
  realPlayResult,
  realPlayView,
  realPlayWhy,
  whenText,
  type RealPlayProgress,
  type RealPlayRecord,
} from "./journey-realplay";

const t = i18n.t.bind(i18n);
const APPLIED = "2026-10-20T19:31:00+00:00";
const UNTIL = "2026-11-03T19:31:00+00:00";

const progress = (over: Partial<RealPlayProgress> = {}): RealPlayProgress => ({
  phase: "collecting",
  game: "WardogsClient-Win64-Shipping.exe",
  experiment_id: "exp:5-1",
  anchor_session_id: null,
  before: 3,
  with: 1,
  need: 3,
  min_sessions: 3,
  max_sessions: 8,
  min_readings: 600,
  window_days: 14,
  band_pct: null,
  applied_at: APPLIED,
  until: UNTIL,
  stop: null,
  not_counted: [],
  ...over,
});
const RUNNING: RealPlayRecord = {
  id: "exp:5-1",
  rec_title: "HAGS",
  game: "WardogsClient-Win64-Shipping.exe",
  status: "running",
  verdict: null,
  mode: "real-play",
  applied_at: APPLIED,
};
const sessions = (n: number, low = 200) =>
  Array.from({ length: n }, (_, i) => ({ session_id: `2026-10-2${i}T20:00:00+00:00`, low1_fps: low, avg_fps: 240, samples: 1170 }));
/** A concluded real-play record: `before`/`with` sessions a side and the record's own numbers. */
const concluded = (over: Partial<RealPlayRecord>, rp: Record<string, unknown> = {}, before = 3, withN = 3): RealPlayRecord => ({
  ...RUNNING,
  status: "restored",
  verdict: "no-change",
  ...over,
  real_play: { before: sessions(before), with: sessions(withN), ...rp },
});

/** No line ever shows a raw key, an unfilled placeholder or an "undefined". */
const clean = (line: string | null) => {
  expect(line).toBeTruthy();
  expect(line).not.toMatch(/lab\.experimentBench|\{\{|\}\}|undefined|NaN|null/);
  return line as string;
};

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("P5-realplay: what the progress read says", () => {
  it("offers real play beside the two-session plan: at once with enough as-is sessions, else while collecting them", () => {
    expect(realPlayOffer(progress({ phase: "ready-to-start", experiment_id: null, before: 3 }), "HAGS", "WardogsClient", t)).toBe(
      "Or test it while you play normally: HAGS goes on now and stays on while you play WardogsClient however you like, for up to 8 sessions or 14 days. Compy compares those sessions with your last 3 without it.",
    );
    expect(realPlayOffer(progress({ phase: "collecting-before", experiment_id: null, before: 2 }), "HAGS", "WardogsClient", t)).toBe(
      "Or test it while you play normally: Compy first measures 3 sessions of WardogsClient as your PC is now (2 so far), then turns HAGS on and leaves it on while you play however you like.",
    );
    // Nothing to offer while a Trial runs, or when the count can't be read.
    for (const phase of ["collecting", "ready", "stopped"] as const) expect(realPlayOffer(progress({ phase }), "HAGS", "W", t)).toBeNull();
    expect(realPlayOffer(null, "HAGS", "W", t)).toBeNull();
  });

  // Rust review fix: sessions recorded before 2026-10-24 never pin, so an upgraded PC starts from zero.
  it("collecting reads naturally from zero", () => {
    expect(realPlayOffer(progress({ phase: "collecting-before", experiment_id: null, before: 0 }), "HAGS", "WardogsClient", t)).toBe(
      "Or test it while you play normally: Compy first measures 3 sessions of WardogsClient as your PC is now (0 so far), then turns HAGS on and leaves it on while you play however you like.",
    );
    expect(collectingBeforeLine(progress({ phase: "collecting-before", before: 0 }), "WardogsClient", t)).toBe(
      "Nothing has been changed yet. Keep playing, Compy is still collecting (0 of 3 sessions of WardogsClient as your PC is now).",
    );
  });

  it("after an as-is session, says nothing is on yet and how many count", () => {
    expect(collectingBeforeLine(progress({ phase: "collecting-before", before: 2 }), "WardogsClient", t)).toBe(
      "Nothing has been changed yet. Keep playing, Compy is still collecting (2 of 3 sessions of WardogsClient as your PC is now).",
    );
  });

  it("collecting: the change is on and since when, how long it may stay on, how to put it back, and N of M", () => {
    const v = realPlayView(RUNNING, progress(), t, "en");
    expect(v.changeOn).toBe(
      `HAGS is on (since ${whenText(APPLIED, "en")}). It stays on while you play, until Compy has a result: at most 8 sessions, or by ${whenText(UNTIL, "en")}.`,
    );
    expect(v.status).toBe("Keep playing, Compy is still collecting (1 of 3 sessions).");
    expect(v.putBackHow).toBe(
      "To put it back, tap Restore now: Compy restores the setting exactly as it was before the test. You can also undo it in Test → Applied & history.",
    );
    expect([v.notYet, v.closeHow, v.action]).toEqual([null, null, "measure"]);
    // After a look that left it open: how much the sessions vary, and the next look's count.
    const later = realPlayView(RUNNING, progress({ with: 3, need: 5, band_pct: 21.66 }), t, "en");
    expect(later.status).toBe("Keep playing, Compy is still collecting (3 of 5 sessions).");
    expect(later.notYet).toBe("Not clear yet: the allowance for normal swings between your sessions is ±21.7% so far, so Compy needs a few more.");
  });

  it("ready: a result is there to see; stopped: why, what closing does, and the close action", () => {
    expect(realPlayView(RUNNING, progress({ phase: "ready", with: 3 }), t, "en")).toMatchObject({
      // Review 2026-11-02, round 2: no "until Compy has a result" above the line saying it has one.
      changeOn: `HAGS is on (since ${whenText(APPLIED, "en")}).`,
      status: "Compy has enough sessions for a result.",
      action: "see-result",
      closeHow: null,
      // Review 2026-11-02 (fix 4): before the tap, what See the result does (concludeRealPlayTrial).
      seeHow:
        "Seeing the result ends the test: Compy keeps HAGS only if the result is Likely better, and otherwise puts it back the way it was before the test.",
    });
    for (const phase of ["collecting", "stopped"] as const) expect(realPlayView(RUNNING, progress({ phase }), t, "en").seeHow, phase).toBeNull();
    const lines: Record<string, string> = {
      "change-off": "HAGS no longer reads as on, so no new session can count. If it reads as on again, Compy keeps collecting.",
      "put-back-in-history": "HAGS was put back in Test → Applied & history, so the test can't go on.",
      unreadable: "Compy can't read HAGS right now, so no new session can count until it can.",
      "other-change": "Another Compy change was applied or undone during the test, so later sessions can't be compared.",
      conditions:
        "Your hardware, graphics driver, Windows build, game build or capture method changed during the test, so later sessions can't be compared.",
      "window-over": "The 14 days for this test are over.",
      "before-missing":
        "The sessions from before the change are no longer in Compy's session history, so there is nothing to compare against.",
      "a-newer-stop": "This test can't go on as it is.",
    };
    for (const [stop, line] of Object.entries(lines)) {
      const v = realPlayView(RUNNING, progress({ phase: "stopped", stop }), t, "en");
      expect(v.status, stop).toBe(line);
      expect(v.action, stop).toBe("close");
      // CR-1102-left owner call (a): another change or a changed condition always puts it back.
      expect(v.closeHow, stop).toBe(
        stop === "put-back-in-history"
          ? "Closing records what the sessions Compy counted show, and keeps nothing, since HAGS was already put back."
          : stop === "other-change" || stop === "conditions"
            ? "Closing records what the sessions Compy counted show, keeps nothing, and writes HAGS back exactly as it was before the test, since something else changed during it."
            : "Closing judges the sessions Compy counted. Unless they show HAGS likely better, Compy then writes the setting back exactly as it was before the test, even if it was changed outside Compy since.",
      );
    }
  });

  // Review 2026-11-02 (fix 1): every stopped state printed "HAGS is on (since …). It stays on while you
  // play, until Compy has a result", the put-back line and its button, beside a status saying the
  // change is off, was put back or can't be read. The line now follows the stop in the backend's own
  // stop order (realplay.rs `with_arm`): off and put back say so and offer no put-back; unreadable says
  // Compy can't tell; before-missing is only ever reported while the setting reads on; every other stop
  // can come first over a setting that reads off or can't be read, so it says only what Compy did.
  describe("a stopped test says plainly whether its change is on", () => {
    const ON_LINE = {
      en: {
        noLongerOn: "HAGS is no longer on.",
        cantTell: "Compy can't tell whether HAGS is on right now.",
        stillOn: "HAGS is still on, but this test can't reach a result.",
        notPutBack: "Compy hasn't put HAGS back, but this test can't go on.",
      },
      "zh-CN": {
        noLongerOn: "HAGS已不再开启。",
        cantTell: "Compy 现在无法判断HAGS是否开启。",
        stillOn: "HAGS仍然开启，但这次测试无法得出结果。",
        notPutBack: "Compy 还没有把HAGS恢复原样，但这次测试无法继续。",
      },
    } as const;
    const STOPPED: [string, keyof (typeof ON_LINE)["en"]][] = [
      ["change-off", "noLongerOn"],
      ["put-back-in-history", "noLongerOn"],
      ["unreadable", "cantTell"],
      ["before-missing", "stillOn"],
      ["window-over", "notPutBack"],
      ["other-change", "notPutBack"],
      ["conditions", "notPutBack"],
      ["a-newer-stop", "notPutBack"],
    ];
    for (const lang of ["en", "zh-CN"] as const)
      it.each(STOPPED)(`${lang}: %s`, async (stop, on) => {
        await i18n.changeLanguage(lang);
        const v = realPlayView(RUNNING, progress({ phase: "stopped", stop, band_pct: 7.8 }), t, lang);
        expect(v.changeOn).toBe(ON_LINE[lang][on]);
        // No stopped state says the change stays on until Compy has a result.
        const said = [v.changeOn, v.status, v.notYet, v.putBackHow, v.closeHow].filter((l) => l != null).join("\n");
        expect(said).not.toMatch(/stays on|until Compy has a result|一直保持开启|得出结果之前/);
        // The two stops that say the change is already off offer no put-back, line or button.
        if (on === "noLongerOn") expect(v.putBackHow).toBeNull();
        else expect(v.putBackHow).toBe(t("lab.experimentBench.journey.realPlay.putBackHow"));
        // Closing a test put back in history keeps nothing and writes nothing (experiment.rs
        // put_back_before_conclude, then a restore that meets "already rolled back"), so it never says
        // "unless they show it likely better"; another change or a changed condition always puts it back
        // (CR-1102-left owner call a); every other stop's close can still keep a Likely better.
        const confounded = stop === "other-change" || stop === "conditions";
        expect(v.closeHow).toBe(
          stop === "put-back-in-history"
            ? t("lab.experimentBench.journey.realPlay.closeHowPutBack", { change: "HAGS" })
            : confounded
              ? t("lab.experimentBench.journey.realPlay.closeHowConfounded", { change: "HAGS" })
              : t("lab.experimentBench.journey.realPlay.closeHow", { change: "HAGS" }),
        );
        if (stop === "put-back-in-history" || confounded) expect(v.closeHow).not.toMatch(/likely better|较可能更好/);
        expect(v.action).toBe("close");
      });
  });

  it("lists every session not counted, when it was played and why", () => {
    const reasons = ["too-short", "behind", "before-change", "conditions-changed", "change-not-on", "other-compy-change", "gaming-mode-differs", "after-window", "no-reading", "other", "a-newer-reason"];
    const at = "2026-10-21T20:15:00+00:00";
    const v = realPlayView(RUNNING, progress({ not_counted: reasons.map((reason) => ({ session_id: at, reason })) }), t, "en");
    const when = whenText(at, "en");
    expect(v.notCounted).toEqual([
      `${when}: too short to count (about 10 minutes of play needed)`,
      `${when}: another window was in front the whole time`,
      `${when}: played before the change went on`,
      `${when}: its conditions differed from the sessions before the change (display, graphics, driver, Windows or game version), or couldn't be confirmed the same`,
      `${when}: the change didn't read as on during it`,
      `${when}: another Compy change was on or moved`,
      `${when}: Gaming Mode wasn't the same as in the sessions before the change`,
      `${when}: played after the test's time ran out`,
      `${when}: no frame-rate reading`,
      `${when}: a reason this version of Compy doesn't know`,
      `${when}: a reason this version of Compy doesn't know`,
    ]);
    expect(notCountedWhy("too-short", 1200, t)).toBe("too short to count (about 20 minutes of play needed)");
  });

  it("a read that failed says the count can't be read and offers nothing but putting it back; no answer yet says nothing", () => {
    const failed = realPlayView(RUNNING, null, t, "en", "Compy can't read its change history");
    expect(failed).toMatchObject({
      changeOn: `HAGS is on (since ${whenText(APPLIED, "en")}).`,
      status: "Compy can't count this test's sessions right now. HAGS stays on until you put it back.",
      action: null,
      notCounted: [],
    });
    expect(failed.putBackHow).toMatch(/^To put it back, tap Restore now/);
    expect(realPlayView(RUNNING, null, t, "en")).toMatchObject({ status: null, action: null });
    // A read of the game before a start, or of another Trial, is no progress of this one.
    expect(realPlayView(RUNNING, progress({ phase: "ready-to-start", experiment_id: null }), t, "en").action).toBeNull();
    expect(realPlayView(RUNNING, progress({ experiment_id: "exp:4-0" }), t, "en").action).toBeNull();
  });
});

describe("P5-realplay: what a concluded real-play Trial says", () => {
  it("Likely better: kept, on the metric its outcome is judged on, with both counts and the band", () => {
    const won = { status: "kept", verdict: "improved", kept: true };
    expect(realPlayResult(concluded(won, { band_pct: 3, delta_low1_pct: 12.1, delta_avg_pct: 0.4 }), "WardogsClient", t)).toBe(
      "Likely better: Compy kept HAGS. With it on, your 1% low (the worst moments) was 12.1% higher across 3 sessions than across 3 without it, more than the ±3% allowance for normal swings between sessions.",
    );
    // Maximum FPS is judged on the average.
    expect(realPlayResult(concluded({ ...won, outcome: "max-fps" }, { band_pct: 4.2, delta_low1_pct: 1, delta_avg_pct: 8.24 }, 5, 4), "W", t)).toBe(
      "Likely better: Compy kept HAGS. With it on, your average frame rate was 8.2% higher across 4 sessions than across 5 without it, more than the ±4.2% allowance for normal swings between sessions.",
    );
  });

  it("Likely worse: put back, naming the metric that fell", () => {
    const worse = { verdict: "regressed" };
    expect(realPlayResult(concluded(worse, { band_pct: 4.1, delta_low1_pct: -9.4, delta_avg_pct: -2 }, 4, 5), "W", t)).toBe(
      "Likely worse: Compy put HAGS back. With it on, your 1% low (the worst moments) was 9.4% lower across 5 sessions than across 4 without it, more than the ±4.1% allowance for normal swings between sessions.",
    );
    // Maximum FPS puts it back when the average OR the 1% low fell beyond the band: the one that did.
    expect(realPlayResult(concluded({ ...worse, outcome: "max-fps" }, { band_pct: 3, delta_low1_pct: -1, delta_avg_pct: -6 }), "W", t)).toMatch(
      /your average frame rate was 6% lower/,
    );
    expect(realPlayResult(concluded({ ...worse, outcome: "max-fps" }, { band_pct: 3, delta_low1_pct: -7, delta_avg_pct: -1 }), "W", t)).toMatch(
      /your 1% low \(the worst moments\) was 7% lower/,
    );
  });

  it("No clear difference: put back; a 1% low gain beside an average that fell is not called a win", () => {
    expect(realPlayResult(concluded({}, { band_pct: 4, delta_low1_pct: 1.2, delta_avg_pct: -0.5 }), "W", t)).toBe(
      "No clear difference: Compy put HAGS back. Across 3 sessions with it on and 3 without, your 1% low (the worst moments) stayed within the ±4% allowance for normal swings between sessions.",
    );
    expect(realPlayResult(concluded({ outcome: "max-fps" }, { band_pct: 4, delta_low1_pct: 9, delta_avg_pct: 2 }), "W", t)).toBe(
      "No clear difference: Compy put HAGS back. Across 3 sessions with it on and 3 without, your average frame rate stayed within the ±4% allowance for normal swings between sessions.",
    );
    expect(realPlayResult(concluded({}, { band_pct: 3, delta_low1_pct: 6, delta_avg_pct: -5 }), "W", t)).toBe(
      "No clear difference: Compy put HAGS back. With it on, your 1% low (the worst moments) was 6% higher but your average frame rate was 5% lower, so it isn't clearly better.",
    );
  });

  // CR-lesson-fall-band (s37 sonnet SHOULD-FIX): a real-play average is judged at the matching fall
  // of its look's band (10% <-> -9.0%) on a build that proves it (model-3 noise); otherwise a fall
  // between the two can't be called from the numbers, and the stored verdict settles it.
  it("names a fall at the fall the record was judged at; the verdict settles one the numbers can't", () => {
    const worse = { verdict: "regressed", outcome: "max-fps", game_noise: { model: 3 } };
    expect(realPlayResult(concluded(worse, { band_pct: 10, delta_low1_pct: -2, delta_avg_pct: -9.5 }), "W", t)).toMatch(
      /your average frame rate was 9\.5% lower/,
    );
    const won = { game_noise: { model: 3 } };
    expect(realPlayResult(concluded(won, { band_pct: 10, delta_low1_pct: 12, delta_avg_pct: -9.5 }), "W", t)).toMatch(
      /was 12% higher but your average frame rate was 9\.5% lower/,
    );
    // s37 opus r2 MUST-FIX: a record that doesn't prove its build can't call -9.5% from the numbers,
    // but a No change with the 1% low past the band was the average's veto: it fell.
    expect(realPlayResult(concluded({}, { band_pct: 10, delta_low1_pct: 12, delta_avg_pct: -9.5 }), "W", t)).toMatch(
      /was 12% higher but your average frame rate was 9\.5% lower/,
    );
    // Read the band both ways neither number fell, so only the matching fall judged this Worse: the
    // average fell there (the engine checks it first).
    expect(realPlayResult(concluded({ verdict: "regressed", outcome: "max-fps" }, { band_pct: 10, delta_low1_pct: -9.4, delta_avg_pct: -9.6 }), "W", t)).toMatch(
      /your average frame rate was 9\.6% lower/,
    );
    // A 1% low past the band fell either way: it is named.
    expect(realPlayResult(concluded({ verdict: "regressed", outcome: "max-fps" }, { band_pct: 10, delta_low1_pct: -12, delta_avg_pct: -9.6 }), "W", t)).toMatch(
      /your 1% low \(the worst moments\) was 12% lower/,
    );
  });

  // CR-fall-words-band (s37 opus r2 SHOULD-FIX): a fall judged at the matching fall (model-3 noise,
  // 10% <-> -9.0%) is named at that fall, never "more than the ±10% allowance".
  it("Likely worse names the fall it was judged at, not the band", () => {
    const worse = { verdict: "regressed", outcome: "max-fps", game_noise: { model: 3 } };
    expect(realPlayResult(concluded(worse, { band_pct: 10, delta_low1_pct: -2, delta_avg_pct: -9.5 }, 4, 5), "W", t)).toBe(
      "Likely worse: Compy put HAGS back. With it on, your average frame rate was 9.5% lower across 5 sessions than across 4 without it, past −9%, the fall that matches the +10% allowance for normal swings between sessions.",
    );
    // Recommended's 1% low in real play is read on the band both ways: the band words stand.
    expect(realPlayResult(concluded({ verdict: "regressed", game_noise: { model: 3 } }, { band_pct: 10, delta_low1_pct: -12, delta_avg_pct: 0 }), "W", t)).toMatch(
      /more than the ±10% allowance/,
    );
    // A record that doesn't prove its build ("unknown"): a fall past the band keeps the band words
    // (true either way); one that didn't pass the band can only have been called at the matching
    // fall, so it names that fall (review r1, sonnet SHOULD-FIX).
    expect(realPlayResult(concluded({ verdict: "regressed", outcome: "max-fps" }, { band_pct: 10, delta_low1_pct: -2, delta_avg_pct: -12 }), "W", t)).toMatch(
      /more than the ±10% allowance/,
    );
    expect(realPlayResult(concluded({ verdict: "regressed", outcome: "max-fps" }, { band_pct: 10, delta_low1_pct: -2, delta_avg_pct: -9.5 }), "W", t)).toMatch(
      /was 9\.5% lower .* past −9%, the fall that matches the \+10% allowance/,
    );
  });

  it("Likely worse at the matching fall, in zh-CN", async () => {
    await i18n.changeLanguage("zh-CN");
    const worse = { verdict: "regressed", outcome: "max-fps", game_noise: { model: 3 } };
    const line = clean(realPlayResult(concluded(worse, { band_pct: 10, delta_low1_pct: -2, delta_avg_pct: -9.5 }), "W", t));
    expect(line).toContain("超过了 −9%，即与各局之间正常波动的 +10% 余量相对应的降幅");
  });

  it("Unknown: sessions too varied (PBZ-style swings), or too few counted before the test stopped, with why", () => {
    expect(
      realPlayResult(concluded({ verdict: "too-noisy", stop_reason: "sessions-too-varied" }, { band_pct: 23.44, delta_low1_pct: 2, delta_avg_pct: 1, look: 3 }, 3, 8), "Phantom Blade Zero", t),
    ).toBe(
      "Unknown: Compy put HAGS back. Your Phantom Blade Zero sessions swung so much that the allowance for normal swings came to ±23.4%, too wide to tell after 8 sessions with it on. Playing the same area each time can give a clearer answer.",
    );
    const because: Record<string, string> = {
      "change-off": "it no longer read as on",
      // put-back-in-history has its own line (below): it says who put the change back.
      unreadable: "Compy couldn't read the setting to confirm it stayed on",
      "other-change": "another Compy change was applied or undone during the test",
      conditions: "your hardware, graphics driver, Windows build, game build or capture method changed",
      "window-over": "the test's time ran out",
      "before-missing": "the sessions from before the change are no longer in Compy's session history",
    };
    for (const [stop, why] of Object.entries(because))
      expect(realPlayResult(concluded({ verdict: "insufficient-evidence" }, { stop }, 3, 2), "W", t), stop).toBe(
        `Unknown: Compy put HAGS back. Only 2 sessions with it on were counted before the test stopped (${why}), too few to judge.`,
      );
    expect(realPlayResult(concluded({ verdict: "confounded" }, { stop: "other-change" }, 3, 1), "W", t)).toBe(
      "Unknown: Compy put HAGS back. Only 1 session with it on was counted before the test stopped (another Compy change was applied or undone during the test), too few to judge.",
    );
  });

  it("Unknown after a look decided but a conclude check overruled it, and the pair's words for anything else", () => {
    expect(
      realPlayResult(
        concluded({ verdict: "insufficient-evidence", stop_reason: "other-change-unverified-at-conclude" }, { band_pct: 3, delta_low1_pct: 12, delta_avg_pct: 1, look: 1 }),
        "W",
        t,
      ),
    ).toBe("Unknown: Compy put HAGS back. Nothing was judged: another setting Compy changed earlier can't be confirmed as still in place.");
    expect(realPlayResult(concluded({ verdict: "confounded", stop_reason: "target-reverted-during-treatment" }, { look: 1 }), "W", t)).toBe(
      "Unknown: Compy put HAGS back. Nothing was judged: it no longer read as on when the test ended.",
    );
    expect(realPlayResult(concluded({ verdict: "expired" }, { look: 1 }), "W", t)).toBe(
      "Unknown: Compy put HAGS back. Nothing was judged: the before-session was too old to compare against.",
    );
    // A measured verdict whose numbers the record doesn't hold is never filled in, nor called unjudged.
    expect(realPlayResult(concluded({ verdict: "no-change" }, { look: 1 }), "W", t)).toBe(
      "Unknown: Compy put HAGS back. This record doesn't hold the numbers its verdict was judged on.",
    );
  });

  // Review 2026-11-02 (fix 8): such a record (a crash one too) printed "Verdict regressed" and
  // "Confidence medium" in its receipt under that Unknown headline. Its receipt reads the same rule.
  it("knows a measured verdict whose numbers the record doesn't hold, the one its headline calls Unknown", () => {
    const numbers = { band_pct: 3, delta_low1_pct: 12.1, delta_avg_pct: 0.4 };
    for (const verdict of ["improved", "no-change", "regressed"]) {
      expect(realPlayNumbersMissing(concluded({ verdict }, { look: 1 })), verdict).toBe(true);
      expect(realPlayNumbersMissing(concluded({ verdict }, { ...numbers, delta_avg_pct: null })), verdict).toBe(true);
      expect(realPlayNumbersMissing(concluded({ verdict }, numbers)), verdict).toBe(false);
    }
    // A crash record: a measured verdict, and no numbers at all.
    expect(realPlayNumbersMissing({ ...concluded({ verdict: "regressed", stop_reason: "crash-during-treatment" }), real_play: null })).toBe(true);
    // A verdict that judged nothing is not "missing" numbers: it never had any to hold.
    for (const verdict of ["too-noisy", "insufficient-evidence", "confounded"]) expect(realPlayNumbersMissing(concluded({ verdict })), verdict).toBe(false);
  });

  // Rust review fix (claude/train-p5-rust-fixes): a change put back in Test → Applied & history keeps
  // its measured verdict with kept=false. Its line says who put it back and never that it was kept.
  it("put back in Applied & history: the measured verdict stands, and it is never called kept", () => {
    const history = { status: "restored", kept: false, stop_reason: "real-play-put-back-in-history" };
    const numbers = { band_pct: 3, delta_low1_pct: 12.1, delta_avg_pct: 0.4, look: 1, stop: "put-back-in-history" };
    const better = realPlayResult(concluded({ ...history, verdict: "improved" }, numbers), "W", t);
    expect(better).toBe(
      "Likely better: HAGS was put back in Test → Applied & history. With it on, your 1% low (the worst moments) was 12.1% higher across 3 sessions than across 3 without it, more than the ±3% allowance for normal swings between sessions.",
    );
    // Even a record that says "kept" beside that stop reason never reads as kept.
    expect(realPlayResult(concluded({ ...history, status: "kept", kept: true, verdict: "improved" }, numbers), "W", t)).not.toMatch(/kept/i);
    expect(realPlayFace({ ...history, status: "kept", verdict: "improved" }, t)).toBe("Likely better — restored");
    expect(realPlayResult(concluded({ ...history, verdict: "regressed" }, { ...numbers, delta_low1_pct: -9 }), "W", t)).toMatch(
      /^Likely worse: HAGS was put back in Test → Applied & history\. With it on, your 1% low/,
    );
    expect(realPlayResult(concluded({ ...history, verdict: "insufficient-evidence" }, { stop: "put-back-in-history" }, 3, 2), "W", t)).toBe(
      "Unknown: HAGS was put back in Test → Applied & history after only 2 sessions with it on were counted, too few to judge.",
    );
  });

  it("explains the rule it was judged by, and that nothing was judged when nothing was", () => {
    expect(realPlayWhy(concluded({ verdict: "improved" }), t)).toMatch(/^Real play compares your sessions .* Recommended keeps a change only when it is likely better/);
    expect(realPlayWhy(concluded({ verdict: "regressed", outcome: "max-fps" }), t)).toMatch(/Maximum FPS keeps a change only when it is likely better: the average higher/);
    expect(realPlayWhy(concluded({ verdict: "too-noisy" }), t)).toBe(
      "Real play needs enough sessions on each side that can be compared fairly, so nothing was judged. The line above says what got in the way, and what happened to the change.",
    );
  });

  it("history faces: Likely better / Likely worse / No clear difference / Unknown, never a measured-faster face", () => {
    expect(realPlayFace({ verdict: "improved", status: "kept" }, t)).toBe("Likely better — kept");
    expect(realPlayFace({ verdict: "improved", kept: true }, t)).toBe("Likely better — kept");
    expect(realPlayFace({ verdict: "improved", status: "restored" }, t)).toBe("Likely better — restored");
    expect(realPlayFace({ verdict: "regressed" }, t)).toBe("Likely worse — restored");
    expect(realPlayFace({ verdict: "no-change" }, t)).toBe("No clear difference — restored");
    for (const v of ["too-noisy", "insufficient-evidence", "confounded", "not-comparable"]) expect(realPlayFace({ verdict: v }, t), v).toBe("Unknown — restored");
    expect(realPlayFace({ verdict: null }, t)).toBeNull();
  });

  it("its band line names this test's own sessions, never older history", () => {
    expect(realPlayNoiseLine(3, realPlayCounts(concluded({})), "WardogsClient", t)).toBe(
      "Judged against a ±3% band from this test's own sessions: an allowance for normal swings between your WardogsClient sessions (3 without the change, 3 with it).",
    );
    expect(realPlayNoiseLine(null, { before: 3, with: 3 }, "W", t)).toBeNull();
  });

  // Review 2026-11-02 (fix 5): the band was called "how much your sessions vary on their own" while the
  // receipt beside it lists a different number as "Spread between sessions". The band is the
  // allowance for normal swings between sessions (realplay.rs `measure`: max(t·SE, 3%)), not the spread.
  it("calls the band an allowance for normal swings, never how much the sessions vary", () => {
    const band = { band_pct: 4, delta_low1_pct: 12, delta_avg_pct: 1 };
    const lines = [
      realPlayView(RUNNING, progress({ with: 3, need: 5, band_pct: 21.7 }), t, "en").notYet,
      realPlayResult(concluded({ status: "kept", kept: true, verdict: "improved" }, band), "W", t),
      realPlayResult(concluded({ verdict: "regressed" }, { ...band, delta_low1_pct: -12 }), "W", t),
      realPlayResult(concluded({ verdict: "no-change" }, { ...band, delta_low1_pct: 1 }), "W", t),
      realPlayResult(concluded({ verdict: "too-noisy" }, { ...band, band_pct: 23, look: 3 }), "W", t),
      realPlayWhy(concluded({ verdict: "improved" }), t),
      realPlayWhy(concluded({ verdict: "improved", outcome: "max-fps" }), t),
      realPlayNoiseLine(4, { before: 3, with: 3 }, "W", t),
    ];
    for (const line of lines) {
      expect(line).toMatch(/allowance for normal swings/);
      expect(line).not.toMatch(/vary on their own|varied on their own|vary by about|varied by about/);
    }
  });

  it("never shows High confidence", () => {
    expect(["high", "medium", "low", "unknown", null].map(realPlayConfidence)).toEqual(["medium", "medium", "low", "unknown", null]);
  });
});

describe("P5-realplay: reading the backend's answer", () => {
  it("reads a progress answer, and refuses one it can't read rather than guess a phase", () => {
    const raw = { ...progress(), stop: "a-newer-stop", not_counted: [{ session_id: "s", reason: "too-short" }, { nope: 1 }] };
    expect(asRealPlayProgress(raw)).toMatchObject({ phase: "collecting", stop: "a-newer-stop", not_counted: [{ session_id: "s", reason: "too-short" }] });
    expect(asRealPlayProgress({ ...raw, phase: "a-newer-phase" })).toBeNull();
    expect(asRealPlayProgress({ ...raw, need: undefined })).toBeNull();
    expect(asRealPlayProgress(null)).toBeNull();
    expect(asRealPlayProgress("collecting")).toBeNull();
  });

  it("knows a real-play record by its mode", () => {
    expect(isRealPlay({ mode: "real-play" })).toBe(true);
    expect([isRealPlay({}), isRealPlay({ mode: null }), isRealPlay(null)]).toEqual([false, false, false]);
  });

  it("names a moment in the reader's language, and nothing for a time it can't read", () => {
    expect(whenText(APPLIED, "en")).toMatch(/Oct/);
    expect(whenText(APPLIED, "zh-CN")).toMatch(/10月/);
    expect([whenText(null, "en"), whenText("not a time", "en")]).toEqual(["", ""]);
  });
});

describe("P5-realplay: every line in zh-CN too", () => {
  it("each phase and verdict line reads in Chinese, with no raw key and no English sentence", async () => {
    await i18n.changeLanguage("zh-CN");
    const zh = (line: string | null) => {
      const s = clean(line);
      expect(s).toMatch(/[一-鿿]/);
      expect(s).not.toMatch(/\b(Compy put|Keep playing|is on|Likely|Unknown|sessions)\b/);
      return s;
    };
    const lines = [
      realPlayOffer(progress({ phase: "ready-to-start", experiment_id: null }), "HAGS", "WardogsClient", t),
      realPlayOffer(progress({ phase: "collecting-before", experiment_id: null, before: 1 }), "HAGS", "WardogsClient", t),
      collectingBeforeLine(progress({ phase: "collecting-before", before: 1 }), "WardogsClient", t),
    ];
    for (const phase of ["collecting", "ready", "stopped"] as const) {
      const v = realPlayView(RUNNING, progress({ phase, band_pct: 8, stop: phase === "stopped" ? "window-over" : null, not_counted: [{ session_id: APPLIED, reason: "behind" }] }), t, "zh-CN");
      lines.push(v.changeOn, v.status, v.putBackHow, ...v.notCounted);
      if (v.notYet) lines.push(v.notYet);
      if (v.closeHow) lines.push(v.closeHow);
      if (v.seeHow) lines.push(v.seeHow);
    }
    lines.push(realPlayView(RUNNING, null, t, "zh-CN", "x").status);
    const verdicts: [Partial<RealPlayRecord>, Record<string, unknown>][] = [
      [{ status: "kept", verdict: "improved" }, { band_pct: 3, delta_low1_pct: 12.1, delta_avg_pct: 0.4 }],
      [{ verdict: "regressed" }, { band_pct: 3, delta_low1_pct: -9, delta_avg_pct: 0 }],
      [{ verdict: "no-change" }, { band_pct: 4, delta_low1_pct: 1, delta_avg_pct: 0 }],
      [{ verdict: "no-change" }, { band_pct: 3, delta_low1_pct: 6, delta_avg_pct: -5 }],
      [{ verdict: "too-noisy" }, { band_pct: 23, delta_low1_pct: 1, delta_avg_pct: 1, look: 3 }],
      [{ verdict: "insufficient-evidence" }, { stop: "window-over" }],
      [{ verdict: "insufficient-evidence", stop_reason: "other-change-unverified-at-conclude" }, { look: 1 }],
      [{ verdict: "insufficient-evidence", stop_reason: "real-play-put-back-in-history" }, { stop: "put-back-in-history" }],
      [{ verdict: "no-change" }, { look: 1 }],
    ];
    for (const [over, rp] of verdicts) {
      lines.push(realPlayResult(concluded(over, rp), "WardogsClient", t), realPlayWhy(concluded(over, rp), t), realPlayFace(concluded(over, rp), t));
    }
    lines.push(realPlayNoiseLine(3, { before: 3, with: 3 }, "WardogsClient", t));
    for (const line of lines) zh(line);
    // The lines the owner reads most, pinned.
    expect(realPlayView(RUNNING, progress(), t, "zh-CN").status).toBe("继续玩吧，Compy 仍在收集数据（1/3 局）。");
    expect(realPlayView(RUNNING, progress({ with: 3, need: 5, band_pct: 21.7 }), t, "zh-CN").notYet).toBe(
      "暂时还看不出来：目前为各局之间正常波动留出的余量是 ±21.7%，所以 Compy 还需要几局。",
    );
    expect(realPlayView(RUNNING, progress(), t, "zh-CN").changeOn).toBe(
      `HAGS已开启（自 ${whenText(APPLIED, "zh-CN")} 起）。在 Compy 得出结果之前它会一直保持开启：最多 8 局，最晚到 ${whenText(UNTIL, "zh-CN")}。`,
    );
    expect(realPlayResult(concluded({ status: "kept", verdict: "improved" }, { band_pct: 3, delta_low1_pct: 12.1, delta_avg_pct: 0.4 }), "W", t)).toBe(
      "较可能更好：已保留HAGS。开启后的 3 局与未开启的 3 局相比，1% 最低帧（最卡的时刻）高了 12.1%，超出了为各局之间正常波动留出的 ±3% 余量。",
    );
    expect(realPlayFace({ verdict: "improved", status: "kept" }, t)).toBe("较可能更好——已保留");
    expect(realPlayOffer(progress({ phase: "collecting-before", experiment_id: null, before: 0 }), "HAGS", "WardogsClient", t)).toBe(
      "也可以边正常玩边测试：Compy 会先测量 3 局保持现状的WardogsClient（目前已测 0 局），然后开启HAGS，并在你随意玩的期间一直保持开启。",
    );
    expect(
      realPlayResult(concluded({ status: "restored", kept: false, verdict: "improved", stop_reason: "real-play-put-back-in-history" }, { band_pct: 3, delta_low1_pct: 12.1, delta_avg_pct: 0.4, look: 1 }), "W", t),
    ).toBe("较可能更好：HAGS已在“测试 → 已应用与历史”中被撤销。开启后的 3 局与未开启的 3 局相比，1% 最低帧（最卡的时刻）高了 12.1%，超出了为各局之间正常波动留出的 ±3% 余量。");
    expect(notCountedWhy("no-reading", 600, t)).toBe("没有帧率读数");
    expect(realPlayResult(concluded({ verdict: "insufficient-evidence" }, { stop: "window-over" }, 3, 1), "W", t)).toBe(
      "未知：已把HAGS恢复原样。测试停止前，开启后只统计到 1 局（测试时间已经结束），太少，无法判断。",
    );
  });

  it("every English line is clean too", () => {
    const v = realPlayView(RUNNING, progress({ phase: "stopped", stop: "conditions", not_counted: [{ session_id: APPLIED, reason: "too-short" }] }), t, "en");
    for (const line of [v.changeOn, v.status, v.putBackHow, v.closeHow, ...v.notCounted]) clean(line);
  });
});
