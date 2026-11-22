import { describe, it, expect } from "vitest";
import { postureLine as postureLineRaw, liveStrip as liveStripRaw } from "./command-center-data";
import type { GameReadiness, Priorities, ReadinessCheck, SessionSummary } from "../types";
import type { InEffectCounts } from "../data/machine-model";
import type { RoughRead } from "./home-facts";
// i18n update (2026-07-23): postureLine/liveStrip's strings now come from t(...) (Simplified
// Chinese translation pass) instead of literal English, so both take a TFunction as their last
// param. These test-local wrappers resolve them through the real i18next instance (English is the
// default language, matching what every assertion below already expects) so every call site below
// stays exactly as written — same text, just sourced from locale JSON instead of a .ts literal.
import i18n from "../i18n";

// A bare number here means the model READ the ledger and counted it (#452).
const counted = (activeNow: number, unknown = 0): InEffectCounts => ({
  kind: "counted",
  activeNow,
  unknown,
  totalRecorded: activeNow + unknown,
});
const postureLine = (
  readiness: GameReadiness | null,
  priorities: Priorities | null,
  inEffect: number | InEffectCounts,
  rough?: RoughRead,
) =>
  postureLineRaw(
    readiness,
    priorities,
    typeof inEffect === "number" ? counted(inEffect) : inEffect,
    i18n.t,
    rough,
  );
// B1 Home truth: the sessions were read, one game was compared with its usual range, and none ran rough.
const noRough: RoughRead = { kind: "read", games: [], judged: 1 };
const liveStrip = (sessions: SessionSummary[]) => liveStripRaw(sessions, i18n.t);

const check = (status: ReadinessCheck["status"], label: string): ReadinessCheck =>
  ({ id: label, label, status, detail: "", value: null });

const readiness = (checks: ReadinessCheck[], dismissed: string[] = []): GameReadiness => {
  const d = new Set(dismissed);
  return {
    checks,
    ready_count: checks.filter((c) => c.status === "ready").length,
    attention_count: checks.filter((c) => c.status === "attention" && !d.has(c.id)).length,
    unknown_count: checks.filter((c) => c.status === "unknown").length,
    advisory_count: checks.filter((c) => c.status === "advisory").length,
    advisory: "",
    dismissed_ids: dismissed,
    drifts: [],
  };
};

const priorities = (limiters: number): Priorities => ({
  limiters: Array.from({ length: limiters }, (_, i) => ({
    id: `l${i}`,
    title: `Limiter ${i}`,
    reason: "",
    linked: null,
    confidence: "medium",
    status: "attention",
  })),
  already_fine: [],
  not_worth_touching: [],
  session_hint: null,
  upgrade_path: null,
});

describe("postureLine (real headline + priorities-driven sentence)", () => {
  it("ready with limiters → says what is listed below as worth a look, never 'worth fixing' (view-1121b B3)", () => {
    const p = postureLine(readiness([check("ready", "SSD")]), priorities(3), 1);
    expect(p.tone).toBe("ready");
    expect(p.sentence).toBe(
      "Every check Compy could read came back right. 3 things are listed below as worth a look.",
    );
    expect(postureLine(readiness([check("ready", "SSD")]), priorities(1), 0).sentence).toBe(
      "Every check Compy could read came back right. 1 thing is listed below as worth a look.",
    );
    expect(p.sentence).not.toMatch(/fix/i);
    expect(p.reassurance).toMatch(/1 change active/);
  });

  // review r1 B1: dialed-in also holds unread, advisory and dismissed checks, so the dek may never
  // say "pass" for them.
  it("an unread check: the dek never says 'pass', and says how many couldn't be read", () => {
    const r = readiness([check("ready", "SSD"), check("unknown", "GPU driver")]);
    const p = postureLine(r, priorities(1), 0);
    expect(p.tone).toBe("ready");
    expect(p.sentence).toBe(
      "Every check Compy could read came back right. 1 thing is listed below as worth a look. 1 check couldn't be read.",
    );
    expect(p.sentence).not.toMatch(/pass/i);
    // Zero limiters + unread: not "measured clean" either.
    const z = postureLine(readiness([check("unknown", "A"), check("unknown", "B")]), priorities(0), 0);
    expect(z.sentence).toBe("Every check Compy could read came back right. 2 checks couldn't be read.");
    expect(z.sentence).not.toMatch(/measured clean/i);
  });

  it("an advisory check (not graded): the dek never says 'pass'", () => {
    const p = postureLine(readiness([check("ready", "SSD"), check("advisory", "BIOS")]), priorities(2), 0);
    expect(p.sentence).toBe(
      "Every check Compy could read came back right. 2 things are listed below as worth a look.",
    );
    expect(p.sentence).not.toMatch(/pass/i);
  });

  it("a dismissed attention check: never 'came back right', and it is named as not counted", () => {
    const r = readiness([check("ready", "SSD"), check("attention", "Refresh")], ["Refresh"]);
    const p = postureLine(r, priorities(1), 0);
    expect(p.tone).toBe("ready");
    expect(p.sentence).toBe(
      "1 thing is listed below as worth a look. 1 check you set aside isn't counted.",
    );
    expect(p.sentence).not.toMatch(/pass|came back right/i);
    expect(postureLine(r, priorities(0), 0).sentence).toBe("1 check you set aside isn't counted.");
  });

  it("ready with zero limiters and the sessions read with no rough game → the measured-clean win sentence", () => {
    const p = postureLine(readiness([check("ready", "SSD")]), priorities(0), 0, noRough);
    expect(p.sentence).toBe("Ready to play — this rig measured clean today.");
    // B1: before the sessions are read, "measured clean" would speak for them: it says only what the checks said.
    expect(postureLine(readiness([check("ready", "SSD")]), priorities(0), 0).sentence).toBe(
      "Every check Compy could read came back right.",
    );
  });

  // CODEX FINDING 4 (2026-08-23, HIGH) — this test used to assert p.tone alone. A tone is a
  // colour; it is not the law. The owner's 2026-07-17 name-it-and-fix-it-inline ruling is that the
  // attention verdict IS the flagged check, by name, and that the check's own detail travels with
  // it. deriveSystemPosture is guarded for that in system-posture.test.ts — but postureLine is
  // what Home actually renders, and NOTHING here proved it passed either one through. Replacing
  // both with a generic "One thing needs your attention" + a stock disclaimer kept this file, and
  // system-posture.test.ts, entirely green. So the passthrough is now the assertion.
  it("attention: the headline IS the flagged check by name, and its detail travels with it", () => {
    const flagged: ReadinessCheck = {
      id: "refresh",
      label: "Monitor below max refresh",
      status: "attention",
      detail: "Your monitor is running at 60Hz and supports 144Hz. Switch it in Test.",
      value: null,
    };
    const p = postureLine(readiness([check("ready", "SSD"), flagged]), priorities(0), 0);
    expect(p.tone).toBe("attention");
    // The name, not a count and not a category.
    expect(p.headline).toBe("Monitor below max refresh");
    expect(p.headline).not.toMatch(/\bthings?\b[^.]*\bneeds?\b[^.]*attention/i);
    // The fix travels WITH the name — a stock disclaimer here is the defect this pins.
    expect(p.sentence).toBe(flagged.detail);
    expect(p.reassurance).toMatch(/without your say-so|say-so/i);
  });

  // Owner ruling 2026-08-26 (#219): the headline no longer appends "· and N more". This is the
  // render-path half of the pin in system-posture.test.ts — that one proves the derivation, this
  // one proves Home gets what the derivation produced. Both are needed: the finding that created
  // the sibling test above was a passthrough silently substituting its own copy.
  it("attention with several flagged checks names the first and stops — no count tail", () => {
    const p = postureLine(
      readiness([check("attention", "Monitor below max refresh"), check("attention", "GPU driver age")]),
      priorities(0),
      0,
    );
    expect(p.tone).toBe("attention");
    expect(p.headline).toBe("Monitor below max refresh");
    expect(p.headline).not.toMatch(/more|·/);
  });

  // #452: the count comes from the Machine Model, and the model has three answers, not one number.
  describe("the change note reads the model's in-effect answer", () => {
    const ready = () => readiness([check("ready", "SSD")]);

    it("an unreadable record is a word, never a silence or a 0", () => {
      const p = postureLine(ready(), priorities(0), {
        kind: "unreadable",
        reason: "history.json is locked",
      });
      expect(p.reassurance).toMatch(/can't read its change record/i);
      expect(p.reassurance).not.toMatch(/\b0\b/);
      // The say-so promise is about the future and stays true either way.
      expect(p.reassurance).toMatch(/say-so/i);
    });

    it("a row whose live check failed is never counted as in effect", () => {
      const p = postureLine(ready(), priorities(0), counted(1, 2));
      expect(p.reassurance).toMatch(/^1 change active/);
      expect(p.reassurance).not.toMatch(/\b3\b/);
    });

    it("nothing in effect and nothing unknown prints no change note", () => {
      const p = postureLine(ready(), priorities(0), counted(0));
      expect(p.reassurance).toBe("Nothing changes without your say-so.");
    });

    it("an unread model (pending) prints no stand-in number", () => {
      const p = postureLine(ready(), priorities(0), { kind: "pending" });
      expect(p.reassurance).toBe("Nothing changes without your say-so.");
    });
  });
});

describe("liveStrip (real last session or honest empty)", () => {
  const session = (startedAt: string, avg: number): SessionSummary => ({
    started_at: startedAt,
    duration_secs: 600,
    process_name: "game.exe",
    samples: 600,
    avg_fps: avg,
    avg_frametime_ms: 1000 / avg,
    low1_fps_est: avg * 0.7,
    peak_gpu_temp_c: 71,
    peak_gpu_usage_pct: 98,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 0,
  });

  it("is empty when no sessions exist (no fake numbers)", () => {
    expect(liveStrip([]).kind).toBe("empty");
  });

  it("picks the most recent session by start time", () => {
    const s = liveStrip([
      session("2026-06-01T10:00:00Z", 120),
      session("2026-06-05T10:00:00Z", 90),
    ]);
    expect(s.kind).toBe("data");
    if (s.kind === "data") {
      expect(s.avgFps).toBe(90);
      expect(s.peakTempC).toBe(71);
    }
  });

  it("never quotes a GPU peak from a session behind another window the whole time (P4-show-f1)", () => {
    const behind = { ...session("2026-06-05T10:00:00Z", 1), samples: 0, avg_fps: 0, low1_fps_est: 0, background_secs_excluded: 900 };
    const s = liveStrip([session("2026-06-01T10:00:00Z", 120), behind]);
    expect(s.kind === "data" && [s.avgFps, s.low1Est, s.peakTempC]).toEqual([null, null, null]);
  });
});
// B1 Home truth (owner decision 2026-11-21): Home's headline, dek and count come from what is off-normal
// (a drifted setting, a game the Paramedic measured rougher than usual, a failed read), never from an optional
// tweak the owner has not applied (Constitution §38). Game titles here are invented.
describe("postureLine: B1 Home truth", () => {
  const tweakRow = {
    id: "pending-safe-recs",
    title: "1 tweak not applied",
    reason: "Compy has reversible tweaks you haven't applied: Trim Windows visual effects.",
    linked: null,
    confidence: "medium" as const,
    status: "attention" as const,
  };
  const withTweak = (n: number): Priorities => {
    const p = priorities(n);
    return { ...p, limiters: [...p.limiters, tweakRow] };
  };
  // Noon UTC, so the date reads Nov 20 in every time zone the tests run in.
  const skyline = (n: number) => ({
    game: "skylinedrift.exe",
    game_name: "Skyline Drift",
    rough_sessions: n,
    newest_rough_at: "2026-11-20T12:00:00Z",
  });
  const rough = (...games: ReturnType<typeof skyline>[]): RoughRead => ({ kind: "read", games, judged: games.length + 1 });
  const drift: ReadinessCheck = {
    id: "applied-changes",
    label: "Compy changes were turned back off",
    status: "attention",
    detail: "Trim Windows visual effects, a setting Compy applied, is no longer on.",
    value: null,
  };

  it("an unapplied optional tweak alone is never 'worth a look' and does not block 'measured clean'", () => {
    const p = postureLine(readiness([check("ready", "SSD")]), withTweak(0), 0, noRough);
    expect(p.sentence).toBe("Ready to play — this rig measured clean today.");
    expect(p.sentence).not.toMatch(/worth a look|tweak/i);
    // With one real limiter beside it, only the real one is counted.
    expect(postureLine(readiness([check("ready", "SSD")]), withTweak(1), 0, noRough).sentence).toBe(
      "Every check Compy could read came back right. 1 thing is listed below as worth a look.",
    );
  });

  it("nothing measured (no game compared with a usual range) is never 'measured clean' and says nothing about games", () => {
    const p = postureLine(readiness([check("ready", "SSD")]), withTweak(0), 0, { kind: "read", games: [], judged: 0 });
    expect(p.sentence).toBe("Every check Compy could read came back right.");
  });

  it("the owner's PC today: the drift owns the headline and the rough game is a separate note, never glued to it", () => {
    const p = postureLine(readiness([check("ready", "SSD"), drift]), withTweak(0), 0, rough(skyline(2)));
    expect(p.tone).toBe("attention");
    expect(p.fromCheck).toBe(true);
    expect(p.headline).toBe("Compy changes were turned back off");
    // The check's own detail alone: the rough line never joins it into one sentence.
    expect(p.sentence).toBe("Trim Windows visual effects, a setting Compy applied, is no longer on.");
    expect(p.note).toBe(
      "Separately: Skyline Drift's last 2 measured sessions in a row, up to Nov 20, ran rougher than its usual range.",
    );
    expect(`${p.headline} ${p.sentence} ${p.note}`).not.toMatch(/measured clean|ready to play|tweak/i);
  });

  it("a rough game alone takes the headline, dated, not from a check: never 'You're ready to play' over it", () => {
    const p = postureLine(readiness([check("ready", "SSD")]), withTweak(0), 0, rough(skyline(1)));
    expect(p.tone).toBe("attention");
    expect(p.fromCheck).toBe(false);
    expect(p.note).toBe("");
    expect(p.headline).toBe("Skyline Drift ran rougher than usual last time");
    expect(p.sentence).toBe(
      "Skyline Drift's last measured session, on Nov 20, ran rougher than its usual range. Every check Compy could read came back right.",
    );
    expect(p.sentence).not.toMatch(/measured clean|has been/i);
  });

  it("every rough game Home counts is named", () => {
    const other = { ...skyline(3), game: "harbornine.exe", game_name: "Harbor Nine" };
    const p = postureLine(readiness([check("ready", "SSD")]), null, 0, rough(skyline(2), other));
    expect(p.sentence).toMatch(
      /^Skyline Drift's last 2 measured sessions in a row, up to Nov 20, ran rougher than its usual range\. Also rougher than usual last time: Harbor Nine\./,
    );
  });

  it("a failed session read is said, and is never 'measured clean'", () => {
    const p = postureLine(readiness([check("ready", "SSD")]), priorities(0), 0, { kind: "unreadable" });
    expect(p.tone).toBe("ready");
    expect(p.sentence).toBe("Every check Compy could read came back right. Compy couldn't read how your games ran.");
  });

  it("unread and dismissed checks keep their own words beside the rough game", () => {
    const r = readiness([check("ready", "SSD"), check("unknown", "GPU driver"), check("attention", "Refresh")], ["Refresh"]);
    const p = postureLine(r, withTweak(0), 0, rough(skyline(2)));
    expect(p.sentence).toBe(
      "Skyline Drift's last 2 measured sessions in a row, up to Nov 20, ran rougher than its usual range. 1 check couldn't be read. 1 check you set aside isn't counted.",
    );
  });

  it("zh-CN: the same facts, in Chinese", () => {
    const zh = i18n.getFixedT("zh-CN");
    const p = postureLineRaw(readiness([check("ready", "SSD")]), null, counted(0), zh, rough(skyline(2)), "zh-CN");
    expect(p.headline).toBe("Skyline Drift 上次运行比平时更不流畅");
    expect(p.sentence).toBe("Skyline Drift 截至 11月20日 连续 2 次测得的会话比它平时的范围更不流畅。 Compy 能读取的检查全部正常。");
    const one = postureLineRaw(readiness([check("ready", "SSD"), drift]), null, counted(0), zh, rough(skyline(1)), "zh-CN");
    expect(one.note).toBe("另外:Skyline Drift 在 11月20日 测得的上一次会话比它平时的范围更不流畅。");
  });
});
