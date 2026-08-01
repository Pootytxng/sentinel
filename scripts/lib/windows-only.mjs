// Why some suites in this repository are Windows-only, stated once instead of five times.
//
// A handful of test files drive the release tooling by spawning `powershell.exe` against a `.ps1`
// harness — production-adapter, release-transaction, public-version-gate, alias-propagation. That
// tooling IS Windows PowerShell; there is nothing for it to be on another platform. When CI came
// back on 2026-08-01 after 22 days dead, those five files failed 100% on the Linux runner —
// 86 assertions, every one of them failing because `powershell.exe` does not exist there and
// `spawnSync` handed back `stdout: null`, not because anything was wrong.
//
// Three options, and why this is the one:
//
//   run them on Linux      impossible — the interpreter under test is absent
//   run them on Windows CI possible, and ~570 billed minutes a month for a 2x runner plus its own
//                          `npm ci`. This repository exhausted its whole 2,000-minute allowance on
//                          9 July and CI was silently dead for three weeks. That is more than half
//                          the remaining budget, spent to re-prove something already proven.
//   skip off-Windows       they still run on every Windows machine, AND inside the release gate
//                          `scripts/verify-release.ps1`, which invokes the FULL `npm test` before a
//                          release. That gate is what actually gates shipping.
//
// So the coverage is not lost, it is located. `windows-only-coverage.test.mjs` enforces both halves
// of that claim — that every PowerShell-driving suite is gated, and that the release gate really
// does run the whole suite — so this comment cannot quietly stop being true.
//
// The skip is deliberately LEGIBLE: vitest prints a skipped suite with its name, so the output says
// which proofs did not run rather than implying they passed. A silent skip would be the same defect
// as the dead CI it replaced.

// Named `windows` and used with `describe.runIf(windows)` because that is ALREADY the convention in
// this repository (native-process-guard, runtime-proof-guard, release-pipeline-guard). A second
// spelling of the same idea would be worse than the duplication it replaced — the point of this
// module is that there is exactly one definition and exactly one reason, not a new dialect.
export const windows = process.platform === "win32";

/** Suffix for a gated suite's name, so the reason travels with the output. */
export const WINDOWS_ONLY = "[Windows only — drives powershell.exe; proven by scripts/verify-release.ps1]";
