// What the shortcut offers when it is given no issue number (owner addendum on Issue #18).
//
// The defect this replaces: the selector took "exactly one Ready task" as permission to start it.
// After an editor restart, Kuya's own Active #18 was invisible to it, the only Ready task was an
// unrelated #13, and the launcher silently drove at #13, refused on that worktree, and exited —
// with the real answer, "18", arriving at a prompt that no longer existed.
//
// So: this module never picks. It builds a MENU, marks at most one recommendation, and reads an
// answer. Four rules come straight from the addendum:
//
//   1. a resumable task we own is offered first, above unrelated Ready work;
//   2. no default exists unless exactly one such task does — and even then Enter is a keypress,
//      not an assumption;
//   3. the menu position AND the issue number both work, in the same run;
//   4. every line states its context window in the owner's words, so "150k — standard" and
//      "300k — marathon" can never be mistaken for one another.
//
// Pure: board items in, a menu out, an injected `ask` for the answer. It reads no processes and no
// editor state — a claim lives on the board, so closing a window cannot erase it. It writes nothing
// at all; the caller does that only after a verdict.

import { intendedWindow } from "./settings-resolve.mjs";

/** Only used when a caller wants a selection without labels (tests). The launcher passes the real policy. */
export const FALLBACK_POLICY = { default: 150000, tiers: [] };

const MAX_ATTEMPTS = 5;
const LABEL_WIDTH = 64;

const lc = (s) => String(s ?? "").trim().toLowerCase();

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
 * Resumable means: OUR lane holds it, it is Active, and the claim has not run out. Someone else's
 * Active task is not ours to resume (one folder, one writer) and an expired one needs a verified
 * takeover, which is a human decision — collision rule 5.
 */
export function isResumable(item, { self, now }) {
  return item?.status === "Active" && lc(item?.lane) === lc(self?.lane) && !claimExpired(item, now);
}

const shorten = (title) => {
  const t = String(title ?? "").replace(/^\[[^\]]+\]\s*/, "").trim();
  return t.length > LABEL_WIDTH ? `${t.slice(0, LABEL_WIDTH - 1).trimEnd()}…` : t;
};

/**
 * The menu, in the order the addendum specifies: ours to resume, then anything Ready.
 * @returns {{options: Array, recommended: number|null, question: string, choices: string}}
 */
export function buildMenu(items, { self = { lane: "Claude Code" }, now = new Date(), policy } = {}) {
  if (!policy || typeof policy.default !== "number") {
    throw new Error("buildMenu needs the context policy — a window label may never be invented.");
  }

  const all = items ?? [];
  const mine = all.filter((i) => i?.status === "Active" && lc(i?.lane) === lc(self?.lane));
  const resumable = mine.filter((i) => !claimExpired(i, now));
  const stale = mine.filter((i) => claimExpired(i, now));
  const ready = all.filter((i) => i?.status === "Ready");
  const recommended = resumable.length === 1 ? Number(resumable[0].number) : null;

  const describe = (item, action, note) => {
    const window = intendedWindow(policy, { issue: item.number });
    return {
      number: Number(item.number),
      title: item.title ?? "",
      label: shorten(item.title),
      status: item.status,
      lane: item.lane ?? null,
      gate: item.gate ?? null,
      action,
      resumable: action === "Resume" && !note,
      recommended: Number(item.number) === recommended,
      note: note ?? null,
      window: window.window,
      marathon: window.marathon,
      contextLabel: contextLabel(window.window, { marathon: window.marathon }),
    };
  };

  const options = [
    ...resumable.map((i) => describe(i, "Resume", null)),
    ...stale.map((i) => describe(i, "Resume", "the claim expired — a takeover has to be verified first")),
    ...ready.map((i) => describe(i, "Start", null)),
  ].map((o, idx) => ({ ...o, ordinal: idx + 1 }));

  const choices = [...options.map((o) => o.ordinal), ...options.map((o) => o.number)].join(", ");
  const question = recommended
    ? `Or type ${choices}, or Q to cancel: `
    : `Type ${choices}, or Q to cancel: `;

  return { options, recommended, question, choices };
}

/** The menu exactly as the owner asked to see it. */
export function renderMenu(menu) {
  const lines = ["", "What would you like to do?", ""];
  for (const o of menu.options) {
    lines.push(`  ${o.ordinal}. ${o.action} #${o.number} — ${o.label}${o.recommended ? "  (Recommended)" : ""}`);
    lines.push(`     Context: ${o.contextLabel}`);
    if (o.note) lines.push(`     ${o.note}`);
  }
  lines.push("");
  if (menu.recommended) lines.push(`Press Enter to resume #${menu.recommended}.`);
  return lines.join("\n");
}

/**
 * One answer -> one outcome. Ordinal first, then issue number; both are on screen, so both work.
 * Anything else explains the valid choices instead of guessing at the closest one.
 */
export function resolveChoice(input, menu) {
  const raw = String(input ?? "").trim();
  const invalid = (why) => ({
    kind: "invalid",
    reason: `${why} Choose ${menu.choices}, or Q to cancel.`,
  });

  if (raw === "") {
    if (!menu.recommended) return invalid("There is no recommended task, so Enter selects nothing.");
    const option = menu.options.find((o) => o.number === menu.recommended);
    return { kind: "task", number: menu.recommended, option };
  }
  if (/^q(uit)?$/i.test(raw)) return { kind: "cancel", reason: "cancelled — nothing was written." };

  const digits = raw.replace(/^#/, "");
  if (!/^\d+$/.test(digits)) return invalid(`"${raw}" is not one of the choices.`);

  const n = Number(digits);
  const byOrdinal = menu.options.find((o) => o.ordinal === n);
  const byNumber = menu.options.find((o) => o.number === n);
  const option = byOrdinal ?? byNumber;
  if (!option) return invalid(`#${n} is not on this menu.`);
  return { kind: "task", number: option.number, option };
}

/**
 * Show the menu and keep reading until there is an answer. `ask` is injected so this is testable
 * and so a closed stdin cancels instead of hanging — the failure mode that lost Kuya's "18" was a
 * prompt that had already gone away.
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
