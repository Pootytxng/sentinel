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

const cp1252 = new TextDecoder("windows-1252");
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

const CP1252_BYTE = new Map();
for (let b = 0; b < 256; b += 1) CP1252_BYTE.set(cp1252.decode(Uint8Array.of(b)), b);

const SCANNED_EXTENSIONS = new Set([
  ".md", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc",
  ".rs", ".toml", ".css", ".scss", ".html", ".astro", ".yml", ".yaml",
  ".ps1", ".psm1", ".sh", ".txt", ".editorconfig",
]);

const utf8SequenceLength = (byte) =>
  byte >= 0xc2 && byte <= 0xdf ? 2 : byte >= 0xe0 && byte <= 0xef ? 3 : byte >= 0xf0 && byte <= 0xf4 ? 4 : 0;

const reEncode = (char) => cp1252.decode(Buffer.from(char, "utf8"));

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
