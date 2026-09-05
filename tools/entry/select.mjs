// What the shortcut offers when it is given no issue number.
//
// Work Control now uses dynamic mutation leases: a Ready row is not permanently owned by the model
// named in its historical/coordination Lane field. Only a live Active lease creates mutation
// ownership. The selector therefore receives the current executor identity explicitly; it never
// invents "Claude Code" when the caller did not supply one.
//
// Rules:
//   1. Exactly one valid Active lease held by THIS executor may auto-resume.
//   2. Ready work is offered, never silently started, and stale lane labels do not reserve it.
//   3. Active work held by another executor remains visible/unavailable.
//   4. Folder occupancy and owner gates still refuse before a worktree is offered.
//   5. Menu position and issue number both work without ambiguity.

import { intendedWindow } from "./settings-resolve.mjs";
import { parseWorktreeField, samePath } from "./worktree-field.mjs";

export const FALLBACK_POLICY = { default: 150000, tiers: [] };

export const BLOCKING_GATES = ["Kuya", "Security / System", "Release / Distribution", "External / Account"];

const LISTED_STATUS = ["Active", "Ready", "Needs Kuya", "Blocked"];
const MAX_ATTEMPTS = 5;
const LABEL_WIDTH = 64;

const lc = (s) => String(s ?? "").trim().toLowerCase();
const sameLane = (a, b) => Boolean(lc(a) && lc(b) && lc(a) === lc(b));

export function contextLabel(window, { marathon = false } = {}) {
  return `${Math.round(Number(window) / 1000)}k — ${marathon ? "marathon" : "standard"}`;
}

/** A board date is a day, so a claim lives through the end of that UTC day. */
export function claimExpired(item, now) {
  if (!item?.claimExpires) return true;
  return new Date(`${item.claimExpires}T23:59:59Z`) < now;
}

/** Active work is resumable only by the executor whose current lease is represented on the row. */
export function isResumable(item, { self, now }) {
  return (
    item?.status === "Active" &&
    sameLane(item?.lane, self?.lane) &&
    !claimExpired(item, now) &&
    !BLOCKING_GATES.includes(item?.gate ?? "None")
  );
}

const folderOf = (item, codeRoot) => {
  const parsed = parseWorktreeField(item?.worktreeBranch ?? "", { codeRoot });
  return parsed.ok ? (parsed.entries[0]?.path ?? null) : null;
};

/**
 * Whether one row may be offered to THIS executor.
 *
 * A Ready row's Lane is informational/routing context only; it does not reserve implementation.
 * Active + unexpired is different: that is a live mutation lease, so only its holder may resume.
 */
export function availability(item, { self = { lane: null }, now = new Date(), items = [], codeRoot = null } = {}) {
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
    if (!mine) {
      return {
        available: false,
        action: null,
        reason: `the ${lane ?? "unnamed"} executor currently holds its mutation lease`,
      };
    }
    if (claimExpired(item, now)) {
      const when = item?.claimExpires ? ` (it ran out ${item.claimExpires})` : "";
      return {
        available: false,
        action: null,
        reason: `your mutation lease has expired${when} — inspect and record a verified takeover/renewal before resuming`,
      };
    }
    return { available: true, action: "Resume", reason: null };
  }
  if (item?.status === "Ready") {
    // Ready means there is no current mutation lease for this work. A historical Lane label is not
    // jurisdiction and therefore does not make the row unavailable to another capable executor.
    const target = folderOf(item, codeRoot);
    if (target) {
      const occupant = (items ?? []).find(
        (o) =>
          o &&
          o !== item &&
          o.status === "Active" &&
          Number(o.number) !== Number(item.number) &&
          samePath(folderOf(o, codeRoot) ?? "", target),
      );
      if (occupant) {
        return {
          available: false,
          action: null,
          reason: `#${occupant.number} already has an active mutation lease in ${target} — one folder, one writer`,
        };
      }
    }
    return { available: true, action: "Start", reason: null };
  }
  return { available: false, action: null, reason: `its status is ${item?.status ?? "unknown"}` };
}

const humanList = (xs) =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;

const shorten = (title) => {
  const t = String(title ?? "").replace(/^\[[^\]]+\]\s*/, "").trim();
  return t.length > LABEL_WIDTH ? `${t.slice(0, LABEL_WIDTH - 1).trimEnd()}…` : t;
};

export function buildMenu(items, { self = { lane: null }, now = new Date(), policy, codeRoot = null } = {}) {
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

  const rows = listed.map((i) => describe(i, availability(i, { self, now, items, codeRoot })));
  const resumable = rows.filter((r) => r.action === "Resume");
  const startable = rows.filter((r) => r.action === "Start");
  const unavailable = rows.filter((r) => !r.available);

  const options = [...resumable, ...startable].map((o, idx) => ({ ...o, ordinal: idx + 1 }));
  // Auto-resume is allowed only when the caller supplied an executor identity and exactly one live
  // lease belongs to it. An unidentified caller can never inherit Claude's work by default.
  const autoResume = self?.lane && resumable.length === 1 ? resumable[0].number : null;

  const choices = [...options.map((o) => o.ordinal), ...options.map((o) => o.number)].join(", ");
  const question = options.length
    ? `Type a number from the list (${humanList(options.map((o) => String(o.ordinal)))}) or an issue number (${humanList(options.map((o) => `#${o.number}`))}), or Q to cancel: `
    : "Nothing is available to start. Press Q to close: ";

  return { options, unavailable, autoResume, choices, question };
}

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

export function ambiguousNumbers(menu) {
  return (menu.options ?? [])
    .map((o) => o.ordinal)
    .filter((n) => {
      const byOrd = (menu.options ?? []).find((o) => o.ordinal === n);
      const byNum = (menu.options ?? []).find((o) => o.number === n);
      return Boolean(byOrd && byNum && byOrd.number !== byNum.number);
    });
}

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

  if (hashed) {
    if (byIssue) return { kind: "task", number: byIssue.number, option: byIssue };
  } else {
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

export async function chooseInteractively({ menu, ask, say = () => {}, maxAttempts = MAX_ATTEMPTS }) {
  say(renderMenu(menu));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const answer = await ask(menu.question);
    if (answer === null || answer === undefined) {
      return {
        kind: "cancel",
        reason: "no answer was available (not an interactive terminal) — nothing was written. Re-run with --issue <n>.",
      };
    }
    const resolved = resolveChoice(answer, menu);
    if (resolved.kind === "task" || resolved.kind === "cancel") return resolved;
    say(`  ${resolved.reason}`);
  }
  return { kind: "cancel", reason: `no valid choice after ${maxAttempts} tries — nothing was written.` };
}
