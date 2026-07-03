import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { AmbientBackdrop } from "./AmbientBackdrop";

afterEach(cleanup);

describe("AmbientBackdrop", () => {
  it("renders nothing when ambiance is off (reversible — app keeps its own bg)", () => {
    const { container } = render(<AmbientBackdrop ambiance="off" />);
    expect(container.querySelector(".ix-aurora")).toBeNull();
  });

  it("mounts the whisper aurora + vignette when ambiance is full", () => {
    const { container } = render(<AmbientBackdrop ambiance="full" />);
    expect(container.querySelector(".ix-aurora")).not.toBeNull();
    expect(container.querySelector(".ix-vignette")).not.toBeNull();
  });

  it("mounts the aurora with the barely-there slow drift when ambiance is calm (owner §8b)", () => {
    const { container } = render(<AmbientBackdrop ambiance="calm" />);
    expect(container.querySelector(".ix-aurora")).not.toBeNull();
    // calm drifts, but only at the much slower, fainter §8b cadence — never full-speed.
    expect(container.querySelector(".ix-aurora-drift-a")).not.toBeNull();
    expect(container.querySelector(".ix-aurora-slow")).not.toBeNull();
  });
});
