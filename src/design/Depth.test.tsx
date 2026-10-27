import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { useEffect } from "react";
import { Depth, ReceiptRow } from "./Depth";
import { setExpertView } from "./use-expert-view";

// P7-depth (Constitution §13): one block, three depths of the same truth. These pin the contract
// the adopters rely on: the answer is always in the DOM; a layer's children mount only while that
// layer is open (the collapsed-<details> trap WalkthroughDisclosure documents); Expert view opens
// both layers by default and live; a block with no explanation or receipt shows no dead door.

let mounts = 0;
function Probe() {
  useEffect(() => {
    mounts++;
  }, []);
  return <span>probe</span>;
}

beforeEach(() => {
  mounts = 0;
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Depth", () => {
  it("always shows the answer; explanation and receipt are closed doors that mount nothing until opened", () => {
    render(<Depth testId="d" answer={<p>Leave this setting alone.</p>} explanation={<Probe />} receipt={<Probe />} />);
    expect(screen.getByText("Leave this setting alone.")).toBeInTheDocument();
    expect(screen.getByTestId("d-why")).not.toHaveAttribute("open");
    expect(screen.getByTestId("d-receipt")).not.toHaveAttribute("open");
    expect(screen.queryByText("probe")).toBeNull();
    expect(mounts).toBe(0);
    fireEvent.click(screen.getByText("Why this, for this PC"));
    expect(screen.getByTestId("d-why")).toHaveAttribute("open");
    expect(screen.getAllByText("probe")).toHaveLength(1);
    fireEvent.click(screen.getByText("Technical receipt"));
    expect(screen.getAllByText("probe")).toHaveLength(2);
    // Closing unmounts again.
    fireEvent.click(screen.getByText("Why this, for this PC"));
    expect(screen.getAllByText("probe")).toHaveLength(1);
  });

  it("shows no door for a layer the caller did not give", () => {
    render(<Depth testId="d" answer={<p>Answer only.</p>} />);
    expect(screen.queryByTestId("d-why")).toBeNull();
    expect(screen.queryByTestId("d-receipt")).toBeNull();
    expect(screen.queryByText("Why this, for this PC")).toBeNull();
    expect(screen.queryByText("Technical receipt")).toBeNull();
  });

  it("Expert view opens both layers by default, and follows the Settings toggle live", () => {
    setExpertView(true);
    render(<Depth testId="d" answer={<p>A</p>} explanation={<p>because</p>} receipt={<p>exact</p>} />);
    expect(screen.getByTestId("d")).toHaveAttribute("data-expert", "on");
    expect(screen.getByText("because")).toBeInTheDocument();
    expect(screen.getByText("exact")).toBeInTheDocument();
    act(() => setExpertView(false));
    expect(screen.getByTestId("d")).toHaveAttribute("data-expert", "off");
    expect(screen.queryByText("because")).toBeNull();
    expect(screen.queryByText("exact")).toBeNull();
    // The user can still open a layer by hand under the default face.
    fireEvent.click(screen.getByText("Technical receipt"));
    expect(screen.getByText("exact")).toBeInTheDocument();
  });

  it("ReceiptRow renders nothing for an empty value: a receipt never shows a blank field", () => {
    const { container } = render(
      <dl>
        <ReceiptRow label="Kind" value="App crash" />
        <ReceiptRow label="App" value={null} />
        <ReceiptRow label="Stop code" value="" />
      </dl>,
    );
    expect(container.querySelectorAll("dt")).toHaveLength(1);
    expect(container.textContent).toBe("KindApp crash");
  });
});
