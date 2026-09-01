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
  file, read three-valued: **`Absent` / `Unreadable` / `Version(u64)`.** The *type* is what holds the
  line. An `Option<u64>` invites `unwrap_or(0)`, which turns `Unreadable` back into `Absent` and hands
  the run a floor of 0 — the invented fallback §2 forbids. A comment cannot stop that; a third case can.
- **P3 — reconciliation, which is the load-bearing part.** The effective floor is computed before
  anything is accepted:

```
effective_floor() -> Option<u64>:                // None = refuse the remote path for this run
  marker  = read_marker()                        // Absent | Unreadable | Version(v)
  cached  = read_generation().and_then(verify)   // signature + SHA-256 bind FIRST, then the floor gate
  witness = cached.map(|g| g.ruleset_version)    // a VERIFIED generation is itself a floor witness
  known   = match (marker, witness):
              (Unreadable, None)    -> return None   // no floor, and nothing to reconcile one from
              (Unreadable, Some(n)) -> n             // the generation restores what the marker lost
              (Absent, _)           -> 0             // genuinely zero; the one honest 0 here
              (Version(v), _)       -> v
  floor = witness.map_or(known, |w| max(known, w))   // NOT unwrap_or(0): never an invented floor
  if floor > known || marker == Unreadable:      // an unreadable marker is REPAIRED, not merely survived
      persist_marker(floor)                      // atomic; BEFORE any remote acceptance
      on failure ->
        if floor > known: return None            // a RISE nothing durable records: refuse this run
        else:             proceed at floor       // a REPAIR only: the witness re-derives it next run
  Some(floor)
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
- **An unreadable marker is repaired on the first run that reconciles one**, which is why the persist
  condition is `floor > known || marker == Unreadable` and not `floor > known` alone. Without the
  second clause `(Unreadable, Some(n))` computes `floor == known == n`, skips the write, and leaves
  the marker unreadable forever — so the machine's whole floor comes to rest on `generation.json`
  staying verifiable, and the day it is not, the run refuses permanently. Fail-closed, and still
  wrong: transient corruption must not become a permanent refusal.
- **A failed `persist_marker` refuses only when the floor ROSE.** The two reasons the write fires are
  not the same event. A rise is durable state that nothing else records, so proceeding would reopen
  the window P3 exists to close. A repair — `floor == known == n`, re-recording what a signature-
  verified generation still on disk already proves — costs nothing if it fails, because the next run
  reconciles the same `n` from the same witness. Collapsing them and refusing for both turns an
  unwritable data directory into a permanent refusal, which is this document's own unreadable-marker
  finding relocated from the marker never healing to the run never proceeding.
- **Reconciling from the generation widens the trust base from one file to two, and that is a real
  cost, not a free reconstruction.** A signature proves a generation was ISSUED; it never proves the
  generation is the NEWEST. An attacker who can write the data directory can corrupt the marker and
  swap the cached generation for an older, validly-signed one, and the floor follows it down. The
  marker was the single anti-rollback anchor; P3 deliberately trades some of that for recoverability,
  and the arming review must weigh it as a trade rather than inherit it as a repair.
- **No marker and no cache** means the machine genuinely has a floor of 0, which is correct rather
  than a fallback. It is the *unreadable* case that must not read as 0 — and when it is unreadable
  with no verifiable generation to reconcile against, there is no floor at all, so the run takes the
  same refusal branch a failed `persist_marker` takes. Accepting anything signed there would be
  precisely the rollback this document exists to close.
- **No new insecure fallback**, and none of this arms anything, opens a network path, or adds
  background work.

## 5. Migration from the existing three-file state

On the first run of the new code, with `generation.json` absent and any of the legacy trio present:

1. Read the legacy marker three-valued, as P2 requires. `Unreadable` → **migrate nothing this run**:
   there is no `generation.json` yet, so there is no witness to reconcile against, and migrating
   against a floor of 0 would let a validly-signed but stale legacy pair install itself as the floor.
   The files stay; the next run retries. Otherwise verify the legacy pair with
   `floor = Absent → 0 | Version(v) → v`.
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
5. An unreadable / corrupt / locked marker **with** a valid generation present yields the generation's
   floor, **not 0**. This one passes against a two-valued marker too — `max()` returns the generation's
   version either way — so it is kept for the reconciliation path and cannot stand alone.
6. An unreadable / corrupt / locked marker with **no** verifiable generation **refuses the remote path**.
   This is the state that actually fails against `unwrap_or(0)`, where the floor drops to 0 and every
   signed generation ever issued becomes acceptable.
7. Signature failure, SHA mismatch, expiry and app-version-range failure each leave the previous
   generation and the previous floor exactly as they were.
8. A publish that fails mid-way leaves no partial generation and no leftover temp.
9. Migration: a verifying legacy trio becomes a generation with the right floor; a non-verifying one
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

**One finding against this document, found in review and fixed here** (session sentinel-63, on #288 at
`25654d16`): §4's first pseudocode wrote `marker.unwrap_or(0)`, collapsing `Unreadable` to `0` and
contradicting the P2 prose two lines above it. Fixture 5 could not catch it — it specified an
unreadable marker *with* a valid generation, where `max()` returns the generation's version whether or
not P2 exists, so it passed against the broken form. The marker is now three-valued, unreadable with
no witness refuses the run, §5's migration takes the same branch, and fixture 5 is split so the second
half can actually fail. **The lesson is the reusable part:** a fixture that passes against the broken
implementation is not coverage, and a comment is not a type.

**Three further findings from the same reviewer against `d31b4940`, all folded in** (comment
5499871021): the persist condition skipped the repair on `(Unreadable, Some(n))`, so the first fix
traded a silent zero for a silent never-heals; reconciling from the generation widens the trust base
from one file to two and the threat model has to say so; and `witness.unwrap_or(0)` was correct but
character-identical to the pattern this document teaches readers to distrust, one line under it. All
three are above.

**Two final findings in a fourth round, both folded in** (comment 5500031121): the persist condition
still collapsed a RISE and a REPAIR, which fail differently — refusing on a failed repair turned an
unwritable data directory into permanent refusal, this document's own unreadable-marker defect
relocated from *the marker never heals* to *the run never proceeds*; and §8 pinned the head of the
commit that introduced it, so it was false on arrival.

**The pattern across all four rounds is worth more than any of them:** every defect here was a
*shape* — a collapsed case, an unstated trade, a familiar idiom, a section asserting a present state
— and **not one was caught by a fixture**. Design review is not redundant with the fixture list; the
fixture list is downstream of it. Sharper still, twice consecutively: **the repair for one shape
produced the next one**, in a document whose whole subject is not inventing fallbacks. So treat any
fix to this design as new unreviewed content, never as a correction that inherits the last verdict.

**Stop condition, honoured:** this document is the design/proof boundary. Nothing in
`src-tauri/src/remote_rules.rs` was changed, no gate was moved, and the remote feature is **not**
reported as fixed by this design.

## 8. Two constraints this lane established, which outlive it

Conditions on the **implementation** lane, not status. Deliberately naming no SHA and no PR state: a
document that pins the head of the commit introducing it is false on arrival, and any sentence about
an open PR stops being true the moment it merges. Current state lives in `docs/RELEASE_STATE.md`.

- **A review verdict binds to the exact head it was written against, and the reason is stronger than
  expiry.** Each round here was raised *against the branch that fixes the previous round*, so the fix
  IS the reviewed content — there is no version of the later verdict that could honestly have been
  bound to the earlier head. Two of the three rounds moved the head; the binding was re-derived each
  time rather than stretched.
- **The independent review available on this repo is practical, not identity-separate.** Both writing
  sessions push under one GitHub account, so a native approval would imitate independence rather than
  evidence it. Verdicts therefore live in PR comments, and `gh api repos/.../pulls/<n>/reviews`
  returns empty even for lanes reviewed three rounds deep — an empty list there is the normal case,
  never evidence that a lane went unreviewed. Any receipt citing such a review must say so in those
  words.

§7's disposition stands: implementation is deferred and is a hard precondition of arming, tracked on
`docs/RELEASE_STATE.md`'s remote-rules row. Still DESIGN ONLY — no fetch armed, no key or CDN,
nothing under `src-tauri/`, no gate moved.
