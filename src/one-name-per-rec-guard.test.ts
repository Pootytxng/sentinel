import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// ONE NAME PER REC — the class guard (product-recovery train, self-review rounds 3–4, 2026-07-28).
//
// WHY A SOURCE SCAN AND NOT ANOTHER RENDER TEST. The naming defect was fixed twice and came back
// twice, both times through a file nobody had thought to open:
//   round 3 — the Check rows printed the raw catalog title while the card beneath printed the
//             friendly one, so a user met one tweak under two names in a single scroll;
//   round 4 — the fix landed on the Check surfaces but not on `src/App.tsx`, where every surface's
//             Apply/Undo actually lands, so clicking "Apply this" on a card reading "Help Windows
//             focus on your game" opened a dialog titled `Apply "Enable Windows Game Mode"?`.
// A render test only covers the surfaces someone remembered to render. This scans EVERY component
// for the shape of the mistake — `title: <something>.title` fed to a user-visible string — so a
// brand-new file, or an old one nobody touched, cannot reintroduce the class silently.
//
// HONEST SCOPE. This is a syntactic guard, not a semantic one: it proves no component interpolates
// a raw rec title into a display string outside the allowlist below. It cannot prove the resolved
// headline is the RIGHT one — that is what check-name-consistency.test.tsx (behaviour) and the
// self-review visual pass are for.
//
// THE BOUNDARY IT MUST NOT BREAK. `invoke("apply_recommendation", { recId, recTitle })` and every
// other IPC arg keep the RAW catalog title — the Trust Ledger records what Compy did, not what it
// said. The regex is deliberately case-sensitive on `title:` so it never matches `recTitle:` or
// `rec_title:`, i.e. it can never pressure someone into "fixing" a receipt.

const SRC = "src";

// Same recursive-readdir idiom the other src guards use (gpu-temp-gate, plain-language, …).
function tsxFiles(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
    .map((f) => join(SRC, f));
}

// `title: <ident><.prop|[0]>*.{title|rec_title|recTitle}` — the interpolation shape. Lowercase
// `title:` with a \b in front: "recTitle:" and "rec_title:" cannot match (see the boundary note).
const RAW_NAME = /\btitle:\s*([A-Za-z_$][\w$]*(?:\??\.[\w$]+|\[\d+\])*\.(?:title|rec_title|recTitle))\b/g;

// Every allowed raw-title site, with the reason it is NOT a naming bug. Anything not listed here
// fails the test — adding an entry is a deliberate, reviewed act, which is the point.
const ALLOWED: Record<string, { expr: string; why: string }[]> = {
  [join("src", "surfaces", "Check.tsx")]: [
    {
      expr: "f.title",
      why: "Leftovers finding, not a recommendation — its id is not a rec id, so there is no friendly label to resolve.",
    },
  ],
  [join("src", "surfaces", "Fix.tsx")]: [
    {
      expr: "rec.title",
      why: "Structural: builds the Recommendation object handed to a child, which resolves its own display name.",
    },
    {
      expr: "c.rec_title",
      why: "Structural: rebuilds a {id,title} rec from a ledger change for a child; the child resolves the name.",
    },
  ],
  [join("src", "surfaces", "Benchmark.tsx")]: [
    {
      expr: "r.title",
      why: "Structural: builds the measurable-tweak list; the <option> render resolves the display name.",
    },
  ],
};

function offenders(): { file: string; expr: string; line: number }[] {
  const out: { file: string; expr: string; line: number }[] = [];
  for (const file of tsxFiles()) {
    const text = readFileSync(file, "utf8");
    const allowed = ALLOWED[file] ?? [];
    for (const [, expr] of text.matchAll(RAW_NAME)) {
      if (allowed.some((a) => a.expr === expr)) continue;
      const idx = text.indexOf(`title: ${expr}`);
      out.push({ file, expr, line: text.slice(0, idx).split("\n").length });
    }
  }
  return out;
}

describe("one name per rec", () => {
  it("no component interpolates a raw rec title into a user-visible string", () => {
    expect(
      offenders(),
      "Resolve the name through recDisplayLabel(id, title).headline (src/data/friendly-labels.ts) " +
        "so the user reads one name per tweak — or, if this genuinely is not a rec name, add it to " +
        "ALLOWED with a reason. Never 'fix' an IPC recTitle arg: receipts stay raw.",
    ).toEqual([]);
  });

  it("the guard actually scans the surfaces (it would notice if the walk broke)", () => {
    const files = tsxFiles();
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain(join("src", "App.tsx")); // the round-4 blind spot
    expect(files).toContain(join("src", "surfaces", "Check.tsx"));
  });

  it("every allowlisted site still exists (a stale exemption is a hiding place)", () => {
    const stale: string[] = [];
    for (const [file, entries] of Object.entries(ALLOWED)) {
      const text = readFileSync(file, "utf8");
      for (const e of entries) {
        if (!text.includes(`title: ${e.expr}`)) stale.push(`${file} → ${e.expr}`);
      }
    }
    expect(stale, "remove exemptions whose code is gone").toEqual([]);
  });
});
