# Signed remote-rules cache — generation recovery design

> **Design only. Nothing here is implemented, and implementing it is NOT this document's ask.**
> Sidebar remediation **Task 8**, issue [#286](https://github.com/Pootytxng/sentinel/issues/286).
> The remote-fetch gate is hard-false, the signing key is the all-zeros placeholder and no CDN URL is
> configured, so **none of the failures below can happen on any shipped build today**. This records a
> design risk found by reading the code, not observed corruption. Locked rule 4 (`CLAUDE.md`) is
> unchanged: unsigned remote rules must never ship, and the triple gate stays OFF.

## 1. What exists today — read from the code, not assumed

Three independent files under `%APPDATA%\Compy\`:

| file | contents | written by |
|---|---|---|
| `cached-manifest.json` | the signed manifest's **exact bytes** | `save_cached_rules`, `remote_rules.rs:382` |
| `cached-rules.json` | the signed rules' **exact bytes**, SHA-256-bound by the manifest | `save_cached_rules`, `remote_rules.rs:383` |
| `last-seen-ruleset-version.txt` | a plain-text `u64` — the anti-rollback floor | `save_last_seen_ruleset_version`, `remote_rules.rs:367` |

The floor is **read at exactly two places** — `remote_rules.rs:376` (before verifying the cache) and
`remote_rules.rs:408` (before accepting a remote fetch) — and **written at exactly one**,
`remote_rules.rs:412`. The rollback gate itself is `remote_rules.rs:276`:
`manifest.ruleset_version < last_seen_ruleset_version` → `RulesetVersionRegression`.

The accept sequence in `load_rules` (`remote_rules.rs:406–420`) is:

```
A0  verify_chain(raw_manifest, raw_rules, floor)   // signature -> SHA-256 bind -> floor -> expiry -> app range -> parse
A1  create_dir_all
A2  fs::write(cached-manifest.json, N)             // the enclosing save_cached_rules result is DISCARDED at :411
A3  fs::write(cached-rules.json,    N)
A4  fs::write(last-seen-ruleset-version.txt, N)    // result discarded (`let _ =`, :367)
```

## 2. Crash-point matrix against today's code

| crash after | on-disk state | next start | verdict |
|---|---|---|---|
| A2 | manifest N, rules N-1 | SHA-256 bind fails → `load_cached_rules` → `None` → embedded baseline | **safe, degraded.** The previous good pair is destroyed, so the cache is lost, but nothing unsafe loads. |
| A3 | cache N complete, floor still N-1 | cache N verifies against floor N-1 → runs as `Cached` | **UNSAFE.** The floor never advances. A later remote offer of a genuinely signed **N-1** passes `:276` and is accepted — a downgrade to an older, superseded ruleset. This is the exact case this task names. |
| A4 | consistent | — | safe |
| A2/A3 write fails, A4 still runs | floor N, cache broken or stale N-1 | stale N-1 now fails `:276` → embedded | safe, degraded |

**Independent of any crash:** `load_last_seen_ruleset_version` is
`fs::read_to_string(..).ok().and_then(parse).unwrap_or(0)` (`remote_rules.rs:358–363`). An **absent,
unreadable, locked or corrupt marker silently becomes a floor of 0**, and every signed generation
ever issued is then acceptable. This already-existing behaviour is exactly the insecure fallback this
task forbids *inventing* — it is documented here rather than claimed absent, and §4 replaces it.

**Competing writers:** `tauri-plugin-single-instance` makes two Compy processes unlikely, but an
antivirus or backup lock on one of the three files produces the same partial-set shapes as the table
above. No file locking exists today, and none is proposed — the shapes are made safe by structure.

## 3. Why per-file atomic writes are not enough

**Dependency, stated plainly — and since satisfied:** the whole-file `atomic_write` helper this
design builds on **is on `main`** as `src-tauri/src/atomic_write.rs`, landed via issue #281 / PR #282
(`082f637e`, merged 2026-09-01). When this section was written it was still open pending independent
review, and everything below was written conditional on it landing first — so the fallback named here,
P1 growing its own temp-and-rename, is now **moot rather than chosen**. Nothing else in the design
moves. Re-derive rather than trusting this line, which is about a branch state and will age:
`git grep atomic_write origin/main -- src-tauri`.

That helper makes each individual file whole. It does nothing about the **relationship** between
three files: the SHA-256 binding means manifest N with rules N-1 is *detected* (good), but the floor
is a separate object with no binding to either, and that is where the unsafe row comes from. A
transaction over the set is required, and a transaction is explicitly not what that helper is — its
own module doc says so.

## 4. Proposed protocol

Three properties, in the order they matter:

- **P1 — one generation, published or not at all.** Manifest and rules live in **one file**,
  `%APPDATA%\Compy\rules-cache\generation.json`, holding `{ ruleset_version, manifest_b64, rules_b64 }`.
  Base64 round-trips the **exact signed bytes**; nothing is re-serialized, and `verify_chain` still
  runs over the decoded originals. Written through the atomic helper: temp in the same directory,
  then rename. One rename publishes the whole generation, so the A2 row above cannot occur.
- **P2 — a monotonic floor that survives an unreadable marker.** The marker stays a separate small
  file, but is read as `Option<u64>`: **absent / unreadable / unparsable is `None`, never `0`.**
- **P3 — reconciliation, which is the load-bearing part.** The effective floor is computed before
  anything is accepted:

```
effective_floor():
  marker  = read_marker()                       // Option<u64>; None means "unknown", not zero
  cached  = read_generation().and_then(verify)  // signature + SHA-256 bind FIRST, then the floor gate
  floor   = max(marker.unwrap_or(0), cached.map(|g| g.ruleset_version).unwrap_or(0))
  if floor > marker.unwrap_or(0):
      persist_marker(floor)                     // atomic; BEFORE any remote acceptance
      on failure -> REFUSE the remote path for this run (keep serving cache/embedded)
  floor
```

Accepting generation N then becomes: verify against `effective_floor()` → publish the generation
(one rename) → advance the marker. **A crash between those last two steps is no longer unsafe:** the
next start recomputes the floor from the published, verified generation and raises it to N, so an
offered N-1 is rejected. Ordering still matters for availability; reconciliation is what stops it
mattering for safety.

Rules that fall out of this, and that the implementation's own doc must state:

- **Never delete the previous generation to make a publish succeed.** A failed publish leaves the
  previous generation in place, leaves the floor unchanged, and refuses the remote path that run.
- **A failed write never lowers the floor.** The only permitted floor transition is upward.
- **No marker and no cache** means the machine genuinely has a floor of 0, which is correct rather
  than a fallback. It is the *unreadable* case that must not read as 0.
- **No new insecure fallback**, and none of this arms anything, opens a network path, or adds
  background work.

## 5. Migration from the existing three-file state

On the first run of the new code, with `generation.json` absent and any of the legacy trio present:

1. Read the legacy pair; verify it with `floor = legacy_marker.unwrap_or(0)`.
2. If it verifies → publish it as a generation and advance the marker to its `ruleset_version`.
3. If it does not verify → **delete nothing**, ignore it, fall through to the embedded baseline.
4. Legacy files stay on disk; after migration they are never read again. **Their safety is not
   presumed:** a legacy pair that verifies only raises the floor to its own version, which is the
   same reconciliation rule as everything else.

## 6. Fixtures required before any implementation is accepted

Ephemeral signing keys and local fixture directories only — never the production key, never the real
`%APPDATA%`. Each is a test that fails *before* the protocol exists:

1. A signed generation N reloads with **byte-identical** manifest and rules (compare raw bytes, not
   parsed structs).
2. A manifest/rules pair from different generations is rejected (SHA-256 bind).
3. **N-1 is rejected after N has been accepted and the process restarted** — run once with the marker
   write suppressed, to pin the reconciliation path specifically.
4. A crash injected before and after each replacement point cannot lower the persisted floor.
5. An unreadable / corrupt / locked marker with a valid generation present yields the generation's
   floor, **not 0**.
6. Signature failure, SHA mismatch, expiry and app-version-range failure each leave the previous
   generation and the previous floor exactly as they were.
7. A publish that fails mid-way leaves no partial generation and no leftover temp.
8. Migration: a verifying legacy trio becomes a generation with the right floor; a non-verifying one
   is ignored and nothing is deleted.

## 7. Disposition, and the decision this asks for

**DEFER IMPLEMENTATION.** Not because the risk is imaginary — the A3 row is a real downgrade path —
but because **no shipped build can reach it**: `remote_fetch_enabled()` returns a literal `false`
(`remote_rules.rs:97`), `RULES_SIGNING_PUBKEY_BYTES` is all zeros and no CDN URL exists, so
`save_cached_rules` and `save_last_seen_ruleset_version` are unreachable in production. Building the
protocol now means shipping and maintaining a cache format that nothing writes, and the arming lane
needs its own independent security review regardless.

**The decision is "when", not "whether":** this design is a **hard precondition of arming**, recorded
on the "Remote-rules production key + CDN + staged rollout" row of `docs/RELEASE_STATE.md` — the
authoritative gate matrix, and the only place that arming gate is actually tracked (there is no
remote-rules row in `docs/OWNER_ACTION_CHECKLIST.md`). The protocol therefore cannot be skipped on
the day remote rules are turned on. Arming itself remains owner territory and is untouched here.

**Stop condition, honoured:** this document is the design/proof boundary. Nothing in
`src-tauri/src/remote_rules.rs` was changed, no gate was moved, and the remote feature is **not**
reported as fixed by this design.
