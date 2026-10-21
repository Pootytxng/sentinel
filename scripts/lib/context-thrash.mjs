// The refill-velocity half of the context story: not "how big is the context right now" but "how
// fast does it come back after it is cleared". Pure arithmetic over a series of per-turn live-context
// measurements, so the guard can prove every branch without a transcript.
//
// Why this module exists (bug→guard, 2026-08-07). `.claude/hooks/context-size-advisor.mjs` warned on
// ABSOLUTE size alone — 85% of CLAUDE_CODE_AUTO_COMPACT_WINDOW, i.e. 127,500 tokens at the configured
// 150k. A measured session peaked at 123k and never once crossed that line, so the advisor never
// fired, while the harness's own "Autocompact is thrashing" dialog fired over and over and the owner
// had to notice it himself and type /clear. An advisory that cannot fire is worse than none, because
// it reads as coverage.
//
// The measured signature of the failure, taken from that session's own transcript:
//     112k -> 0k, back to ~112k in 1 turn
//     118k -> 0k, back to ~118k in 1 turn
//     121k -> 0k, back to ~121k in 2 turns
// and, from the same session, one HEALTHY drop for contrast:
//     119k -> 88k, back to ~119k in 48 turns
// Size cannot tell those apart — every one of them happened under the warn line. Refill velocity can.
//
// The mechanism it detects: when almost all of the context is fixed per-turn payload (system prompt,
// auto-loaded docs, tool listings, re-injected skills, the handoff summary) rather than conversation,
// compaction has nothing left to reclaim, so it drops and instantly refills. The fix is never a bigger
// window — it is a smaller baseline. This module's job is to say so at the moment it is observable.

/**
 * Thresholds, named so a reader never has to decode a bare literal.
 *
 * DROP_FRACTION   — a turn under this share of the previous turn is a drop (compaction or /clear).
 * REFILL_FRACTION — "back to where it was" means back to this share of the pre-drop level.
 * REFILL_TURNS    — a refill inside this many turns is a rebound, not a recovery.
 * MIN_REBOUNDS    — one fast rebound is noise; two is a pattern. (The harness itself says 3.)
 * FLOOR_FRACTION  — a compaction that LANDS at this share of the window reclaimed nothing worth
 *                   reclaiming; that single event is damning on its own and needs no repeat.
 */
export const THRASH_LIMITS = {
  DROP_FRACTION: 0.75,
  REFILL_FRACTION: 0.9,
  REFILL_TURNS: 2,
  MIN_REBOUNDS: 2,
  FLOOR_FRACTION: 0.7,
};

/**
 * Find drop→rebound pairs and no-headroom compactions in a live-context series.
 *
 * A drop at the very END of the series is deliberately counted neither way: the turns that would
 * prove or disprove a rebound have not happened yet, and guessing in either direction would either
 * cry wolf on a healthy compaction or stay silent through a thrashing one.
 *
 * @param {Array<number>} series per-turn live context (input + cache_read + cache_creation), oldest first
 * @param {number} window the effective CLAUDE_CODE_AUTO_COMPACT_WINDOW
 * @returns {{rebounds: Array<{from:number,to:number,turns:number}>, floorHits: Array<{from:number,to:number}>, worst: {from:number,to:number,turns:number}|null, thrashing: boolean}}
 */
export function detectThrash(series, window) {
  const clean = (Array.isArray(series) ? series : [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const w = Number.isFinite(Number(window)) && Number(window) > 0 ? Number(window) : 0;
  const { DROP_FRACTION, REFILL_FRACTION, REFILL_TURNS, MIN_REBOUNDS, FLOOR_FRACTION } = THRASH_LIMITS;

  const rebounds = [];
  const floorHits = [];
  for (let i = 1; i < clean.length; i++) {
    const from = clean[i - 1];
    const to = clean[i];
    if (!(to < from * DROP_FRACTION)) continue;

    // Landed high: compaction ran and the context is still nearly full, so the payload is not
    // conversation. /clear drops to ~0 and never trips this — correctly, since a clear DID work.
    if (w && to >= w * FLOOR_FRACTION) floorHits.push({ from, to });

    const target = from * REFILL_FRACTION;
    for (let turns = 1; turns <= REFILL_TURNS; turns++) {
      const j = i + turns;
      if (j >= clean.length) break; // unresolved — not yet knowable, so not counted
      if (clean[j] >= target) {
        rebounds.push({ from, to, turns });
        break;
      }
    }
  }

  // Worst = fastest refill; ties broken by the bigger context, because that is the more expensive one.
  const worst = rebounds.slice().sort((a, b) => a.turns - b.turns || b.from - a.from)[0] || null;
  const thrashing = rebounds.length >= MIN_REBOUNDS || floorHits.length > 0;
  return { rebounds, floorHits, worst, thrashing };
}

/**
 * One human sentence naming the evidence, or null when nothing is wrong. Never a bare verdict — the
 * point of the advisory is that the reader can check the claim against the numbers that produced it.
 *
 * @param {ReturnType<typeof detectThrash>} result
 * @param {number} window
 * @returns {string|null}
 */
export function describeThrash(result, window) {
  if (!result?.thrashing) return null;
  const k = (n) => `${Math.round(n / 1000)}k`;
  const parts = [];
  if (result.worst) {
    const { to, from, turns } = result.worst;
    parts.push(
      `context fell to ${k(to)} and was back at ${k(from)} within ${turns} turn${turns === 1 ? "" : "s"}` +
        (result.rebounds.length > 1 ? ` (${result.rebounds.length} such refills)` : ""),
    );
  }
  if (result.floorHits.length && Number(window) > 0) {
    const f = result.floorHits[result.floorHits.length - 1];
    parts.push(
      `a compaction landed at ${k(f.to)} — already ${Math.round((f.to / Number(window)) * 100)}% of the ` +
        `${k(Number(window))} window, so it reclaimed almost nothing`,
    );
  }
  if (!parts.length) parts.push(`${result.rebounds.length} fast refills`);
  return parts.join("; ");
}

/**
 * True when the harness says this session is hosted (claude.ai/code), i.e. not the desk checkout.
 * CLAUDE_CODE_REMOTE=true is the harness's own marker; nothing here guesses from paths or hostnames.
 *
 * @param {NodeJS.ProcessEnv|Record<string,string|undefined>} [env]
 * @returns {boolean}
 */
export function isHostedSession(env = process.env) {
  return String(env?.CLAUDE_CODE_REMOTE ?? "").toLowerCase() === "true";
}

/**
 * The window the thrash FLOOR test may judge against, or 0 when it must not judge at all.
 *
 * Why (bug→guard, 2026-10-21, found while auditing the owner's report that hosted sessions keep
 * stopping on hindrances). The configured literal is the DESK window: settings.json sets
 * CLAUDE_CODE_AUTO_COMPACT_WINDOW for the owner's Windows checkout. A hosted claude.ai/code session
 * loads the same settings.json but summarizes against a far larger native window, so a healthy
 * summarization that lands anywhere above 0.7 × the desk literal reads as a no-headroom floor hit and
 * the advisory tells the model to write a handoff and leave — in a session with most of its real
 * window still free. That is the mirror image of the 2026-08-07 bug above: not silent coverage but
 * loud non-coverage, and the model obeys it.
 *
 * Two independent signals, either of which makes the window unknowable:
 *   - the harness's own hosted marker (CLAUDE_CODE_REMOTE=true), passed in as `hosted`;
 *   - a measurement in the series ABOVE the configured window, which no window that applied could
 *     have allowed.
 * The answer is then 0 ("unknown"), never a guess at the real window: detectThrash still finds
 * rebounds — the refill-velocity signal needs no window at all — and only the floor test stands down.
 *
 * @param {number} configured the CLAUDE_CODE_AUTO_COMPACT_WINDOW literal in force
 * @param {Array<number>} series the per-turn live-context measurements, oldest first
 * @param {{hosted?: boolean}} [opts] defaults to isHostedSession() so a caller needs no env read
 * @returns {number} the window to judge against, or 0
 */
export function judgeableWindow(configured, series, { hosted = isHostedSession() } = {}) {
  const w = Number.isFinite(Number(configured)) && Number(configured) > 0 ? Number(configured) : 0;
  if (!w || hosted) return 0;
  const peak = (Array.isArray(series) ? series : [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .reduce((a, b) => (b > a ? b : a), 0);
  return peak > w ? 0 : w;
}

/**
 * Keep a bounded per-session series. Bounded on purpose: the thing this module exists to fight is
 * unbounded carried state, and a monitor that grows without limit would be an instance of it.
 *
 * A measurement identical to the previous one is dropped. Live context never repeats to the token
 * between real turns — an exact repeat means the hook was invoked twice against the same last
 * assistant message, and letting that in would stretch a 1-turn rebound into a 2-turn one and hide
 * the very signature this exists to catch.
 *
 * @param {string} raw previously stored series, comma-separated
 * @param {number} next the newest measurement
 * @param {number} cap how many turns to remember
 * @returns {{series: number[], serialized: string}}
 */
export function appendSeries(raw, next, cap = 60) {
  // Blank segments are dropped BEFORE Number(), because Number("") is 0, not NaN — a missing or
  // truncated marker file would otherwise deserialize into a phantom leading 0, i.e. a measurement
  // that never happened, and a phantom 0 is indistinguishable from a real /clear to detectThrash.
  const prev = String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const n = Number(next);
  if (Number.isFinite(n) && n >= 0 && prev[prev.length - 1] !== n) prev.push(n);
  const series = prev.slice(-Math.max(2, cap));
  return { series, serialized: series.join(",") };
}
