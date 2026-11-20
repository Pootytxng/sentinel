// The parked checks: exactly the files listed in scripts/audit-tests.txt. Run weekly and before every release.
import { readFileSync } from "node:fs";
import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

const audit = readFileSync("scripts/audit-tests.txt", "utf8")
  .split(/\r?\n/)
  .map((l) => l.split("\t")[0].trim())
  .filter((l) => l && !l.startsWith("#"));

export default mergeConfig(base, defineConfig({ test: { include: audit } }));
