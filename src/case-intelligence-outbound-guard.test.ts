import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// CASE-INTELLIGENCE OUTBOUND GUARD (#220, 2026-08-25) — Tier 1 of the Capability Exception Gate.
//
// WHY THIS EXISTS. Tier 1 is a signed DOWNLOAD of public advisory knowledge: a catalog comes in, no
// machine data goes out. That is a one-word difference from Tier 2 and a one-line difference in
// code — `.get(` versus `.post(` — and it is the whole basis on which the owner approved Tier 1
// separately from the tiers that upload. A download path that grows a body, a query string, a
// header carrying an incident, or a redirect it follows off the allowlist is no longer Tier 1; it
// is Tier 2/3 arriving on Tier 1's consent, which is precisely what the 2026-08-09 decision
// forbids.
//
// `src/outbound-claim-guard.test.ts` asks "is anything live and does the copy still tell the truth".
// This file asks the narrower question that only Tier 1 has: given that a network-capable module now
// exists in this crate, can it be made to carry anything? Every check below is structural. Intent is
// not auditable; shape is.
//
// Paths are repo-root-relative; vitest runs from the repo root (scripts/run-vitest.mjs).

const MODULE = join("src-tauri", "src", "case_intelligence.rs");
const RECEIPTS = join("src-tauri", "src", "receipts.rs");
const REMOTE_RULES = join("src-tauri", "src", "remote_rules.rs");
const SUPPORT_EVIDENCE = join("src-tauri", "src", "support_evidence.rs");
const BLACKBOX = join("src-tauri", "src", "blackbox.rs");
const LIB = join("src-tauri", "src", "lib.rs");
const CONF = join("src-tauri", "tauri.conf.json");

// ── Source normalisation ────────────────────────────────────────────────────────────────────────

// Comments legitimately NAME what the module refuses to do — the module doc says "Tier 1 uploads no
// machine data at all", and a raw-text scan would make documenting the ban the thing that breaks it.
// (That is not hypothetical: it fired on outbound-claim-guard the hour this module landed.) Only
// executable source is in scope. `(?<!:)` keeps `https://…` inside a string literal from reading as
// a line comment — a hard-coded URL is exactly what several checks below are looking for.
export function stripRustComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(?<!:)\/\/[^\n]*/g, " ");
}

// The unit tests legitimately contain hostile-looking INPUT: a local fixture HTTP server (a real
// `TcpListener` on 127.0.0.1) is how the transport is proven to refuse a redirect and honour a size
// cap, and a test asserting that `.post(` is refused has to write `.post(`. Production source is
// therefore the corpus for every shape check. That truncation is only honest while the test module
// is a single block at the tail, which is asserted below.
export function productionSource(source: string): string {
  const at = source.indexOf("#[cfg(test)]");
  return at < 0 ? source : source.slice(0, at);
}

function prod(path: string): string {
  return stripRustComments(productionSource(readFileSync(path, "utf8")));
}

// ── What a Tier 1 request may not be ────────────────────────────────────────────────────────────

type Detector = { id: string; re: RegExp };

// A request that can CARRY something. Tier 1 is approved to ask for a file and read the answer;
// every shape here is a way of putting the user's machine into the question.
const CARRYING_REQUEST: Detector[] = [
  { id: "POST", re: /\.\s*post\s*\(/ },
  { id: "PUT", re: /\.\s*put\s*\(/ },
  { id: "PATCH", re: /\.\s*patch\s*\(/ },
  { id: "DELETE", re: /\.\s*delete\s*\(/ },
  { id: "arbitrary method", re: /\.\s*request\s*\(\s*(reqwest::)?Method/ },
  { id: "request body", re: /\.\s*body\s*\(/ },
  { id: "form body", re: /\.\s*form\s*\(/ },
  { id: "json body", re: /\.\s*json\s*\(\s*&/ },
  { id: "multipart", re: /\bmultipart\b/ },
  { id: "query string", re: /\.\s*query\s*\(/ },
  { id: "custom header", re: /\.\s*header\s*\(/ },
];

// Verbs that describe moving the user's own material off the machine. Tier 3 territory, and Tier 3
// is not authorized by Tier 1.
const UPLOAD_VERBS: Detector[] = [
  { id: "upload", re: /\bupload\w*/i },
  { id: "exfiltrate", re: /\bexfiltrat\w*/i },
  { id: "send_report", re: /\bsend_report\b/i },
  { id: "support bundle", re: /\bsupport[_-]?bundle\b/i },
  { id: "crash dump", re: /\b(minidump|crash_dump|dump_file)\b/i },
  { id: "evidence export", re: /\b(export|preview|clear)_support_evidence\b/ },
];

// Anything that would make one machine distinguishable from another across requests. A header is
// data too; a cookie jar is an account by another name.
const IDENTITY: Detector[] = [
  { id: "cookie", re: /\bcookie\w*/i },
  { id: "install id", re: /\b(install|machine|device|client|user)_id\b/i },
  { id: "authorization", re: /\bAuthorization\b|\bbearer\b/i },
  { id: "api key", re: /\b(api[_-]?key|access[_-]?token|secret)\b/i },
  { id: "hardware id", re: /\b(hwid|serial_number|motherboard_serial)\b/i },
];

// The local facts. If any of these types appear in the fetch path at all, the request has an
// opportunity to describe the machine — and an opportunity is all this guard is willing to fail on.
const LOCAL_FACT_TYPES = [
  "CaseIncidentFacts",
  "CaseLocalFacts",
  "CaseMatchOutcome",
  "CaseIntelligenceMatch",
  "blackbox::Incident",
];

export function detect(source: string, detectors: Detector[]): string[] {
  return detectors.filter((d) => d.re.test(source)).map((d) => d.id);
}

// The transport half of the module: from the pull-path banner to the test module. Narrower than the
// whole file on purpose — `advise` legitimately handles a `CaseIncidentFacts`, and the question this
// slice answers is whether the code that opens a socket can see one.
export function transportSection(source: string): string {
  const body = productionSource(source);
  const at = body.indexOf("─── The pull path");
  if (at < 0) throw new Error("case_intelligence.rs has no '─── The pull path' section banner — the transport slice cannot be located, so this guard would be scanning nothing");
  return stripRustComments(body.slice(at));
}

// ── Corpus helpers ──────────────────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(["node_modules", "dist", "dist-web", "dist-site", ".astro", ".vite"]);
const WEB_EXT = /\.(ts|tsx|js|jsx|mjs|astro|svelte|vue)$/;

function collectWeb(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const rel = join(dir, name);
      let st;
      try {
        st = statSync(rel);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(rel);
        continue;
      }
      if (WEB_EXT.test(name) && !/\.(test|spec)\.[tj]sx?$/.test(name)) out.push(rel);
    }
  };
  walk(root);
  return out.sort();
}

const WEB_NETWORK: Detector[] = [
  { id: "fetch", re: /\bfetch\s*\(/ },
  { id: "XMLHttpRequest", re: /\bXMLHttpRequest\b/ },
  { id: "sendBeacon", re: /\bsendBeacon\s*\(/ },
  { id: "axios", re: /\baxios\b/ },
  { id: "WebSocket", re: /\bnew\s+WebSocket\b/ },
  { id: "EventSource", re: /\bnew\s+EventSource\b/ },
];

/** A Rust `const NAME: &[&str] = &[ ... ];` list, read as its string literals. */
export function readStrList(source: string, name: string): string[] {
  const re = new RegExp("const\\s+" + name + "\\s*:\\s*&\\[&str\\]\\s*=\\s*&\\[([^\\]]*)\\]");
  const m = stripRustComments(source).match(re);
  if (!m) throw new Error(`case_intelligence.rs has no compiled '${name}' list — the allowlist this guard reads does not exist`);
  return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
}

/** Reads a `fn name() -> bool { .. }` gate literal, tolerating a commented body. */
export function rustGateLiteral(source: string, name: string): boolean {
  const at = source.search(new RegExp("fn\\s+" + name + "\\s*\\(\\s*\\)\\s*->\\s*bool"));
  if (at < 0) return false;
  const open = source.indexOf("{", at);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return false;
  const lits = stripRustComments(source.slice(open + 1, end)).match(/\b(true|false)\b/g);
  return lits ? lits[lits.length - 1] === "true" : false;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════

// Everything inside Tier 1 that is NOT the advisory result: the fetch, the trust chain and the
// cache. No module outside case_intelligence.rs may name any of them — that is what makes "one
// transport, in one file, decidable by reading the source" true rather than aspirational.
const TIER1_INTERNALS = [
  "refresh_case_catalog",
  "refresh_with",
  "refresh_from",
  "CaseHttp",
  "ReqwestCaseHttp",
  "reqwest_get",
  "CASE_CATALOG_ENDPOINTS",
  "CASE_CATALOG_ORIGINS",
  "CASE_SIGNING_PUBKEY",
  "CASE_FETCH_DISABLE_FILE",
  "verify_catalog_chain",
  "verify_manifest_with",
  "cache_store_verified",
  "cache_load_verified",
  "cached_catalog",
  "case_cache_dir",
  "parse_catalog",
  "parse_manifest",
];

describe("Tier 1 owns its transport, and that transport can only ask", () => {
  const raw = readFileSync(MODULE, "utf8");

  it("the module exists and its test block is a single trailing section", () => {
    // Everything below reads production source by truncating at the first `#[cfg(test)]`. That is
    // only honest while there is exactly one, at the tail.
    expect(existsSync(MODULE)).toBe(true);
    expect(raw.split("#[cfg(test)]").length - 1, "more than one test block — productionSource() would stop reading real code").toBe(1);
    expect(productionSource(raw).length).toBeGreaterThan(1000);
  });

  it("only this module holds Tier 1's transport", () => {
    // The trust-domain neighbours must not reach Tier 1 AT ALL. Each already has, or is forbidden
    // from having, a transport of its own, and a shared symbol is how two domains quietly become one.
    for (const path of [RECEIPTS, REMOTE_RULES, SUPPORT_EVIDENCE]) {
      const body = prod(path);
      expect(
        /case_intelligence/.test(body),
        `${path} reaches case_intelligence. Tier 1 keeps its own key, schema, origins, cache and ` +
          `gate; a neighbour that names it has joined a trust domain it was never reviewed for.`,
      ).toBe(false);
    }

    // The crash station is the ONE consumer, and consuming is not transporting. Narrowed on
    // 2026-08-25 when task 7 attached the optional match to an incident and this line went red for
    // the right file and the wrong reason: "nobody may name Tier 1" would have barred the advisory
    // from ever being SHOWN, which is the entire point of building it. So the bar moved from "may
    // not mention" to "may not fetch, verify or cache", which is what the module boundary is for.
    const bb = prod(BLACKBOX);
    for (const sym of TIER1_INTERNALS) {
      expect(
        bb.includes(sym),
        `${BLACKBOX} names ${sym}. The crash station reads the RESULT; fetching, verifying and ` +
          `caching stay inside case_intelligence.rs, where the guards in this file can see them.`,
      ).toBe(false);
    }

    // And what it may name is a CLOSED list, so widening the seam is a reviewed diff line here
    // rather than a call site that lands unnoticed.
    const named = new Set<string>();
    for (const m of bb.matchAll(/case_intelligence::(?:{([^}]*)}|(\w+))/g)) {
      for (const part of (m[1] ?? m[2]).split(",")) {
        const name = part.trim();
        if (name) named.add(name);
      }
    }
    expect([...named].sort(), "the Tier 1 seam into the crash station changed").toEqual([
      "CaseIntelligenceMatch",
      "CaseMatchOutcome",
      "advise",
      "case_intelligence_gate",
      "local_facts_from",
    ]);
  });

  it("the fetch path asks for a file and cannot carry one", () => {
    const found = detect(transportSection(raw), CARRYING_REQUEST);
    expect(
      found,
      `Tier 1's transport carries: ${found.join(", ")}. A download is GET only — a body, a query ` +
        `string or a custom header is a channel out, and an upload path needs its own gate, its own ` +
        `consent and its own owner sign-off (Tier 2/3).`,
    ).toEqual([]);
  });

  it("the fetch path actually issues a GET, so 'no POST' is not passing by being empty", () => {
    const section = transportSection(raw);
    expect(section, "no `.get(` in the transport section — the corpus is empty and every check above is vacuous").toMatch(/\.\s*get\s*\(/);
  });

  it("nothing in the module moves the user's own material", () => {
    const found = detect(stripRustComments(productionSource(raw)), UPLOAD_VERBS);
    expect(found, `Tier 1 names an upload shape: ${found.join(", ")}`).toEqual([]);
  });

  it("no request can be told apart from any other machine's", () => {
    const found = detect(transportSection(raw), IDENTITY);
    expect(
      found,
      `Tier 1's transport carries identity: ${found.join(", ")}. A signed public download must look ` +
        `the same from every machine, or it is a fingerprint with a file attached.`,
    ).toEqual([]);
  });

  it("no local fact can reach the request", () => {
    const section = transportSection(raw);
    const reachable = LOCAL_FACT_TYPES.filter((t) => section.includes(t));
    expect(
      reachable,
      `the fetch path can see ${reachable.join(", ")}. The incident never travels: matching happens ` +
        `entirely on the user's side of the wire, and the only way to keep that true structurally is ` +
        `for the code that opens the socket to have no access to the facts.`,
    ).toEqual([]);
  });

  it("the URL is picked from a compiled list, never built from anything local", () => {
    const section = transportSection(raw);
    // A URL assembled at runtime is where a fingerprint hides: `format!("{base}?gpu={vendor}")`.
    const built = [...section.matchAll(/format!\s*\(\s*"[^"]*https?:/gi)].map((m) => m[0]);
    expect(built, `a URL is being built with format!: ${built.join(", ")}`).toEqual([]);
  });
});

describe("the allowlists are compiled in, and the catalog cannot change them", () => {
  const raw = readFileSync(MODULE, "utf8");

  it("both lists exist, and this build ships them empty", () => {
    // Two separate lists, and both matter: ENDPOINTS is where a manifest may be asked for, ORIGINS
    // is where the manifest is then allowed to point. Empty in this build, so no fetch can resolve
    // even if the gate were flipped by accident.
    expect(readStrList(raw, "CASE_CATALOG_ENDPOINTS")).toEqual([]);
    expect(readStrList(raw, "CASE_CATALOG_ORIGINS")).toEqual([]);
  });

  it("the vendor source list is https-only and carries no query or credential", () => {
    // CASE_SOURCE_ORIGINS is what a catalog entry's `source_url` may point at — a link the user
    // clicks, not a request Compy makes. Still an allowlist, still compiled, still checked.
    const sources = readStrList(raw, "CASE_SOURCE_ORIGINS");
    expect(sources.length, "the vendor origin allowlist is empty — entries could cite anywhere").toBeGreaterThan(0);
    for (const origin of sources) {
      expect(origin, `${origin} must be https`).toMatch(/^https:\/\//);
      expect(origin, `${origin} carries a query or credential`).not.toMatch(/[?#@]/);
    }
  });

  it("the endpoint allowlist is a compiled constant, not something a document can add to", () => {
    const section = transportSection(raw);
    // The allowlist arrives as a parameter so tests can inject a local fixture, and the ONLY
    // production value passed is the compiled constant. A catalog field feeding it would mean a
    // signed document could nominate its own next endpoint — remote configuration by another name.
    expect(section).toMatch(/CASE_CATALOG_ENDPOINTS/);
    for (const shape of [/endpoints\s*\.\s*push/, /endpoints\s*=\s*[^=]/, /Vec<&str>\s*=\s*catalog/, /manifest\s*\.\s*endpoints/, /catalog\s*\.\s*endpoints/]) {
      expect(section, `the endpoint list is mutated or read from a document: ${shape}`).not.toMatch(shape);
    }
  });

  it("no field in the signed schema can enable, configure or redirect the transport", () => {
    // The wire types are the surface a signed document actually reaches. If none of them names an
    // endpoint, an origin, a poll interval or an enable flag, then no catalog — however well signed
    // — can turn Tier 1 on, point it somewhere new, or make it talk more often.
    //
    // Slice the RAW source, THEN strip comments. The closing marker is a comment banner, so stripping
    // first erases it, indexOf answers -1, and slice(from, -1) runs quietly to the end of the file —
    // sweeping the transport’s own `endpoint:` parameters into the "schema" and failing this test for
    // a reason it was never asking about. (bug→guard, #220: it fired in exactly that shape.) Both
    // anchors are asserted, so a moved banner is a loud failure rather than a silent widening.
    const src = productionSource(readFileSync(MODULE, "utf8"));
    const from = src.indexOf("pub(crate) struct CaseEntry");
    const to = src.indexOf("─── Match result");
    expect(from, "the wire schema no longer begins at CaseEntry").toBeGreaterThan(-1);
    expect(to, "the ‘Match result’ banner moved — the schema slice is unanchored").toBeGreaterThan(from);
    const schema = stripRustComments(src.slice(from, to)).toLowerCase();
    for (const banned of ["endpoint", "origin", "fetch", "enable", "poll", "interval", "telemetry", "callback", "webhook"]) {
      expect(schema, `the signed schema carries a '${banned}' field — a document could steer the transport`).not.toMatch(new RegExp("\\b" + banned + "\\w*\\s*:"));
    }
  });

  it("redirects are refused rather than followed", () => {
    const section = transportSection(raw);
    expect(section, "no redirect policy is set — reqwest follows up to 10 hops by default, straight off the allowlist").toMatch(/redirect\s*\(\s*(reqwest::)?redirect::Policy::none\s*\(\s*\)\s*\)/);
    expect(section).not.toMatch(/Policy::limited|Policy::custom/);
  });

  it("the response is size-capped and time-capped", () => {
    const section = transportSection(raw);
    expect(section, "no timeout on the client — a hung endpoint would hang the caller").toMatch(/\.\s*timeout\s*\(/);
    expect(section, "no size cap on the response body").toMatch(/max_bytes|MAX_BYTES/);
  });
});

describe("Tier 1 stays dark, and nothing remote can wake it", () => {
  const raw = readFileSync(MODULE, "utf8");
  const body = stripRustComments(productionSource(raw));

  it("the gate hard-returns false", () => {
    expect(rustGateLiteral(body, "case_intelligence_gate"), "case_intelligence_gate() is armed").toBe(false);
  });

  it("the kill switch is local and deny-only", () => {
    // Deny-only is the property that matters. A switch that can turn a capability ON is a remote
    // control with a friendly name; this one is a file whose PRESENCE refuses and whose absence
    // decides nothing — the gate still governs.
    expect(body, "no local kill switch").toMatch(/CASE_FETCH_DISABLE_FILE/);
    const fn = body.slice(body.indexOf("fn case_fetch_disabled"));
    expect(fn.slice(0, 400), "the kill switch reads something other than a local file").toMatch(/exists\s*\(\s*\)/);

    // Nothing may re-enable. Every production line that so much as NAMES the switch is read here,
    // and none of them may write it, delete it or sweep it up — the pruner shares that directory,
    // and a switch its own housekeeping can remove is a switch that turns itself back on.
    const touching = body.split(/\r?\n/).filter((l) => l.includes("CASE_FETCH_DISABLE_FILE"));
    expect(touching.length, "nothing references the kill switch — it is decorative").toBeGreaterThan(1);
    for (const line of touching) {
      for (const shape of [/remove_file/, /remove_dir/, /fs::write/, /File::create/, /OpenOptions/]) {
        expect(line.trim(), `something can clear the kill switch: ${shape}`).not.toMatch(shape);
      }
    }
    // And no symbol anywhere that would turn the capability ON.
    for (const shape of [/CASE_FETCH_ENABLE/, /fn\s+enable_case_fetch/, /fn\s+case_fetch_enabled/]) {
      expect(body, `an enabling switch exists: ${shape}`).not.toMatch(shape);
    }
  });

  it("nothing polls on startup", () => {
    // Explicit refresh only. A timer is how a dark capability becomes a live one without a diff
    // anybody reads as arming.
    for (const shape of [/spawn\s*\(/, /set_interval/, /thread::sleep/, /Duration::from_secs\s*\(\s*\d{3,}/]) {
      expect(body, `the module schedules itself: ${shape}`).not.toMatch(shape);
    }
    const lib = prod(LIB);
    expect(lib, "lib.rs calls the refresh at startup — Tier 1 is explicit-refresh only").not.toMatch(/refresh_case_catalog/);
  });

  it("its names never collide with the updater's or remote rules'", () => {
    // Separate endpoint, separate key, separate cache. Shared names are how two trust domains end
    // up sharing a value that only one of them was reviewed for.
    const conf = JSON.parse(readFileSync(CONF, "utf8"));
    const updaterEndpoints: string[] = conf?.plugins?.updater?.endpoints ?? [];
    const tier1 = readStrList(raw, "CASE_CATALOG_ENDPOINTS").concat(readStrList(raw, "CASE_CATALOG_ORIGINS"));
    for (const e of updaterEndpoints) expect(tier1, "Tier 1 shares an endpoint with the updater").not.toContain(e);

    const remote = prod(REMOTE_RULES);
    for (const name of ["CASE_SIGNING_PUBKEY", "CASE_MANIFEST_SIGNING_CONTEXT", "CASE_CACHE_DIR_NAME", "CASE_CATALOG_ENDPOINTS"]) {
      expect(body, `${name} is missing from Tier 1`).toContain(name);
      expect(remote, `${name} is shared with remote rules — the trust domains have merged`).not.toContain(name);
    }
    expect(body, "Tier 1 reuses the remote-rules signing key").not.toMatch(/RULES_SIGNING_PUBKEY/);
  });
});

describe("nothing on the frontend can reach a Tier 1 endpoint", () => {
  it("no web file holds both a network primitive and a case-intelligence identifier", () => {
    const offenders = collectWeb("src")
      .concat(collectWeb("site-app"))
      .filter((f) => {
        const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(?<!:)\/\/[^\n]*/g, " ");
        return /case_intelligence|case_catalog|refresh_case/i.test(src) && detect(src, WEB_NETWORK).length > 0;
      });
    expect(
      offenders,
      "a frontend file wires a network call to case intelligence. Tier 1 is Rust-side only — the " +
        "webview never fetches, which is why the production CSP never has to grow a host:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("the production CSP is unchanged by Tier 1", () => {
    // Pinned in full by src/csp-lockdown-guard.test.ts; pinned to this exact value here so that a
    // Tier 1 change which widens it fails in the Tier 1 guard too, where the author is looking.
    const conf = JSON.parse(readFileSync(CONF, "utf8"));
    expect(conf?.app?.security?.csp?.["connect-src"]).toBe("'self' ipc: http://ipc.localhost");
  });
});

describe("the neighbouring surfaces are unaffected", () => {
  it("support evidence still has no transport of its own", () => {
    const body = prod(SUPPORT_EVIDENCE);
    for (const d of [{ id: "http client", re: /\b(reqwest|ureq|hyper)\b/ }, { id: "socket", re: /\b(std::net|TcpStream)\b/ }, { id: "url", re: /\bhttps?:\/\// }]) {
      expect(d.re.test(body), `support_evidence.rs grew a ${d.id}`).toBe(false);
    }
  });

  it("Receipts stays Tier 2, behind its own gate", () => {
    const receipts = readFileSync(RECEIPTS, "utf8");
    expect(rustGateLiteral(stripRustComments(productionSource(receipts)), "receipts_gate"), "receipts_gate() is armed").toBe(false);
  });
});

// ── Positive controls ───────────────────────────────────────────────────────────────────────────
//
// Every check above is a "must not contain". A typo in a regex, a renamed section banner, a moved
// file — any of those turn the whole file into a standing pass that reads exactly like a green
// build. These prove each detector still bites.

describe("catches the shapes it was written for", () => {
  it("a POST, a body, a query string and a header each fail", () => {
    expect(detect('client.post(URL).send()', CARRYING_REQUEST)).toContain("POST");
    expect(detect('client.get(URL).body(payload)', CARRYING_REQUEST)).toContain("request body");
    expect(detect('client.get(URL).query(&[("gpu", vendor)])', CARRYING_REQUEST)).toContain("query string");
    expect(detect('client.get(URL).header("X-Compy-Machine", id)', CARRYING_REQUEST)).toContain("custom header");
    expect(detect('client.get(URL).send()', CARRYING_REQUEST)).toEqual([]);
  });

  it("an identity or an upload verb fails", () => {
    expect(detect("let jar = cookie::Jar::default();", IDENTITY)).toContain("cookie");
    expect(detect("let install_id = read_install_id();", IDENTITY)).toContain("install id");
    expect(detect("fn upload_case_evidence() {}", UPLOAD_VERBS)).toContain("upload");
  });

  it("a comment describing the ban is not the ban being broken", () => {
    expect(detect(stripRustComments("// never .post( anything here"), CARRYING_REQUEST)).toEqual([]);
    expect(detect(stripRustComments("/* no upload path */"), UPLOAD_VERBS)).toEqual([]);
    // ...but a URL inside a string literal must still be visible.
    expect(stripRustComments('const E: &str = "https://x.test/a";')).toContain("https://x.test/a");
  });

  it("a frontend fetch wired to case intelligence fails", () => {
    const fixture = `const c = await fetch("/case_intelligence/catalog.json");`;
    expect(/case_intelligence/i.test(fixture) && detect(fixture, WEB_NETWORK).length > 0).toBe(true);
  });

  it("a support-evidence URL fails", () => {
    const fixture = `let url = "https://support.example.test/upload"; export_support_evidence();`;
    expect(detect(fixture, UPLOAD_VERBS).length).toBeGreaterThan(0);
    expect(/https?:\/\//.test(fixture)).toBe(true);
  });

  it("a missing allowlist or a missing section banner is an error, never a silent pass", () => {
    expect(() => readStrList("fn nothing() {}", "CASE_CATALOG_ENDPOINTS")).toThrow(/does not exist/);
    expect(() => transportSection("fn nothing() {}")).toThrow(/pull path/);
  });

  it("the gate reader survives a commented body", () => {
    expect(rustGateLiteral("fn g() -> bool {\n  // false would be safer\n  true\n}", "g")).toBe(true);
    expect(rustGateLiteral("fn g() -> bool {\n  // would be: KEY != [0u8; 32]\n  false\n}", "g")).toBe(false);
    expect(rustGateLiteral("fn g() -> bool { true }", "other")).toBe(false);
  });
});

describe("Tier 1's evidence keys and the words a user reads for them", () => {
  // bug→guard (#220, 2026-08-25, IPC contract audit warning 1). `evidence_refs` are KEYS, and the
  // frontend turns each one into a phrase with
  //   t(`gaming.blackBox.knownIssue.evidenceKey.${ref}`, { defaultValue: "" })
  // The `defaultValue: ""` is deliberate and stays: a catalog signed by a newer schema could name a
  // fact this build has no label for, and showing a raw key like `gpu_driver_version` to a user is
  // worse than showing nothing.
  //
  // But it makes the OTHER failure silent too. Add an eighth `EvidenceRequirement` variant without
  // adding its locale line and the ref renders as an EMPTY <li> — no error, no failed build, and
  // nothing a reviewer would notice, because the list simply looks one item shorter than it should.
  // The Rust enum is the only source of these strings (`EvidenceRequirement::key()`; the refs are
  // built from `m.evidence().key()` and `r.key()` and never from catalog text), so the two sides can
  // be compared directly.
  const KEY_FN = /pub\(crate\) fn key\(self\) -> &'static str \{([\s\S]*?)\n    \}/;

  /** Every key `EvidenceRequirement::key()` can return, read out of the source. */
  function rustEvidenceKeys(): string[] {
    const body = KEY_FN.exec(readFileSync(MODULE, "utf8"))?.[1];
    expect(body, "EvidenceRequirement::key() moved or changed shape — this guard went blind").toBeTruthy();
    return [...(body as string).matchAll(/=>\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
  }

  /** The evidenceKey.* labels one locale file carries. */
  function localeEvidenceKeys(locale: string): string[] {
    const json = JSON.parse(readFileSync(join("src", "i18n", "locales", locale, "gaming.json"), "utf8"));
    const node = json?.blackBox?.knownIssue?.evidenceKey;
    expect(node, `${locale}/gaming.json has no blackBox.knownIssue.evidenceKey block`).toBeTruthy();
    return Object.keys(node).sort();
  }

  it("finds the enum at all (the extractor must not silently return nothing)", () => {
    // Falsification anchor. Every assertion below compares two lists, and two empty lists are
    // equal — so a regex that stopped matching would turn this whole block green and vacuous.
    expect(rustEvidenceKeys().length).toBeGreaterThanOrEqual(7);
    expect(rustEvidenceKeys()).toContain("faulting_module");
  });

  for (const locale of ["en", "zh-CN"]) {
    it(`${locale} has a label for every key the matcher can emit, and no orphans`, () => {
      // Equality, not containment, in BOTH directions. A missing label renders an empty list item;
      // a leftover label is a string somebody is still translating for a fact that no longer exists.
      expect(localeEvidenceKeys(locale)).toEqual(rustEvidenceKeys());
    });
  }
});

describe("nothing in Tier 1 is defined and then never reached", () => {
  // bug→guard (#220, 2026-08-25, pre-merge review warning 2). `parse_manifest` shipped with zero
  // callers anywhere — not production, not tests — and, unlike its sibling `parse_catalog`, it
  // validated a manifest with NO signature check at all. Dead code is untidy; dead code shaped like
  // a verification helper is a trap for whoever arms Tier 1 in plan tasks 10–11.
  //
  // The scope is one module on purpose, and so is counting the test block as a call site. Several
  // `pub(crate)` fns here are PRODUCTION-BINDING WRAPPERS — `cached_catalog`, `match_incident`,
  // `verify_catalog_chain`, `refresh_case_catalog` bind the compiled constants, and their only
  // callers today are the tests that prove Tier 1 is dark. That is the module's idiom, not rot.
  // What is banned is a function that nothing anywhere so much as mentions.
  //
  // Known blind spot, stated rather than papered over: a short name like `key` or `level` matches
  // elsewhere in the crate by coincidence, so this catches an orphan with a distinctive name and
  // would miss one called `new`. It is a floor, not a proof.
  const RUST_DIR = join("src-tauri", "src");

  // RECURSIVE on purpose. This used to be a flat `readdirSync`, which was complete only because
  // `src-tauri/src` happens to hold no subdirectory today. The day a module moves into one, a flat
  // read stops seeing it and the orphan check silently covers less than its name says — a dead-code
  // guard that goes quiet is worse than no guard, because the green tick keeps being cited. Skips
  // `target` so pointing this at `src-tauri` itself stays cheap.
  function collectRust(root: string): string[] {
    if (!existsSync(root)) return [];
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const rel = join(dir, name);
        let st;
        try {
          st = statSync(rel);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          if (name !== "target" && !SKIP_DIRS.has(name)) walk(rel);
          continue;
        }
        if (name.endsWith(".rs")) out.push(rel);
      }
    };
    walk(root);
    return out;
  }

  function crateSource(): string {
    return collectRust(RUST_DIR)
      .map((f) => stripRustComments(readFileSync(f, "utf8")))
      .join("\n");
  }

  function declaredNames(moduleSource: string): string[] {
    const prod = stripRustComments(productionSource(moduleSource));
    return [...new Set([...prod.matchAll(/pub\(crate\)\s+fn\s+([a-z_][a-z0-9_]*)/g)].map((m) => m[1]))];
  }

  function orphans(moduleSource: string, corpus: string): string[] {
    return declaredNames(moduleSource).filter((n) => {
      const all = (corpus.match(new RegExp(String.raw`\b${n}\b`, "g")) || []).length;
      const defs = (corpus.match(new RegExp(String.raw`fn\s+${n}\b`, "g")) || []).length;
      return all - defs < 1;
    });
  }

  it("the crate corpus descends into subdirectories, so a moved module cannot go quiet", () => {
    // Falsified against a real nested file rather than a fixture: `src-tauri/examples/sign_manifest.rs`
    // sits one level below `src-tauri`, and `src-tauri/build.rs` sits flat beside it. A flat read of
    // `src-tauri` returns the second and not the first, so this assertion is exactly the difference
    // between the two implementations — it fails the moment the walk stops descending.
    const nested = collectRust("src-tauri").map((f) => f.replace(/\\/g, "/"));
    expect(nested, "the walk no longer descends — the orphan scan now covers less than it claims").toContain(
      "src-tauri/examples/sign_manifest.rs",
    );
    expect(nested).toContain("src-tauri/build.rs");
    // And `target` stays skipped, or this walk becomes a build-output crawl.
    expect(nested.some((f) => f.includes("/target/"))).toBe(false);
    // The production corpus is still non-empty and still the module's own directory.
    expect(collectRust(RUST_DIR).length).toBeGreaterThan(30);
  });

  it("finds the functions at all, so an empty offender list is not vacuous", () => {
    const names = declaredNames(readFileSync(MODULE, "utf8"));
    expect(names.length, "the pub(crate) fn extractor went blind").toBeGreaterThanOrEqual(10);
    expect(names).toContain("advise");
  });

  it("every pub(crate) fn in the module is reached from somewhere in the crate", () => {
    expect(orphans(readFileSync(MODULE, "utf8"), crateSource())).toEqual([]);
  });

  it("catches the exact shape that got through — a function nothing calls", () => {
    const fixture = "pub(crate) fn parse_manifest(json: &str) -> R<CaseCatalogManifest> { todo!() }\n";
    expect(orphans(fixture, stripRustComments(fixture))).toEqual(["parse_manifest"]);
    expect(orphans(fixture, stripRustComments(`${fixture}let m = parse_manifest(body)?;`))).toEqual([]);
    // A mention in a comment is not a call site.
    expect(orphans(fixture, stripRustComments(`${fixture}// parse_manifest is unused for now`))).toEqual([
      "parse_manifest",
    ]);
  });
});
