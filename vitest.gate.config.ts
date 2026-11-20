// The pre-push gate: every test file EXCEPT the ones parked in scripts/audit-tests.txt.
// A new test therefore runs on every push unless someone deliberately parks it (docs/PRODUCT_CONSTITUTION.md section 38).
import { readFileSync } from "node:fs";
import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

const audit = readFileSync("scripts/audit-tests.txt", "utf8")
  .split(/\r?\n/)
  .map((l) => l.split("\t")[0].trim())
  .filter((l) => l && !l.startsWith("#"));

// mergeConfig appends to the base excludes.
export default mergeConfig(base, defineConfig({ test: { exclude: audit } }));
