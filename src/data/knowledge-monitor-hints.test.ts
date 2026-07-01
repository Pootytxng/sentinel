// Content guard for the monitor model-hint cards (A4 Monitor content lane). When Compy has read the
// attached monitor's real model over EDID (WmiMonitorID, read-only), we can point the owner at the
// EXISTING display knowledge that actually matters for that panel — instead of leaving the detected
// model as a dead string. First family: the Acer XFA253Q / XFA253QZ (24.5" 1080p IPS FreeSync gaming
// monitors, the dev rig's own panel). Everything here is read-only/advisory content: it names the
// panel's traits in plain English and cross-links real Learn entries (set the refresh rate, turn on
// FreeSync/VRR, the FreeSync-vs-blur-reduction trade-off). No mutation, no capability, no fabricated
// FPS claim, no per-SKU number we can't stand behind. Bug->guard: an edit can't drop the entry,
// mis-topic it, break the model matcher, dangle a cross-link, or turn a hint into a "do this for FPS".

import { describe, it, expect } from "vitest";
import { KNOWLEDGE_BY_ID } from "./knowledge";
import { MONITOR_MODEL_HINTS, monitorHintsFor, MONITOR_HINT_ENTRY_IDS } from "./knowledge";
import { searchKnowledge } from "./knowledge-search";
import { TOPIC_BY_ID } from "./knowledge-topics";

const ACER_ID = "monitor-hint-acer-xfa253q";

describe("monitor model-hint cards", () => {
  it("registers the Acer XFA253Q family as a display-topic term entry", () => {
    const e = KNOWLEDGE_BY_ID.get(ACER_ID);
    expect(e, `entry "${ACER_ID}" must exist`).toBeTruthy();
    expect(e!.type).toBe("term");
    expect(e!.topic).toBe("display");
    // Explicitly mapped in the central taxonomy (the lint completeness guard requires this).
    expect(TOPIC_BY_ID[ACER_ID]).toBe("display");
  });

  it("exposes exactly the injected hint ids and every one resolves to a real entry", () => {
    expect(MONITOR_HINT_ENTRY_IDS.length).toBeGreaterThan(0);
    for (const id of MONITOR_HINT_ENTRY_IDS) {
      expect(KNOWLEDGE_BY_ID.has(id), `hint entry "${id}" must be in the corpus`).toBe(true);
      expect(TOPIC_BY_ID[id], `hint entry "${id}" must be mapped in the taxonomy`).toBe("display");
    }
    expect(MONITOR_HINT_ENTRY_IDS).toContain(ACER_ID);
  });

  it("cross-links only real display entries (no dangling related ids)", () => {
    const e = KNOWLEDGE_BY_ID.get(ACER_ID)!;
    // The hints the card points at: refresh rate, VRR/FreeSync, and the FreeSync/blur trade-off.
    expect(e.related).toContain("set-refresh-rate");
    expect(e.related).toContain("vrr");
    expect(e.related).toContain("freesync-vrb-exclusion");
    for (const r of e.related) {
      expect(KNOWLEDGE_BY_ID.has(r), `related "${r}" must resolve`).toBe(true);
    }
  });

  it("matches the whole XFA253Q family from the EDID-decoded model string", () => {
    // The EDID decode on the dev rig reads "Acer XFA253Q Z" (spaced); real-world strings vary in
    // spacing/case/suffix across the family, so the matcher must be tolerant.
    for (const model of ["Acer XFA253Q Z", "XFA253QZ", "Acer XFA253Qz", "  acer   xfa253q  ", "XFA253Q"]) {
      const hit = monitorHintsFor(model);
      expect(hit?.entryId, `"${model}" should match the Acer family`).toBe(ACER_ID);
    }
  });

  it("does not match unrelated monitors", () => {
    for (const model of ["ASUS VG245", "LG 27GP850", "Dell S2721DGF", "", "   ", "Generic PnP Monitor"]) {
      expect(monitorHintsFor(model), `"${model}" must not match`).toBeUndefined();
    }
  });

  it("every hint table row points at an existing, display-topic entry", () => {
    expect(MONITOR_MODEL_HINTS.length).toBeGreaterThan(0);
    for (const h of MONITOR_MODEL_HINTS) {
      const e = KNOWLEDGE_BY_ID.get(h.entryId);
      expect(e, `hint entryId "${h.entryId}" must exist`).toBeTruthy();
      expect(e!.topic).toBe("display");
      expect(h.match.length, `hint "${h.entryId}" needs at least one match token`).toBeGreaterThan(0);
    }
  });

  it("is findable by the model people would search", () => {
    const all = [...KNOWLEDGE_BY_ID.values()];
    expect(searchKnowledge("XFA253Q", all).map((e) => e.id)).toContain(ACER_ID);
    expect(searchKnowledge("acer nitro monitor", all).map((e) => e.id)).toContain(ACER_ID);
  });

  it("stays honest — advisory display copy, no fabricated FPS/gain claim and no per-SKU number promise", () => {
    const e = KNOWLEDGE_BY_ID.get(ACER_ID)!;
    if (e.type !== "term") throw new Error("expected term");
    const body = `${e.what} ${e.more}`.toLowerCase();
    expect(body, "must not promise more FPS").not.toMatch(/more fps|higher fps|boost(?:s)? fps|faster frames/);
    // It should point people at setting the refresh rate + FreeSync, framed as getting the panel's
    // rated capability (not inventing one).
    expect(body).toMatch(/refresh rate|freesync|variable refresh/);
    expect(body).toMatch(/rated|max(?:imum)?|its full|advertised/);
  });
});
