import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { expectNoAxeViolations } from "../test/axe";

import { CaseEvidenceConsent, type CaseRemovableUnit } from "./CaseEvidenceConsent";
import { corpusPreview, corpusRemovable } from "../case-preview-corpus";

// Q9b Tier 3 Stage 2 (#258) — the consent screen's BEHAVIOUR, checked against real Rust bytes.
//
// Every payload string in this file comes from `src/case-preview-corpus.json`, which is generated
// and drift-checked by `case_preview_corpus_matches_what_this_module_produces` in
// src-tauri/src/case_evidence_upload.rs. So "the screen shows what would be sent" is asserted here
// as byte equality against the one canonical serializer — not against a fixture someone typed to
// match the screen, which is the version of this test that would have passed no matter what.
//
// `case-evidence-consent-guard.test.ts` holds the structural half (no send path, no serializer, no
// reachability, and the copy pinned phrase by phrase). This file holds the half only a render can
// prove: that removing a field really changes the bytes, that every honest shape is reachable, and
// that each state a user can land in says something true and calm.

afterEach(cleanup);

const BOTH = corpusRemovable("both");
const COMMENT_ONLY = corpusRemovable("comment-only");

/** The real screen, wired to real Rust output. `removable` defaults to what the corpus offers. */
function mount(
  base: "both" | "comment-only" = "both",
  props: Partial<React.ComponentProps<typeof CaseEvidenceConsent>> = {},
) {
  return render(
    <CaseEvidenceConsent
      removable={base === "both" ? BOTH : COMMENT_ONLY}
      preview={(removed) => corpusPreview(base, removed)}
      {...props}
    />,
  );
}

const payloadText = () => screen.getByTestId("case-consent-payload").textContent;
const removeButton = (name: string) => screen.getByRole("button", { name: `Remove ${name}` });

describe("Tier 3 consent screen: the preview IS the payload", () => {
  it("renders the canonical bytes character for character", () => {
    mount();
    // Byte equality, not "contains the fields". A summary that happens to mention every field is
    // exactly what §3 forbids, and it would pass any looser assertion than this one.
    expect(payloadText()).toBe(corpusPreview("both", []).payload_json);
  });

  it("re-renders those bytes the moment a field is removed", () => {
    mount();
    expect(payloadText()).toContain("app_family");

    fireEvent.click(removeButton("Which program"));

    expect(payloadText()).toBe(corpusPreview("both", ["app_family"]).payload_json);
    expect(payloadText()).not.toContain("app_family");
    // The row goes with it: a screen that keeps showing a field it no longer sends is lying in the
    // safer direction, which is still lying.
    expect(screen.queryByTestId("case-row-app_family")).toBeNull();
  });

  it("removes the four hardware fields as one block, never individually (§2C)", () => {
    mount();
    const hw = screen.getByTestId("case-row-hardware");
    // One row, one control, four values — there is no way to send three quarters of the block.
    expect(within(hw).getAllByRole("button")).toHaveLength(1);

    fireEvent.click(removeButton("Your PC"));

    expect(payloadText()).toBe(corpusPreview("both", ["hardware"]).payload_json);
    for (const key of ["gpu_vendor", "gpu_model", "cpu_family", "ram_gb_bucket"]) {
      expect(payloadText()).not.toContain(key);
    }
    expect(screen.queryByTestId("case-row-hardware")).toBeNull();
  });

  it("ends on the fully-stripped payload after every optional field is taken out", () => {
    mount();
    // Clicked in the order a user meets them, one at a time, each re-deriving from the last — the
    // path a real person takes, rather than a single jump to the end state.
    const order: [CaseRemovableUnit, string][] = [
      ["user_comment", "What you wrote"],
      ["app_family", "Which program"],
      ["module_family", "Which file inside it failed"],
      ["error_code", "Windows error code"],
      ["hardware", "Your PC"],
      ["windows_build", "Windows build number"],
      ["gpu_driver_version", "Graphics driver"],
    ];
    expect(order.map(([unit]) => unit)).toEqual(BOTH);

    const removed: CaseRemovableUnit[] = [];
    for (const [unit, label] of order) {
      fireEvent.click(removeButton(label));
      removed.push(unit);
      expect(payloadText(), `after removing ${unit}`).toBe(corpusPreview("both", removed).payload_json);
    }
    // What is left is what §2B says cannot be removed: the case's own identity.
    const remaining = Object.keys(JSON.parse(payloadText() ?? "{}"));
    expect(remaining).toEqual(["schema_version", "compy_version", "incident_kind", "occurred_at"]);
  });

  it("shows every row the bytes carry, and no row they do not", () => {
    mount();
    const keys = Object.keys(JSON.parse(payloadText() ?? "{}"));
    const shown = screen
      .getAllByTestId(/^case-row-/)
      .map((el) => el.getAttribute("data-testid")?.replace("case-row-", ""));
    // The four hardware keys collapse into one `hardware` row (§2C); every other key is its own.
    const expected = keys.filter((k) => !["gpu_model", "cpu_family", "ram_gb_bucket"].includes(k));
    expect(shown).toEqual(expected.map((k) => (k === "gpu_vendor" ? "hardware" : k)));
  });
});

describe("Tier 3 consent screen: all three honest shapes (§1)", () => {
  it("says 'comment + incident evidence' when the case carries both", () => {
    mount();
    expect(screen.getByTestId("case-consent-shape").textContent).toContain("comment + incident evidence");
    expect(screen.getByTestId("case-consent-shape").textContent).toContain("your message, and the details of one crash");
  });

  it("collapses to 'incident evidence only' when the comment is taken out", () => {
    mount();
    fireEvent.click(removeButton("What you wrote"));
    const line = screen.getByTestId("case-consent-shape").textContent;
    expect(line).toContain("incident evidence only");
    // The gloss changes with it — the shape line is not a label the screen keeps while the case moves.
    expect(line).toContain("Nothing you wrote");
    expect(payloadText()).toBe(corpusPreview("both", ["user_comment"]).payload_json);
  });

  it("says 'comment only' on journey A, where the comment cannot be removed at all", () => {
    mount("comment-only");
    expect(screen.getByTestId("case-consent-shape").textContent).toContain("comment only");
    // §2B: the comment IS the case here, so offering to remove it would offer to send nothing.
    expect(screen.queryByRole("button", { name: "Remove What you wrote" })).toBeNull();
    expect(screen.getByTestId("case-row-user_comment")).toBeTruthy();
    // The §2C context is still removable, and still re-derives.
    fireEvent.click(removeButton("Your PC"));
    expect(payloadText()).toBe(corpusPreview("comment-only", ["hardware"]).payload_json);
  });

  it("offers a remove control for exactly the units the case really allows", () => {
    mount();
    const removes = screen.getAllByRole("button", { name: /^Remove / });
    expect(removes).toHaveLength(BOTH.length);
    cleanup();

    mount("comment-only");
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(COMMENT_ONLY.length);
  });

  it("shows what survived redaction, rather than describing it", () => {
    // The corpus comment carries a Windows path and an IP on purpose. A person judging "is this
    // safe to send" needs the masked text in front of them; a sentence promising it was cleaned is
    // the thing #259's review proved cannot be relied on.
    mount();
    const comment = screen.getByTestId("case-row-user_comment").textContent ?? "";
    expect(comment).toContain("<path>");
    expect(comment).toContain("<ip>");
    expect(comment).not.toContain("192.168.1.14");
    expect(comment).not.toContain("kuya");
  });
});

describe("Tier 3 consent screen: the states a user can land in", () => {
  it("refuses calmly when there is no case to send", () => {
    render(<CaseEvidenceConsent removable={BOTH} preview={() => null} />);
    expect(screen.getByTestId("case-consent-empty").textContent).toContain("nothing to send");
    // Nothing to consent to means nothing to press — the button is absent, not disabled-and-hopeful.
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();
    expect(screen.queryByTestId("case-consent-payload")).toBeNull();
  });

  it("refuses to send text it cannot read back", () => {
    render(
      <CaseEvidenceConsent
        removable={BOTH}
        preview={() => ({ shape: "comment only", payload_json: "{ this is not json" })}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("could not read");
    expect(alert.textContent).toContain("Nothing has left this PC");
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();
  });

  it("shows a host error without losing the payload or the decision", () => {
    mount("both", { errorText: "Compy could not reach the support store. Nothing was sent." });
    const alert = screen.getByTestId("case-consent-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("Nothing was sent");
    // The user can still read what they were about to send, and still decide.
    expect(payloadText()).toBe(corpusPreview("both", []).payload_json);
    expect(screen.getByRole("button", { name: /Send this one case/ })).toBeTruthy();
  });

  it("says it is working, and cannot be pressed twice", () => {
    const onSend = vi.fn();
    mount("both", { status: "working", onSend });
    const send = screen.getByRole("button", { name: "Sending…" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(send);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("hands the exact removal set to the host, once", () => {
    const onSend = vi.fn();
    mount("both", { onSend });
    fireEvent.click(removeButton("What you wrote"));
    fireEvent.click(removeButton("Your PC"));
    fireEvent.click(screen.getByRole("button", { name: "Send this one case" }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(["user_comment", "hardware"]);
  });

  it("carries no consent from one send to the next", () => {
    // §3: permission is for ONE submission. The screen keeps its removal set in local state and
    // nothing else, so a fresh mount starts from the full case again — there is no remembered
    // choice to inherit, and nothing to switch off later.
    const { unmount } = mount();
    fireEvent.click(removeButton("What you wrote"));
    expect(payloadText()).not.toContain("user_comment");
    unmount();

    mount();
    expect(payloadText()).toBe(corpusPreview("both", []).payload_json);
  });
});

describe("Tier 3 consent screen: reachable by keyboard, named for a screen reader", () => {
  it("has no structural accessibility violations in its main state", async () => {
    const { container } = mount();
    await expectNoAxeViolations(container);
  });

  it("has no violations in the refusing states either", async () => {
    const empty = render(<CaseEvidenceConsent removable={BOTH} preview={() => null} />);
    await expectNoAxeViolations(empty.container);
    cleanup();
    const broken = render(
      <CaseEvidenceConsent removable={BOTH} preview={() => ({ shape: "comment only", payload_json: "nope" })} />,
    );
    await expectNoAxeViolations(broken.container);
  });

  it("uses real buttons, so Tab and Enter work without a keyboard handler of its own", () => {
    mount();
    // A div with onClick looks identical on screen and is unreachable without a mouse. Every
    // control here must be a native button (the disclosure is a native <summary>), and none may be
    // pulled out of the tab order.
    for (const el of screen.getAllByRole("button")) {
      expect(el.tagName, `${el.textContent} is not a native button`).toBe("BUTTON");
      expect((el as HTMLButtonElement).type).toBe("button");
      expect(el.getAttribute("tabindex")).toBeNull();
    }
    expect(document.querySelector("details > summary")).toBeTruthy();
  });

  it("names every control by the thing it acts on, not by 'Remove'", () => {
    mount();
    // Seven identically-labelled "Remove" buttons is a screen reader reading the same word seven
    // times. Each accessible name carries the field, in the plain words the row uses.
    const names = screen.getAllByRole("button", { name: /^Remove / }).map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual([
      "Remove What you wrote",
      "Remove Which program",
      "Remove Which file inside it failed",
      "Remove Windows error code",
      "Remove Your PC",
      "Remove Windows build number",
      "Remove Graphics driver",
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("tells the user what changed after a removal", () => {
    mount();
    expect(screen.queryByTestId("case-consent-removed-note")).toBeNull();
    fireEvent.click(removeButton("Which program"));
    expect(screen.getByTestId("case-consent-removed-note").textContent).toContain("One thing was taken out");
    fireEvent.click(removeButton("Your PC"));
    expect(screen.getByTestId("case-consent-removed-note").textContent).toContain("2 things were taken out");
  });
});
