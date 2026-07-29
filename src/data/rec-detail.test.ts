import { describe, expect, it } from "vitest";
import type { PriorityItem, Recommendation } from "../types";
import {
  actionable,
  describePriority,
  describeRec,
  recIdsForPriority,
  recsForPriority,
} from "./rec-detail";

// bug → guard: the tester saw "1 safe tweak not applied" and a chip promising steps that never
// appeared (recovery train items 2/4/5). These lock the identity + action rules that fix it.

const APPLIABLE = new Set(["hags-enable", "game-mode", "power-ultimate"]);
const isAppliable = (id: string) => APPLIABLE.has(id);

function rec(over: Partial<Recommendation> = {}): Recommendation {
  return {
    id: "hags-enable",
    title: "Enable Hardware-accelerated GPU Scheduling",
    category: "GPU",
    severity: "safe",
    description: "Lets the GPU manage its own memory and command queue directly.",
    impact: "Lower input latency",
    downside: "Reboot required.",
    applies_to: "Currently: Off",
    currently_applied: false,
    provenance: "expected-impact",
    ...over,
  };
}

function lim(over: Partial<PriorityItem> = {}): PriorityItem {
  return {
    id: "pending-safe-recs",
    title: "2 safe tweaks not applied",
    reason: "Compy has safe, reversible tweaks you haven't applied.",
    linked: null,
    rec_ids: [],
    confidence: "medium",
    status: "attention",
    ...over,
  };
}

describe("describeRec", () => {
  it("offers a real apply only when the backend can actually dispatch it", () => {
    expect(describeRec(rec(), isAppliable).action).toBe("apply");
    // Advisory-only rec: the backend's APPLIABLE_REC_IDS does not carry it, so "Apply" would throw.
    expect(describeRec(rec({ id: "xmp-enable" }), isAppliable).action).toBe("manual");
  });

  it("reports an already-applied rec as done, not as a fresh action", () => {
    const d = describeRec(rec({ currently_applied: true }), isAppliable);
    expect(d.action).toBe("applied");
    expect(d.applied).toBe(true);
  });

  it("keeps an ineligible rec out of the action grammar and names the reason", () => {
    const d = describeRec(
      rec({ eligible: false, ineligible_reason: "No NVIDIA GPU detected" }),
      isAppliable,
    );
    expect(d.action).toBe("ineligible");
    expect(d.ineligibleReason).toBe("No NVIDIA GPU detected");
    expect(actionable([d])).toHaveLength(0);
  });

  it("only claims reversibility where Compy itself is the one changing something", () => {
    expect(describeRec(rec(), isAppliable).reversible).toBe(true);
    // Hands-on change: Compy captured no rollback contract, so it must not promise an undo.
    expect(describeRec(rec({ id: "xmp-enable" }), isAppliable).reversible).toBe(false);
  });

  it("carries the per-rig detection, the why, and the provenance-tagged impact verbatim", () => {
    const d = describeRec(rec(), isAppliable);
    expect(d.detected).toBe("Currently: Off");
    expect(d.why).toBe("Lets the GPU manage its own memory and command queue directly.");
    expect(d.impact).toBe("Lower input latency");
    expect(d.provenance).toBe("expected-impact");
    expect(d.downside).toBe("Reboot required.");
  });
});

describe("recIdsForPriority", () => {
  it("reads identity from rec_ids — the aggregate row that used to resolve to nothing", () => {
    expect(recIdsForPriority(lim({ rec_ids: ["game-mode", "hags-enable"] }))).toEqual([
      "game-mode",
      "hags-enable",
    ]);
  });

  it("falls back to linked ?? id only for payloads written by an older build", () => {
    expect(recIdsForPriority(lim({ rec_ids: undefined, linked: "game-mode" }))).toEqual([
      "game-mode",
    ]);
    expect(recIdsForPriority(lim({ id: "hags-enable", rec_ids: undefined, linked: null }))).toEqual([
      "hags-enable",
    ]);
  });
});

describe("describePriority", () => {
  it("turns a count-only aggregate row back into every named recommendation behind it", () => {
    const details = describePriority(
      lim({ rec_ids: ["game-mode", "hags-enable"] }),
      [rec({ id: "game-mode", title: "Turn on Windows Game Mode" }), rec()],
      isAppliable,
    );
    expect(details.map((d) => d.title)).toEqual([
      "Turn on Windows Game Mode",
      "Enable Hardware-accelerated GPU Scheduling",
    ]);
    expect(actionable(details)).toHaveLength(2);
  });

  it("drops ids the current scan no longer carries instead of rendering a ghost row", () => {
    const details = describePriority(
      lim({ rec_ids: ["game-mode", "retired-rec"] }),
      [rec({ id: "game-mode" })],
      isAppliable,
    );
    expect(details.map((d) => d.id)).toEqual(["game-mode"]);
  });

  it("resolves nothing for a row that is not about recommendations at all", () => {
    // A readiness-check row: no rec ids, and its `linked` points at a check, not the catalog.
    expect(
      describePriority(lim({ rec_ids: [], linked: "ram-speed" }), [rec()], isAppliable),
    ).toHaveLength(0);
  });
});

describe("recsForPriority", () => {
  it("preserves the payload's display order", () => {
    const recs = [rec({ id: "hags-enable" }), rec({ id: "game-mode" })];
    expect(recsForPriority(lim({ rec_ids: ["game-mode", "hags-enable"] }), recs).map((r) => r.id))
      .toEqual(["game-mode", "hags-enable"]);
  });
});
