import { describe, it, expect } from "vitest";
import { SITE_URL, SITE_TAGLINE, WAITLIST_SLOT } from "./site";

describe("site constants", () => {
  it("SITE_URL is an https URL", () => {
    expect(SITE_URL).toMatch(/^https:\/\//);
  });

  it("SITE_TAGLINE is a non-empty string", () => {
    expect(typeof SITE_TAGLINE).toBe("string");
    expect(SITE_TAGLINE.length).toBeGreaterThan(0);
  });

  it("WAITLIST_SLOT is defined markup", () => {
    expect(WAITLIST_SLOT).toBeDefined();
    expect(WAITLIST_SLOT.length).toBeGreaterThan(0);
  });
});
