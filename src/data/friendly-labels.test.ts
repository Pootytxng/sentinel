import { describe, it, expect } from "vitest";
import { FRIENDLY_LABELS, friendlyLabel } from "./friendly-labels";

// Honesty guard for the friendly-label layer: plain-language headlines must NEVER drift into
// unmeasured hype. The measured evidence lives on the chip + under "What's this?"; the headline only
// frames the action/benefit. Mirrors the doctrine's "never fabricate, never claim unmeasured" law.
const BANNED = [
  "guaranteed",
  "guarantee",
  "instantly",
  "massive",
  "huge",
  "+fps",
  "fps boost",
  "double your",
  "blazing",
  "supercharge",
  "maximize fps",
  "best possible",
];

describe("friendly-labels", () => {
  it("every headline is non-empty and reasonably short (a headline, not a paragraph)", () => {
    for (const [id, label] of Object.entries(FRIENDLY_LABELS)) {
      expect(label.headline.trim().length, `${id} headline empty`).toBeGreaterThan(0);
      expect(label.headline.length, `${id} headline too long`).toBeLessThanOrEqual(60);
    }
  });

  it("no headline or tech tag uses unmeasured hype words (honesty law)", () => {
    for (const [id, label] of Object.entries(FRIENDLY_LABELS)) {
      const hay = `${label.headline} ${label.tech ?? ""}`.toLowerCase();
      for (const w of BANNED) {
        expect(hay.includes(w), `${id} uses banned hype "${w}": ${label.headline}`).toBe(false);
      }
    }
  });

  it("tech tag is present where mapped (the technical name stays quiet-but-visible)", () => {
    // The voice keeps the real name visible; every remapped jargon rec carries its tech tag.
    for (const [id, label] of Object.entries(FRIENDLY_LABELS)) {
      expect(label.tech && label.tech.trim().length > 0, `${id} missing tech tag`).toBe(true);
    }
  });

  it("returns null for an unmapped id (caller falls back to the original title)", () => {
    expect(friendlyLabel("definitely-not-a-rec")).toBeNull();
    expect(friendlyLabel("nagle-disable")?.headline).toBe("Smoother online play");
  });
});
