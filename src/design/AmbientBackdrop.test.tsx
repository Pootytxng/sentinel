import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { AmbientBackdrop } from "./AmbientBackdrop";

afterEach(cleanup);

describe("AmbientBackdrop", () => {
  it("renders nothing when ambiance is off (reversible — app keeps its own bg)", () => {
    const { container } = render(<AmbientBackdrop ambiance="off" themeKey="velocity" />);
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("mounts the canvas + vignette when ambiance is full", () => {
    const { container } = render(<AmbientBackdrop ambiance="full" themeKey="velocity" />);
    expect(container.querySelector("canvas.ix-backdrop")).not.toBeNull();
    expect(container.querySelector(".ix-vignette")).not.toBeNull();
  });

  it("mounts the canvas when ambiance is calm", () => {
    const { container } = render(<AmbientBackdrop ambiance="calm" themeKey="velocity" />);
    expect(container.querySelector("canvas")).not.toBeNull();
  });
});
