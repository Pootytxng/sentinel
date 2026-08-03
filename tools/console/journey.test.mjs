import { describe, expect, it } from "vitest";

const chat = (overrides = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  agent: "claude",
  folder: "C:\\Users\\Kuya\\code\\sentinel",
  project: "sentinel",
  title: "Review the current Compy work",
  updatedAt: "2026-08-02T06:00:00.000Z",
  messageCount: 12,
  ...overrides,
});

async function subject() {
  const loaded = await import("./journey.mjs").catch(() => null);
  expect(loaded, "the owner-journey projection must exist").not.toBeNull();
  return loaded;
}

describe("History shows useful conversations instead of native-store noise", () => {
  it("suppresses test sessions and collapses repeated conversations without deleting either", async () => {
    const { projectHistory } = await subject();
    const result = projectHistory([
      chat(),
      chat({ id: "22222222-2222-4222-8222-222222222222", updatedAt: "2026-08-02T05:00:00.000Z", messageCount: 4 }),
      chat({ id: "33333333-3333-4333-8333-333333333333", title: "Reply with exactly the two words: CONSOLE OK. Nothing else, no tools." }),
    ]);

    expect(result.items.map((item) => item.id)).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(result.items[0].relatedCount).toBe(2);
    expect(result.hiddenNoiseCount).toBe(1);
    expect(result.hiddenDuplicateCount).toBe(1);
  });

  it("searches plain-language titles and projects, then groups the matches by project", async () => {
    const { projectHistory } = await subject();
    const result = projectHistory([
      chat({ title: "Review the LabDeck pilot" }),
      chat({ id: "22222222-2222-4222-8222-222222222222", project: "holoforge", folder: "C:\\Users\\Kuya\\code\\holoforge", title: "Prepare the HoloForge release" }),
      chat({ id: "33333333-3333-4333-8333-333333333333", project: "sentinel-feedback", folder: "C:\\Users\\Kuya\\code\\sentinel-feedback", title: "Continue the feedback recovery" }),
    ], { query: "feedback" });

    expect(result.groups).toEqual([
      expect.objectContaining({ project: "sentinel-feedback", count: 1 }),
    ]);
    expect(result.items.map((item) => item.title)).toEqual(["Continue the feedback recovery"]);
  });

  it("chooses the newest useful conversation for Continue", async () => {
    const { continueCandidate } = await subject();
    const result = continueCandidate([
      chat({ id: "11111111-1111-4111-8111-111111111111", updatedAt: "2026-08-02T05:00:00.000Z" }),
      chat({ id: "22222222-2222-4222-8222-222222222222", updatedAt: "2026-08-02T07:00:00.000Z", title: "Continue the Console redesign" }),
      chat({ id: "33333333-3333-4333-8333-333333333333", updatedAt: "2026-08-02T08:00:00.000Z", title: "Reply with exactly the two words: CONSOLE OK." }),
    ]);

    expect(result?.id).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("turns launcher refusal prompts into an owner-readable conversation title", async () => {
    const { projectHistory } = await subject();
    const [result] = projectHistory([
      chat({ title: '#14 ("[REVIEW] Decide the user-feedback LabDeck recovery candidate") cannot be started: "it is gated"' }),
    ]).items;

    expect(result.title).toBe("#14 · Decide the user-feedback LabDeck recovery candidate");
  });

  it("marks chats whose original folder is gone as readable but not resumable", async () => {
    const { projectHistory } = await subject();
    const result = projectHistory([
      chat(),
      chat({ id: "22222222-2222-4222-8222-222222222222", project: "sentinel-marathon", folder: "C:\\Users\\Kuya\\code\\sentinel-marathon", title: "Finished marathon" }),
    ], { availableFolders: ["C:\\Users\\Kuya\\code\\sentinel"] });

    expect(result.items.map((item) => [item.project, item.resumable])).toEqual([
      ["sentinel", true],
      ["sentinel-marathon", false],
    ]);
  });

  it("does not offer an unavailable-folder transcript as the primary Continue action", async () => {
    const { continueCandidate } = await subject();
    const result = continueCandidate([
      chat({ id: "11111111-1111-4111-8111-111111111111", updatedAt: "2026-08-02T05:00:00.000Z" }),
      chat({ id: "22222222-2222-4222-8222-222222222222", project: "sentinel-marathon", folder: "C:\\Users\\Kuya\\code\\sentinel-marathon", updatedAt: "2026-08-02T07:00:00.000Z" }),
    ], { availableFolders: ["C:\\Users\\Kuya\\code\\sentinel"] });

    expect(result?.id).toBe("11111111-1111-4111-8111-111111111111");
  });
});
