# Verification mechanics

## On the user's Windows dev box (the normal case)
Everything is native. Just run, from the repo root:
```
npm test                                          # full vitest suite
npx tsc --noEmit                                  # types
cargo test --manifest-path src-tauri/Cargo.toml   # full Rust suite
cargo build --manifest-path src-tauri/Cargo.toml  # must be warning-free
```
No mirror, no tricks. Skip the rest of this file.

## Inside a Linux sandbox (Cowork) — the native-mirror procedure
Two hazards make the repo's own `node_modules` unusable here, learned the hard way:

1. **Windows-native binaries don't run on Linux.** The installed `rollup`/`esbuild` are win32 builds;
   importing them throws `Cannot find module @rollup/rollup-linux-x64-gnu` / `MODULE_NOT_FOUND`.
   Symlinking the repo's `node_modules` into the mirror does NOT help — the Linux binary is simply absent.
2. **The mounted outputs dir can refuse symlink operations** ("Operation not permitted"). Build the
   mirror on local sandbox disk (`/tmp`), not on the mount.

### Procedure
```bash
REPO=<sandbox path to repo, e.g. /sessions/.../mnt/code/sentinel>
M=/tmp/cv
rm -rf "$M" && mkdir -p "$M"
cp -r "$REPO/src" "$M/src"
cp "$REPO/package.json" "$REPO/package-lock.json" "$REPO"/tsconfig*.json "$REPO/vitest.config.ts" "$M/"
cd "$M"
npm ci --no-audit --no-fund        # fresh LINUX-native install from the lockfile (fast: ~10s, modest dep set)
# sanity: prove the harness runs before trusting it
npx vitest run src/surfaces/system-posture.test.ts
```
Now drop new test files into `$M/src/<subpath>/` and run them. The mirror's `src/` already holds the
source modules, so imports like `./guided` resolve.

### Running the full suite without getting killed
- Background jobs do NOT survive across separate bash calls in this sandbox — a `nohup ... &` run gets
  reaped when the call returns. Run the suite in the FOREGROUND.
- The full suite can exceed a single call's time budget. Split by file type and run each foreground:
  ```bash
  npx vitest run --reporter=dot $(find src -name '*.test.ts'  | tr '\n' ' ')   # fast: logic + all guards
  npx vitest run --reporter=dot $(find src -name '*.test.tsx' | tr '\n' ' ')   # slower: component renders
  ```
  The `*.test.ts` half is the meaningful gate for test-only additions: it runs every doctrine guard
  plus the new pure-logic tests. Component `*.test.tsx` are independent of new test-only files.

### Rust in the sandbox
There is no `cargo`/`rustc`. Author + statically review only; carry the run command forward for the
owner / dev box:
```
cargo test --manifest-path src-tauri/Cargo.toml hardware::
```
Say clearly that Rust runtime verification is pending — never imply a cargo run that didn't happen.
