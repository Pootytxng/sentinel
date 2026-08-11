import { describe, it, expect, vi, afterEach } from "vitest";
import { useEffect } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { RigSelection } from "./rig-parts";

// KEYBOARD ROUTE INTO THE HOLOGRAM (#49 a11y acceptance, PR #90 recovery P3).
//
// The rig hologram is a WebGL canvas: its parts are three.js meshes, not DOM, and they were
// selectable by pointer alone. Everything a selection opens — the Lab evidence panel's real
// readings — was therefore unreachable without a mouse. `canvas-a11y-guard` pins that the picture
// has a NAME; nothing pinned that the picture is OPERABLE, and a named picture you cannot use is
// still a wall.
//
// These tests are behavioural on purpose. A text scan for `<button>` would pass on markup that
// renders the buttons and wires them to nothing, which is the exact failure this replaces.

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve([])) }));
vi.mock("../../design/use-motion", () => ({ useReducedMotion: () => true }));

// The scene, exactly as RigHologram emits it: parts, then user-added, then fans. Stubbing the 3D
// module keeps three.js out of jsdom while leaving the inventory boundary real — that boundary IS
// the thing under test.
const INVENTORY: RigSelection[] = [
  { source: "part", id: "cpu", name: "Ryzen 7 9850X3D", detected: true },
  { source: "part", id: "psu", name: "Power supply", detected: false },
  { source: "manual", id: "manual-1", name: "Corsair RM850x" },
  { source: "fan", id: "fan-0", name: "CPU fan", rpm: 1180, detected: true },
  { source: "fan", id: "fan-ghost-front", name: "Front intake", rpm: null, detected: false },
];

vi.mock("./RigHologram", () => ({
  // Emitted from an effect, as the real one does — announcing the scene during render would update
  // the parent mid-render, which React refuses.
  RigHologram: ({ onInventory }: { onInventory?: (items: RigSelection[]) => void }) => {
    useEffect(() => onInventory?.(INVENTORY), [onInventory]);
    return <div data-testid="hologram-stub" />;
  },
}));

const { RigViewer } = await import("./RigViewer");

const hw = { cpu_brand: "AMD Ryzen 7 9850X3D", gpus: [], disks: [] } as never;

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const picker = async () => {
  await screen.findByTestId("hologram-stub");
  return screen.getByRole("list", { name: /rig parts/i });
};

describe("the hologram's keyboard route", () => {
  it("offers a real button for every part the canvas can select", async () => {
    render(<RigViewer hw={hw} chromeless />);
    const buttons = (await picker()).querySelectorAll("button");
    expect([...buttons].map((b) => b.textContent)).toEqual([
      "Ryzen 7 9850X3Ddetected",
      "Power supplynot software-detectable",
      "Corsair RM850xuser-added",
      "CPU fan1180 rpm",
      "Front intakenot software-detectable",
    ]);
    // Native <button> is the point, not a div with a click handler: Enter and Space, focusability,
    // and the button role all come from the element rather than from code we would have to keep.
    for (const b of buttons) expect(b.tagName).toBe("BUTTON");
  });

  it("states an honest unavailable instead of an empty or invented reading", async () => {
    render(<RigViewer hw={hw} chromeless />);
    const text = (await picker()).textContent ?? "";
    // A fan with a sensor reports its real rpm; a fan without one says so. Neither shows a zero.
    expect(text).toContain("1180 rpm");
    expect(text).not.toMatch(/\b0 rpm\b/);
    expect(text).toContain("not software-detectable");
  });

  it("selects the same thing a mesh click selects, and reports which is selected", async () => {
    const onSelectedIdChange = vi.fn();
    render(<RigViewer hw={hw} chromeless onSelectedIdChange={onSelectedIdChange} />);
    const button = (await picker()).querySelectorAll("button")[3];

    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);

    // The full descriptor, not just the id — a host that only gets an id cannot answer for a fan,
    // which is what left the Lab's evidence panel blank on those clicks.
    expect(onSelectedIdChange).toHaveBeenCalledWith("fan-0", INVENTORY[3]);
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("renders no empty picker before the lazy 3D chunk has reported a scene", () => {
    // Nothing to select yet is not the same as an empty list of parts, and a keyboard user landing
    // on a nameless empty group learns nothing from it.
    vi.resetModules();
    render(<div />);
    expect(screen.queryByRole("list", { name: /rig parts/i })).toBeNull();
  });
});
