// bug->guard (J, 2026-07-22): "1 safe tweak not applied" was a dead end.
//
// The fast-path receipt named a COUNT and nothing else, so a user who was told one tweak had been
// skipped had no way to learn which one or why. The information was never missing — the batch
// primitive returns `{ title, reason }[]` per skip — it was discarded one line after arriving:
//
//     setFastPathReceipt({ applied: res.applied, skipped: res.skipped.length })
//
// This guard pins that the detail is RETAINED and RENDERED with its reason.
//
// Honest about its own strength: this is a source-contract guard, not a behavioural one. Driving
// the real fast path needs the intake flag, a confirm provider, recs fixtures and an appliable
// predicate all mounted together; that behavioural test is the stronger form and is worth adding
// when this surface is next touched. A contract guard catches the specific regression that already
// happened once (collapsing the receipt back to a bare count) and is honest about catching no more.
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// The fast path moved from the intake band into the interview on 2026-08-20 (issue #177): the room
// still OWNS the apply and the result, the interview RENDERS them. So the contract is read across
// both files rather than pinned to the filename it happened to live in when the bug was found — a
// guard that only knows one filename retires itself the first time the code is reorganised.
const home = [
  readFileSync(join("src", "surfaces", "HomeConsole.tsx"), "utf8"),
  readFileSync(join("src", "surfaces", "HomeInterview.tsx"), "utf8"),
].join("\n");
const en = JSON.parse(
  readFileSync(join("src", "i18n", "locales", "en", "home.json"), "utf8"),
);
const zh = JSON.parse(
  readFileSync(join("src", "i18n", "locales", "zh-CN", "home.json"), "utf8"),
);

const fastpath = (o: Record<string, unknown>) =>
  // The file root differs from the i18n key prefix; resolve either shape rather than assume.
  ((o.homeConsole ?? (o.home as Record<string, unknown>)?.homeConsole) as Record<
    string,
    Record<string, Record<string, string>>
  >).intake.fastpath;

describe("fast-path skipped detail (J, 2026-07-22)", () => {
  it("retains the per-skip title and reason on the receipt, not just a count", () => {
    expect(
      home,
      "the receipt no longer carries skippedItems — a skipped tweak is a dead end again (J, 2026-07-22)",
    ).toContain("skippedItems");
    // The bare-count collapse, verbatim. If this exact reduction comes back, so does the bug.
    expect(
      home.replace(/\s+/g, " "),
      "the receipt was collapsed back to res.skipped.length only",
    ).not.toContain("setFastPathReceipt({ applied: res.applied, skipped: res.skipped.length })");
  });

  it("renders the REASON alongside the title, never a bare list of names", () => {
    // A name with no reason answers "which?" but not "why?", which is half the dead end.
    expect(home).toContain("skippedItemReason");
    expect(home).toMatch(/reason:\s*item\.reason/);
  });

  it("ships the disclosure copy in both locales", () => {
    for (const [name, bundle] of [["en", en], ["zh-CN", zh]] as const) {
      const f = fastpath(bundle as Record<string, unknown>);
      for (const key of ["skippedDisclosure_one", "skippedDisclosure_other", "skippedItemReason"]) {
        expect(f[key], `${name} is missing ${key} — the disclosure would render its raw key`).toBeTruthy();
      }
      // The reason is the point; a translation that drops the interpolation silently loses it.
      expect(f.skippedItemReason, `${name} skippedItemReason must interpolate reason`).toContain(
        "{{reason}}",
      );
      expect(f.skippedItemReason, `${name} skippedItemReason must interpolate title`).toContain(
        "{{title}}",
      );
    }
  });
});
