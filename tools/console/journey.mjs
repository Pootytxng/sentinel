const TEST_SESSION = [
  /^reply with exactly\b/i,
  /\bconsole ok\b/i,
  /\[fixture\]/i,
  /^what git branch is this folder\b/i,
];

const normalized = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const normalizedPath = (value) => String(value ?? "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
const timestamp = (value) => Number.isFinite(Date.parse(value ?? "")) ? Date.parse(value) : 0;
const fingerprint = (chat) => [chat.agent, chat.project, normalized(chat.title)].join("|");

export function conversationTitle(value) {
  const title = String(value ?? "Untitled conversation").replace(/\s+/g, " ").trim();
  const blocked = /^#(\d+)\s+\("([^"]+)"\)\s+cannot be started\b/i.exec(title);
  if (!blocked) return title;
  return `#${blocked[1]} · ${blocked[2].replace(/^\[[^\]]+\]\s*/, "")}`;
}

export function isTestSession(chat) {
  return TEST_SESSION.some((pattern) => pattern.test(String(chat?.title ?? "")));
}

export function projectHistory(chats = [], { query = "", availableFolders = null } = {}) {
  const ordered = [...chats].sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt));
  const visible = ordered.filter((chat) => !isTestSession(chat));
  const available = Array.isArray(availableFolders) ? new Set(availableFolders.map(normalizedPath)) : null;
  const groups = new Map();
  for (const chat of visible) {
    const presentable = {
      ...chat,
      title: conversationTitle(chat.title),
      resumable: !available || available.has(normalizedPath(chat.folder)),
    };
    const key = fingerprint(presentable);
    const existing = groups.get(key);
    if (existing) existing.relatedCount += 1;
    else groups.set(key, { ...presentable, relatedCount: 1 });
  }
  const needle = normalized(query);
  const items = [...groups.values()].filter((chat) => !needle || [chat.title, chat.project, chat.agent]
    .some((value) => normalized(value).includes(needle)));
  const byProject = new Map();
  for (const item of items) {
    const project = item.project || "Other";
    if (!byProject.has(project)) byProject.set(project, []);
    byProject.get(project).push(item);
  }
  return {
    items,
    groups: [...byProject].map(([project, projectItems]) => ({ project, count: projectItems.length, items: projectItems })),
    hiddenNoiseCount: ordered.length - visible.length,
    hiddenDuplicateCount: visible.length - groups.size,
  };
}

export function continueCandidate(chats = [], options = {}) {
  return projectHistory(chats, options).items.find((chat) => chat.resumable) ?? null;
}
