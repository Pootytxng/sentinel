import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import {
  EvidenceChip,
  Disclosure,
  Verdict,
  Reading,
  Action,
  ActionRow,
  type EvidenceState,
} from "./contracts";

// Quiet Pit Wall component contracts — the Direction D laws made structural (issue #49, gate
// 2026-08-01). A room should not be ABLE to violate glance→proof→advanced by accident; these
// assertions are what keeps that true as the redesign is built out room by room.

afterEach(cleanup);

const css = readFileSync(join("src", "design", "qpw", "qpw-components.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

describe("flag-off byte identity", () => {
  it("every selector in qpw-components.css is scoped under [data-qpw='on']", () => {
    const selectors = css
      .split("}")
      .map((c) => c.split("{")[0].trim())
      .filter(Boolean)
      .flatMap((s) => s.split(",").map((p) => p.trim()))
      .filter(Boolean);
    expect(selectors.length).toBeGreaterThan(0);
    expect(selectors.filter((s) => !s.includes('[data-qpw="on"]'))).toEqual([]);
  });

  it("consumes ONLY the token layer — no colour, size, radius or duration literals", () => {
    const decls = css.match(/[a-z-]+\s*:\s*[^;]+;/g) ?? [];
    const literals = decls.filter((d) => {
      const value = d.slice(d.indexOf(":") + 1);
      if (/#[0-9a-f]{3,8}\b/i.test(value)) return true; // hex colour
      if (/\b(rgb|hsl)a?\(/i.test(value)) return true; // functional colour
      if (/\b\d+m?s\b/.test(value)) return true; // raw duration
      return false;
    });
    expect(literals).toEqual([]);
  });
});

describe("PROOF — EvidenceChip is the four honest answers and no fifth", () => {
  const states: EvidenceState[] = ["measured", "expected", "unknown", "unavailable"];

  it.each(states)("renders %s with its own state hook for CSS", (state) => {
    const { container } = render(<EvidenceChip state={state} />);
    expect(container.querySelector(".qpw-chip")!.getAttribute("data-state")).toBe(state);
  });

  it("every state carries a SPOKEN meaning, not just an abbreviation", () => {
    for (const state of states) {
      cleanup();
      render(<EvidenceChip state={state} />);
      // The abbreviation alone ("EXPECTED") is not an explanation for a nontechnical user.
      expect(screen.getByText(/on this PC|not read yet|not measured on this PC/i)).toBeInTheDocument();
    }
  });

  it("'expected' never claims to be measured — the catalog-guidance honesty rail", () => {
    render(<EvidenceChip state="expected" />);
    const spoken = screen.getByText(/general guidance, not measured on this PC/i);
    expect(spoken).toBeInTheDocument();
  });

  it("the stylesheet styles exactly these four states and no others", () => {
    const styled = [...css.matchAll(/\.qpw-chip\[data-state="([a-z]+)"\]/g)].map((m) => m[1]);
    expect(new Set(styled)).toEqual(new Set(states));
  });
});

describe("ADVANCED — Disclosure removes collapsed content from focus and the a11y tree", () => {
  it("closed content is [hidden], not merely transparent", () => {
    const { container } = render(
      <Disclosure summary="5 more decisions">
        <button type="button">Buried action</button>
      </Disclosure>,
    );
    const panel = container.querySelector(".qpw-disc-panel") as HTMLElement;
    expect(panel.hasAttribute("hidden")).toBe(true);
    // The decisive assertion: a keyboard user cannot reach it.
    expect(screen.queryByRole("button", { name: "Buried action" })).toBeNull();
  });

  it("opening exposes it, closing hides it again", () => {
    render(
      <Disclosure summary="Advanced tools">
        <button type="button">Buried action</button>
      </Disclosure>,
    );
    const toggle = screen.getByRole("button", { name: /Advanced tools/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Buried action" })).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByRole("button", { name: "Buried action" })).toBeNull();
  });

  it("the toggle owns its panel via aria-controls", () => {
    const { container } = render(
      <Disclosure summary="Methodology">
        <p>How Compy decides.</p>
      </Disclosure>,
    );
    const toggle = screen.getByRole("button", { name: /Methodology/ });
    const panel = container.querySelector(".qpw-disc-panel") as HTMLElement;
    expect(toggle.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.id).not.toBe("");
  });

  it("the toggle clears the 24px interaction floor via the token, not a literal", () => {
    expect(css).toMatch(/\.qpw-disc-btn\s*\{[^}]*min-height:\s*var\(--qpw-h-action\)/);
  });
});

describe("GLANCE — Verdict is one conclusion, never a score", () => {
  it("renders exactly one H1", () => {
    const { container } = render(<Verdict lede="One supporting sentence.">No urgent issue found</Verdict>);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("the conclusion is plain language — the component cannot accept a number", () => {
    // `children: string` is the type-level guard; this pins the runtime shape too.
    render(<Verdict>No urgent issue found</Verdict>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("No urgent issue found");
  });

  it("the supporting sentence is optional and singular", () => {
    const { container } = render(<Verdict>All clear</Verdict>);
    expect(container.querySelectorAll(".qpw-lede")).toHaveLength(0);
  });
});

describe("GLANCE — Reading tells the truth when there is no reading", () => {
  it("a null value renders the honest empty and NO bar", () => {
    const { container } = render(
      <Reading name="Display sync" value={null} interpretation="Compy hasn't read this." fill={0.8} />,
    );
    expect(screen.getByText("Not available")).toBeInTheDocument();
    // An empty bar reads as "zero", which is a different claim from "unknown".
    expect(container.querySelector(".qpw-read-bar")).toBeNull();
    expect(container.querySelector(".qpw-read")!.getAttribute("data-unavailable")).toBe("true");
  });

  it("a real value renders the bar at the measured fill", () => {
    const { container } = render(
      <Reading name="Frame pacing" value="11.8 ms" interpretation="Steady last session." fill={0.78} />,
    );
    const fill = container.querySelector(".qpw-read-bar i") as HTMLElement;
    // jsdom normalises trailing zeros; assert the normalised form.
    expect(fill.style.width).toBe("78%");
    expect(container.querySelector(".qpw-read")!.getAttribute("data-unavailable")).toBe("false");
  });

  it("fill is clamped — a bad caller cannot draw past the track", () => {
    const { container } = render(
      <Reading name="Load" value="3 apps" interpretation="Your call." fill={4.2} />,
    );
    expect((container.querySelector(".qpw-read-bar i") as HTMLElement).style.width).toBe("100%");
  });

  it("every reading carries an interpretation — a number alone explains nothing", () => {
    render(<Reading name="GPU temperature" value="71 °C" interpretation="Normal under load." fill={0.62} />);
    expect(screen.getByText("Normal under load.")).toBeInTheDocument();
  });
});

describe("ACTION HIERARCHY — one filled primary per viewport", () => {
  it("a single primary passes through untouched", () => {
    const { container } = render(
      <ActionRow>
        <Action variant="primary">Apply this change</Action>
        <Action variant="quiet">Show me how</Action>
        <Action variant="bare">Not now</Action>
      </ActionRow>,
    );
    const row = container.querySelector(".qpw-actions")!;
    expect(row.getAttribute("data-primary-count")).toBe("1");
    expect(row.getAttribute("data-demoted")).toBe("0");
    expect(container.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);
  });

  it("a SECOND primary is demoted to quiet, not shipped as a second 'do this'", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <ActionRow>
        <Action variant="primary">Apply this change</Action>
        <Action variant="primary">Apply everything</Action>
      </ActionRow>,
    );
    expect(container.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);
    expect(container.querySelector(".qpw-actions")!.getAttribute("data-demoted")).toBe("1");
    expect(err).toHaveBeenCalledWith(expect.stringContaining("One filled primary per viewport"));
    err.mockRestore();
  });

  it("a demoted action keeps its label and its handler — nothing is silently dropped", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const onSecond = vi.fn();
    render(
      <ActionRow>
        <Action variant="primary">Apply this change</Action>
        <Action variant="primary" onClick={onSecond}>
          Apply everything
        </Action>
      </ActionRow>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply everything" }));
    expect(onSecond).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it("the primary is physically larger than the others (44px vs 40px), via tokens", () => {
    expect(css).toMatch(/\.qpw-action\s*\{[^}]*min-height:\s*var\(--qpw-h-action\)/);
    expect(css).toMatch(/\.qpw-action\[data-variant="primary"\]\s*\{[^}]*min-height:\s*var\(--qpw-h-primary\)/);
  });

  it("focus is never removed — outline:none appears nowhere", () => {
    expect(css).not.toMatch(/outline:\s*(none|0)\b/);
    expect(css).toMatch(/:focus-visible/);
  });
});
