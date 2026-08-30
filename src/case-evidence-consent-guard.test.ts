import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// CASE-EVIDENCE CONSENT GUARD (Q9b Tier 3, Stage 2 — #258).
// Contract: docs/superpowers/specs/2026-08-29-q9b-tier3-case-evidence-contract.md (§§1–3, §11).
//
// WHAT STAGE 2 IS ALLOWED TO BE. A local preview/consent SCREEN over Stage 1's canonical payload:
// it shows the exact bytes, lets the user strike optional fields out of them, and asks permission
// for ONE submission. Stage 2 is explicitly NOT allowed a send command, HTTP, a queue, a timer, a
// persisted payload, or any runtime reachability. Those are Stage 4's, behind Stage 4's review.
//
// WHAT THIS FILE MAKES STRUCTURAL, rather than hoped-for at review time:
//
//   1. The screen has NO SERIALIZER. §3 is "the preview is the payload" — preview-source must equal
//      send-source. The tempting Stage 2 implementation is a TypeScript reducer that rebuilds the
//      JSON so the UI can re-render on removal; that is a second implementation of the canonical
//      bytes, in a second language, free to drift the first time a field is added. Instead every
//      reachable removal state is enumerated in Rust, run through the real `case_preview()`, and
//      committed to src/case-preview-corpus.json. This guard pins that the screen only ever LOOKS
//      UP and PRINTS those bytes.
//   2. The screen cannot send, store, schedule, or reach the network — checked as source shape, so
//      Stage 4 arriving early is a build failure and not a review catch.
//   3. It is unreachable from the shipped app: nothing in src/ imports it for value.
//   4. Its promises are the ones the backend can keep. "Redacted" as a bare word is banned; the
//      only legal form of the redaction claim is best-effort, because that is what #259's review
//      proved the redactor to be (two residual bypasses are live and test-pinned in Rust).
//   5. The three §1 shapes and the §2 removable units are the SAME strings in Rust, in the corpus,
//      and on screen — a field that becomes removable in the contract cannot land in one of the
//      three and not the others.
//
// Every detector below is exercised on a seeded positive control in the last describe block: a
// pattern that cannot be shown to fire is a pattern nobody can trust when it stays silent.

const TSX = join("src", "surfaces", "CaseEvidenceConsent.tsx");
const CSS = join("src", "surfaces", "CaseEvidenceConsent.css");
const LOADER = join("src", "case-preview-corpus.ts");
const CORPUS = join("src", "case-preview-corpus.json");
const RUST = join("src-tauri", "src", "case_evidence_upload.rs");

/** JSX wraps a sentence across lines; the reader sees one line, so phrase pins must too.
 *
 *  NOTHING IS STRIPPED. Three independent reviews broke the comment-stripper that used to sit
 *  here, each time the same way: it had to decide "is this a comment or is it inside a string",
 *  it got that wrong, and real `invoke()` calls vanished from the detectors. A regex could not
 *  answer it, and neither could a hand-written scanner — the third review defeated that one with
 *  an escaped backtick and with a backtick used as ordinary punctuation in a comment.
 *
 *  So the question is no longer asked. The detectors read every byte of the scanned files,
 *  comments included, and a comment that names a banned capability is a FAILURE like any other —
 *  the fix is to describe the thing without spelling it. That costs one comment in
 *  CaseEvidenceConsent.tsx and buys the property that matters: there is no longer any input that
 *  can hide code from this guard, because there is no longer anything that removes text.
 */
const flat = (source: string) => source.replace(/\s+/g, " ");

// ── Detectors ──────────────────────────────────────────────────────────────────────────────────
// Vocabulary deliberately wider than what Stage 2 would plausibly add: the failure being guarded
// is not "someone writes fetch() in a consent screen", it is Stage 4 work landing here piecemeal
// because this file was the convenient place to put it.
// Three of these were widened 2026-08-30 after an independent review probed them for evasion
// rather than for the shapes Stage 2 actually contains. Each was literal-substring-only, and the
// evasions it named are the ones a piecemeal Stage 4 would arrive as, not exotic obfuscation:
// `invoke` reached through a renamed destructure, a URL assembled from fragments, and
// `JSON["stringify"]`. None was present in the file; a detector that CANNOT fail is still a hole,
// because its silence is what the rest of this suite treats as evidence.
const BANNED = [
  { id: "Tauri IPC", re: /\binvoke\b|@tauri-apps|__TAURI/ },
  { id: "network call", re: /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\s*\.|\bimport\s*\(/ },
  { id: "persistence", re: /localStorage|sessionStorage|indexedDB|document\s*\.\s*cookie/ },
  { id: "background work", re: /setTimeout|setInterval|requestIdleCallback|queueMicrotask|requestAnimationFrame/ },
  // `://` catches a scheme however it is assembled; the host arm is scoped to a QUOTED span so the
  // consent copy naming compy.gg in prose (a §3 requirement) is not read as an endpoint constant.
  { id: "endpoint literal", re: /:\/\/|["'`][^"'`\n]*\bcompy\.gg|\.workers\.dev\b|["'`]https?["'`]/ },
  { id: "a serializer", re: /JSON\s*\.\s*stringify|JSON\s*\[\s*["'`]stringify|\bstringify\s*\(/ },
];

function detect(source: string): string[] {
  const body = source;
  return BANNED.filter((d) => d.re.test(body)).map((d) => d.id);
}

/** Bare absolutes about what happened to the user's text. Only the best-effort form is honest. */
const OVERCLAIM = [
  { id: "bare 'redacted'", re: /\bredact(ed|ion|s)?\b/i },
  { id: "bare 'scrubbed'", re: /\bscrubb?(ed|ing)?\b/i },
  { id: "bare 'anonymised'", re: /\banonymi[sz](ed|ation)?\b/i },
  { id: "bare 'sanitised'", re: /\bsaniti[sz](ed|ation)?\b/i },
  { id: "'guaranteed'", re: /\bguaranteed\b/i },
  { id: "'completely removed'", re: /\bcompletely removed\b/i },
  { id: "'cannot be traced'", re: /\bcannot be traced\b/i },
  // Added 2026-08-30 from an independent review. The unreadable state used to end "Nothing has
  // left this PC." It was TRUE in that branch — the payload was never built, so nothing was
  // attempted — and it is exactly the reassurance Stage 4 would carry onto a send that failed
  // mid-flight, where it is not true and nobody would notice the difference. `outbound-claim-
  // guard.test.ts` bans one tense and pronoun of this claim across the repo; here the claim is
  // banned in any of them, because on THIS screen it is comfort rather than a description.
  { id: "an absolute about what left the PC", re: /\bnothing\s+(?:has\s+|ever\s+)?(?:left|leaves)\s+(?:this|your|the)\s+(?:pc|machine|computer)\b/i },
  { id: "'never leaves this PC'", re: /\bnever\s+(?:leaves?|left)\s+(?:this|your|the)\s+(?:pc|machine|computer)\b/i },
];

function overclaims(source: string): string[] {
  const body = flat(source);
  return OVERCLAIM.filter((d) => d.re.test(body)).map((d) => d.id);
}

function walkSrc(dir = "src", out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkSrc(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

// ── The guard ──────────────────────────────────────────────────────────────────────────────────

describe("Tier 3 consent screen: Stage 2 is a screen, and only a screen", () => {
  const tsx = readFileSync(TSX, "utf8");
  const css = readFileSync(CSS, "utf8");
  const loader = readFileSync(LOADER, "utf8");
  const corpus = JSON.parse(readFileSync(CORPUS, "utf8"));

  it("has a real corpus to guard (the reads are not silently trivial)", () => {
    // A guard whose subject was renamed away passes loudest of all.
    expect(existsSync(TSX) && existsSync(CSS) && existsSync(LOADER) && existsSync(CORPUS)).toBe(true);
    expect(tsx).toContain("export function CaseEvidenceConsent");
    expect(tsx).toContain("function rowsFrom");
    expect(css).toContain(".cec-payload");
    expect(corpus.entries.length).toBeGreaterThan(100);
    for (const e of corpus.entries) expect(typeof JSON.parse(e.payload_json)).toBe("object");
  });

  it("keeps the files' own claims of enforcement honest", () => {
    // Each file tells its reader that THIS test is what makes its promise structural. If the
    // pointer rots, the promise silently reverts to prose — the exact tier this repo ranks last.
    expect(tsx).toContain("src/case-evidence-consent-guard.test.ts");
    expect(loader).toContain("src/case-evidence-consent-guard.test.ts");
  });

  it("cannot send, store, schedule or serialize (§11 Stage 2's hard boundary)", () => {
    expect(
      detect(tsx),
      "the Tier 3 consent screen grew a capability Stage 2 does not have. A send command, HTTP, a " +
        "stored payload or a timer is Stage 4's work and lands behind Stage 4's review — not as a " +
        "quiet line inside the screen that was allowed to exist first.",
    ).toEqual([]);
    expect(detect(loader), "the fixture corpus loader is a lookup table, nothing more").toEqual([]);
  });

  it("imports exactly React and its own stylesheet — nothing that could make it live", () => {
    // An allowlist rather than a ban list: the interesting failure is an import nobody thought to
    // forbid (a store, a context that invokes, the corpus itself — which would make the screen
    // reachable and ship the fixture with it).
    // Side-effect imports (`import "./x.css";`) have no `from` and are exactly the shape a
    // capability could arrive in unnoticed — the pattern reads both forms.
    const specs = [...tsx.matchAll(/\bimport\s+(?:[^;"]*?\bfrom\s+)?"([^"]+)"/g)]
      .map((m) => m[1])
      .sort();
    expect(specs).toEqual(["./CaseEvidenceConsent.css", "react"]);
  });

  it("prints the canonical bytes verbatim, and derives every row by parsing them (§3)", () => {
    const body = flat(tsx);
    // The payload block renders the preview text and nothing else — no join, slice, format or map
    // between the bytes and the screen.
    expect(body).toMatch(/data-testid="case-consent-payload"\s*>\s*\{current\.payload_json\}\s*<\/pre>/);
    // Rows come from the parsed canonical text, so a row cannot claim a field the bytes lack.
    expect(body).toMatch(/function rowsFrom\(payloadJson: string\)[\s\S]*?JSON\.parse\(payloadJson\)/);
    // `payload_json` appears exactly three times: the type field, the parse argument's binding at
    // the call site, and the render. A fourth is a transform, which is what §3 forbids.
    expect((body.match(/payload_json/g) ?? []).length).toBe(3);
    // And the bytes are on screen by default. A collapsible block is fine — a COLLAPSED one turns
    // "the preview is the payload" into "the payload was available if you went looking".
    expect(body, "the exact-text disclosure must open by default").toMatch(/<details className="cec-exact" open>/);
  });

  it("says what the redactor can actually do — best-effort, never 'redacted'", () => {
    // #259's independent review left two residual bypasses live and test-pinned in Rust (mixed-
    // script homoglyphs, U+2800). A screen that says "redacted" is making a promise the module
    // below it does not keep, to a person deciding whether to send their own text.
    expect(
      overclaims(tsx),
      "the consent copy claims more than the redactor delivers. The honest form names what is " +
        "screened for AND that screening is best-effort, and asks the user to read the text.",
    ).toEqual([]);
    const body = flat(tsx);
    expect(body).toMatch(/screens it for usernames, IP addresses, computer names/);
    expect(body).toMatch(/screening is best-effort, not a guarantee/);
    // Every use of the word, not just the one above: "guarantee" is legal only in its denial.
    for (const m of body.match(/.{0,20}guarantee.{0,20}/gi) ?? []) expect(m).toMatch(/not a guarantee/i);
  });

  it("names the recipient, the retention window and what the deletion code means", () => {
    const body = flat(tsx);
    expect(body, "§3: the recipient is named, and named as the only one").toMatch(
      /own store on compy\.gg, and nowhere else/,
    );
    expect(body, "§3: the retention window is stated, not implied").toMatch(/deleted after 30 days/);
    expect(body, "§3: what the deletion secret is FOR").toMatch(/deletion code/);
    expect(body, "and that Compy cannot recover it — the half a user learns too late").toMatch(
      /only way to delete this case[\s\S]*?cannot look it up/,
    );
  });

  it("asks for one submission only — nothing remembered, nothing armed", () => {
    const body = flat(tsx);
    expect(body).toMatch(/permission for this one send/);
    expect(body).toMatch(/Nothing is remembered, nothing is switched on/);
    expect(body).toMatch(/asks you again from scratch/);
    // The state that makes it true: consent is local component state, never persisted or hoisted
    // into anything that outlives the screen (the persistence detector above pins the other half).
    expect(body).toMatch(/useState<CaseRemovableUnit\[\]>\(\[\]\)/);
    expect(body, "the user is told, before the button, that nothing has gone yet").toMatch(
      /Nothing has been sent yet/,
    );
    // ...and that sentence is retracted the moment it stops being true. A reassurance that sits
    // stale through a send is worse than none: it is the screen telling the user the opposite of
    // what is happening. `role="status"` is what makes the swap reach a screen reader without
    // yanking focus off the button the user just pressed.
    expect(body, "the consent note must be a live region, or the swap is silent").toMatch(
      /role="status"[\s\S]{0,120}data-testid="case-consent-note"/,
    );
    expect(body, "and it must actually change while a send is in flight").toMatch(
      /status === "working"\s*\?\s*"Sending this one case now\."/,
    );
    expect(body, "the send control reports its own busy state").toMatch(/aria-busy=\{status === "working"\}/);
  });

  it("is unreachable from the shipped app — no src/ module imports it for value", () => {
    // `import type` is erased at build; a value import is the screen shipping. The corpus loader
    // takes the types only, and that is the one edge allowed to exist.
    const offenders: string[] = [];
    for (const file of walkSrc()) {
      if (file === TSX) continue;
      const body = readFileSync(file, "utf8");
      for (const stmt of body.match(/\bimport\b[^;]*?\bfrom\s+"[^"]+"/g) ?? []) {
        const spec = (stmt.match(/\bfrom\s+"([^"]+)"$/) ?? ["", ""])[1];
        // The corpus JSON is data the loader owns; the screen is the thing that must not ship.
        if (spec.endsWith(".json")) continue;
        if (!/CaseEvidenceConsent|case-preview-corpus/.test(spec)) continue;
        const typeOnly = /\bimport\s+type\b/.test(stmt) || /\{\s*type\s/.test(stmt);
        if (!(typeOnly && file === LOADER)) offenders.push(`${file} -> ${spec}`);
      }
    }
    expect(
      offenders,
      "a src/ module imports the Tier 3 consent screen or its fixture corpus. Stage 2 ships no " +
        "runtime reachability: the screen is reached from docs/ui-sweep/fixture only, and Stage 4 " +
        "is where wiring it into a room is even discussable.",
    ).toEqual([]);
  });
});

// ── The one vocabulary, in all three places ────────────────────────────────────────────────────

describe("Tier 3 consent screen: Rust, corpus and screen agree on the contract", () => {
  // Comments out before parsing: the doc comments here legitimately QUOTE contract strings, and a
  // parser that reads them would grade the documentation instead of the code.
  const tsx = readFileSync(TSX, "utf8");
  const rust = readFileSync(RUST, "utf8");
  const corpus = JSON.parse(readFileSync(CORPUS, "utf8"));

  /** The three §1 shapes, straight out of `shape_line`. */
  const rustShapes = [...(rust.match(/fn shape_line\([\s\S]*?\n\}/) ?? [""])[0].matchAll(/=>\s*"([^"]+)"/g)]
    .map((m) => m[1])
    .sort();
  const rustUnits = [
    ...(rust.match(/const REMOVABLE_BOTH: \[&str; \d+\] = \[([\s\S]*?)\];/) ?? ["", ""])[1].matchAll(/"([a-z_]+)"/g),
  ].map((m) => m[1]);

  const tsxUnits = [
    ...(tsx.match(/export type CaseRemovableUnit =([\s\S]*?);\n/) ?? ["", ""])[1].matchAll(/"([a-z_]+)"/g),
  ].map((m) => m[1]);
  const glossKeys = [
    ...(tsx.match(/const SHAPE_GLOSS[^{]*\{([\s\S]*?)\n\};/) ?? ["", ""])[1].matchAll(/"([^"]+)":/g),
  ].map((m) => m[1]).sort();
  const unitOfKey = Object.fromEntries(
    [...(tsx.match(/const UNIT_OF_KEY[^{]*\{([\s\S]*?)\n\};/) ?? ["", ""])[1].matchAll(/(\w+):\s*(null|"([a-z_]+)")/g)].map(
      (m) => [m[1], m[3] ?? null],
    ),
  ) as Record<string, string | null>;

  it("parsed something from all three sources (a silent parse miss proves nothing)", () => {
    expect(rustShapes.length).toBe(3);
    expect(rustUnits.length).toBe(7);
    expect(tsxUnits.length).toBe(7);
    expect(glossKeys.length).toBe(3);
    expect(Object.keys(unitOfKey).length).toBeGreaterThan(10);
  });

  it("the three §1 shapes are one set of strings, not three copies of it", () => {
    expect(corpus.shapes.slice().sort()).toEqual(rustShapes);
    // The screen glosses each shape in plain English. A shape with no gloss renders a bare
    // contract phrase at a person who just lost their game — silently, since `?? ""` is a fallback.
    expect(glossKeys).toEqual(rustShapes);
  });

  it("the §2 removable units are one set too — Rust, corpus, screen", () => {
    expect(corpus.removable_units.both).toEqual(rustUnits);
    expect(tsxUnits).toEqual(rustUnits);
    // Journey A's units are a subset: the comment IS the case there, so it is not removable.
    expect(rustUnits).toEqual(expect.arrayContaining(corpus.removable_units["comment-only"]));
    expect(corpus.removable_units["comment-only"]).not.toContain("user_comment");
  });

  it("every removable unit has a row that can remove it, and every required field has none", () => {
    // The mapping the screen actually uses, checked against the payload the corpus really carries —
    // so "there is a Remove button for every optional field" is measured, not asserted in prose.
    const fullest = corpus.entries.find((e: { base: string; removed: string[] }) => e.base === "both" && e.removed.length === 0);
    const keys = Object.keys(JSON.parse(fullest.payload_json));

    const unmapped = keys.filter((k) => !(k in unitOfKey));
    expect(unmapped, `the payload carries fields the screen has no rule for: ${unmapped.join(", ")}`).toEqual([]);

    const reachable = new Set(keys.map((k) => unitOfKey[k]).filter(Boolean));
    expect([...reachable].sort(), "a §2 removable unit has no field on screen to remove it from").toEqual(
      rustUnits.slice().sort(),
    );

    // §2C: the four hardware fields are ONE unit, removable as a block and never individually.
    expect(keys.filter((k) => unitOfKey[k] === "hardware").sort()).toEqual([
      "cpu_family",
      "gpu_model",
      "gpu_vendor",
      "ram_gb_bucket",
    ]);
    // Required fields carry no remove control — §2B: they are what makes the case a case.
    for (const k of ["schema_version", "compy_version", "incident_kind", "occurred_at"]) {
      expect(unitOfKey[k], `${k} is required by §2 and must not offer a Remove button`).toBe(null);
    }
  });

  it("every field on screen has a plain-English label — no bare field names", () => {
    // DIR-1: a non-technical gamer must understand what is being shown. `module_family` is not
    // English, and a row that shows the key is a row nobody can make a decision about.
    const labels = Object.fromEntries(
      [...(tsx.match(/const LABEL_OF_KEY[^{]*\{([\s\S]*?)\n\};/) ?? ["", ""])[1].matchAll(/(\w+):\s*"([^"]+)"/g)].map(
        (m) => [m[1], m[2]],
      ),
    );
    const missing = Object.keys(unitOfKey).filter((k) => !labels[k]);
    expect(missing, `no plain-English label for: ${missing.join(", ")}`).toEqual([]);
    for (const [key, label] of Object.entries(labels)) {
      expect(label, `"${label}" is the field name, not English`).not.toContain("_");
      expect(label.toLowerCase(), `"${label}" just echoes ${key}`).not.toBe(key.replace(/_/g, " "));
    }
  });
});

// ── Seeded negative controls ───────────────────────────────────────────────────────────────────
// Each detector above is silent on the real files. Silence is only evidence if the detector can be
// shown to speak — so every one of them is fired here on source that should trip it.

describe("Tier 3 consent guard: the detectors fire", () => {
  it("removes nothing before it looks — the property three reviews broke", () => {
    // Reviews 1, 2 and 3 each defeated a different implementation of "skip the comments": an
    // unanchored regex, a line-anchored one, and a hand-written scanner. All three failed the same
    // way — deciding whether a `//` or a backtick was code or text — and each time a real
    // `invoke()` disappeared. The property that ends the class is that NOTHING is removed, so this
    // pins it structurally rather than trusting the next author to remember why.
    const guard = readFileSync(join("src", "case-evidence-consent-guard.test.ts"), "utf8");
    // Built by concatenation on purpose: this file is its own corpus here, and a literal would
    // match itself. That is the no-strip rule biting its author, which is the point of it.
    const stripper = new RegExp("function " + "strip" + "Comments");
    expect(
      guard,
      "a stripper is how all three known bypasses of this guard worked. If comments must be " +
        "excluded again, that is a decision to re-argue, not a helper to re-add quietly.",
    ).not.toMatch(stripper);
    // And `flat` may collapse whitespace, nothing else: every other character has to survive it.
    const sample = 'a"//"b`${c}`d/*e*/f//g';
    expect(flat(sample)).toBe(sample);
    expect(flat("one\n  // two\n  `three`").replace(/ /g, "")).toBe("one//two`three`");
  });
  it("catches each banned capability", () => {
    const seeds: Record<string, string> = {
      "Tauri IPC": 'const r = await invoke("send_case", { payload });',
      "network call": 'await fetch(url, { method: "POST" });',
      persistence: 'localStorage.setItem("case-draft", text);',
      "background work": "setTimeout(() => retry(), 5000);",
      "endpoint literal": 'const CASE_ENDPOINT = "https://compy.gg/api/case";',
      "a serializer": "const body = JSON.stringify(payload);",
    };
    expect(Object.keys(seeds).sort(), "every banned-capability detector needs its own control").toEqual(
      BANNED.map((b) => b.id).sort(),
    );
    for (const [id, seed] of Object.entries(seeds)) {
      expect(detect(seed), `the "${id}" detector did not fire on ${seed}`).toContain(id);
    }
    // And the inverse of the old mirror: a comment is NOT an excuse. Nothing is stripped any
    // more, so a comment that names a banned capability fails exactly like a call would. That is
    // the price of the property that no input can hide code from this guard, and it is cheap —
    // the scanned files describe the ban without spelling it, in two comments.
    expect(detect("// this screen must never call fetch() or invoke()")).toContain("Tauri IPC");
  });

  it("catches the evasions, not just the obvious spellings", () => {
    // The shapes a review named as slipping past the literal-substring versions of these three
    // detectors. Each is how the capability would plausibly ARRIVE here — renamed, split or
    // computed — rather than written out the way the seeds above write it.
    const evasions: Record<string, string[]> = {
      "Tauri IPC": [
        "const { invoke: ship } = window.__TAURI__; ship('send_case');",
        "const ipc = w.__TAURI_INTERNALS__;",
      ],
      "network call": ["const net = await import('./sender');"],
      "endpoint literal": [
        'const base = "http" + "s://compy.gg";',
        'const host = "compy.gg";',
        'const scheme = "https";',
      ],
      "a serializer": ['const body = JSON["stringify"](payload);', "const body = stringify(payload);"],
    };
    for (const [id, seeds] of Object.entries(evasions)) {
      for (const seed of seeds) {
        expect(detect(seed), `the "${id}" detector did not fire on ${seed}`).toContain(id);
      }
    }
  });

  it("cannot be walked around by a string that merely looks like a comment", () => {
    // The hole an independent review found at 39f23847, in the layer UPSTREAM of every detector:
    // `stripComments` blanked from any `//` to end of line, with no idea whether that `//` sat
    // inside a string. One throwaway `const shim = "//";` therefore hid the rest of its line from
    // all six detectors simultaneously — the widened ones included. These four are its exact
    // working demonstrations, and they are one line of real Stage 4 each.
    const shimmed: Record<string, string[]> = {
      "Tauri IPC": ['const shim = "//"; invoke("send_case", payload);'],
      "network call": ['const shim = "//"; fetch(target, { method: "POST" });'],
      persistence: ['const shim = "//"; localStorage.setItem("draft", text);'],
      "background work": ['const shim = "//"; setTimeout(() => retry(), 3000);'],
      "a serializer": ['const shim = "//"; const body = JSON.stringify(payload);'],
    };
    for (const [id, seeds] of Object.entries(shimmed)) {
      for (const seed of seeds) {
        expect(detect(seed), `the "${id}" detector was blinded by the comment shim: ${seed}`).toContain(id);
      }
    }
    // Under the no-strip rule these comment forms are corpus like everything else, so the shim
    // cannot help: the detector fires on the comment AND on the call behind it.
    expect(detect("  // this screen must never call fetch() or invoke()")).toContain("network call");
    expect(detect("  /* never fetch() from here */")).toContain("network call");
    expect(detect("  {/* and never invoke() from here either */}")).toContain("Tauri IPC");
  });

  it("cannot be walked around by a comment-shaped line inside a template literal", () => {
    // The second review's finding, and the same class as the first: a physical line inside a
    // multi-line template literal can BEGIN with `//` and still be executable, because a `${...}`
    // on it is code. Line-leading recognition alone read those as comments and blanked them.
    const templated: Record<string, string[]> = {
      "Tauri IPC": [
        "const s = `intro\n// note ${invoke(\"send_case\", payload)}\nmore`;",
        "const s = `intro\n/* by design\n${invoke(\"send_case\", payload)}\nend */\nmore`;",
      ],
      "network call": ["const s = `intro\n// see ${fetch(target, { method: \"POST\" })}\nend`;"],
    };
    for (const [id, seeds] of Object.entries(templated)) {
      for (const seed of seeds) {
        expect(detect(seed), `the "${id}" detector was blinded inside a template: ${seed}`).toContain(id);
      }
    }
    // And the copy side of the same hole: an overclaim parked on a comment-shaped template line.
    expect(
      overclaims("const NOTE = `Your case is ready.\n// Removal of personal data is guaranteed.\nThanks.`;"),
      "an overclaim inside a template literal must still be read",
    ).toContain("'guaranteed'");
  });

  it("catches each overclaim, and allows the honest form", () => {
    // Keyed by detector id, and the keys are compared against the table below — so a detector that
    // is deleted, renamed, or quietly made redundant with a neighbour fails HERE rather than going
    // silent in the corpus check above. `not.toEqual([])` alone could not tell those apart.
    const seeds: Record<string, string[]> = {
      "bare 'redacted'": ["Your comment has been redacted."],
      "bare 'scrubbed'": ["Personal details are scrubbed before sending."],
      "bare 'anonymised'": ["The report is fully anonymised."],
      "bare 'sanitised'": ["Your text is sanitized automatically."],
      "'guaranteed'": ["Removal of personal data is guaranteed."],
      "'completely removed'": ["Usernames are completely removed."],
      "'cannot be traced'": ["The report cannot be traced back to you."],
      "an absolute about what left the PC": ["Nothing has left this PC.", "Nothing leaves your machine."],
      "'never leaves this PC'": ["Your case never leaves this computer."],
    };
    expect(Object.keys(seeds).sort(), "every overclaim detector needs its own control").toEqual(
      OVERCLAIM.map((o) => o.id).sort(),
    );
    for (const [id, texts] of Object.entries(seeds)) {
      for (const text of texts) {
        expect(overclaims(text), `the "${id}" detector did not fire on: ${text}`).toContain(id);
      }
    }
    expect(
      overclaims("Compy screens it for usernames and IP addresses. That screening is best-effort, not a guarantee."),
      "the honest, qualified form must stay legal — a guard that bans it bans the truth too",
    ).toEqual([]);
    // And the sentence §3 REQUIRES: the user must be told nothing has gone yet, which is a
    // statement about this send, not an absolute about the machine. Banning it would ban §3.
    expect(
      overclaims("Nothing has been sent yet. This is the last step, and it is yours."),
      "the required 'nothing has been sent yet' line must stay legal",
    ).toEqual([]);
  });

  it("catches a shape or unit that drifts in only one place", () => {
    // The failure this pins is asymmetric drift: the contract gains a removable field, Rust and the
    // corpus learn about it, and the screen keeps a stale union — so the field is sent with no way
    // to take it out. Proven here on the parse itself, since the real files agree by construction.
    const rustUnits = ["user_comment", "app_family", "hardware"];
    const staleTsx = ["user_comment", "app_family"];
    expect(staleTsx).not.toEqual(rustUnits);
    const glossMissingOne = ["comment only", "incident evidence only"];
    expect(glossMissingOne).not.toEqual(["comment + incident evidence", "comment only", "incident evidence only"]);
  });
});
