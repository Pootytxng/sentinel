// Content guard for the no-new-cable networking explainers (A4 content lane): powerline
// adapters and MoCA. Asserts both ship as network-topic terms, cross-link each other and the
// existing wired-vs-Wi-Fi debunk, are findable, and stay honest — neither sells a connectivity
// option as an FPS boost (the network never draws frames; the win is ping/stability for online
// play). Bug->guard: pins the pair so an edit can't drop, mis-topic, or over-claim them.

import { describe, it, expect } from "vitest";
import { KNOWLEDGE_BY_ID } from "./knowledge";
import { searchKnowledge } from "./knowledge-search";

const IDS = ["powerline-ethernet", "moca-ethernet"] as const;

describe("powerline / MoCA networking explainers", () => {
  it("both ship as network-topic terms", () => {
    for (const id of IDS) {
      const e = KNOWLEDGE_BY_ID.get(id);
      expect(e, `entry "${id}" must exist`).toBeTruthy();
      expect(e!.type).toBe("term");
      expect(e!.topic).toBe("network");
    }
  });

  it("cross-link each other and the wired-vs-Wi-Fi debunk", () => {
    const pl = KNOWLEDGE_BY_ID.get("powerline-ethernet")!;
    const mo = KNOWLEDGE_BY_ID.get("moca-ethernet")!;
    expect(pl.related).toContain("moca-ethernet");
    expect(mo.related).toContain("powerline-ethernet");
    for (const e of [pl, mo]) expect(e.related).toContain("wifi-vs-ethernet-fps");
  });

  it("are findable by the terms people search", () => {
    const all = [...KNOWLEDGE_BY_ID.values()];
    expect(searchKnowledge("powerline adapter", all).map((e) => e.id)).toContain("powerline-ethernet");
    expect(searchKnowledge("ethernet over coax", all).map((e) => e.id)).toContain("moca-ethernet");
  });

  it("stay honest — they do not promise more FPS, they frame it as ping/connection", () => {
    for (const id of IDS) {
      const e = KNOWLEDGE_BY_ID.get(id)!;
      if (e.type !== "term") throw new Error("expected term");
      const body = `${e.what} ${e.more}`.toLowerCase();
      expect(body, `${id}: must say it does not raise FPS`).toMatch(/won't raise your fps|not raise your fps|won't raise the frame|does not raise your fps/);
      expect(body, `${id}: must frame the real win as ping/latency/stability`).toMatch(/ping|latency|stabil|lag spike/);
    }
  });
});
