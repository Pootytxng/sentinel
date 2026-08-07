#!/usr/bin/env node
// Stop hook — context-refresh advisor v5 (2026-08-07).
//
// v5 exists because v4 COULD NOT FIRE. v4 warned on absolute size only: 85% of
// CLAUDE_CODE_AUTO_COMPACT_WINDOW, i.e. 127,500 tokens at the configured 150k. A session measured
// straight from its own transcript peaked at 123k and never once crossed that line — while the
// harness's "Your context window is full / Autocompact is thrashing" dialog fired over and over and
// the owner had to notice it himself and type /clear. An advisory that cannot fire is worse than
// none, because it reads as coverage. Same failure class as big-read-guard v1, which was dead on a
// swallowed ReferenceError.
//
// The measurement that reframed the problem (same transcript, 3822 assistant turns):
//   PEAK 123k · median 105k · p90 115k — only ~18k of spread against a 150k window.
//   112k -> 0k, back to ~112k in 1 turn.  118k -> 0k, back in 1 turn.  121k -> 0k, back in 2.
//   And, for contrast, one HEALTHY drop: 119k -> 88k, back to ~119k in 48 turns.
// A context that varies by 18k around 105k is almost entirely FIXED per-turn payload — system
// prompt, auto-loaded docs, tool listings, re-injected skills, the carried handoff. Compaction can
// only reclaim CONVERSATION, and there is barely any. That is the whole mechanism behind the 1-turn
// refill, and it is why a bigger window would not have helped: the session never reached the old one.
//
// So v5 keeps the size checkpoint and adds the signal that actually fires: refill velocity, computed
// by scripts/lib/context-thrash.mjs from a bounded per-session series this hook samples each turn.
// When the pattern shows up, the advisory escalates from "persist state" to "write the handoff and
// tell the owner /clear" — the one thing this process cannot do for itself, since /clear is his
// command and no hook output can clear a conversation.
//
// It also retargets the persist step. v4 pointed at docs/BACKLOG.md — 133 KB, a file the big-read
// guard now refuses to read unbounded, which made the resume payload unreadable after a clear. v5
// points at docs/SESSION_HANDOFF.md: one small, budget-capped, always-current resume file.
//
// Safety guards:
//   - stop_hook_active → always allow (never loop).
//   - each advisory has its own throttle; neither repeats without new evidence.
//   - any parse/read failure → silent exit (advisory hook, never breaks a stop).

import { readFileSync, writeFileSync, openSync, readSync, closeSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The refill-velocity arithmetic lives in scripts/lib/ so it is unit-testable without a transcript.
// Imported defensively: a missing lib degrades this hook to v4's size-only behaviour rather than
// throwing on a Stop, which is the one thing an advisory must never do.
let thrash = null;
try {
  thrash = await import(new URL("../../scripts/lib/context-thrash.mjs", import.meta.url));
} catch {
  /* size-only fallback */
}

// Single source of truth for the window is settings.json's CLAUDE_CODE_AUTO_COMPACT_WINDOW —
// read it at runtime (fallback only if the env var is somehow missing) rather than restating
// the literal value here. Warn at 85% of the real window, giving headroom before native
// auto-compact fires (which itself triggers at ~92-95% of the window, per Anthropic's default).
const COMPACT_WINDOW = Number(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW) || 150_000;
const WARN_TOKENS = Math.round(COMPACT_WINDOW * 0.85);
const STEP_TOKENS = 30_000;
const TAIL_BYTES = 512 * 1024; // enough to contain several recent assistant lines
const SERIES_TURNS = 60; // bounded on purpose — a monitor that grows is the disease, not the cure

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
let found = false; // distinct from "measured exactly 0" — a genuine drop to 0 IS the thrash signature
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
      found = true;
      break;
    }
  }
} catch {
  process.exit(0);
}
if (!found) process.exit(0);

const sid = String(input?.session_id || "x").replace(/[^a-z0-9-]/gi, "");
const readMarker = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};
const writeMarker = (path, value) => {
  try {
    writeFileSync(path, String(value));
  } catch {
    /* ignore — advisory state, never worth breaking a stop over */
  }
};

// --- sample the series EVERY turn, before any threshold decides to stay quiet ------------------
// v4's bug in one line: it exited before recording anything, so it could only ever know the single
// number it was already ignoring. Velocity needs history, and history costs ~400 bytes of tmp file.
let thrashResult = null;
if (thrash) {
  const seriesMarker = join(tmpdir(), `compy-ctxadvisor-series-${sid}`);
  const { series, serialized } = thrash.appendSeries(readMarker(seriesMarker), ctx, SERIES_TURNS);
  writeMarker(seriesMarker, serialized);
  thrashResult = thrash.detectThrash(series, COMPACT_WINDOW);
}

const k = Math.round(ctx / 1000);
const windowK = Math.round(COMPACT_WINDOW / 1000);
const emit = (reason) => {
  process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
  process.exit(0);
};

// --- ESCALATION: the context is thrashing -------------------------------------------------------
// Throttled on the evidence count, not on time or size: it re-fires only when a NEW rebound or a new
// no-headroom compaction has actually been observed since the last time it spoke.
if (thrashResult?.thrashing) {
  const evidenceCount = thrashResult.rebounds.length + thrashResult.floorHits.length;
  const thrashMarker = join(tmpdir(), `compy-ctxadvisor-thrash-${sid}`);
  const lastCount = Number(readMarker(thrashMarker));
  if (!Number.isFinite(lastCount) || evidenceCount > lastCount) {
    writeMarker(thrashMarker, evidenceCount);
    emit(
      `CONTEXT IS THRASHING — ${thrash.describeThrash(thrashResult, COMPACT_WINDOW)}. Live context is ` +
        `~${k}k against a ~${windowK}k window. This is the harness's own "Autocompact is thrashing" ` +
        `condition, measured from this session's transcript rather than guessed.\n` +
        `Compaction cannot fix it. Compaction reclaims CONVERSATION, and at this refill speed almost ` +
        `all of the context is fixed per-turn payload (system prompt, auto-loaded docs, tool ` +
        `listings, re-injected skills, the carried handoff) — there is nothing left for it to ` +
        `reclaim. A bigger window would not help either. Do exactly this, then end your turn:\n` +
        `1. Write or refresh docs/SESSION_HANDOFF.md — the ONE bounded resume file. Decisions made, ` +
        `exact file:line refs, what is committed, the precise next action. Complete enough that a ` +
        `session starting from zero could carry on from it alone; short enough to stay under its ` +
        `doc-budget cap. Replace stale content, never append to it.\n` +
        `2. Commit anything worth keeping.\n` +
        `3. Tell the owner in ONE line that /clear is now the cheapest correct move and that ` +
        `docs/SESSION_HANDOFF.md holds the resume point. You cannot run /clear — it is his command, ` +
        `not a tool — so that one line IS the handoff.\n` +
        `4. Do NOT paste a long recap into chat. The file is the recap; repeating it in the ` +
        `conversation is the cost you are trying to avoid.`,
    );
  }
}

// --- CHECKPOINT: approaching the window (v3/v4 behaviour, retargeted) ---------------------------
const marker = join(tmpdir(), `compy-ctxadvisor-${sid}`);
const rawLast = readMarker(marker);
const last = rawLast === "" ? NaN : Number(rawLast);
const compacted = Number.isFinite(last) && ctx < last; // context shrank → compaction happened → re-arm
if (ctx < WARN_TOKENS) {
  if (compacted) writeMarker(marker, "0");
  process.exit(0);
}
if (Number.isFinite(last) && !compacted && ctx - last < STEP_TOKENS) process.exit(0);
writeMarker(marker, ctx);

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
  join(PROJECT_DIR, "docs", "SESSION_HANDOFF.md"),
  join(PROJECT_DIR, "docs", "BACKLOG.md"),
  join(PROJECT_DIR, "docs", "superpowers", "specs"),
  join(PROJECT_DIR, "docs", "superpowers", "plans"),
];
const freshMarker = join(tmpdir(), `compy-ctxadvisor-persist-${sid}`);
let noPersistWarning = "";
try {
  const currentLatest = latestMtimeMs(watchPaths);
  const rawPrev = readMarker(freshMarker);
  const prevLatest = rawPrev === "" ? NaN : Number(rawPrev);
  if (Number.isFinite(prevLatest) && currentLatest <= prevLatest) {
    noPersistWarning =
      `\n\n⚠️ No change detected in docs/SESSION_HANDOFF.md, docs/BACKLOG.md or ` +
      `docs/superpowers/{specs,plans} since the last checkpoint at this context size — if real work ` +
      `happened since then, step 1 below is not optional this time.`;
  }
  writeMarker(freshMarker, currentLatest);
} catch { /* advisory only — never let the freshness check break the hook */ }

// Block once: force a state-persist to disk, then let the turn end normally. Native auto-compact
// (~92-95% of the window) handles the refresh at this size on its own — no owner action needed yet.
emit(
  `CONTEXT CHECKPOINT — live context is ~${k}k tokens; the harness will auto-compact itself ` +
    `near ~${windowK}k (CLAUDE_CODE_AUTO_COMPACT_WINDOW=${COMPACT_WINDOW}). Compaction summarizes the ` +
    `conversation, so anything that lives ONLY in this conversation gets lossy. Do exactly this, ` +
    `then end your turn normally:\n` +
    `1. If mid-train, persist the working state to disk NOW — refresh docs/SESSION_HANDOFF.md (the ` +
    `bounded resume file), plus a cycle note in the active spec/plan if one is open: decisions made, ` +
    `exact file refs, the precise next step — written so a fresh session could resume from it alone. ` +
    `If everything is already committed/pushed and reported, say nothing and just finish.\n` +
    `2. Do NOT stop the work and do NOT emit a paste/refresh block — at this size the refresh is ` +
    `automatic. Escalating to /clear is for the separate THRASHING advisory, which fires on measured ` +
    `refill velocity; if you have not seen it, compaction is still doing its job and there is nothing ` +
    `to tell the owner.\n` +
    `3. Exception: if the owner's driver prompt for THIS session explicitly said to ride the ` +
    `context without refresh (e.g. "NO REFRESH"), note that and carry on unchanged.` +
    noPersistWarning,
);
