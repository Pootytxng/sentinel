import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// TIER 2 USAGE-ENDPOINT GUARD (Q9a, issue #217).
//
// WHY THIS EXISTS — three failure modes, none of which a type-checker or a green suite would catch,
// because the producer and the receiver are in different languages and different runtimes and never
// import each other:
//
//   1. PRODUCER/RECEIVER VOCABULARY DRIFT — the one that would actually happen. `functions/api/usage.ts`
//      validates `ram_gb_bucket`, `duration_bucket` and `gpu_vendor` against closed sets of exact
//      strings, and those strings are emitted by `ram_gb_bucket`, `duration_bucket` and
//      `gpu_vendor_token` in `src-tauri/src/receipts.rs`. Nothing links them. Renaming a bucket on
//      the Rust side — a one-word edit that compiles, passes clippy and passes every Rust test —
//      would make the receiver 400 every real payload in production, silently, forever. This test
//      re-derives the vocabularies from the Rust source on every run, so that edit fails HERE.
//
//      It was nearly written the other way round and would have shipped broken: the first draft of
//      the receiver guessed "<=8gb"/"8-16gb" and reused a token pattern for duration_bucket, which
//      cannot admit the real "<15min" and "3h+" at all.
//
//   2. THE RECEIPT BECOMING RE-LINKABLE. The whole claim the first-run disclosure makes is that a
//      usage receipt carries nothing that ties two submissions from one PC together. That is a
//      property of two things: `usage_receipts` having no ip_hash column, and the endpoint not
//      binding one into it. Both are one careless line away from being untrue, and the disclosure
//      would keep saying otherwise.
//
//   3. REACHING THE WRONG DATABASE. `compy_waitlist` holds email addresses. `compy_reports` holds
//      anonymous receipts. The endpoint that handles the anonymous half must not hold a binding to
//      the identified half at all — not "must not query it", must not be able to.
//
// It also pins that this lane left the gate dark. Q9a builds the send path; ARMING it
// (`receipts_gate()` -> true) is a separate owner-signed commit with the EU/UK region check in
// front of it, and a lane that quietly armed while adding an endpoint would skip both.

const RECEIPTS_RS = join("src-tauri", "src", "receipts.rs");
const ENDPOINT = join("functions", "api", "usage.ts");
const MIGRATION = join("migrations-reports", "0001_usage.sql");
const WRANGLER = "wrangler.toml";

const read = (p) => readFileSync(p, "utf8");

/** Body of a Rust fn, from its signature to the first line that is a bare `}` at column 0. */
function rustFnBody(source, name) {
  const start = source.indexOf(`fn ${name}(`);
  expect(start, `${name} must exist in ${RECEIPTS_RS}`).toBeGreaterThan(-1);
  const end = source.indexOf("\n}", start);
  expect(end, `${name} must be a closed fn`).toBeGreaterThan(start);
  return source.slice(start, end);
}

const quoted = (s) => [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1]);

/** The exact strings a `new Set([...])` in the endpoint admits. */
function tsSet(source, name) {
  const start = source.indexOf(`const ${name} = new Set(`);
  expect(start, `${name} must exist in ${ENDPOINT}`).toBeGreaterThan(-1);
  const end = source.indexOf(");", start);
  expect(end, `${name} must be a closed Set literal`).toBeGreaterThan(start);
  return new Set(quoted(source.slice(start, end)));
}

describe("Tier 2 usage endpoint — producer/receiver vocabulary", () => {
  const rust = read(RECEIPTS_RS);
  const ts = read(ENDPOINT);

  it("accepts exactly the ram_gb_bucket strings receipts.rs emits", () => {
    const produced = new Set(quoted(rustFnBody(rust, "ram_gb_bucket")));
    expect(tsSet(ts, "RAM_BUCKETS")).toEqual(produced);
  });

  it("accepts exactly the duration_bucket strings receipts.rs emits", () => {
    const produced = new Set(quoted(rustFnBody(rust, "duration_bucket")));
    expect(tsSet(ts, "DURATION_BUCKETS")).toEqual(produced);
  });

  it("accepts exactly the gpu_vendor tokens receipts.rs returns", () => {
    // gpu_vendor_token's body holds two kinds of literal: the needles it matches on
    // (`n.contains("radeon")`) and the tokens it returns. Only the returns are the vocabulary, so
    // strip the needles before collecting.
    const body = rustFnBody(rust, "gpu_vendor_token").replace(/contains\("[^"]*"\)/g, "");
    expect(tsSet(ts, "GPU_VENDORS")).toEqual(new Set(quoted(body)));
  });

  it("pins the schema version the Rust builder stamps", () => {
    expect(rust).toMatch(/schema_version:\s*1\b/);
    expect(ts).toMatch(/SUPPORTED_SCHEMA_VERSION\s*=\s*1\b/);
  });
});

describe("Tier 2 usage endpoint — the receipt stays unlinkable", () => {
  const ts = read(ENDPOINT);
  const sql = read(MIGRATION);

  it("has no ip_hash column on usage_receipts", () => {
    const table = sql.slice(
      sql.indexOf("CREATE TABLE IF NOT EXISTS usage_receipts"),
      sql.indexOf(");", sql.indexOf("CREATE TABLE IF NOT EXISTS usage_receipts")),
    );
    expect(table).not.toMatch(/ip_hash/);
    // Nor any other per-machine handle by another name.
    expect(table).not.toMatch(/machine_id|install_id|device_id|user_id|hostname/i);
  });

  it("never inserts an identifier into usage_receipts", () => {
    const insert = ts.slice(
      ts.indexOf("INSERT INTO usage_receipts"),
      ts.indexOf("INSERT INTO usage_rate"),
    );
    expect(insert.length).toBeGreaterThan(0);
    // ipHash may appear in this slice only as the rate-limit COUNT's parameter, never in the
    // column list. The column list is everything up to the closing paren of the INSERT INTO.
    const columns = insert.slice(0, insert.indexOf("SELECT"));
    expect(columns).not.toMatch(/ip_hash/);
  });

  it("keeps the rate ledger self-pruning, so the hash is short-lived by construction", () => {
    expect(ts).toMatch(/DELETE FROM usage_rate WHERE created_at <= datetime\('now', '-1 hour'\)/);
    // The prune must be inside the same batch as the insert, not a stray statement someone can
    // drop without noticing the retention promise went with it.
    const batch = ts.slice(ts.indexOf("batch(["), ts.indexOf("]);", ts.indexOf("batch([")));
    expect(batch).toMatch(/DELETE FROM usage_rate/);
    expect(batch).toMatch(/INSERT INTO usage_receipts/);
  });
});

describe("Tier 2 usage endpoint — blast radius", () => {
  const ts = read(ENDPOINT);
  const toml = read(WRANGLER);

  it("reaches compy_reports and cannot reach the waitlist database", () => {
    expect(ts).toMatch(/env\.REPORTS/);
    // Comments stripped first: this file's header deliberately DISCUSSES waitlist.ts to explain
    // where the two endpoints differ, and that prose is the opposite of the defect being guarded.
    // What must not exist is executable code that names the other database or its table.
    const code = ts.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/env\.DB\b/);
    expect(code).not.toMatch(/waitlist/i);
  });

  it("declares both databases separately, with distinct ids and migration dirs", () => {
    const bindings = [...toml.matchAll(/binding\s*=\s*"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(bindings).toEqual(["DB", "REPORTS"]);

    const ids = [...toml.matchAll(/database_id\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("73f5e8a3-1827-42e3-8543-9fedc3750532"); // compy_reports, B_land decision

    const dirs = [...toml.matchAll(/migrations_dir\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(dirs).size).toBe(dirs.length);
  });

  it("is POST-only and answers a bare GET honestly", () => {
    expect(ts).toMatch(/export const onRequestGet/);
    expect(ts).toMatch(/status:\s*405/);
  });

  it("loads nothing from a third party", () => {
    // Same-origin is the site's whole pitch. The only absolute URLs allowed in this file are none.
    const urls = [...ts.matchAll(/https?:\/\/[^\s"'`)]+/g)].map((m) => m[0]);
    expect(urls).toEqual([]);
  });
});

describe("Tier 2 usage endpoint — Q9a builds, it does not arm", () => {
  it("leaves receipts_gate() hard-false", () => {
    const rust = read(RECEIPTS_RS);
    const body = rustFnBody(rust, "receipts_gate");
    expect(body).toMatch(/\bfalse\b/);
    expect(body).not.toMatch(/\btrue\b/);
  });
});
