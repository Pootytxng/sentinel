// bug→guard (forensic CI/workspace pass, 2026-07-27): three docs and src-tauri/Cargo.toml were
// found carrying mojibake — text that was valid UTF-8, read back as CP1252, and re-saved as UTF-8.
// docs/RELEASE_STATE.md (the authoritative gate matrix) had 42 corrupt lines; Cargo.toml had the
// corruption applied five times over. A prior "demojibake" commit (333b725) repaired 2 of 44 lines
// and was reported done, so the class survived a fix. .editorconfig (8bd575a) stops FUTURE editor
// corruption but never repaired committed bytes and cannot detect them.
//
// Detection is structural, not a table of known-bad strings: a mojibake span is a character whose
// CP1252 byte is a UTF-8 lead byte, followed by characters whose CP1252 bytes are continuation
// bytes, where the assembled bytes decode as valid UTF-8. Recovery is that mapping inverted, and
// every span must prove itself — re-encoding the recovered character has to reproduce the exact
// source characters it consumed, or the span is left untouched.
//
// Known limit: text that is genuinely indistinguishable from mojibake is reported rather than
// silently kept. That is the intended reading — this repo has no such content. The literal
// example, exempted from this file's own scan: "Â©"  encoding-guard:allow
//
// Usage:
//   node scripts/encoding-guard.mjs            scan every tracked text file, exit 1 if any is dirty
//   node scripts/encoding-guard.mjs --fix      repair in place, looping until no span remains
//   node scripts/encoding-guard.mjs [files...] scan/repair only the given files
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// bug->guard (CI, 2026-08-01): this table used to be built by asking
// `new TextDecoder("windows-1252")` what each byte decodes to. That decoder is NOT dependable — it
// depends on how the running Node was built against ICU, and it fails SILENTLY:
//
//   node v20   0x80 -> U+0080   0x94 -> U+0094     <- Latin-1 fallback, no windows-1252 table
//   node v22   0x80 -> U+20AC   0x94 -> U+201D     <- correct
//
// CI pins Node 20. So on the exact runtime that is supposed to be enforcing this rule, the map had
// no entry for the euro sign or the curly quotes — precisely the characters mojibake is made of —
// and both `findMojibake` and `recoverMojibake` quietly saw nothing. A guard against silent
// corruption, silently corrupted. It did not throw and it did not warn; it just stopped finding
// anything, which is the worst failure mode a guard has.
//
// The 0x80–0x9F range is the ONLY place windows-1252 differs from Latin-1, and it is a fixed,
// published 32-entry table. Written out rather than derived, for the same reason the test builds its
// fixture "from code points, not pasted": a constant cannot be mis-decoded.
const CP1252_HIGH = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…",
  0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š",
  0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’",
  0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—",
  0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ",
  0x9e: "ž", 0x9f: "Ÿ",
  // 0x81, 0x8d, 0x8f, 0x90 and 0x9d are absent here ON PURPOSE, and the fallback below is what
  // makes that correct. Vendor windows-1252 leaves them undefined, but the WHATWG encoding standard
  // — which is what `TextDecoder("windows-1252")` implements, and therefore what every other tool
  // touching these files agrees with — maps them to their C1 control characters. My first version
  // dropped them, and `peels layered corruption` went red immediately: a table that disagrees with
  // the platform is a different bug wearing the fix's clothes.
};

/**
 * byte -> character, matching TextDecoder("windows-1252") on a Node whose ICU has the table.
 * Total by construction: the 0x80–0x9F specials come from CP1252_HIGH, and every other byte —
 * including the five WHATWG passes straight through — is its own code point.
 */
const cp1252Char = (b) => CP1252_HIGH[b] ?? String.fromCharCode(b);

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

const CP1252_BYTE = new Map();
for (let b = 0; b < 256; b += 1) {
  const ch = cp1252Char(b);
  if (ch !== undefined) CP1252_BYTE.set(ch, b);
}

const SCANNED_EXTENSIONS = new Set([
  ".md", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc",
  ".rs", ".toml", ".css", ".scss", ".html", ".astro", ".yml", ".yaml",
  ".ps1", ".psm1", ".sh", ".txt", ".editorconfig",
]);

const utf8SequenceLength = (byte) =>
  byte >= 0xc2 && byte <= 0xdf ? 2 : byte >= 0xe0 && byte <= 0xef ? 3 : byte >= 0xf0 && byte <= 0xf4 ? 4 : 0;

// Same reason as the table above: map the UTF-8 bytes of `char` through OUR windows-1252 table
// rather than through an ICU table that may not exist on this Node.
const reEncode = (char) => [...Buffer.from(char, "utf8")].map((b) => cp1252Char(b) ?? "�").join("");

// Walks the text once, recovering every span that proves itself. Returns the repaired text and
// each recovery so callers can report precise locations.
export function recoverMojibake(text) {
  const chars = [...text];
  const out = [];
  const spans = [];
  let offset = 0;

  for (let i = 0; i < chars.length; ) {
    const lead = CP1252_BYTE.get(chars[i]);
    const width = lead === undefined ? 0 : utf8SequenceLength(lead);

    if (width) {
      const bytes = [lead];
      let contiguous = true;
      for (let k = 1; k < width; k += 1) {
        const byte = CP1252_BYTE.get(chars[i + k]);
        if (byte === undefined || byte < 0x80 || byte > 0xbf) { contiguous = false; break; }
        bytes.push(byte);
      }
      if (contiguous) {
        let recovered = null;
        try { recovered = strictUtf8.decode(Uint8Array.from(bytes)); } catch { recovered = null; }
        const consumed = chars.slice(i, i + width).join("");
        if (recovered !== null && reEncode(recovered) === consumed) {
          spans.push({ offset, consumed, recovered });
          out.push(recovered);
          offset += recovered.length;
          i += width;
          continue;
        }
      }
    }

    out.push(chars[i]);
    offset += chars[i].length;
    i += 1;
  }

  return { text: out.join(""), spans };
}

// Mojibake can be layered (Cargo.toml carried five passes), so repair loops to a fixpoint.
export function repairToFixpoint(text, maxPasses = 12) {
  let current = text;
  let passes = 0;
  let total = 0;
  for (; passes < maxPasses; passes += 1) {
    const { text: next, spans } = recoverMojibake(current);
    if (!spans.length) break;
    total += spans.length;
    current = next;
  }
  return { text: current, passes, total };
}

// A line may opt out — .editorconfig quotes the corruption on purpose to explain the rule it
// enforces, and repairing that example would destroy its meaning. Mojibake spans never cross a
// newline (a newline is not a continuation byte), so per-line handling is exactly equivalent.
export const ALLOW_MARKER = "encoding-guard:allow";

export function findMojibake(text) {
  const hits = [];
  text.split("\n").forEach((line, index) => {
    if (line.includes(ALLOW_MARKER)) return;
    for (const span of recoverMojibake(line).spans) {
      hits.push({ line: index + 1, consumed: span.consumed, recovered: span.recovered });
    }
  });
  return hits;
}

export function repairText(text, maxPasses = 12) {
  let passes = 0;
  let total = 0;
  const repaired = text.split("\n").map((line) => {
    if (line.includes(ALLOW_MARKER)) return line;
    const result = repairToFixpoint(line, maxPasses);
    passes = Math.max(passes, result.passes);
    total += result.total;
    return result.text;
  });
  return { text: repaired.join("\n"), passes, total };
}

export function trackedTextFiles(cwd = process.cwd()) {
  return execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean)
    .filter((file) => {
      const dot = file.lastIndexOf(".");
      const slash = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
      return dot > slash && SCANNED_EXTENSIONS.has(file.slice(dot).toLowerCase());
    });
}

function readUtf8(file) {
  try {
    return strictUtf8.decode(readFileSync(file));
  } catch {
    return null; // not UTF-8 at all — a different defect, and not this guard's claim
  }
}

function main(argv) {
  const fix = argv.includes("--fix");
  const explicit = argv.filter((arg) => arg !== "--fix");
  const files = explicit.length ? explicit : trackedTextFiles();

  let dirty = 0;
  for (const file of files) {
    const text = readUtf8(file);
    if (text === null) continue;
    const hits = findMojibake(text);
    if (!hits.length) continue;
    dirty += 1;

    if (fix) {
      const { text: repaired, passes, total } = repairText(text);
      writeFileSync(file, Buffer.from(repaired, "utf8"));
      console.log(`FIXED ${file} — ${total} spans over ${passes} pass(es)`);
    } else {
      console.log(`MOJIBAKE ${file} — ${hits.length} span(s)`);
      for (const hit of hits.slice(0, 3)) {
        console.log(`    line ${hit.line}: ${JSON.stringify(hit.consumed)} should be ${JSON.stringify(hit.recovered)}`);
      }
      if (hits.length > 3) console.log(`    ... ${hits.length - 3} more`);
    }
  }

  if (!dirty) {
    console.log(`encoding-guard: ${files.length} tracked text files clean`);
    return 0;
  }
  if (fix) return 0;
  console.log(`\nencoding-guard: ${dirty} file(s) carry double-encoded text. Repair with:\n  node scripts/encoding-guard.mjs --fix`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
