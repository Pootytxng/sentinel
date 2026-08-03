import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function subject() {
  const loaded = await import("./chats.mjs").catch(() => null);
  expect(loaded, "tools/console/chats.mjs must expose the native-session reader").not.toBeNull();
  return loaded;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "compy-console-chats-"));
  roots.push(root);
  const claudeProjectsDir = join(root, "claude-projects");
  const codexSessionsDir = join(root, "codex-sessions");
  const claudeProject = join(claudeProjectsDir, "C--Users-Kuya-code-sentinel");
  const codexDay = join(codexSessionsDir, "2026", "08", "01");
  mkdirSync(claudeProject, { recursive: true });
  mkdirSync(codexDay, { recursive: true });

  const claudeId = "2594b1c6-c069-4949-8c79-bddea3f7832c";
  const claudePath = join(claudeProject, `${claudeId}.jsonl`);
  writeFileSync(claudePath, [
    "this malformed line is tolerated",
    JSON.stringify({
      type: "user", timestamp: "2026-08-01T19:54:06.366Z", sessionId: claudeId,
      cwd: "C:\\Users\\Kuya\\code\\sentinel",
      message: { role: "user", content: "Catch me up on sentinel without guessing." },
    }),
    JSON.stringify({
      type: "user", timestamp: "2026-08-01T19:54:30.000Z", sessionId: claudeId,
      cwd: "C:\\Users\\Kuya\\code\\sentinel", isCompactSummary: true,
      message: { role: "user", content: "This session is being continued from a hidden summary." },
    }),
    JSON.stringify({
      type: "assistant", timestamp: "2026-08-01T19:55:16.545Z", sessionId: claudeId,
      cwd: "C:\\Users\\Kuya\\code\\sentinel",
      message: { role: "assistant", content: [{ type: "text", text: "Main is clean and the loose work is isolated." }] },
    }),
  ].join("\n"));

  const outOfScopeId = "11111111-1111-4111-8111-111111111111";
  writeFileSync(join(claudeProject, `${outOfScopeId}.jsonl`), JSON.stringify({
    type: "user", timestamp: "2026-08-01T20:00:00.000Z", sessionId: outOfScopeId,
    cwd: "C:\\Private", message: { role: "user", content: "Do not expose this." },
  }));

  const subagents = join(claudeProject, claudeId, "subagents");
  mkdirSync(subagents, { recursive: true });
  writeFileSync(join(subagents, "agent-aaaaaaaaaaaaaaaaa.jsonl"), JSON.stringify({
    type: "user", timestamp: "2026-08-01T20:01:00.000Z", sessionId: "22222222-2222-4222-8222-222222222222",
    cwd: "C:\\Users\\Kuya\\code\\sentinel", message: { role: "user", content: "Worker chatter." },
  }));

  const codexId = "019fbd23-799c-7e82-9898-b845f434b304";
  writeFileSync(join(codexDay, `rollout-2026-08-01T04-44-06-${codexId}.jsonl`), [
    JSON.stringify({
      timestamp: "2026-08-01T19:40:00.000Z", type: "session_meta",
      payload: { id: codexId, cwd: "C:\\Users\\Kuya\\code\\sentinel", originator: "codex_exec" },
    }),
    JSON.stringify({
      timestamp: "2026-08-01T19:40:01.000Z", type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<recommended_plugins>Hidden setup context</recommended_plugins>" }] },
    }),
    JSON.stringify({
      timestamp: "2026-08-01T19:40:02.000Z", type: "event_msg",
      payload: { type: "user_message", message: "Check the Console." },
    }),
    JSON.stringify({
      timestamp: "2026-08-01T19:40:03.000Z", type: "event_msg",
      payload: { type: "agent_message", phase: "final_answer", message: "Console OK." },
    }),
  ].join("\n"));

  return { root, claudeProjectsDir, codexSessionsDir, claudePath, claudeId, codexId };
}

describe("native CLI chats remain discoverable after the page forgets them", () => {
  it("lists owner conversations from both native stores and excludes workers or other folders", async () => {
    const { createNativeChatStore } = await subject();
    const f = fixture();
    const store = createNativeChatStore({
      claudeProjectsDir: f.claudeProjectsDir,
      codexSessionsDir: f.codexSessionsDir,
      codeRoot: "C:\\Users\\Kuya\\code",
    });

    const chats = store.list();

    expect(chats.map(({ agent, id }) => `${agent}:${id}`)).toEqual([
      `claude:${f.claudeId}`,
      `codex:${f.codexId}`,
    ]);
    expect(chats[0]).toMatchObject({
      title: "Catch me up on sentinel without guessing.",
      folder: "C:\\Users\\Kuya\\code\\sentinel",
      messageCount: 2,
    });
  });

  it("restores the exact readable transcript and native resume id", async () => {
    const { createNativeChatStore } = await subject();
    const f = fixture();
    const store = createNativeChatStore({
      claudeProjectsDir: f.claudeProjectsDir,
      codexSessionsDir: f.codexSessionsDir,
      codeRoot: "C:\\Users\\Kuya\\code",
    });

    expect(store.get("claude", f.claudeId)).toMatchObject({
      id: f.claudeId,
      agent: "claude",
      folder: "C:\\Users\\Kuya\\code\\sentinel",
      messages: [
        { role: "user", text: "Catch me up on sentinel without guessing." },
        { role: "assistant", text: "Main is clean and the loose work is isolated." },
      ],
    });
    expect(store.get("codex", f.codexId)?.messages).toEqual([
      { role: "user", text: "Check the Console.", timestamp: "2026-08-01T19:40:02.000Z" },
      { role: "assistant", text: "Console OK.", timestamp: "2026-08-01T19:40:03.000Z" },
    ]);
  });

  it("fails closed for malformed ids and files beyond the read budget", async () => {
    const { createNativeChatStore } = await subject();
    const f = fixture();
    const store = createNativeChatStore({
      claudeProjectsDir: f.claudeProjectsDir,
      codexSessionsDir: f.codexSessionsDir,
      codeRoot: "C:\\Users\\Kuya\\code",
      maxFileBytes: 32,
    });

    expect(store.list()).toEqual([]);
    expect(store.get("claude", "..\\credentials.json")).toBeNull();
    expect(store.get("other", f.claudeId)).toBeNull();
  });

  it("labels a bounded long transcript honestly without losing its original title", async () => {
    const { createNativeChatStore } = await subject();
    const f = fixture();
    const records = Array.from({ length: 241 }, (_, index) => JSON.stringify({
      type: index === 0 ? "user" : "assistant",
      timestamp: `2026-08-01T19:${String(index % 60).padStart(2, "0")}:00.000Z`,
      sessionId: f.claudeId,
      cwd: "C:\\Users\\Kuya\\code\\sentinel",
      message: index === 0
        ? { role: "user", content: "The original request." }
        : { role: "assistant", content: `Answer part ${index}.` },
    }));
    writeFileSync(f.claudePath, records.join("\n"));
    const store = createNativeChatStore({
      claudeProjectsDir: f.claudeProjectsDir,
      codexSessionsDir: f.codexSessionsDir,
      codeRoot: "C:\\Users\\Kuya\\code",
    });

    const chat = store.get("claude", f.claudeId);
    expect(chat).toMatchObject({
      title: "The original request.",
      messageCount: 241,
      shownMessageCount: 240,
      truncated: true,
    });
    expect(chat.messages[0].text).toBe("Answer part 1.");
  });
});
