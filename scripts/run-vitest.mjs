// Guard against the Windows drive-letter-casing dual-instance bug (caught 2026-07-22).
// When a shell launches node with a lowercase drive in the cwd (`c:\...` — VSCode/agent harnesses
// do this), Node resolves some modules via lowercase paths and others via uppercase, so vitest and
// its setup file load as TWO module instances → every suite dies with "Vitest failed to find the
// current suite". Re-spawn vitest from the true on-disk casing so runs are deterministic.
import { realpathSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// 2026-07-22: an Electron-hosted bridge shell leaks NODE_ENV=production into children; production React lacks React.act and 608 render tests false-fail. Tests always run in vitest's own env.
delete process.env.NODE_ENV;

const trueCwd = realpathSync.native(process.cwd());
// vitest's exports map doesn't expose the bin file directly — resolve package.json (always
// exported) and read the bin field from it.
const pkgPath = createRequire(import.meta.url).resolve("vitest/package.json");
const bin = JSON.parse(readFileSync(pkgPath, "utf8")).bin;
const vitestBin = join(dirname(pkgPath), typeof bin === "string" ? bin : bin.vitest);
const result = spawnSync(
  process.execPath,
  [vitestBin, ...process.argv.slice(2)],
  { cwd: trueCwd, stdio: "inherit" },
);
process.exit(result.status ?? 1);
