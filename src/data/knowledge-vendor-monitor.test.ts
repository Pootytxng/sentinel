// Content guard for the vendor-aware monitor-tuning explainer (A4 Monitor content lane). The generic
// VRR/HDR/refresh walkthroughs already exist, but people don't know the BRAND names for the same
// feature: AMD calls variable refresh "FreeSync", NVIDIA "G-SYNC", and each enables it in a different
// app (Adrenalin vs NVIDIA App/Control Panel). This code-injected display-topic `term` names the
// per-brand path for the three things that actually matter on a monitor — variable refresh, HDR, and
// the refresh rate — so a reader on any rig finds the setting Compy can point them at. Read-only /
// advisory content: nothing here reads or writes a Windows setting, adds a capability, or claims an
// unmeasured/per-SKU FPS number. Bug->guard: an edit can't drop the entry, mis-topic it, dangle a
// cross-link, forget a vendor, or turn the honest guidance into a fabricated "do this for more FPS".

import { describe, it, expect } from "vitest";
import { KNOWLEDGE_BY_ID } from "./knowledge";
import { searchKnowledge } from "./knowledge-search";
import { TOPIC_BY_ID } from "./knowledge-topics";

const ID = "vendor-monitor-tuning";

describe("vendor-aware monitor-tuning explainer", () => {
  it("ships as a display-topic term, explicitly mapped in the taxonomy", () => {
    const e = KNOWLEDGE_BY_ID.get(ID);
    expect(e, `entry "${ID}" must exist`).toBeTruthy();
    expect(e!.type).toBe("term");
    expect(e!.topic).toBe("display");
    // The lint completeness guard requires an EXPLICIT taxonomy mapping (no silent default).
    expect(TOPIC_BY_ID[ID]).toBe("display");
  });

  it("names all three GPU vendors' brand terms for variable refresh", () => {
    const e = KNOWLEDGE_BY_ID.get(ID)!;
    if (e.type !== "term") throw new Error("expected term");
    const body = `${e.what} ${e.more}`.toLowerCase();
    // AMD = FreeSync, NVIDIA = G-SYNC, Intel exists (Arc). All three must be named so no rig is stranded.
    expect(body, "must name AMD FreeSync").toContain("freesync");
    expect(body, "must name NVIDIA G-SYNC").toMatch(/g-?sync/);
    expect(body, "must name Intel").toContain("intel");
  });

  it("covers all three monitor levers: variable refresh, HDR, and the refresh rate", () => {
    const e = KNOWLEDGE_BY_ID.get(ID)!;
    if (e.type !== "term") throw new Error("expected term");
    const body = `${e.what} ${e.more}`.toLowerCase();
    expect(body, "must cover variable refresh").toMatch(/variable refresh|freesync|g-?sync/);
    expect(body, "must cover HDR").toContain("hdr");
    expect(body, "must cover the refresh rate").toContain("refresh rate");
  });

  it("cross-links the real display entries it builds on (no dangling related ids)", () => {
    const e = KNOWLEDGE_BY_ID.get(ID)!;
    expect(e.related).toContain("vrr");
    expect(e.related).toContain("set-refresh-rate");
    for (const r of e.related) {
      expect(KNOWLEDGE_BY_ID.has(r), `related "${r}" must resolve`).toBe(true);
    }
    // No self-reference (also enforced by the lint, pinned here for this entry).
    expect(e.related).not.toContain(ID);
  });

  it("is findable by the brand names people search", () => {
    const all = [...KNOWLEDGE_BY_ID.values()];
    expect(searchKnowledge("freesync g-sync", all).map((e) => e.id)).toContain(ID);
    expect(searchKnowledge("nvidia monitor settings", all).map((e) => e.id)).toContain(ID);
  });

  it("stays honest — advisory display copy, no fabricated FPS/gain claim, read-only framing", () => {
    const e = KNOWLEDGE_BY_ID.get(ID)!;
    if (e.type !== "term") throw new Error("expected term");
    const body = `${e.what} ${e.more}`.toLowerCase();
    expect(body, "must not promise more FPS").not.toMatch(/more fps|higher fps|boost(?:s)? fps|faster frames/);
    // It should frame these as getting the panel's rated capability, and make clear Compy doesn't flip
    // the setting for you (advisory / read-only).
    expect(body).toMatch(/rated|advertised|max(?:imum)?|full/);
  });
});
