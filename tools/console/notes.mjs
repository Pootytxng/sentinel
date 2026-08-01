// The ONE thing the console remembers — and you typed all of it.
//
// Everywhere else the rule is absolute: the console owns no state, because a value it stores is a
// value that can disagree with reality (#39). This file is the single, deliberate exception, and it
// is safe for a specific reason: NOTHING IS DERIVED FROM IT. It holds two append-only lists that
// only the owner writes — loose ideas, and links back to conversations worth finding again. A store
// that nothing computes against cannot drift; it can only be out of date in the way a notebook is.
//
// So the exception comes with rules that keep it one:
//   - no field here is ever read to decide anything (startability, health, verdicts);
//   - the console never writes to it on the owner's behalf — no auto-filing, no inference;
//   - a corrupt or missing file degrades to an empty list, never to a crash or a silent overwrite.
//
// Kept outside the repository on purpose: personal notes are not project history, and they must not
// turn a worktree dirty or ride along in a diff.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

export const NOTES_DIR = join(homedir(), ".compy-console");
export const NOTES_FILE = join(NOTES_DIR, "notes.json");

/**
 * Frozen, and never handed out directly.
 *
 * bug->guard (caught by notes.test.mjs before this shipped): `readNotes` used to return
 * `{ ...EMPTY }`, which is a SHALLOW copy — the returned object carried references to the very same
 * `ideas` and `links` arrays. `addIdea` then did `notes.ideas.unshift(...)` and permanently mutated
 * the module constant, so every later read of a missing or corrupt file returned ideas that were
 * not in the file, and the next write persisted them. That is precisely the "the store disagrees
 * with reality" failure this whole console is built to make impossible.
 *
 * Two changes, because one would have been a fix and not a guard: `empty()` mints fresh arrays on
 * every call, and EMPTY is deep-frozen so any future code that reaches for it and mutates throws
 * loudly instead of quietly poisoning the process.
 */
export const EMPTY = Object.freeze({ ideas: Object.freeze([]), links: Object.freeze([]) });

const empty = () => ({ ideas: [], links: [] });

/** Providers whose conversations are worth linking back to. Anything else is refused, not stored. */
export const PROVIDERS = {
  chatgpt: { label: "ChatGPT", hosts: ["chatgpt.com", "chat.openai.com"], home: "https://chatgpt.com/" },
  claude: { label: "Claude", hosts: ["claude.ai"], home: "https://claude.ai/" },
};

export function providerOf(url) {
  let host;
  try { host = new URL(String(url)).hostname.toLowerCase(); } catch { return null; }
  for (const [key, p] of Object.entries(PROVIDERS)) {
    if (p.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return key;
  }
  return null;
}

/** A malformed file is treated as empty rather than thrown — notes must never block the console. */
export function readNotes({ file = NOTES_FILE } = {}) {
  try {
    if (!existsSync(file)) return empty();
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return {
      ideas: Array.isArray(parsed?.ideas) ? parsed.ideas : [],
      links: Array.isArray(parsed?.links) ? parsed.links : [],
    };
  } catch {
    return empty();
  }
}

/**
 * Atomic write: a torn file would lose ideas the owner typed, and losing his notes to a crashed
 * write is precisely the "runaway tool" failure he was worried about. Write beside, then rename.
 */
export function writeNotes(notes, { file = NOTES_FILE } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(notes, null, 2), "utf8");
  renameSync(tmp, file);
  return notes;
}

const stamp = (now) => (now instanceof Date ? now : new Date()).toISOString();

export function addIdea({ text, folder = null, file = NOTES_FILE, now = new Date(), id = null } = {}) {
  const body = String(text ?? "").trim();
  if (!body) return { ok: false, reason: "An empty idea is not an idea." };
  if (body.length > 4000) return { ok: false, reason: "That is longer than a note — make it a train instead." };
  const notes = readNotes({ file });
  const idea = { id: id ?? randomUUID(), text: body, folder: folder || null, created: stamp(now) };
  notes.ideas.unshift(idea);
  writeNotes(notes, { file });
  return { ok: true, idea, notes };
}

export function addLink({ title, url, tag = null, file = NOTES_FILE, now = new Date(), id = null } = {}) {
  const provider = providerOf(url);
  if (!provider) {
    return { ok: false, reason: "Only ChatGPT and Claude conversation links are stored here." };
  }
  const notes = readNotes({ file });
  const link = {
    id: id ?? randomUUID(),
    title: String(title ?? "").trim() || PROVIDERS[provider].label + " conversation",
    url: String(url).trim(),
    provider,
    tag: tag ? String(tag).trim() : null,
    created: stamp(now),
  };
  notes.links.unshift(link);
  writeNotes(notes, { file });
  return { ok: true, link, notes };
}

export function remove({ kind, id, file = NOTES_FILE } = {}) {
  if (kind !== "ideas" && kind !== "links") return { ok: false, reason: `unknown list "${kind}"` };
  const notes = readNotes({ file });
  const before = notes[kind].length;
  notes[kind] = notes[kind].filter((x) => x.id !== id);
  if (notes[kind].length === before) return { ok: false, reason: "nothing with that id" };
  writeNotes(notes, { file });
  return { ok: true, notes };
}
