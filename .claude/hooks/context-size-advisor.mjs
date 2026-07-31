#!/usr/bin/env node
// Stop hook — context-refresh advisor v4 (2026-07-18, owner directive: single-source the
// numbers, no hardcoded duplicate of the compact window).
//
// The refresh itself is NATIVE: settings.json's CLAUDE_CODE_AUTO_COMPACT_WINDOW is THE one
// place the window value lives (see .claude/USAGE_ECONOMICS.md §5 for the reconciled numbers
// doc). This hook reads that same env var at runtime instead of hardcoding a derived warn
// threshold, so a future change to the setting never needs a matching edit here. Its only job
// is the part compaction can't guarantee: making sure mid-train state is ON DISK before the
// summary replaces the conversation. It never stops work and never emits an owner paste block.
//
// v3 measured LIVE context (not transcript file size — after a compaction the file keeps
// growing while live context resets, so the old proxy breaks): it parses the last assistant
// message's `usage` from the transcript tail. live ctx = input_tokens +
// cache_read_input_tokens + cache_creation_input_tokens. v4 keeps that and only changes where
// WARN_TOKENS comes from.
//
// Safety guards:
//   - stop_hook_active → always allow (never loop).
//   - fires once per +STEP_TOKENS growth; marker auto-resets when ctx shrinks (compaction).
//   - any parse/read failure → silent exit (advisory hook, never breaks a stop).

import { readFileSync, writeFileSync, openSync, readSync, closeSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Single source of truth for the window is settings.json's CLAUDE_CODE_AUTO_COMPACT_WINDOW —
// read it at runtime (fallback only if the env var is somehow missing) rather than restating
// the literal value here. Warn at 85% of the real window, giving headroom before native
// auto-compact fires (which itself triggers at ~92-95% of the window, per Anthropic's default).
const COMPACT_WINDOW = Number(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW) || 150_000;
const WARN_TOKENS = Math.round(COMPACT_WINDOW * 0.85);
const STEP_TOKENS = 30_000;
const TAIL_BYTES = 512 * 1024; // enough to contain several recent assistant lines

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}

// Never loop: if any Stop hook already forced a continuation, allow the stop.
if (input.stop_hook_active === true) process.exit(0);

const tp = input?.transcript_path;
if (!tp) process.exit(0);

// --- measure live context from the last assistant usage in the transcript tail ---
let ctx = 0;
try {
  const size = statSync(tp).size;
  const fd = openSync(tp, "r");
  const start = Math.max(0, size - TAIL_BYTES);
  const buf = Buffer.alloc(size - start);
  readSync(fd, buf, 0, buf.length, start);
  closeSync(fd);
  const lines = buf.toString("utf8").split("\n");
  // first line of the tail may be a partial JSON line — parse failures are skipped anyway
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.isSidechain === true) continue;
    const u = entry?.message?.usage;
    if (entry?.type === "assistant" && u && typeof u.input_tokens === "number") {
      ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      break;
    }
  }
} catch {
  process.exit(0);
}
if (!ctx) process.exit(0);

// --- growth-step throttle (marker stores last-fired ctx; reset if ctx shrank = compaction) ---
const sid = String(input?.session_id || "x").replace(/[^a-z0-9-]/gi, "");
const marker = join(tmpdir(), `compy-ctxadvisor-${sid}`);
let last = NaN;
try {
  last = Number(readFileSync(marker, "utf8"));
} catch {
  /* no marker yet */
}
const compacted = Number.isFinite(last) && ctx < last; // context shrank → compaction happened → re-arm
if (ctx < WARN_TOKENS) {
  if (compacted) {
    try {
      writeFileSync(marker, "0");
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
}
if (Number.isFinite(last) && !compacted && ctx - last < STEP_TOKENS) process.exit(0);
try {
  writeFileSync(marker, String(ctx));
} catch {
  /* ignore */
}

const k = Math.round(ctx / 1000);
const windowK = Math.round(COMPACT_WINDOW / 1000);

// --- persist-verification (2026-07-18 addition) ------------------------------------------
// The instruction below has always TOLD the model to persist state to disk, but nothing ever
// checked whether it actually did. This is a real gap: the whole quality-retention design
// depends on the persist step happening, and a hook can't inspect conversation content — but
// it CAN check whether any of the docs a persist would touch actually changed on disk since
// the last time this hook fired. That's a cheap, honest proxy: not proof the write was good,
// but proof SOMETHING was written, which "no file changed since last checkpoint" rules out.
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
function latestMtimeMs(paths) {
  let latest = 0;
  for (const p of paths) {
    try {
      const st = statSync(p);
      if (st.isDirectory()) {
        for (const f of readdirSync(p)) {
          try {
            const fst = statSync(join(p, f));
            if (fst.mtimeMs > latest) latest = fst.mtimeMs;
          } catch { /* skip unreadable entry */ }
        }
      } else if (st.mtimeMs > latest) {
        latest = st.mtimeMs;
      }
    } catch { /* path doesn't exist — skip, not fatal */ }
  }
  return latest;
}
const watchPaths = [
  join(PROJECT_DIR, "docs", "BACKLOG.md"),
  join(PROJECT_DIR, "docs", "superpowers", "specs"),
  join(PROJECT_DIR, "docs", "superpowers", "plans"),
];
const freshMarker = join(tmpdir(), `compy-ctxadvisor-persist-${sid}`);
let noPersistWarning = "";
try {
  const currentLatest = latestMtimeMs(watchPaths);
  let prevLatest = NaN;
  try {
    prevLatest = Number(readFileSync(freshMarker, "utf8"));
  } catch { /* first fire this growth-cycle, nothing to compare yet */ }
  if (Number.isFinite(prevLatest) && currentLatest <= prevLatest) {
    noPersistWarning =
      `\n\n⚠️ No change detected in docs/BACKLOG.md or docs/superpowers/{specs,plans} since the ` +
      `last checkpoint at this context size — if real work happened since then, step 1 below is ` +
      `not optional this time.`;
  }
  writeFileSync(freshMarker, String(currentLatest));
} catch { /* advisory only — never let the freshness check break the hook */ }

// Block once: force a state-persist to disk, then let the turn end normally. Auto-compact
// (native, ~92-95% of the window) handles the refresh itself — no owner action, no paste
// block, no stopping.
const reason =
  `CONTEXT CHECKPOINT — live context is ~${k}k tokens; the harness will auto-compact itself ` +
  `near ~${windowK}k (CLAUDE_CODE_AUTO_COMPACT_WINDOW=${COMPACT_WINDOW}). Compaction summarizes the conversation, so ` +
  `anything that lives ONLY in this conversation gets lossy. Do exactly this, then end your ` +
  `turn normally:\n` +
  `1. If mid-train, persist the working state to disk NOW — a brief cycle note in ` +
  `docs/BACKLOG.md or the active spec/plan: decisions made, exact file refs, the precise next ` +
  `step — written so a fresh session could resume from it alone. If everything is already ` +
  `committed/pushed and reported, say nothing and just finish.\n` +
  `2. Do NOT stop the work, do NOT ask the owner to /clear, and do NOT emit a paste/refresh ` +
  `block — the refresh is automatic now.\n` +
  `3. Exception: if the owner's driver prompt for THIS session explicitly said to ride the ` +
  `context without refresh (e.g. "NO REFRESH"), note that and carry on unchanged.` +
  noPersistWarning;

process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
process.exit(0);
