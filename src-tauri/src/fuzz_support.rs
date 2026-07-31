//! Test-only input generator for the property/fuzz suites (blueprint §11, Q4).
//!
//! Two Compy surfaces cannot be honestly covered by hand-written examples:
//!
//! * **Persistence parsing.** `history.json` and `gaming-session.json` are user-writable files that
//!   the rollback path trusts. Every byte sequence on disk is a reachable input, including the
//!   torn, truncated, and deliberately hostile ones. The claims worth proving — "never panics",
//!   "an unreadable ledger is never silently treated as empty", "the bytes are preserved" — are
//!   claims about the whole input space, not about a list of cases someone thought of.
//! * **Bounded IPC inputs.** The webview supplies `rec_id`, `service_name`, `task_id`, `app_id`, and
//!   every token that ends up interpolated into an elevated PowerShell command. Those domains are
//!   *bounded*: the security property is that everything outside the bound is refused. That is a
//!   statement about the complement of the allowlist, which no finite example list can make.
//!
//! **No new dependency.** `proptest`/`arbitrary` are not in this tree and adding a crate is out of
//! scope, so generation is a dependency-free xorshift64\* PRNG driven by a FIXED seed table. That
//! makes the suite reproducible rather than merely random: it is not flaky, it runs the same inputs
//! on every machine and every CI-less local gate run, and a failure prints the seed and the exact
//! offending input so the case can be replayed by hand.

/// xorshift64\* — a small, fast, fully deterministic generator. Not cryptographic and not meant to
/// be: the goal is a wide, reproducible walk through the input space.
pub(crate) struct Rng {
    state: u64,
}

impl Rng {
    pub(crate) fn seeded(seed: u64) -> Rng {
        // xorshift dies at zero, so a zero seed maps to the golden-ratio constant.
        Rng {
            state: if seed == 0 { 0x9E37_79B9_7F4A_7C15 } else { seed },
        }
    }

    pub(crate) fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.state = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// Uniform-enough index below `n` (0 when `n` is 0).
    pub(crate) fn below(&mut self, n: usize) -> usize {
        if n == 0 {
            0
        } else {
            (self.next_u64() % n as u64) as usize
        }
    }

    pub(crate) fn flag(&mut self) -> bool {
        self.next_u64() & 1 == 1
    }

    /// Panics on an empty slice — every call site passes a non-empty compile-time catalog.
    pub(crate) fn pick<'a, T>(&mut self, xs: &'a [T]) -> &'a T {
        let i = self.below(xs.len());
        &xs[i]
    }
}

/// Fixed seeds. Deliberately not random and not time-derived: the suite must run the SAME inputs
/// every time, or a green run proves nothing about the next one.
pub(crate) const SEEDS: [u64; 12] = [
    1,
    2,
    3,
    5,
    8,
    13,
    0x5EED,
    0xDEAD_BEEF,
    0x1234_5678_9ABC_DEF0,
    0xFFFF_FFFF_FFFF_FFFF,
    0x0F0F_0F0F_0F0F_0F0F,
    0xA5A5_A5A5_A5A5_A5A5,
];

/// Single characters that must either survive as inert DATA or be refused outright — never be
/// interpreted. Shell/PowerShell metacharacters, quoting, path separators, a NUL, bidi and
/// zero-width controls, Cyrillic homoglyphs for `c`/`s`/`a` (byte-different, eye-identical), and a
/// multi-byte emoji to catch any char-boundary handling that assumes one byte per character.
const HOSTILE_CHARS: &[char] = &[
    '\'', '"', '`', '$', ';', '|', '&', '\\', '/', '\0', '\n', '\r', '\t', ' ', '(', ')', '{', '}',
    '<', '>', '*', '?', '%', '^', '=', '\u{202E}', '\u{200B}', '\u{FEFF}', 'с', 'ѕ', 'а', '😀',
];

/// Whole fragments a real attacker would reach for, plus the structural JSON and numeric edges that
/// break naive parsers.
const HOSTILE_FRAGMENTS: &[&str] = &[
    "'; Stop-Service lsass; #",
    "$(whoami)",
    "`n Remove-Item C:\\ -Recurse -Force",
    "& calc.exe",
    "| Out-File poc.txt",
    "; exit 0",
    "%TEMP%",
    "..\\..\\..\\Windows\\System32\\cmd.exe",
    "../../../etc/passwd",
    "\\\\attacker\\share",
    "SysMain ",
    " SysMain",
    "SYSMAIN",
    "\u{0441}ysMain",
    "game-mode\0",
    "-9223372036854775808",
    "18446744073709551616",
    "1e999",
    "NaN",
    "null",
    "true",
    "{}",
    "[]",
    "[{}]",
    "{\"schema_version\":1}",
    "{\"schema_version\":",
    "\u{202E}nwodkaerb",
    "",
];

/// A string built from hostile fragments, hostile characters, and long runs. Used both as raw file
/// content and as field content inside otherwise well-formed structures.
pub(crate) fn hostile_string(rng: &mut Rng, max_fragments: usize) -> String {
    let n = 1 + rng.below(max_fragments.max(1));
    let mut s = String::new();
    for _ in 0..n {
        match rng.below(10) {
            // A long run: catches anything that assumes a short, bounded token.
            0 => {
                let len = 1 + rng.below(64);
                s.push_str(&"A".repeat(len));
            }
            1 => s.push(*rng.pick(HOSTILE_CHARS)),
            _ => {
                // Bound to a local first: `pick` is generic over `T`, so passing the result
                // straight to `push_str` makes inference try `T = str` (unsized).
                let fragment = *rng.pick(HOSTILE_FRAGMENTS);
                s.push_str(fragment);
            }
        }
    }
    s
}

/// A near-miss of `base`: delete, insert, replace, duplicate, truncate, or case-flip a character.
/// Near-misses are the interesting inputs for an allowlist — `"SysMain "`, `"sysmain"`, `"SysMai"`,
/// and a Cyrillic-`с` `"сysMain"` all have to be refused, and none of them look wrong.
///
/// Operates on `char`s, never bytes, so a mutation can never split a multi-byte character.
pub(crate) fn mutate_text(rng: &mut Rng, base: &str) -> String {
    let mut chars: Vec<char> = base.chars().collect();
    let ops = 1 + rng.below(3);
    for _ in 0..ops {
        if chars.is_empty() {
            chars.push(*rng.pick(HOSTILE_CHARS));
            continue;
        }
        let at = rng.below(chars.len());
        match rng.below(6) {
            0 => {
                chars.remove(at);
            }
            1 => chars.insert(at, *rng.pick(HOSTILE_CHARS)),
            2 => chars[at] = *rng.pick(HOSTILE_CHARS),
            3 => {
                let c = chars[at];
                chars.insert(at, c);
            }
            4 => chars.truncate(at),
            _ => {
                let c = chars[at];
                chars[at] = if c.is_ascii_uppercase() {
                    c.to_ascii_lowercase()
                } else {
                    c.to_ascii_uppercase()
                };
            }
        }
    }
    chars.into_iter().collect()
}
