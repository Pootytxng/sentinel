import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Picker, type PickerOption } from "./Picker";

// The Picker replaced a native `<select>` on five surfaces (C-10). A native select is a LOT of
// behaviour the browser gave us for free, and every bit of it that we dropped is a regression a
// green build would not mention. So these tests are written as a PARITY list, not a feature list:
// each one names the native behaviour it is holding on to.
//
// What is deliberately NOT tested here: the look. That is the `self-review` skill's job on the live
// app — jsdom applies no stylesheets, so a test asserting the list is opaque would assert nothing.

const OPTIONS: PickerOption[] = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Bravo" },
  { value: "c", label: "Charlie", disabled: true },
  { value: "d", label: "Delta" },
];

function Harness({
  initial = "",
  options = OPTIONS,
  onPick,
  ...rest
}: {
  initial?: string;
  options?: PickerOption[];
  onPick?: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Picker
      options={options}
      value={value}
      onChange={(v) => {
        setValue(v);
        onPick?.(v);
      }}
      aria-label="Test picker"
      {...rest}
    />
  );
}

const trigger = () => screen.getByRole("combobox");
const listbox = () => document.querySelector('[role="listbox"]');
const option = (value: string) =>
  document.querySelector<HTMLElement>(`[role="listbox"] [data-value="${value}"]`)!;

afterEach(cleanup);

describe("Picker — the control itself", () => {
  it("shows the placeholder until something is chosen, then the chosen LABEL (not its value)", () => {
    render(<Harness placeholder="Choose a change…" />);
    expect(trigger()).toHaveTextContent("Choose a change…");
    fireEvent.click(trigger());
    fireEvent.click(option("b"));
    expect(trigger()).toHaveTextContent("Bravo");
    expect(trigger()).not.toHaveTextContent("Choose a change…");
  });

  it("opens on click and closes again on a second click", () => {
    render(<Harness />);
    expect(listbox()).toBeNull();
    fireEvent.click(trigger());
    expect(listbox()).not.toBeNull();
    fireEvent.click(trigger());
    expect(listbox()).toBeNull();
  });

  it("reports the pick ONCE, and not at all when the same option is re-chosen", () => {
    const onPick = vi.fn();
    render(<Harness initial="a" onPick={onPick} />);
    fireEvent.click(trigger());
    fireEvent.click(option("b"));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("b");
    // Re-choosing what is already chosen is not a change — a native select fires no change event
    // either, and the call sites here kick off real work (a simulator read, a benchmark) on it.
    fireEvent.click(trigger());
    fireEvent.click(option("b"));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("closes on an outside press without changing the value", () => {
    const onPick = vi.fn();
    render(<Harness initial="a" onPick={onPick} />);
    fireEvent.click(trigger());
    expect(listbox()).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(listbox()).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    expect(trigger()).toHaveTextContent("Alpha");
  });

  it("never commits a disabled option, by pointer or by keyboard", () => {
    const onPick = vi.fn();
    render(<Harness initial="a" onPick={onPick} />);
    fireEvent.click(trigger());
    fireEvent.click(option("c"));
    expect(onPick).not.toHaveBeenCalled();
    expect(listbox()).not.toBeNull(); // an inert click must not silently close it either

    // Arrowing down from Alpha must SKIP Charlie and land on Delta.
    fireEvent.keyDown(trigger(), { key: "ArrowDown" }); // → Bravo
    fireEvent.keyDown(trigger(), { key: "ArrowDown" }); // → Delta (Charlie skipped)
    fireEvent.keyDown(trigger(), { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("d");
  });
});

describe("Picker — keyboard parity with the <select> it replaced", () => {
  it("opens on ArrowDown / Enter / Space and starts on the CURRENT selection", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Enter", " "]) {
      cleanup();
      render(<Harness initial="b" />);
      fireEvent.keyDown(trigger(), { key });
      expect(listbox(), key).not.toBeNull();
      expect(option("b").dataset.active, key).toBe("true");
    }
  });

  it("Escape closes and keeps the previous value", () => {
    const onPick = vi.fn();
    render(<Harness initial="a" onPick={onPick} />);
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    fireEvent.keyDown(trigger(), { key: "ArrowDown" }); // highlight Bravo
    fireEvent.keyDown(trigger(), { key: "Escape" });
    expect(listbox()).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    expect(trigger()).toHaveTextContent("Alpha");
  });

  it("Tab leaves without committing the mere highlight", () => {
    // Deliberate divergence from the ARIA APG, documented in Picker.tsx: this control sits beside
    // Apply/Measure buttons, and a value the user only arrowed PAST is not a choice they made.
    const onPick = vi.fn();
    render(<Harness initial="a" onPick={onPick} />);
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    fireEvent.keyDown(trigger(), { key: "Tab" });
    expect(listbox()).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("Home and End reach the first and last ENABLED option", () => {
    const onPick = vi.fn();
    render(<Harness initial="b" onPick={onPick} />);
    fireEvent.keyDown(trigger(), { key: "End" });
    fireEvent.keyDown(trigger(), { key: "Enter" });
    expect(onPick).toHaveBeenLastCalledWith("d");
    fireEvent.keyDown(trigger(), { key: "Home" });
    fireEvent.keyDown(trigger(), { key: "Enter" });
    expect(onPick).toHaveBeenLastCalledWith("a");
  });

  it("typeahead jumps to the first match — closed it commits, open it highlights", () => {
    const onPick = vi.fn();
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    render(<Harness initial="a" onPick={onPick} />);
    // Closed: a native select commits straight away on a typed character.
    fireEvent.keyDown(trigger(), { key: "d" });
    expect(onPick).toHaveBeenLastCalledWith("d");
    expect(listbox()).toBeNull();
    // Open: it moves the highlight and waits for Enter. The clock moves past the typeahead window
    // first — otherwise this "a" would (correctly) extend the previous query to "da".
    clock.mockReturnValue(5_000);
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    fireEvent.keyDown(trigger(), { key: "a" });
    expect(option("a").dataset.active).toBe("true");
    expect(onPick).toHaveBeenCalledTimes(1);
    clock.mockRestore();
  });

  it("a fast run of characters is ONE query; a pause starts a new one", () => {
    // The behaviour that makes typeahead usable on a list of similarly-named tweaks: "de" must be
    // able to reach past the first "d". This is the native control's rule, ~1s of quiet to reset.
    const opts: PickerOption[] = [
      { value: "a", label: "Alpha" },
      { value: "delta", label: "Delta" },
      { value: "denim", label: "Denim" },
    ];
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    render(<Harness initial="a" options={opts} />);
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });

    fireEvent.keyDown(trigger(), { key: "d" });
    expect(option("delta").dataset.active).toBe("true");
    clock.mockReturnValue(120);
    fireEvent.keyDown(trigger(), { key: "e" });
    clock.mockReturnValue(240);
    fireEvent.keyDown(trigger(), { key: "n" });
    expect(option("denim").dataset.active).toBe("true");

    // Quiet for longer than the window: the next "d" is a fresh query, back to Delta.
    clock.mockReturnValue(9_000);
    fireEvent.keyDown(trigger(), { key: "d" });
    expect(option("delta").dataset.active).toBe("true");
    clock.mockRestore();
  });
});

describe("Picker — accessibility contract", () => {
  it("is a named combobox that declares its expanded state and its active option", async () => {
    render(<Harness initial="a" />);
    const t = trigger();
    expect(t).toHaveAttribute("aria-haspopup", "listbox");
    expect(t).toHaveAttribute("aria-expanded", "false");
    expect(t).toHaveAccessibleName("Test picker");
    expect(t).not.toHaveAttribute("aria-activedescendant");

    fireEvent.click(t);
    await waitFor(() => expect(t).toHaveAttribute("aria-expanded", "true"));
    // The active option is pointed AT rather than focused — DOM focus never leaves the trigger, so
    // there is no focus to lose when the list closes.
    const activeId = t.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    expect(document.getElementById(activeId!)).toBe(option("a"));
    expect(t).toHaveAttribute("aria-controls", listbox()!.id);
  });

  it("marks exactly one option aria-selected — the chosen one, not the highlighted one", () => {
    render(<Harness initial="a" />);
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: "ArrowDown" }); // highlight Bravo, still choosing Alpha
    const selected = [...document.querySelectorAll('[role="option"][aria-selected="true"]')];
    expect(selected).toHaveLength(1);
    expect(selected[0]).toBe(option("a"));
    expect(option("b").dataset.active).toBe("true");
  });

  it("a disabled picker does not open, by pointer or by keyboard", () => {
    render(<Harness initial="a" disabled />);
    expect(trigger()).toBeDisabled();
    fireEvent.click(trigger());
    expect(listbox()).toBeNull();
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    expect(listbox()).toBeNull();
  });

  it("survives an empty option list instead of throwing", () => {
    render(<Harness options={[]} placeholder="Nothing to pick" />);
    expect(trigger()).toHaveTextContent("Nothing to pick");
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    fireEvent.keyDown(trigger(), { key: "Enter" });
    expect(trigger()).toHaveTextContent("Nothing to pick");
  });

  it("an option whose value is empty keeps the UNCHOSEN look while staying re-selectable", () => {
    // ExperimentBench needs both: the native <select> it replaced had a blank <option value=""> the
    // user could go back to, and it read as "nothing chosen". Carrying that entry as an option must
    // not make the trigger look like a made choice.
    const withEmpty: PickerOption[] = [{ value: "", label: "Choose a change…" }, ...OPTIONS];
    const onPick = vi.fn();
    render(<Harness initial="b" options={withEmpty} onPick={onPick} />);
    expect(trigger().dataset.placeholder).toBe("false");
    fireEvent.click(trigger());
    fireEvent.click(option(""));
    expect(onPick).toHaveBeenCalledWith("");
    expect(trigger()).toHaveTextContent("Choose a change…");
    expect(trigger().dataset.placeholder).toBe("true");
  });

  it("shows the placeholder when the value matches no option (a stale id, not a crash)", () => {
    render(<Harness initial="gone" placeholder="Choose…" />);
    expect(trigger()).toHaveTextContent("Choose…");
  });

  it("cleans its portalled list out of <body> when it unmounts while open", () => {
    const { unmount } = render(<Harness initial="a" />);
    fireEvent.click(trigger());
    expect(listbox()).not.toBeNull();
    unmount();
    expect(listbox()).toBeNull();
  });
});
