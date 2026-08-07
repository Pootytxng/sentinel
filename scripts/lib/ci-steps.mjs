// The checks `.github/workflows/ci.yml` runs, as data, so the local runner and the drift guard read
// one list instead of two copies. `scripts/verify-like-ci.test.mjs` proves this matches the
// workflow — the whole point of `npm run verify` is that it is not an approximation of CI.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const siteApp = join(repoRoot, "site-app");

export const CI_STEPS = [
  {
    name: "site-app dependencies (site guards need them)",
    cmd: "npm",
    args: ["ci"],
    cwd: siteApp,
    // One-time on a developer machine; on CI every run starts bare. Skipping it here is the
    // difference between a 4-minute local run and a 12-minute one.
    skipIf: () => existsSync(join(siteApp, "node_modules", "astro", "astro.js")),
    skipNote: "already installed",
  },
  { name: "stage the site once, for the site guards", cmd: "npm", args: ["run", "stage:site"] },
  { name: "vitest", cmd: "npm", args: ["test"] },
  { name: "type-check + build", cmd: "npm", args: ["run", "build"] },
  { name: "cargo test", cmd: "cargo", args: ["test", "--manifest-path", "src-tauri/Cargo.toml"] },
  {
    name: "cargo clippy (deny warnings)",
    cmd: "cargo",
    args: ["clippy", "--manifest-path", "src-tauri/Cargo.toml", "--all-targets", "--", "-D", "warnings"],
  },
];

/** Workflow `run:` lines that set the machine up rather than check the code — a local checkout
    already has them, so the runner skips them and the drift guard does not demand a match. */
export const SETUP_ONLY = [
  /^git config/m,
  /^git fetch/m,
  /^rustc --version/m,
  /^npm ci$/m, // the ROOT install; the site-app one is a real step above, and carries a cwd
];
