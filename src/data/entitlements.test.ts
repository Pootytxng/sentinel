// R3 Lane E — the Pro gate stays hard-false; everything-free semantics pinned.
import { describe, it, expect } from "vitest";
import { proGate, currentTier, entitled } from "./entitlements";

describe("entitlements (dark scaffold)", () => {
  it("proGate is pinned false — flipping it is an owner-signed Phase 5 commit, never a refactor side effect", () => {
    expect(proGate()).toBe(false);
  });

  it("every install runs free while the gate is down", () => {
    expect(currentTier()).toBe("free");
  });

  it("entitled(): free requirements pass for everyone; pro requirements need pro", () => {
    expect(entitled("free", "free")).toBe(true);
    expect(entitled("pro", "free")).toBe(true);
    expect(entitled("free", "pro")).toBe(false);
    expect(entitled("pro", "pro")).toBe(true);
  });
});
