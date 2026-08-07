#!/usr/bin/env node
// `npm run verify` — run, on this machine, exactly what .github/workflows/ci.yml runs.
//
// Why this exists: GitHub Actions on this repo is a metered private-repo budget, and when it runs
// dry (or a card lapses) every job dies in two seconds with `steps: 0` and no log — a red X that
// says nothing about the code. The repo is a single-developer repo, so CI was never a gate against
// somebody else's bad push; it was a reminder to run the checks. A reminder that costs money and
// can be switched off by a billing page is worse than one that cannot.
//
// This runs the same commands, in the same order, and fails the same way. Keep it in step with
// ci.yml — `scripts/verify-like-ci.test.mjs` fails the build if the two drift apart.
import { spawnSync } from "node:child_process";
import { CI_STEPS, repoRoot } from "./lib/ci-steps.mjs";

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const fast = process.argv.includes("--fast"); // skip the Rust half — the slow one

const started = Date.now();
const results = [];

for (const step of CI_STEPS) {
  if (only.length > 0 && !only.some((o) => step.name.includes(o))) continue;
  if (fast && step.cmd === "cargo") {
    results.push({ name: step.name, state: "skipped", note: "--fast" });
    continue;
  }
  if (step.skipIf?.()) {
    results.push({ name: step.name, state: "skipped", note: step.skipNote });
    continue;
  }

  process.stdout.write(`\n── ${step.name} ──\n`);
  const t = Date.now();
  // Windows needs a shell (`npm` is a .cmd shim, and Node refuses to spawn one directly), and a
  // shell must be handed ONE string — passing an args array alongside `shell: true` concatenates it
  // unescaped, which Node deprecates as an injection hazard. Quoting here keeps the two apart.
  const win = process.platform === "win32";
  const quoted = step.args.map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a));
  const run = spawnSync(win ? [step.cmd, ...quoted].join(" ") : step.cmd, win ? undefined : step.args, {
    cwd: step.cwd ?? repoRoot,
    stdio: "inherit",
    shell: win,
  });
  const secs = Math.round((Date.now() - t) / 1000);
  if (run.status !== 0) {
    results.push({ name: step.name, state: "FAILED", note: `${secs}s` });
    report(results, started);
    process.stderr.write(`\nverify: FAILED at "${step.name}". CI would have failed here too.\n`);
    process.exit(1);
  }
  results.push({ name: step.name, state: "ok", note: `${secs}s` });
}

report(results, started);
process.stdout.write("\nverify: OK — everything ci.yml runs passed on this machine.\n");

function report(rows, since) {
  const width = Math.max(...rows.map((r) => r.name.length));
  process.stdout.write("\n" + "─".repeat(width + 22) + "\n");
  for (const r of rows) {
    const mark = r.state === "ok" ? "PASS" : r.state === "skipped" ? "skip" : "FAIL";
    process.stdout.write(`${mark}  ${r.name.padEnd(width)}  ${r.note ?? ""}\n`);
  }
  process.stdout.write(`total ${Math.round((Date.now() - since) / 1000)}s\n`);
}
