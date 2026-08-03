// Read-only views over the session stores the installed CLIs already own.
//
// Compy Console deliberately keeps no transcript database. Claude Code and Codex both persist
// JSONL sessions themselves; this module only discovers eligible records and projects their
// readable user/assistant messages into the Console.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, win32 } from "node:path";

const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_MAX_FILE_BYTES = 32 * 1024 * 1024;
const DEFAULT_LIMIT = 24;
const DEFAULT_CANDIDATE_LIMIT = 160;
const DEFAULT_MESSAGE_LIMIT = 240;

const safeEntries = (dir) => {
  try { return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []; }
  catch { return []; }
};

const safeStat = (path) => {
  try { return statSync(path); }
  catch { return null; }
};

function directClaudeFiles(root) {
  const files = [];
  for (const project of safeEntries(root)) {
    if (!project.isDirectory()) continue;
    const projectDir = join(root, project.name);
    for (const entry of safeEntries(projectDir)) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(join(projectDir, entry.name));
    }
  }
  return files;
}

function codexFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const dir = pending.pop();
    for (const entry of safeEntries(dir)) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) files.push(path);
    }
  }
  return files;
}

function ranked(files, limit) {
  return files
    .map((path) => ({ path, stat: safeStat(path) }))
    .filter(({ stat }) => stat?.isFile())
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, limit);
}

function withinRoot(folder, root) {
  if (!folder || !root) return false;
  const relative = win32.relative(win32.resolve(root), win32.resolve(folder));
  return relative === "" || (!relative.startsWith("..") && !win32.isAbsolute(relative));
}

function lines(path, maxFileBytes) {
  const stat = safeStat(path);
  if (!stat || stat.size <= 0 || stat.size > maxFileBytes) return null;
  try { return readFileSync(path, "utf8").split(/\r?\n/); }
  catch { return null; }
}

const parsed = (line) => {
  try { return JSON.parse(line); }
  catch { return null; }
};

function blockText(content, accepted) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && accepted.has(part.type) && typeof part.text === "string")
    .map((part) => part.text)
    .join("")
    .trim();
}

function pushMessage(messages, message) {
  if (!message.text) return;
  const previous = messages.at(-1);
  if (previous?.role === message.role && previous.text === message.text && previous.timestamp === message.timestamp) return;
  messages.push(message);
}

function parseClaude(path, maxFileBytes, messageLimit) {
  const records = lines(path, maxFileBytes);
  if (!records) return null;
  const fallbackId = basename(path, ".jsonl");
  let id = THREAD_ID.test(fallbackId) ? fallbackId : null;
  let folder = null;
  let updatedAt = null;
  const messages = [];
  for (const line of records) {
    const record = parsed(line);
    if (!record || record.isSidechain === true || record.isCompactSummary === true || !["user", "assistant"].includes(record.type)) continue;
    id ||= THREAD_ID.test(record.sessionId ?? "") ? record.sessionId : null;
    folder ||= typeof record.cwd === "string" ? record.cwd : null;
    const role = record.message?.role;
    if (!["user", "assistant"].includes(role)) continue;
    const text = blockText(record.message?.content, new Set(["text"]));
    if (!text) continue;
    const timestamp = typeof record.timestamp === "string" ? record.timestamp : null;
    pushMessage(messages, { role, text, timestamp });
    if (timestamp && (!updatedAt || timestamp > updatedAt)) updatedAt = timestamp;
  }
  if (!id || !folder || !messages.length) return null;
  const totalMessages = messages.length;
  return {
    id, agent: "claude", folder, updatedAt,
    titleText: messages.find((message) => message.role === "user")?.text,
    totalMessages,
    truncated: totalMessages > messageLimit,
    messages: messages.slice(-messageLimit),
  };
}

function parseCodex(path, maxFileBytes, messageLimit) {
  const records = lines(path, maxFileBytes);
  if (!records) return null;
  let id = null;
  let folder = null;
  let isExecSession = false;
  let updatedAt = null;
  const messages = [];
  for (const line of records) {
    const record = parsed(line);
    if (!record) continue;
    if (record.type === "session_meta") {
      const meta = record.payload ?? {};
      const candidate = meta.id ?? meta.session_id;
      id = THREAD_ID.test(candidate ?? "") ? candidate : id;
      folder = typeof meta.cwd === "string" ? meta.cwd : folder;
      isExecSession = meta.originator === "codex_exec" || meta.source === "exec";
      continue;
    }
    if (record.type !== "event_msg") continue;
    const eventType = record.payload?.type;
    const role = eventType === "user_message"
      ? "user"
      : eventType === "agent_message" && record.payload?.phase === "final_answer"
        ? "assistant"
        : null;
    if (!role) continue;
    const text = typeof record.payload?.message === "string" ? record.payload.message.trim() : "";
    if (!text) continue;
    const timestamp = typeof record.timestamp === "string" ? record.timestamp : null;
    pushMessage(messages, { role, text, timestamp });
    if (timestamp && (!updatedAt || timestamp > updatedAt)) updatedAt = timestamp;
  }
  if (!isExecSession || !id || !folder || !messages.length) return null;
  const totalMessages = messages.length;
  return {
    id, agent: "codex", folder, updatedAt,
    titleText: messages.find((message) => message.role === "user")?.text,
    totalMessages,
    truncated: totalMessages > messageLimit,
    messages: messages.slice(-messageLimit),
  };
}

const titleOf = (chat) => {
  const firstUser = chat.titleText ?? chat.messages.find((message) => message.role === "user")?.text ?? "Untitled conversation";
  const oneLine = firstUser.replace(/\s+/g, " ").trim();
  return oneLine.length > 96 ? `${oneLine.slice(0, 95)}…` : oneLine;
};

const publicChat = (chat, { includeMessages = false } = {}) => ({
  id: chat.id,
  agent: chat.agent,
  folder: chat.folder,
  project: win32.basename(chat.folder),
  title: titleOf(chat),
  updatedAt: chat.updatedAt,
  messageCount: chat.totalMessages ?? chat.messages.length,
  truncated: Boolean(chat.truncated),
  ...(includeMessages ? { shownMessageCount: chat.messages.length, messages: chat.messages } : {}),
});

export function createNativeChatStore({
  claudeProjectsDir = join(homedir(), ".claude", "projects"),
  codexSessionsDir = join(homedir(), ".codex", "sessions"),
  codeRoot,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  limit = DEFAULT_LIMIT,
  candidateLimit = DEFAULT_CANDIDATE_LIMIT,
  messageLimit = DEFAULT_MESSAGE_LIMIT,
} = {}) {
  const cache = new Map();
  const candidates = () => [
    ...ranked(directClaudeFiles(claudeProjectsDir), candidateLimit).map((entry) => ({ ...entry, agent: "claude" })),
    ...ranked(codexFiles(codexSessionsDir), candidateLimit).map((entry) => ({ ...entry, agent: "codex" })),
  ].sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  const read = (candidate) => {
    const version = `${candidate.stat.size}:${candidate.stat.mtimeMs}`;
    const cached = cache.get(candidate.path);
    if (cached?.version === version) return cached.chat;
    const chat = candidate.agent === "claude"
      ? parseClaude(candidate.path, maxFileBytes, messageLimit)
      : parseCodex(candidate.path, maxFileBytes, messageLimit);
    const scoped = chat && withinRoot(chat.folder, codeRoot) ? chat : null;
    cache.set(candidate.path, { version, chat: scoped });
    return scoped;
  };

  return {
    list() {
      const chats = [];
      const sampleSize = Math.max(limit * 2, limit);
      for (const candidate of candidates()) {
        const chat = read(candidate);
        if (chat) chats.push(chat);
        if (chats.length >= sampleSize) break;
      }
      return chats
        .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
        .slice(0, limit)
        .map((chat) => publicChat(chat));
    },
    get(agent, id) {
      if (!["claude", "codex"].includes(agent) || !THREAD_ID.test(id ?? "")) return null;
      const candidate = candidates().find((entry) => entry.agent === agent && basename(entry.path).includes(id));
      const chat = candidate ? read(candidate) : null;
      return chat?.id === id ? publicChat(chat, { includeMessages: true }) : null;
    },
  };
}
