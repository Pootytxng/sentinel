import { describe, it, expect } from "vitest";
import { createGenerations } from "./latest-wins";

describe("createGenerations", () => {
  it("only the newest run is current; an older run stays superseded", () => {
    const g = createGenerations();
    const first = g.begin();
    expect(first()).toBe(true);
    const second = g.begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
    g.begin();
    expect(second()).toBe(false);
  });

  it("two flows never share a generation", () => {
    const a = createGenerations();
    const b = createGenerations();
    const ra = a.begin();
    b.begin();
    expect(ra()).toBe(true);
  });
});
