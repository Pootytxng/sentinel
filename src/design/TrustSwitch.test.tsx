import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TrustSnapshotLine, restoresCopy } from "./TrustSwitch";

// A5 fuller-delta guard: the snapshot-reveal line keeps the LOCKED kernel-§6 sentence verbatim,
// and the "set to <after>" delta is strictly additive — appended only when the typed after-label
// exists AND differs from the prior (a no-op apply appends nothing).
describe("TrustSnapshotLine", () => {
  it("locked copy renders verbatim; the after-delta is appended when it differs", () => {
    const c = render(
      <TrustSnapshotLine restoresLabel="Off" appliedLabel="On" />,
    ).container;
    expect(c.textContent).toContain(restoresCopy("Off")); // locked sentence intact
    expect(c.textContent).toContain("· set to On");
  });

  it("no delta when the after-label is absent or identical to the prior", () => {
    const absent = render(<TrustSnapshotLine restoresLabel="Off" />).container;
    expect(absent.textContent).not.toContain("set to");
    const noop = render(
      <TrustSnapshotLine restoresLabel="On" appliedLabel="On" />,
    ).container;
    expect(noop.textContent).not.toContain("set to");
    expect(noop.textContent).toContain(restoresCopy("On"));
  });
});
