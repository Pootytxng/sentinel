import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Icon } from "./Icon";

describe("Icon", () => {
  it("renders an svg for a known name", () => {
    const { container } = render(<Icon name="check" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
