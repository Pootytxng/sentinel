import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ConfirmProvider, useConfirm } from "./ConfirmDialog";

afterEach(cleanup);

// A tiny consumer that surfaces the resolved boolean so we can assert the promise result.
function Harness() {
  const confirm = useConfirm();
  const [result, setResult] = useState("none");
  return (
    <div>
      <button
        onClick={async () =>
          setResult(
            String(
              await confirm({
                title: "Roll back Windows Game Mode?",
                body: "It'll return to Off",
                confirmLabel: "Roll back",
              }),
            ),
          )
        }
      >
        trigger
      </button>
      <span data-testid="result">{result}</span>
    </div>
  );
}

const open = () => {
  render(
    <ConfirmProvider>
      <Harness />
    </ConfirmProvider>,
  );
  fireEvent.click(screen.getByText("trigger"));
};

describe("ConfirmDialog", () => {
  it("shows the themed dialog with outcome-stating copy + an ink-law confirm button", () => {
    open();
    expect(screen.getByText("Roll back Windows Game Mode?")).toBeInTheDocument();
    expect(screen.getByText("It'll return to Off")).toBeInTheDocument(); // states the destination, not "are you sure?"
    const go = screen.getByRole("button", { name: "Roll back" });
    expect(go.className).toContain("cmp-confirm-go"); // accent-fill + --ix-accent-ink (never white)
  });

  it("resolves true on confirm and false on cancel (no native confirm)", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Roll back" }));
    await waitFor(() => expect(screen.getByTestId("result").textContent).toBe("true"));
    // reopen + cancel
    fireEvent.click(screen.getByText("trigger"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByTestId("result").textContent).toBe("false"));
  });

  it("Esc cancels", async () => {
    open();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.getByTestId("result").textContent).toBe("false"));
  });
});
