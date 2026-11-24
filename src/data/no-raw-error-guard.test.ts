// B11: the owner's "no String(e) in the face" law (App.tsx `fail`): the backend's raw text is console detail only.
// ExperimentBench, Benchmark and TrustMoment used to put it on screen. This pins their sources so it can't come back,
// pins the benchmark's apply-failed prefixes to the Rust that writes them, and pins the three same-setting refusals
// (now fixed, title-free sentences) in both languages.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import en from "../i18n/locales/en/app.json";
import zh from "../i18n/locales/zh-CN/app.json";
import { BACKEND_SENTENCES, backendMessages, backendSentenceKey } from "./backend-error";
import { STACK_APPLY_PREFIX, TRIAL_APPLY_PREFIX, trialErrorText } from "../surfaces/bench-error";
import { NOT_CONCLUDED_PREFIX, NOT_STARTED_PREFIX, sayableReason, saysNothingChanged, trialWriteText } from "../surfaces/trial-error";
import enLab from "../i18n/locales/en/lab.json";
import zhLab from "../i18n/locales/zh-CN/lab.json";

const src = (p: string) => readFileSync(join("src", ...p.split("/")), "utf8");

// Break checks (each makes the named file fail here): put back `setError(String(e))` in ExperimentBench's runWrite or
// simulate catch; `setErr(String(e))` in Benchmark's start or baseline catch; `{trial.error}` in Benchmark's trial
// card; `{ error: String(e) }` in either TrustMoment message; `reason={error}` / `rp.error ??` in ExperimentBench.
describe("B11: these screens never show the backend's raw text", () => {
  const RAW = [
    /set(?:Err|Error|ErrorMsg)\(\s*String\(/,
    /\{\s*error:\s*String\(/,
    /\{trial\.error\}/,
    /reason=\{error\}/,
    /unread=\{rp \? \(rp\.error \?\?/,
  ];
  for (const file of ["surfaces/ExperimentBench.tsx", "surfaces/Benchmark.tsx", "surfaces/TrustMoment.tsx"]) {
    it(`${file} renders no String(e) / raw error text`, () => {
      const text = src(file);
      for (const re of RAW) expect(re.test(text), `${file} matches ${re}`).toBe(false);
    });
  }

  it("each screen routes a failure through backendMessage", () => {
    expect(src("surfaces/ExperimentBench.tsx")).toContain("setError(trialWriteText(e, t), String(e));");
    expect(src("surfaces/ExperimentBench.tsx")).toContain('backendMessage(e, t) ?? t("lab.experimentBench.errors.simulateFailed")');
    expect(src("surfaces/Benchmark.tsx")).toContain('backendMessage(e, t) ?? t("gaming.benchmark.errors.startFailed")');
    expect(src("surfaces/Benchmark.tsx")).toContain('backendMessage(e, t) ?? t("gaming.benchmark.errors.baselineFailed")');
    expect(src("surfaces/Benchmark.tsx")).toContain("trialErrorText(trial.error, t)");
    expect(src("surfaces/TrustMoment.tsx")).toContain('backendMessage(e, t) ?? t("home.trustMoment.errors.applyFailed")');
  });
});

// B11 r1: GuidedJourney (the main Trial flow) keeps the backend's text in its phases (the remedies read it) but says
// a reason only through sayableReason. Break check: put `{ reason: p.reason }` / `{ reason: p.refused }` back in
// any t() call, or drop sayableReason -> fails.
describe("B11 r1: GuidedJourney never says the backend's raw text", () => {
  const text = src("surfaces/GuidedJourney.tsx");
  const t = ((k: string) => `T(${k})`) as never;

  it("no phase reason goes into a line unmapped", () => {
    expect(/reason:\s*p\.(?:reason|refused)\b/.test(text)).toBe(false);
    // Rendered as a child; `reason={p.reason}` (ChangedOutsideRemedy, which only reads it) is allowed.
    expect(/[^=]\{\s*p\.(?:reason|refused)\s*\}/.test(text)).toBe(false);
    expect(text).toContain("const sayable = (reason: string) => sayableReason(reason, t, own);");
    for (const key of ["notStarted", "restoredError", "restoreFailed", "reuseRefused"]) {
      expect(text, key).toContain(`t(\`\${k}.${key}\`, {`);
      expect(text, `${key}Plain`).toContain(`\${k}.${key}Plain\``);
    }
    expect(text).toContain('t("lab.experimentBench.journey.realPlay.failedPlain"');
  });

  it("sayableReason: the journey's own line as it is, else the mapped sentences, else null", () => {
    const own = ["Compy couldn't start measuring."];
    const missing = BACKEND_SENTENCES.find((x) => x.rust === "BASELINE_MISSING")!;
    expect(sayableReason(own[0], t, own)).toBe(own[0]);
    expect(sayableReason(`${NOT_STARTED_PREFIX}${missing.text}`, t, own)).toBe(`T(${missing.key})`);
    expect(sayableReason("helper did not launch", t, own)).toBeNull();
    expect(sayableReason("", t, [""])).toBeNull();
  });
});

describe("B11: the benchmark's apply-failed lines", () => {
  const rust = readFileSync(join("src-tauri", "src", "benchmark_trial.rs"), "utf8");
  const t = ((k: string) => `T(${k})`) as never;

  it("the prefixes are the ones benchmark_trial.rs writes", () => {
    // Break check: change either prefix here or in the Rust format! -> fails.
    expect(rust).toContain(`format!("${TRIAL_APPLY_PREFIX}{e}")`);
    expect(rust).toContain(`format!("${STACK_APPLY_PREFIX}{e}")`);
  });

  it("an apply failure shows a mapped sentence or the card's own line, never the raw text", () => {
    const bench = BACKEND_SENTENCES.find((s) => s.rust === "BENCH_HOLDS_SETTING_REFUSAL")!;
    expect(trialErrorText(`${TRIAL_APPLY_PREFIX}${bench.text}`, t)).toBe(`T(${bench.key})`);
    expect(trialErrorText(`${TRIAL_APPLY_PREFIX}access denied (os error 5)`, t)).toBe("T(gaming.benchmark.errors.trialApplyFailed)");
    expect(trialErrorText(`${STACK_APPLY_PREFIX}access denied (os error 5)`, t)).toBe("T(gaming.benchmark.errors.stackApplyFailed)");
    // Any other trial error is one of benchmark_trial.rs's own sentences and stays as it is.
    expect(trialErrorText("Couldn't collect frames with the change on.", t)).toBe("Couldn't collect frames with the change on.");
  });

  it("a rollback / change-history outcome shows its mapped sentence, never the detail after it", () => {
    // Break check: write `{e}` straight into s.error again (no BENCH_* const) -> the card shows raw text and this fails.
    const s = (rust: string) => BACKEND_SENTENCES.find((x) => x.rust === rust)!;
    for (const name of [
      "BENCH_ROLLED_BACK_UNRECORDED",
      "BENCH_ROLLBACK_FAILED",
      "BENCH_STACK_ROLLBACK_FAILED",
      "BENCH_STACK_ROLLED_BACK_UNRECORDED",
      "BENCH_LEDGER_UNREAD_BEFORE",
      "BENCH_LEDGER_UNREAD_AFTER",
    ]) {
      expect(rust.includes(`{${name}} (`), `${name} is written with its detail in ( )`).toBe(true);
      expect(trialErrorText(`${s(name).text} (access denied (os error 5))`, t)).toBe(`T(${s(name).key})`);
    }
  });
});

describe("B11 r1 F3: a Trial write with no mapped sentence is said by its prefix", () => {
  const rust = readFileSync(join("src-tauri", "src", "experiment.rs"), "utf8");
  const code = rust.slice(0, rust.indexOf("#[cfg(test)]"));
  const t = ((k: string) => `T(${k})`) as never;

  it("the prefixes are the ones experiment.rs writes", () => {
    // Break check: change either prefix here or in the Rust -> fails.
    expect(code).toContain(`format!("${NOT_STARTED_PREFIX}{why}")`);
    expect(code).toContain(`format!("${NOT_CONCLUDED_PREFIX}{why}")`);
  });

  it("each prefix is written only where nothing was recorded, applied or restored yet", () => {
    // The notStarted / notConcluded lines say "nothing was changed"; that holds only for these refusals. Break
    // check: write NOT_STARTED_PREFIX after start_experiment's Pending save, or from another fn -> fails.
    const allowed: Record<string, string[]> = {
      // mark_failed_apply (F6) writes it only in front of a mapped apply refusal that wrote nothing
      // (APPLY_REFUSALS_BEFORE_WRITE), so the screen shows that refusal, never this fallback line.
      [NOT_STARTED_PREFIX]: ["start_outcome", "start_mode", "precheck_refusal", "start_experiment", "mark_failed_apply"],
      [NOT_CONCLUDED_PREFIX]: ["conclude_experiment", "conclude_realplay"],
    };
    const MUTATES = ["save_store(", "apply_recommendation(", "rollback_change(", "finish_conclude(", "record_real_play("];
    const fnHeads = [...code.matchAll(/^\s*(?:pub(?:\([a-z]+\))? )?(?:async )?fn ([a-z_0-9]+)\s*[(<]/gm)];
    for (const [prefix, fns] of Object.entries(allowed)) {
      let at = code.indexOf(prefix);
      let seen = 0;
      for (; at >= 0; at = code.indexOf(prefix, at + 1)) {
        const lineStart = code.lastIndexOf("\n", at) + 1;
        if (/^\s*\/\//.test(code.slice(lineStart, at))) continue; // a comment that names the prefix
        seen++;
        const head = fnHeads.filter((m) => m.index! < at).pop()!;
        const name = head[1];
        expect(fns, `${prefix} written in ${name}`).toContain(name);
        if (name !== "mark_failed_apply") {
          // Nothing in the same fn before the refusal mutates (the record, Windows or the ledger).
          const before = code.slice(head.index!, at);
          for (const m of MUTATES) expect(before.includes(m), `${name}: ${m} before "${prefix}"`).toBe(false);
        }
      }
      expect(seen, prefix).toBeGreaterThan(0);
    }
  });

  it("start_experiment's one-Trial-at-a-time refusals carry the prefix (they return before any record or apply)", () => {
    // B11 r2: without it the screen said an apply "may have stopped part-way" though nothing ran. Break check:
    // drop the prefix from either format! -> fails.
    const joined = code.replace(/\\\r?\n\s*/g, "");
    expect(joined).toContain(`"${NOT_STARTED_PREFIX}an earlier experiment start ({}) was interrupted`);
    expect(joined).toContain(`"${NOT_STARTED_PREFIX}another experiment ({}) is still running`);
  });

  it("a mapped sentence wins; else the prefix picks the line; else the bench's own line", () => {
    const missing = BACKEND_SENTENCES.find((x) => x.rust === "BASELINE_MISSING")!;
    expect(trialWriteText(`${NOT_STARTED_PREFIX}${missing.text}`, t)).toBe(`T(${missing.key})`);
    expect(trialWriteText(`${NOT_STARTED_PREFIX}helper did not launch`, t)).toBe("T(lab.experimentBench.errors.notStarted)");
    expect(trialWriteText(new Error(`${NOT_CONCLUDED_PREFIX}Compy is still collecting: 2 sessions`), t)).toBe(
      "T(lab.experimentBench.errors.notConcluded)",
    );
    expect(trialWriteText("experiment is not running — nothing to conclude", t)).toBe("T(lab.experimentBench.errors.writeFailed)");
  });

  it("en + zh literals", () => {
    const en = enLab.experimentBench.errors as Record<string, string>;
    const zh = zhLab.experimentBench.errors as Record<string, string>;
    expect(en.notStarted).toBe("Compy didn't start this Trial, so nothing was changed.");
    expect(zh.notStarted).toBe("Compy 没有启动这次试验，所以没有做任何更改。");
    expect(en.notConcluded).toBe("Compy didn't conclude this Trial, so nothing was changed. It is still running.");
    expect(zh.notConcluded).toBe("Compy 没有为这次试验得出结论，所以没有做任何更改。试验仍在进行。");
  });
});

describe("B11: an error that carries several sentences shows all of them, in order", () => {
  const t = ((k: string) => `T(${k})`) as never;
  const s = (rust: string) => BACKEND_SENTENCES.find((x) => x.rust === rust)!;

  it("a Trial aborted before measuring says why, then whether the change was put back", () => {
    const err = `experiment aborted before measuring — ${s("ABORT_NOT_CHANGED").text} ${s("ABORT_RESTORED").text}`;
    expect(backendMessages(err, t)).toBe(`T(${s("ABORT_NOT_CHANGED").key}) T(${s("ABORT_RESTORED").key})`);
  });

  it("a failed restore keeps its sentence and drops the OS text", () => {
    const err = `experiment aborted before measuring — ${s("ABORT_UNREADABLE").text} ${s("RESTORE_NOT_COMPLETED").text} (Access is denied. C:\\Users\\x)`;
    const shown = backendMessages(err, t)!;
    expect(shown).toBe(`T(${s("ABORT_UNREADABLE").key}) T(${s("RESTORE_NOT_COMPLETED").key})`);
    expect(shown).not.toContain("Access");
  });

  it("a refused conclude on sessions that aren't comparable says which condition differs (F5)", () => {
    for (const reason of ["DIFFERENT_GAMES_REASON", "DIFFERENT_GPUS_REASON", "NO_COMMON_METRIC_REASON"]) {
      const err = `experiment not concluded — ${s("TREATMENT_NOT_COMPARABLE").text} (${s(reason).text})`;
      expect(backendMessages(err, t)).toBe(`T(${s("TREATMENT_NOT_COMPARABLE").key}) T(${s(reason).key})`);
    }
    // No game or GPU name is part of the mapped reason (nothing parsed out of English text).
    expect(s("DIFFERENT_GAMES_REASON").text).toBe("These are different games, and Compy compares a game only against itself.");
    expect((zh.backendErrors as Record<string, string>).differentGames).toBe("这是两个不同的游戏，而 Compy 只会拿一个游戏与它自己比较。");
  });

  it("no known sentence -> null (the screen's own line)", () => {
    expect(backendMessages("access denied (os error 5)", t)).toBeNull();
    expect(backendMessages(undefined, t)).toBeNull();
  });

  it("experiment.rs writes the restore-failed sentence before its detail on every path", () => {
    // Break check: put `{e}` back without RESTORE_NOT_COMPLETED in conclude/restore/abort -> fails.
    const rust = readFileSync(join("src-tauri", "src", "experiment.rs"), "utf8");
    expect(rust).toContain("{RESTORE_NOT_COMPLETED} ({e})");
    expect(rust).toContain(`format!("restore did not complete — {RESTORE_NOT_COMPLETED} ({e})")`);
    expect(rust).not.toMatch(/format!\("restore did not complete — \{e\}"\)/);
  });
});

describe("B11: the same-setting refusals are mapped in both languages", () => {
  const enKeys = en.backendErrors as Record<string, string>;
  const zhKeys = zh.backendErrors as Record<string, string>;
  const cases: Array<[string, string, string, string]> = [
    [
      "TRIAL_HOLDS_SETTING_REFUSAL",
      "trialHoldsSetting",
      "A setting this action changes is being tested by a Trial right now, so Compy won't run it on top of the test. Let the Trial finish, or end it with Restore now in Test, first. Nothing was changed.",
      "这项操作要更改的某项设置正在接受一项试验，所以 Compy 不会在试验期间叠加执行它。请先等试验完成，或在「测试」中用「立即恢复」结束它。没有做任何更改。",
    ],
    [
      "TRIAL_START_INTERRUPTED_REFUSAL",
      "trialStartInterrupted",
      "An earlier Trial start of a setting this action changes was interrupted and isn't resolved yet, so Compy won't run it now. Check Test → Applied & history, then try again. Nothing was changed.",
      "之前一次针对这项操作要更改的某项设置的试验启动被中断了，尚未解决，所以 Compy 现在不会执行它。请查看「测试 → 已应用与历史记录」，然后再试。没有做任何更改。",
    ],
    [
      "BENCH_HOLDS_SETTING_REFUSAL",
      "benchHoldsSetting",
      "A setting this action changes is being measured by the benchmark right now, so Compy won't run it on top of the measurement. Wait until the benchmark finishes and puts its change back, or cancel it. Nothing was changed.",
      "这项操作要更改的某项设置正在被基准测试测量，所以 Compy 不会在测量期间叠加执行它。请等基准测试完成并恢复它的更改，或取消它。没有做任何更改。",
    ],
  ];
  it.each(cases)("%s: en and zh literal, found inside a wrapped error", (rust, key, enText, zhText) => {
    const s = BACKEND_SENTENCES.find((x) => x.rust === rust)!;
    expect(s.key).toBe(`app.backendErrors.${key}`);
    expect(enKeys[key]).toBe(enText);
    expect(zhKeys[key]).toBe(zhText);
    expect(backendSentenceKey(`experiment not started - ${enText}`)).toBe(s.key);
    // No setting title is ever part of it (the reason it can be mapped at all).
    expect(enText).not.toMatch(/[“”]/);
  });
});

// B11 r1: en is pinned to the Rust byte for byte, but zh only for being Chinese, so a zh text swapped between two
// keys stayed green. For the safety-relevant sentences (did the change go back, is it still on, can it be undone),
// each zh text must carry a phrase that says ITS case, and no other listed zh text may carry it. Break check: swap
// the zh of restoreNotCompleted and benchRollbackFailed (or of any two below) -> fails.
describe("B11 r1: the safety-relevant zh sentences can't be swapped between keys", () => {
  const zhKeys = zh.backendErrors as Record<string, string>;
  const DISTINGUISHING: Array<[string, string]> = [
    ["restoreNotCompleted", "恢复没有完成"],
    ["restoredStillReadsChanged", "已恢复这项更改，但之后读取时"],
    ["alreadyUndoneReadsChanged", "但现在读取到该设置处于已更改状态"],
    ["applyErrReadsUnchanged", "读起来没有改变"],
    ["applyErrReadsChanged", "现在读起来已更改"],
    ["applyErrUnreadable", "无法读取这项设置来判断"],
    ["benchRollbackFailed", "尝试回滚这项更改时回滚失败"],
    ["benchStackRollbackFailed", "有一项或多项回滚失败"],
    ["benchRolledBackUnrecorded", "无法把这次撤销保存"],
    ["benchLedgerUnreadBefore", "在测量前无法读取"],
    ["benchLedgerUnreadAfter", "已执行应用"],
    ["unverifiedOthersStart", "无法确认仍然生效"],
  ];
  it.each(DISTINGUISHING)("%s says its own case, and only it does", (key, phrase) => {
    expect(zhKeys[key], key).toContain(phrase);
    for (const [other] of DISTINGUISHING) if (other !== key) expect(zhKeys[other], `${other} vs ${key}`).not.toContain(phrase);
  });
});

// B11 r2: the other-changes start refusal (experiment::unverified_start_refusal) used to carry a count, so it was
// unmapped and both the bench and the journey said only "not started", with no reason and nothing to do. It is
// now one fixed sentence. Break check: put a count back into UNVERIFIED_OTHERS_START_REFUSAL (Rust) -> the
// byte-equal pin in backend-error.test fails; drop its backend-error.ts entry -> these fail.
describe("B11 r2: the other-changes start refusal is said in both languages", () => {
  const t = ((k: string) => `T(${k})`) as never;
  const s = BACKEND_SENTENCES.find((x) => x.rust === "UNVERIFIED_OTHERS_START_REFUSAL")!;
  const EN =
    "One or more other settings Compy changed earlier can't be confirmed as still in place, so a Trial couldn't show that its result is this setting's alone. Undo them in Test → Applied & history, then start the Trial again.";
  const ZH =
    "Compy 之前更改的一项或多项其他设置无法确认仍然生效，所以试验无法证明结果只来自这项设置。请在「测试 → 已应用与历史记录」中撤销它们，然后重新开始试验。";

  it("en + zh literals, and the words the changed-outside remedy keys on", () => {
    expect(s.key).toBe("app.backendErrors.unverifiedOthersStart");
    expect(s.text).toBe(EN);
    expect((en.backendErrors as Record<string, string>).unverifiedOthersStart).toBe(EN);
    expect((zh.backendErrors as Record<string, string>).unverifiedOthersStart).toBe(ZH);
    // ChangedOutsideRemedy's UNCONFIRMED_REFUSAL.
    expect(EN).toContain("can't be confirmed as still in place");
    expect(EN).not.toMatch(/\d/);
  });

  it("the bench start line and the journey both say it, after the not-started prefix", () => {
    const err = `${NOT_STARTED_PREFIX}${s.text}`;
    expect(trialWriteText(err, t)).toBe(`T(${s.key})`);
    expect(sayableReason(err, t, [])).toBe(`T(${s.key})`);
  });

  it("the journey says a refusal that already says nothing was changed once (mark_failed_apply's case)", () => {
    // Break check: drop the saysNothingChanged branch in GuidedJourney -> "nothing was changed" twice.
    const held = BACKEND_SENTENCES.find((x) => x.rust === "TRIAL_HOLDS_SETTING_REFUSAL")!;
    expect(saysNothingChanged(`${NOT_STARTED_PREFIX}${held.text}`)).toBe(true);
    expect(saysNothingChanged(`${NOT_STARTED_PREFIX}${s.text}`)).toBe(false);
    expect(saysNothingChanged(`${NOT_STARTED_PREFIX}helper did not launch`)).toBe(false);
    expect(src("surfaces/GuidedJourney.tsx")).toContain("saysNothingChanged(p.reason)");
  });
});
