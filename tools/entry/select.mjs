// What the shortcut offers when it is given no issue number (owner addendum on #18, reworked for #23).
//
// The original defect: the selector took "exactly one Ready task" as permission to start it. After an
// editor restart Kuya's own Active #18 was invisible to it, the only Ready task was an unrelated #13,
// and the launcher silently drove at #13, refused on that worktree, and exited — with the real answer,
// "18", arriving at a prompt that no longer existed.
//
// The fix for that was a menu that never picks. #23 keeps the rule and narrows it to what it was
// actually protecting against, because "never picks" had started costing the owner a keypress for a
// decision that was never his to make:
//
//   1. ONE valid task we already own, Active and claimed, RESUMES AUTOMATICALLY. That is not a
//      selection — the choice was made when the claim was posted, and re-asking it is the chore this
//      program deletes. It stays honest because "valid" is checked, not assumed: our lane, Active,
//      claim still live, no blocking gate.
//   2. Anything else asks. In particular an unrelated Ready task is NEVER started without a choice,
//      which is the defect above and is now structural: Ready work is only ever an OPTION.
//   3. Work that cannot be started is still SHOWN, in a separate list, each line saying plainly why —
//      owner-gated, someone else's lane, an expired claim, waiting on Kuya. Typing its number gets
//      that explanation back, not a refusal three stages later.
//   4. The menu position and the issue number both work, and the prompt says so, so nobody has to
//      know an issue number to start work.
//   5. Every line states its context window in the owner's words, so "150k — standard" and
//      "300k — marathon" can never be mistaken for one another.
//
// Pure: board items in, a menu out, an injected `ask` for the answer. It reads no processes and no
// editor state — a claim lives on the board, so closing a window cannot erase it. It writes nothing at
// all; the caller does that only after a verdict.

import { intendedWindow } from "./settings-resolve.mjs";
import { parseWorktreeField, samePath } from "./worktree-field.mjs";

/** Only used when a caller wants a selection without labels (tests). The launcher passes the real policy. */
export const FALLBACK_POLICY = { default: 150000, tiers: [] };

/**
 * Gates whose next step is owner territory. Lives here, not in preflight, because the SELECTOR is the
 * first thing that has to know — an owner-gated task must be unavailable on the menu, not refused
 * after a worktree has been offered. preflight imports from this module, so the constant cannot go
 * the other way without a cycle.
 */
export const BLOCKING_GATES = ["Kuya", "Security / System", "Release / Distribution", "External / Account"];

/** Statuses a person could reasonably expect to start. Anything else (Done, Review) is not listed at all. */
const LISTED_STATUS = ["Active", "Ready", "Needs Kuya", "Blocked"];

const MAX_ATTEMPTS = 5;
const LABEL_WIDTH = 64;

const lc = (s) => String(s ?? "").trim().toLowerCase();
const sameLane = (a, b) => lc(a) === lc(b);

/**
 * "150k — standard" / "300k — marathon". The tier comes from the policy, never from a guess.
 *
 * 300000 is an ACCEPTED tier (Kuya, 2026-07-31, on #19), so the label names it instead of hedging
 * about it. It is still not the default — that is scope, and the policy file carries it.
 */
export function contextLabel(window, { marathon = false } = {}) {
  return `${Math.round(Number(window) / 1000)}k — ${marathon ? "marathon" : "standard"}`;
}

/** A claim is live until the end of its recorded day. Board dates are days, not instants. */
export function claimExpired(item, now) {
  if (!item?.claimExpires) return true;
  return new Date(`${item.claimExpires}T23:59:59Z`) < now;
}

/**
 * Resumable means: OUR lane holds it, it is Active, the claim has not run out, and no gate has moved
 * the next step into owner territory. Someone else's Active task is not ours to resume (one folder,
 * one writer) and an expired one needs a verified takeover, which is a human decision — collision
 * rule 5.
 */
export function isResumable(item, { self, now }) {
  return (
    item?.status === "Active" &&
    sameLane(item?.lane, self?.lane) &&
    !claimExpired(item, now) &&
    !BLOCKING_GATES.includes(item?.gate ?? "None")
  );
}

/**
 * Why a row is or is not startable, in one sentence Kuya can act on.
 *
 * Ownership is checked BEFORE status: an Active task in another lane is that lane's, and a Ready task
 * assigned to another lane is not ours to take either — that second rule is what makes the original
 * defect impossible rather than merely unlikely, because the Ready task the old code drove at was a
 * Codex-lane one. Unassigned Ready work stays open to whoever asks for it.
 */
/**
 * The folder an item would be worked in, or null when its field does not name one.
 *
 * Comparison goes through `samePath`, which canonicalises separators and case — the board is typed by
 * hand, so `C:/Users/...` and `c:\users\...` name the same folder and a string compare would call
 * them different.
 */
const folderOf = (item, codeRoot) => {
  const parsed = parseWorktreeField(item?.worktreeBranch ?? "", { codeRoot });
  return parsed.ok ? (parsed.entries[0]?.path ?? null) : null;
};

export function availability(item, { self = { lane: "Claude Code" }, now = new Date(), items = [], codeRoot = null } = {}) {
  const gate = item?.gate ?? "None";
  const lane = item?.lane ?? null;
  const mine = sameLane(lane, self?.lane);

  if (BLOCKING_GATES.includes(gate)) {
    return { available: false, action: null, reason: `it is gated on ${gate} — the next step is not ours to take` };
  }
  if (item?.status === "Needs Kuya") {
    return { available: false, action: null, reason: "it is waiting on Kuya — only he can move it" };
  }
  if (item?.status === "Blocked") {
    return { available: false, action: null, reason: "it is blocked" };
  }
  if (item?.status === "Active") {
    if (!mine) return { available: false, action: null, reason: `the ${lane ?? "unnamed"} lane is working on it — one folder, one writer` };
    if (claimExpired(item, now)) {
      const when = item?.claimExpires ? ` (it ran out ${item.claimExpires})` : "";
      return { available: false, action: null, reason: `your claim has expired${when} — a takeover has to be verified before it can resume` };
    }
    return { available: true, action: "Resume", reason: null };
  }
  if (item?.status === "Ready") {
    if (lane && !mine) return { available: false, action: null, reason: `it is assigned to the ${lane} lane` };

    // One folder, one writer — and the menu is where that has to be said. preflight catches this
    // too, but only AFTER the folder has been offered and chosen, which is the "refused after a
    // worktree has been offered" shape this selector exists to prevent (see the header). An item
    // whose folder another Active task is already writing in is visible and unavailable, with the
    // reason on screen rather than three steps later.
    const mine2 = folderOf(item, codeRoot);
    if (mine2) {
      const occupant = (items ?? []).find(
        (o) => o && o !== item && o.status === "Active" && Number(o.number) !== Number(item.number) && samePath(folderOf(o, codeRoot) ?? "", mine2),
      );
      if (occupant) {
        return {
          available: false,
          action: null,
          reason: `#${occupant.number} is already working in ${mine2} — one folder, one writer`,
        };
      }
    }
    return { available: true, action: "Start", reason: null };
  }
  return { available: false, action: null, reason: `its status is ${item?.status ?? "unknown"}` };
}

/** "1", "1 or 2", "1, 2 or 3" — the prompt has to read like a sentence, not like an array. */
const humanList = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

const shorten = (title) => {
  const t = String(title ?? "").replace(/^\[[^\]]+\]\s*/, "").trim();
  return t.length > LABEL_WIDTH ? `${t.slice(0, LABEL_WIDTH - 1).trimEnd()}…` : t;
};

/**
 * The menu: what can be started, what cannot and why, and whether the answer is already known.
 *
 * `autoResume` is a number ONLY when exactly one task is ours to resume. Ready work never sets it,
 * however little of it there is, and a second resumable task clears it — two claims we own is
 * precisely the ambiguity a person has to settle.
 *
 * @returns {{options: Array, unavailable: Array, autoResume: number|null, question: string, choices: string}}
 */
export function buildMenu(items, { self = { lane: "Claude Code" }, now = new Date(), policy, codeRoot = null } = {}) {
  if (!policy || typeof policy.default !== "number") {
    throw new Error("buildMenu needs the context policy — a window label may never be invented.");
  }

  const listed = (items ?? []).filter((i) => LISTED_STATUS.includes(i?.status));

  const describe = (item, verdict) => {
    const window = intendedWindow(policy, { issue: item.number });
    return {
      number: Number(item.number),
      title: item.title ?? "",
      label: shorten(item.title),
      status: item.status,
      lane: item.lane ?? null,
      gate: item.gate ?? null,
      available: verdict.available,
      action: verdict.action,
      reason: verdict.reason,
      resumable: verdict.action === "Resume",
      window: window.window,
      marathon: window.marathon,
      contextLabel: contextLabel(window.window, { marathon: window.marathon }),
    };
  };

  // The whole board is passed in, because folder occupancy is a fact ABOUT the set, not about
  // one row: an item is unavailable because of what another Active item is doing.
  const rows = listed.map((i) => describe(i, availability(i, { self, now, items, codeRoot })));
  const resumable = rows.filter((r) => r.action === "Resume");
  const startable = rows.filter((r) => r.action === "Start");
  const unavailable = rows.filter((r) => !r.available);

  // Ours to resume first, then anything open — the order the addendum asked for.
  const options = [...resumable, ...startable].map((o, idx) => ({ ...o, ordinal: idx + 1 }));
  const autoResume = resumable.length === 1 ? resumable[0].number : null;

  const choices = [...options.map((o) => o.ordinal), ...options.map((o) => o.number)].join(", ");
  const question = options.length
    ? `Type a number from the list (${humanList(options.map((o) => String(o.ordinal)))}) or an issue number (${humanList(options.map((o) => `#${o.number}`))}), or Q to cancel: `
    : "Nothing is available to start. Press Q to close: ";

  return { options, unavailable, autoResume, choices, question };
}

/** The menu exactly as the owner asked to see it: what to type, then what cannot be typed and why. */
export function renderMenu(menu) {
  const lines = ["", "Which task would you like to work on?", ""];
  for (const o of menu.options) {
    lines.push(`  ${o.ordinal}.  ${o.action} #${o.number} — ${o.label}`);
    lines.push(`      Context: ${o.contextLabel}`);
  }
  if (menu.options.length === 0) lines.push("  (nothing is available to start)");
  if (menu.unavailable.length > 0) {
    lines.push("", "Not available right now:");
    for (const u of menu.unavailable) lines.push(`  #${u.number} — ${u.label}`, `      ${u.reason}.`);
  }
  lines.push("");
  if (menu.options.length > 0) {
    // "either works" is a promise, so it is only printed when it is true. When a list position also
    // spells an issue number on this same menu, saying it would be the menu lying to the owner about
    // the one thing he has to type.
    const clashes = ambiguousNumbers(menu);
    lines.push(`Type the number on the left (${humanList(menu.options.map((o) => String(o.ordinal)))}) or the issue`);
    if (clashes.length === 0) {
      lines.push(`number (${humanList(menu.options.map((o) => `#${o.number}`))}) — either works. Q cancels; nothing is written.`);
    } else {
      lines.push(`number with a # (${humanList(menu.options.map((o) => `#${o.number}`))}). ${humanList(clashes.map(String))} would mean`);
      lines.push(`both, so ${clashes.length === 1 ? "it needs" : "they need"} the #. Q cancels; nothing is written.`);
    }
  }
  return lines.join("\n");
}

/**
 * Numbers that name a list position AND a different issue on this same menu. Bare, they are
 * genuinely ambiguous; with a `#` they are not.
 */
export function ambiguousNumbers(menu) {
  return (menu.options ?? [])
    .map((o) => o.ordinal)
    .filter((n) => {
      const byOrd = (menu.options ?? []).find((o) => o.ordinal === n);
      const byNum = (menu.options ?? []).find((o) => o.number === n);
      return Boolean(byOrd && byNum && byOrd.number !== byNum.number);
    });
}

/**
 * One answer -> one outcome. List position first, then issue number; both are on screen, so both work.
 *
 * A number belonging to an UNAVAILABLE row gets that row's explanation back rather than a generic
 * "not on this menu" — the point of printing the reason is that typing the number reaches it.
 * Enter selects nothing: the one case where the answer is already known never reaches this function,
 * because the launcher auto-resumes it without a prompt.
 */
export function resolveChoice(input, menu) {
  const raw = String(input ?? "").trim();
  const howToChoose = menu.options.length
    ? `Type ${humanList(menu.options.map((o) => String(o.ordinal)))}, or an issue number (${humanList(menu.options.map((o) => `#${o.number}`))}), or Q to cancel.`
    : "Nothing here is available to start. Press Q to close.";
  const invalid = (why) => ({ kind: "invalid", reason: `${why} ${howToChoose}` });

  if (raw === "") return invalid("Enter does not select anything.");
  if (/^q(uit)?$/i.test(raw)) return { kind: "cancel", reason: "cancelled — nothing was written." };

  const hashed = raw.startsWith("#");
  const digits = raw.replace(/^#/, "");
  if (!/^\d+$/.test(digits)) return invalid(`"${raw}" is not one of the choices.`);

  const n = Number(digits);
  const byOrdinal = menu.options.find((o) => o.ordinal === n);
  const byIssue = menu.options.find((o) => o.number === n);

  // `#N` is always the issue number. That is what the prefix is FOR, and it is the escape hatch out
  // of the collision below -- so it must never be silently reinterpreted as a list position.
  if (hashed) {
    if (byIssue) return { kind: "task", number: byIssue.number, option: byIssue };
  } else {
    // A bare number that names both a list position and a DIFFERENT issue means neither. Resolving
    // ordinal-first silently picked one of two honest readings, which is exactly how "18" selected
    // something else and the menu still claimed both spellings work.
    if (byOrdinal && byIssue && byOrdinal.number !== byIssue.number) {
      return invalid(
        `"${n}" means two things on this menu: list position ${n} is #${byOrdinal.number}, and #${n} is its own task. ` +
          `Type #${n} for the issue, or a list position that is not also an issue number.`,
      );
    }
    const option = byOrdinal ?? byIssue;
    if (option) return { kind: "task", number: option.number, option };
  }

  const blocked = menu.unavailable.find((u) => u.number === n);
  if (blocked) return invalid(`#${n} cannot be started: ${blocked.reason}.`);
  return invalid(`#${n} is not on this menu.`);
}

/**
 * Show the menu and keep reading until there is an answer. `ask` is injected so this is testable and
 * so a closed stdin cancels instead of hanging — the failure mode that lost Kuya's "18" was a prompt
 * that had already gone away.
 */
export async function chooseInteractively({ menu, ask, say = () => {}, maxAttempts = MAX_ATTEMPTS }) {
  say(renderMenu(menu));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const answer = await ask(menu.question);
    if (answer === null || answer === undefined) {
      return { kind: "cancel", reason: "no answer was available (not an interactive terminal) — nothing was written. Re-run with --issue <n>." };
    }
    const resolved = resolveChoice(answer, menu);
    if (resolved.kind === "task" || resolved.kind === "cancel") return resolved;
    say(`  ${resolved.reason}`);
  }
  return { kind: "cancel", reason: `no valid choice after ${maxAttempts} tries — nothing was written.` };
}
