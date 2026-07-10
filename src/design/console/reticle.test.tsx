import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { createRef } from "react";
vi.mock("../use-motion", () => ({ useReducedMotion: () => true }));
import { ReticleCursor } from "./ReticleCursor";

describe("ReticleCursor", () => {
  it("renders nothing under reduced motion (native cursor preserved)", () => {
    const { container } = render(<ReticleCursor scopeRef={createRef<HTMLElement>()} />);
    expect(container.firstChild).toBeNull();
  });
});
