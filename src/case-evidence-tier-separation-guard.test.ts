import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";

// CASE-EVIDENCE TIER SEPARATION GUARD (Q9b Stage 1, #252) — the contract's §12 rows that go live
// with the Stage 1 module: docs/superpowers/specs/2026-08-29-q9b-tier3-case-evidence-contract.md.
//
// WHY THIS EXISTS: Tier 3 (`case_evidence_upload.rs`) is the module that will one day carry user
// evidence off the machine — the ONLY tier ever authorized to. Its §4 discipline is that it shares
// NOTHING with the other trust domains: not Tier 2's module (receipts), not Tier 1's (the advisory
// catalog), not the privileged remote-rules domain, and above all not the local evidence store.
// The one sanctioned sharing is `hw_class.rs`, a tier-NEUTRAL module of pure classification
// helpers — and neutrality is only real while that module reaches no tier either. None of that
// survives as prose; each line here makes an import a build failure instead of a review hope.
//
// Stage discipline is pinned too: at Stage 1 the module is PURE — no Tauri command, no transport,
// no background construct, and a gate that is hard-false with no caller. Stage 4 (the dark,
// refusing send command) must amend these rows by name, in a diff that says so.

const TIER3 = join("src-tauri", "src", "case_evidence_upload.rs");
const HW_CLASS = join("src-tauri", "src", "hw_class.rs");
const RUST_ROOT = join("src-tauri", "src");
const SELF = join("src", "case-evidence-tier-separation-guard.test.ts");

// ── NOTHING IS STRIPPED (#266) ─────────────────────────────────────────────────────────────────
// Every scan below used to run over a comment-stripped copy of the source, on the theory that a
// comment NAMING a banned module documents the ban rather than breaking it. The sibling guard
// (`case-evidence-consent-guard.test.ts`) held the same theory and three independent reviews broke
// it three different ways — an unanchored regex, a line-anchored one, and a hand-written scanner —
// each time by making a real call vanish from the detectors. Deleting the stripper was the fix
// there; the copy that lived here was strictly worse, because Rust spells the same trap in more
// ways. All of these were run against the deleted implementation on 2026-08-30, and every one of
// them hid genuinely executing code:
//
//   const GLOB: &str = "/*";                     a `/*` inside a STRING opened a comment that ran
//   use crate::receipts::build_receipt_payload;  to the next `*/`, blanking everything between it
//   let c = reqwest::Client::new();              and the close — the import, the transport, a
//   const UNGLOB: &str = "*/";                   `#[tauri::command]`, `thread::spawn`, a caller of
//                                                the gate, a reach into the guarded module
//
//   const P: &str = r#"a /* b"#;                 the same trap in Rust's RAW-STRING spelling, and
//   const B: &[u8] = b"/*";                      again in a BYTE string — neither is TypeScript-
//                                                shaped, so "the sibling's version was the broken
//                                                one" was never true of this file either
//
//   fn f() { let sep = "//"; use crate::receipts::x; }   a `//` inside a string blanked the rest of
//                                                        its line, the import with it
//
//   /* outer /* inner */ use crate::receipts::x; */      and Rust's NESTED block comments failed in
//                                                        the other direction: real comment text
//                                                        came back as "code", so it cried wolf too
//
// So the question "is this text a comment?" is no longer asked, because no regex and no scanner can
// answer it. Every scan below reads every byte of the file, comments included, and a comment naming
// a banned module or capability FAILS exactly like a call would — the fix for one is to describe
// the thing without spelling it. That cost three comments in `hw_class.rs` and one in `lib.rs`, and
// it buys the property that matters: there is no input that can hide code from this guard, because
// nothing removes text any more. The single place the price could not be paid in a reworded comment
// is quarantined by exact bytes below — one named line, never a class of text.
// Pinned structurally by "removes nothing before it looks", at the bottom of this file.

// `case_evidence_upload.rs` is the module this guard fences, and its own doc header contains the
// English word "upload", which the transport vocabulary below matches. Rewording it would mean
// editing the guarded module to satisfy its guard, so the line is quarantined by its EXACT BYTES
// instead: nothing is removed from the source, and a detector match is excused only when the WHOLE
// line it sits on is byte-identical to an entry here. An excuse cannot hide a second thing (the
// line's every byte is spelled out here) and cannot go stale (each entry must still occur in the
// file exactly once — pinned below). To retire it, reword that one doc line and delete this entry.
const TIER3_EXCUSED_LINES = [
  "//! Compy Care Tier 3 (Q9b, #252) — explicit per-case evidence upload. **STAGE 1 ONLY.**",
] as const;

// ── Reachability ───────────────────────────────────────────────────────────────────────────────

const PATH_LEAD = /(?:\bmod\s+|\buse\s+|crate::|super::)/;
const NOT_WORD_CHAR = /(?![A-Za-z0-9_])/;

function referencesModule(source: string, moduleStem: string): boolean {
  const direct = new RegExp(PATH_LEAD.source + moduleStem + NOT_WORD_CHAR.source);
  // A grouped import (`use crate::{receipts::x, other::y};`) puts `{` or `,` between the lead and
  // the stem, which the direct pattern waves through (review finding, 2026-08-29). `[^;]*` cannot
  // cross a statement boundary, and the stem must sit right after `{`/`,` so prose inside a string
  // ("use the receipts tab") stays a non-match.
  const grouped = new RegExp(String.raw`\buse\s+[^;]*[{,]\s*` + moduleStem + NOT_WORD_CHAR.source);
  return direct.test(source) || grouped.test(source);
}

// Rust-side transports, same vocabulary as the outbound guard's — a Stage 1 module that can reach
// the network is Stage 4 arriving without its review.
const RUST_DETECTORS = [
  { id: "http client crate", re: /\b(reqwest|ureq|isahc|attohttpc|surf|hyper|tungstenite)\b/ },
  { id: "raw socket", re: /\b(std::net|TcpStream|TcpListener|UdpSocket|SocketAddr)\b/ },
  { id: "tauri http surface", re: /\b(tauri_plugin_http|tauri::api::http)\b/ },
  { id: "hard-coded URL", re: /\bhttps?:\/\// },
  { id: "shelled-out transfer", re: /\b(Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer|bitsadmin|curl(\.exe)?|wget)\b/i },
  { id: "upload verb", re: /\b(upload|exfiltrat|post_json|send_report)\w*/i },
];

function detectRust(source: string, excused: readonly string[] = []): string[] {
  // The scan is over the WHOLE source, unmodified. The line split exists only to attribute a match
  // to a quarantined line: no detector above can match a newline, so no match spans one, and a
  // match that begins on an excused line sits wholly inside bytes this file spells out in full.
  const lines = source.split("\n").map((l) => l.replace(/\r$/, ""));
  const fired = new Set<string>();
  for (const d of RUST_DETECTORS) {
    for (const m of source.matchAll(new RegExp(d.re.source, d.re.flags + "g"))) {
      const line = lines[source.slice(0, m.index).split("\n").length - 1];
      if (!excused.includes(line)) fired.add(d.id);
    }
  }
  return RUST_DETECTORS.filter((d) => fired.has(d.id)).map((d) => d.id);
}

function collectRustFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const rel = join(dir, name);
      const st = statSync(rel);
      if (st.isDirectory()) walk(rel);
      else if (name.endsWith(".rs")) out.push(rel);
    }
  };
  walk(RUST_ROOT);
  return out.sort();
}

// ── The guard ──────────────────────────────────────────────────────────────────────────────────

describe("case-evidence tier separation: Tier 3 shares nothing with the other trust domains", () => {
  const tier3 = readFileSync(TIER3, "utf8");
  const hwClass = readFileSync(HW_CLASS, "utf8");

  it("has real modules to guard (the reads are not silently trivial)", () => {
    // A guard whose corpus vanished passes loudest of all — a rename must fail HERE, not report a
    // clean bill of health for files that no longer exist.
    expect(existsSync(TIER3) && existsSync(HW_CLASS)).toBe(true);
    expect(tier3).toContain("struct CasePayload");
    expect(tier3).toContain("deny_unknown_fields");
    expect(tier3).toContain("fn case_evidence_gate");
    expect(hwClass).toContain("fn sanitize_token");
    expect(hwClass).toContain("fn ram_gb_bucket");
    expect(hwClass).toContain("fn gpu_vendor_token");
  });

  it("keeps both modules' own claims of enforcement honest", () => {
    // Each module doc tells the reader THIS file is what makes its separation structural. If the
    // doc stops naming this guard — or this guard is renamed out from under it — the promise
    // silently reverts to prose.
    expect(tier3).toContain("src/case-evidence-tier-separation-guard.test.ts");
    expect(hwClass).toContain("src/case-evidence-tier-separation-guard.test.ts");
  });

  it("Tier 3 imports no tier module and never the evidence store (§4)", () => {
    for (const stem of ["receipts", "support_evidence", "case_intelligence", "remote_rules"]) {
      expect(
        referencesModule(tier3, stem),
        `case_evidence_upload.rs reaches ${stem}. Contract §4 is absolute: the shared hardware ` +
          `vocabularies come through the tier-neutral hw_class module, and everything else — ` +
          `consent, gating, transport, the evidence bundle — stays inside its own trust domain.`,
      ).toBe(false);
    }
  });

  it("hw_class stays tier-neutral — it reaches no tier module in either direction", () => {
    // The §4 sharing is only sound while the shared module is genuinely neutral: pure
    // classification helpers that know nothing about consent, gates, payloads, or stores.
    for (const stem of ["receipts", "support_evidence", "case_intelligence", "case_evidence_upload", "remote_rules"]) {
      expect(
        referencesModule(hwClass, stem),
        `hw_class.rs reaches ${stem} — a "neutral" module that imports a tier module is a corridor ` +
          `between trust domains wearing a neutral name.`,
      ).toBe(false);
    }
    // No excuse list, deliberately: hw_class carries none of the transport vocabulary in code OR in
    // prose, and must not start. Its doc names the tiers it stays neutral toward by TIER, not by
    // module path — that is the no-strip rule's price, paid where it can be paid.
    expect(detectRust(hwClass), "hw_class carries pure string/number classification only").toEqual([]);
  });

  it("Stage 1 is pure: no transport, no Tauri command, no background construct", () => {
    expect(
      detectRust(tier3, TIER3_EXCUSED_LINES),
      "Tier 3's Stage 1 module gained a transport shape. The send path is Stage 4's, behind its " +
        "own review — it does not arrive as a quiet line inside the payload module.",
    ).toEqual([]);
    expect(tier3, "no command surface at Stage 1 — registration is Stage 4's diff").not.toContain("tauri::command");
    expect(
      tier3,
      "no background/queue construct — §7: sending is synchronous and user-attended, and nothing " +
        "here may run when the user is not looking",
    ).not.toMatch(/\b(std::thread|thread::spawn|tokio::|async\s+fn|\.await|set_interval|spawn)\b/);
  });

  it("the gate is hard-false and NOTHING calls through it", () => {
    // §11 Stage 1: "case_evidence_gate() may exist only as a hard-false constant nothing calls
    // through." Both halves are structural: the body is literally `false`, and no other file in
    // the crate names the symbol at all.
    //
    // The count comes first, and it is what the no-strip rule costs a POSITIVE assertion: with
    // comments in scope, a doc comment quoting the hard-false signature would satisfy the match
    // below while the real function had changed underneath it. One definition, so the match below
    // is necessarily about that definition.
    expect(
      (tier3.match(/fn case_evidence_gate/g) ?? []).length,
      "exactly one `fn case_evidence_gate` in the module — a second spelling (or a comment quoting " +
        "the signature) would let the hard-false pin below match the wrong one",
    ).toBe(1);
    expect(tier3).toMatch(/fn case_evidence_gate\(\)\s*->\s*bool\s*\{\s*false\s*\}/);
    const callers = collectRustFiles().filter(
      (f) => basename(f) !== "case_evidence_upload.rs" && readFileSync(f, "utf8").includes("case_evidence_gate"),
    );
    expect(
      callers,
      "a file outside the module names case_evidence_gate — Stage 4 territory, its own review. " +
        "Naming it in a COMMENT fails here too: nothing is stripped, so describe the gate instead " +
        "of spelling its symbol, the way lib.rs's `mod` line now does.",
    ).toEqual([]);
  });

  it("the module is wired into the crate as a declaration and nothing more", () => {
    // lib.rs must declare `mod case_evidence_upload;` (dark code that does not compile rots), and
    // no file anywhere may USE a path into it — reachable-by-name is how dark code goes live early.
    const reachers = collectRustFiles().filter((f) => {
      if (basename(f) === "case_evidence_upload.rs") return false;
      const body = readFileSync(f, "utf8");
      if (!/\bcase_evidence_upload\b/.test(body)) return false;
      return basename(f) !== "lib.rs" || /case_evidence_upload::/.test(body);
    });
    expect(
      reachers,
      "a file reaches INTO case_evidence_upload — at Stage 1 only lib.rs's bare `mod` line may name " +
        "it. A comment elsewhere naming the module fails here as well: refer to it as Tier 3, the " +
        "way hw_class.rs now does.",
    ).toEqual([]);
    const lib = readFileSync(join(RUST_ROOT, "lib.rs"), "utf8");
    expect(
      (lib.match(/\bmod\s+case_evidence_upload\s*;/g) ?? []).length,
      "exactly one `mod case_evidence_upload;` in lib.rs — with comments in scope, a second " +
        "occurrence could be prose satisfying this pin while the real declaration was gone",
    ).toBe(1);
  });

  it("only the two proven functions turn a CasePayload into bytes (§3)", () => {
    // Independent review of the S3 repair (#259/#260) named the residual honestly: refusing a
    // shapeless payload inside case_payload_json is a gate you must WALK THROUGH, not a structural
    // impossibility. CasePayload still derives Serialize unconditionally, so a future
    // `serde_json::to_string(&payload)` written anywhere else in the module would serialize bytes
    // the preview refuses to show — quietly, and past both tests that pin the current pair.
    //
    // The reviewer's alternative (a #[serde(remote = "Self")] proxy) enforces it in the type
    // without duplicating the field list, and is the better fix WHEN a real send path exists. Until
    // then this is the cheaper half of the same promise: exactly two call sites, named here.
    //
    // What it is NOT, stated so nobody has to rediscover it: a proof. Three review passes each
    // found another spelling that reached serde_json without matching the previous pattern
    // (`to_writer_pretty`, `use serde_json as sj`, `use serde_json::{self as sj}`), and CasePayload
    // also derives Debug, which stringifies the whole thing by a route no pattern here looks at.
    // This guard is a tripwire against a CARELESS edit; the type-level fix is what stops a
    // determined one, and it lands with the send path in Stage 4.
    // Split on the `mod tests` declaration specifically, not on any `#[cfg(test)]`: a future
    // scattered `#[cfg(test)] fn helper()` would otherwise silently narrow what is scanned.
    const halves = tier3.split(/#\[cfg\(test\)\]\s*mod\s+tests\b/);
    expect(halves.length, "the `#[cfg(test)] mod tests` boundary moved — this guard scans the wrong half").toBe(2);
    const production = halves[0];
    const ALLOWED = ["case_payload_json", "case_preview"];
    const stray: string[] = [];
    // The family, not a list of its members. The reviewer proved a member list is guessable-wrong:
    // `to_writer_pretty` is a real serde_json entry point and was missing from the first version.
    const call = /serde_json::to_[a-z_]+/g;
    for (let m = call.exec(production); m !== null; m = call.exec(production)) {
      const before = production.slice(0, m.index);
      const fn = [...before.matchAll(/\bfn\s+([A-Za-z0-9_]+)/g)].pop();
      stray.push(...(fn && ALLOWED.includes(fn[1]) ? [] : [`${m[0]} in fn ${fn ? fn[1] : "<none>"}`]));
    }
    // Two routes that serialize without ever writing `serde_json::to_`: importing the function by
    // name (this file already does `use serde_json::Value`, so it is the file's own idiom), and
    // driving a Serializer straight off the derived impl.
    const byImport = production.match(/use\s+serde_json::(?:\{[^}]*\b)?to_[a-z_]+/);
    const byWriter = production.match(/serde_json::Serializer\b/);
    // Third route, found by the third review pass injecting it: alias the crate at import and the
    // literal `serde_json::` never appears again, so all of the above go quiet at once. The fourth
    // pass walked through the first version of this line with `use serde_json::{self as sj}` — the
    // same rename in Rust's grouped-import spelling — and the fifth caught the overcorrection:
    // matching any `as` inside a serde_json `use` also fires on `use serde_json::Value as Json`,
    // an ordinary type rename that hides nothing and touches no serializer. Both crate-rename
    // spellings, and only those.
    const byAlias = production.match(
      /use\s+serde_json\s+as\s+[A-Za-z0-9_]+|use\s+serde_json::\{[^}]*\bself\s+as\s+[A-Za-z0-9_]+/,
    );
    stray.push(...(byImport ? [`${byImport[0]} — imported by name, then callable bare`] : []));
    stray.push(...(byWriter ? ["serde_json::Serializer — drives the derived impl directly"] : []));
    stray.push(...(byAlias ? [`${byAlias[0]} — the crate under another name hides every check above`] : []));
    // File-scoped, not type-scoped, on purpose: it fails closed. It cannot tell WHAT is being
    // serialized, so the message says what it actually knows. Comments count as call sites here as
    // well — a doc comment that writes out a third `serde_json::to_…` spelling fails, and the fix
    // is to describe that route rather than write it.
    expect(stray, "an additional serde_json serialization route in this module's production half").toEqual([]);
    // Not vacuous: both allowed call sites must actually be there, or this guard is guarding air.
    expect(production).toMatch(/fn case_payload_json[\s\S]*?serde_json::to_string\b/);
    expect(production).toMatch(/fn case_preview[\s\S]*?serde_json::to_string_pretty\b/);
  });
});

// ── Seeded controls ────────────────────────────────────────────────────────────────────────────

describe("case-evidence tier separation guard: the scans see what they claim to see", () => {
  it("removes nothing before it looks — the property three reviews broke in the sibling guard", () => {
    const guard = readFileSync(SELF, "utf8");
    // Built by concatenation on purpose: this file is its own corpus here, and a literal would
    // match itself. That is the no-strip rule biting its author, which is the point of it.
    const stripper = new RegExp("function\\s+" + "strip" + "\\w*");
    expect(
      guard,
      "a stripper is how every known bypass of this guard and its sibling worked. If comments must " +
        "be excluded again, that is a decision to re-argue with the six shapes at the top of this " +
        "file in hand, not a helper to re-add quietly.",
    ).not.toMatch(stripper);
    // Name-checking alone is not enough, as an independent review told the sibling guard: a
    // differently named transform applied ONLY at the production call sites would leave every
    // seeded control below green, because those pass literal strings. So the call sites are pinned
    // too — each scan is handed the file itself, not an expression over it.
    expect(guard, "the transport scan gets the file and its one quoted excuse, nothing else").toMatch(
      /\bdetectRust\(tier3, TIER3_EXCUSED_LINES\)/,
    );
    expect(guard, "and hw_class is scanned with no excuse list at all").toMatch(/\bdetectRust\(hwClass\)/);
    expect(guard, "the reads are plain, with nothing between the file and the scan").toMatch(
      /const tier3 = readFileSync\(TIER3, "utf8"\);/,
    );
    expect(guard).toMatch(/const hwClass = readFileSync\(HW_CLASS, "utf8"\);/);
    expect(guard, "the crate-wide scans read each file directly too").toMatch(
      /readFileSync\(f, "utf8"\)\.includes\("case_evidence_gate"\)/,
    );
    expect(guard).toMatch(/const body = readFileSync\(f, "utf8"\);/);
  });

  it("the one quoted excuse is exact, single, and still real", () => {
    const tier3 = readFileSync(TIER3, "utf8");
    expect(
      TIER3_EXCUSED_LINES.length,
      "one line is the whole quarantine. A second entry is a policy change: say why it cannot be a " +
        "comment rewrite, in the diff that adds it.",
    ).toBe(1);
    for (const line of TIER3_EXCUSED_LINES) {
      expect(line, "an excused line is one line — a multi-line excuse is a stripper again").not.toContain("\n");
      const occurrences = tier3.split(line).length - 1;
      expect(
        occurrences,
        `the excused line is no longer in ${TIER3} exactly once. A stale excuse is dead weight that ` +
          `reads as protection; a duplicated one is a second place to hide the same bytes. Either ` +
          `re-copy the line verbatim, or (better) reword the module's doc line and delete the entry.`,
      ).toBe(1);
      // The excuse must still be doing something, or it is a hole masking nothing. Exactly one
      // detector fires on it, and it is the one the comment above it names.
      expect(detectRust(line)).toEqual(["upload verb"]);
    }
  });

  it("the shapes that defeated the stripper are all caught now", () => {
    // Each of these hid genuinely executing code from the deleted implementation. They are seeded
    // here so the bypass class cannot come back quietly: to a scan that removes nothing they are
    // ordinary text, and every one of them fires.
    const stringOpensAComment = [
      'const GLOB: &str = "/*";',
      "use crate::receipts::build_receipt_payload;",
      "let c = reqwest::Client::new();",
      'const UNGLOB: &str = "*/";',
    ].join("\n");
    expect(referencesModule(stringOpensAComment, "receipts")).toBe(true);
    expect(detectRust(stringOpensAComment)).toContain("http client crate");

    const rawString = 'const P: &str = r#"a /* b"#;\nuse crate::support_evidence::bundle;\nconst Q: &str = r#"c */ d"#;';
    expect(referencesModule(rawString, "support_evidence")).toBe(true);

    const byteString = 'const B: &[u8] = b"/*";\nuse crate::remote_rules::verify;\nconst E: &[u8] = b"*/";';
    expect(referencesModule(byteString, "remote_rules")).toBe(true);

    const slashInString = 'fn f() { let sep = "//"; use crate::receipts::x; }';
    expect(referencesModule(slashInString, "receipts")).toBe(true);

    // The same trap hid a whole Stage 4 send path. These are the raw-byte checks the guard makes of
    // the real files, run against the shape that used to vanish before they saw it.
    const hiddenSendPath = [
      'const D: &str = "/*";',
      "#[tauri::command]",
      "pub fn send_case() { std::thread::spawn(move || {}); }",
      'const E: &str = "*/";',
    ].join("\n");
    expect(hiddenSendPath).toContain("tauri::command");
    expect(hiddenSendPath).toMatch(/\b(std::thread|thread::spawn|tokio::|async\s+fn|\.await|set_interval|spawn)\b/);

    // Rust's nested block comments broke it the other way — the stripper handed back real comment
    // text as "code" and cried wolf. Under the no-strip rule that is not a special case at all: it
    // is a comment naming a banned module, which fails, and the fix is to reword it.
    const nested = "/* outer\n   /* inner */\n   use crate::receipts::x;\n*/";
    expect(referencesModule(nested, "receipts")).toBe(true);
  });

  it("catches the shapes it was written for (positive controls)", () => {
    expect(referencesModule("use crate::receipts::build_receipt_payload;", "receipts")).toBe(true);
    expect(referencesModule("use crate::{receipts::build_receipt_payload, hw_class::x};", "receipts")).toBe(true);
    expect(referencesModule("use crate::{blackbox::Incident, hw_class::sanitize_token};", "receipts")).toBe(false);
    expect(referencesModule("mod support_evidence;", "support_evidence")).toBe(true);
    expect(referencesModule("let x = super::case_evidence_upload::CASE_SCHEMA_VERSION;", "case_evidence_upload")).toBe(true);
    // A different module with a similar prefix is not a match.
    expect(referencesModule("use crate::receipts_archive::X;", "receipts")).toBe(false);
    // Prose that does not spell a path is still not a reference — that is what makes the price of
    // the no-strip rule payable: `hw_class.rs` names the tiers it stays neutral toward this way.
    expect(referencesModule("//! neutral toward Tier 2 and Tier 3, and imports neither", "receipts")).toBe(false);
    // But describing the ban IN the banned words is a failure now. Three reviews' worth of evidence
    // says the alternative — a scan that decides which text is a comment — cannot be built.
    expect(referencesModule("// never use crate::receipts here", "receipts")).toBe(true);
    expect(detectRust("// this module must never reqwest anything")).toContain("http client crate");
    // Every detector fires on something: silence is only evidence if the detector can speak.
    const seeds: Record<string, string> = {
      "http client crate": "let c = reqwest::Client::new();",
      "raw socket": "let s = std::net::TcpStream::connect(addr);",
      "tauri http surface": "use tauri_plugin_http::reqwest_shim;",
      "hard-coded URL": 'const CASE: &str = "https://compy.gg/api/case";',
      "shelled-out transfer": 'Command::new("curl").arg(url);',
      "upload verb": "fn upload_case(p: &CasePayload) {}",
    };
    expect(Object.keys(seeds).sort(), "every transport detector needs its own control").toEqual(
      RUST_DETECTORS.map((d) => d.id).sort(),
    );
    for (const [id, seed] of Object.entries(seeds)) {
      expect(detectRust(seed), `the "${id}" detector did not fire on ${seed}`).toContain(id);
    }
    // And the excuse is a WHOLE line, not a substring of one: the same bytes with anything else on
    // the line are not excused, so nothing can ride along behind them.
    const excused = TIER3_EXCUSED_LINES[0];
    expect(detectRust(excused, TIER3_EXCUSED_LINES)).toEqual([]);
    expect(detectRust(`${excused} let c = reqwest::Client::new();`, TIER3_EXCUSED_LINES)).toEqual([
      "http client crate",
      "upload verb",
    ]);
  });
});
