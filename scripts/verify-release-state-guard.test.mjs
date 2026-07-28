import { describe, expect, it } from "vitest";
import { validateOwnerDecisionVersions } from "./verify-release-state.mjs";

describe("release-state owner-decision version guard", () => {
  it("accepts historical checkpoint versions when the live decision names the candidate", () => {
    const section = `## Required owner decisions (live)

1. **Publish GO/NO-GO for the next prepared release (v0.9.11)** — v0.9.9 and v0.9.10 are
   preserved historical checkpoints and must not be rewritten.
2. **Single-tester canary** — after publication.
`;

    expect(validateOwnerDecisionVersions(section, "0.9.10", "0.9.11")).toEqual([]);
  });

  it("rejects a live publish decision that does not name the candidate version", () => {
    const section = `## Required owner decisions (live)

1. **Publish GO/NO-GO for v0.9.10** — stale pending release.
`;

    expect(validateOwnerDecisionVersions(section, "0.9.10", "0.9.11")).toEqual([
      "STALE-DECISION: first live owner decision must name candidate v0.9.11",
    ]);
  });
});
