import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// MUTATION-BOUNDARY GUARD (2026-08-03).
//
// WHY THIS EXISTS — a real defect, not a hypothetical:
//
//   `set_startup_entry_enabled` lived in lib.rs and wrote
//   HKCU\...\Explorer\StartupApproved\Run **directly**: no Snapshot, no receipt, no RollbackAction,
//   no ledger entry. Worse, it SYNTHESISED the value it wrote — vec![flag, 0,0,0,0,0,0,0,0,0,0,0] —
//   destroying the timestamp bytes Windows keeps in the tail. After one toggle the user's prior
//   state was not merely un-restored, it was unrestorable IN PRINCIPLE. Every review of the file
//   passed, because nothing mechanical was watching the boundary: the rollback-first rule lived in
//   prose and in `actions.rs` convention, and prose does not fail a build.
//
// So this guard states the rule mechanically. Compy changes Windows from ONE place —
// `src-tauri/src/actions.rs`, where every change is snapshot → apply → verify → receipt → rollback.
// A registry write, service stop, task disable, power-plan switch, or package removal that appears
// anywhere else in `src-tauri/src` fails this test by construction.
//
// The corpus is INVERTED on purpose (walk everything, exempt explicitly), the same lesson the
// outbound-claim guard learned the hard way: the logic is never the weak part, the corpus is. A new
// backend module is in scope the moment it exists, with no list to remember to update.
//
// Paths are repo-root-relative; vitest runs from the repo root (scripts/run-vitest.mjs).

const BACKEND = join("src-tauri", "src");

// ── Corpus ──────────────────────────────────────────────────────────────────────────────────────

function collect(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const rel = join(dir, name);
    const st = statSync(rel);
    if (st.isDirectory()) {
      out.push(...collect(rel));
    } else if (name.endsWith(".rs")) {
      out.push(rel);
    }
  }
  return out.sort();
}

// A module declared `#[cfg(test)] mod x;` never reaches a release binary, so it cannot be the thing
// that changes a user's machine — `fuzz_support.rs` carries `"'; Stop-Service lsass; #"` as a hostile
// INPUT it feeds the sanitiser, which is the opposite of authority. Derived from the real
// declaration rather than hand-listed: the day that module is promoted to production, this guard
// starts covering it with nothing to remember.
function testOnlyModules(): Set<string> {
  const lib = readFileSync(join(BACKEND, "lib.rs"), "utf8");
  const re =
    /#\[cfg\((?![^\]]*\bnot\s*\(\s*test)[^\]]*\btest\b[^\]]*\)\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/g;
  return new Set([...lib.matchAll(re)].map((m) => join(BACKEND, `${m[1]}.rs`)));
}

// ── Source normalisation ────────────────────────────────────────────────────────────────────────

// Line-scoped escape hatch for source that NAMES a command without running it. Compy's Leftovers
// detector exists to tell the user which guide-era tweak it found ("Disable-MMAgent -mc") and how to
// undo it ("Removable with bcdedit /deletevalue") — that is copy, not authority, and no amount of
// pattern-matching can tell the two apart from the outside. So the author asserts it, on the exact
// line, and `git grep mutation-boundary-allow` lists every assertion in the repo for review.
const ALLOW_MARKER = "mutation-boundary-allow";

// Comments legitimately QUOTE the commands they explain ("// Stop-Service is elevated → real UAC").
// Only executable source is in scope. `(?<!:)` keeps `https://…` inside a string literal from
// reading as a line comment; worst case that hides a real call sitting on a URL line — a false
// negative, never a false positive. Block comments are BLANKED rather than deleted so line
// positions survive for the per-line marker check.
export function stripRustComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(?<!:)\/\/[^\n]*/g, " ");
}

// Test modules hold owner-present QA fixtures that deliberately seed and clean real Windows state
// (history.rs `manual_restore_qa`, gaming_orchestrator.rs service-suspend QA). Those are harnesses a
// human runs at the Secure Desktop, not shipped authority — a `#[cfg(test)]` item is compiled out of
// every release binary, so it cannot be the thing that mutates a user's machine.
//
// Relies on rustfmt's invariant that an item's closing brace sits at the attribute's own
// indentation. `#[cfg(not(test))]` is production code and is deliberately NOT stripped.
export function stripCfgTest(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = /^(\s*)#\[cfg\([^\]]*\btest\b[^\]]*\)\]/.exec(lines[i]);
    if (!m || /\bnot\s*\(\s*test\b/.test(m[0])) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    const closer = `${m[1]}}`;
    let sawBrace = /\{/.test(lines[i].slice(m[0].length));
    let j = i + 1;
    let scanned = 0;
    for (; j < lines.length; j += 1) {
      const line = lines[j].replace(/\s+$/, "");
      if (sawBrace) {
        if (line === closer) {
          j += 1;
          break;
        }
        continue;
      }
      if (/\{\s*$/.test(line)) {
        sawBrace = true;
        continue;
      }
      if (/;\s*$/.test(line)) {
        j += 1;
        break;
      }
      scanned += 1;
      // A `#[cfg(test)]` attribute is always within a few lines of its item. Refusing to run away
      // matters more than covering an exotic shape: an over-eager stripper would silently blind the
      // whole guard, which is the exact failure mode it exists to prevent.
      if (scanned > 8) {
        j = i + 1;
        break;
      }
    }
    i = j;
  }
  return out.join("\n");
}

// ── What counts as changing Windows ─────────────────────────────────────────────────────────────

// Mutating forms ONLY. `powercfg /query`, `bcdedit /enum` and `RegKey::get_value` read the machine
// and are not this guard's business — naming the binary would have made the guard so noisy its
// exemption list would rot into a rubber stamp.
type Detector = { id: string; re: RegExp };

const DETECTORS: Detector[] = [
  // winreg, the direct path — the one the startup defect took.
  {
    id: "registry write (winreg API)",
    re: /\.\s*(create_subkey(_with_flags|_transacted)?|set_value|set_raw_value|delete_value|delete_subkey(_all|_with_flags)?)\s*(::<[^>]*>\s*)?\(/,
  },
  // The same authority spelled as a PowerShell cmdlet inside a command string.
  {
    id: "registry write (PowerShell cmdlet)",
    re: /\b(Set|New|Remove)-ItemProperty\b/i,
  },
  { id: "service state change", re: /\b(Set|Stop|Start|Restart|Suspend|Resume)-Service\b/i },
  { id: "scheduled-task change", re: /\b(Register|Unregister|Enable|Disable|Set)-ScheduledTask\b/i },
  { id: "installed-package removal", re: /\bRemove-Appx(Provisioned)?Package\b/i },
  { id: "network-adapter change", re: /\b(Set-NetAdapter[A-Za-z]*|(Enable|Disable)-NetAdapterBinding|Set-NetTCPSetting|Set-NetOffloadGlobalSetting)\b/i },
  { id: "memory-management change", re: /\b(Set|Enable|Disable)-MMAgent\b/i },
  { id: "process kill", re: /\bStop-Process\b/i },
  { id: "console registry write", re: /\breg(\.exe)?\s+(add|delete)\b/i },
  { id: "boot-configuration write", re: /(^|[\s"'])[-/](set|deletevalue)\b/im },
  {
    id: "power-plan write",
    re: /(^|[\s"'])[-/](setactive|setacvalueindex|setdcvalueindex|duplicatescheme|changename|hibernate)\b/i,
  },
  { id: "console scheduled-task change", re: /\bschtasks(\.exe)?\b[\s\S]{0,200}?[-/](change|create|delete|end)\b/i },
  { id: "console service change", re: /\bsc(\.exe)?\s+(config|stop|start|delete)\b/i },
  { id: "filesystem behaviour write", re: /\bfsutil\b[\s\S]{0,80}?\bbehavior\s+set\b/i },
  { id: "netsh tcp write", re: /\bnetsh\b[\s\S]{0,120}?\btcp\s+set\b/i },
];

// Order matters: `#[cfg(test)]` items go first (they are recognised by their raw attribute lines),
// then marked lines drop out whole, and only then are comments cleared.
export function detect(source: string): string[] {
  const kept = stripCfgTest(source)
    .split("\n")
    .filter((line) => !line.includes(ALLOW_MARKER))
    .join("\n");
  const body = stripRustComments(kept);
  return DETECTORS.filter((d) => d.re.test(body)).map((d) => d.id);
}

// ── The boundary, and the one reasoned exception ────────────────────────────────────────────────

// Every Windows change Compy makes goes through here: typed Snapshot captured BEFORE the write,
// apply, verify, receipt, and a RollbackAction that can put the prior state back byte-for-byte.
const BOUNDARY = join(BACKEND, "actions.rs");

// An exception must name WHY the rollback-first rule is still satisfied — not merely that a write
// exists. "It's convenient" is not a reason; "the ledger already owns the rollback" is.
const EXCEPTIONS: Record<string, string> = {
  [join(BACKEND, "game_mode_persist.rs")]:
    "Re-asserts a change the ledger ALREADY owns: it fires only when history::rec_is_active('game-mode') " +
    "is true, meaning the original apply captured a Snapshot and a RollbackAction, and it writes the same " +
    "audited actions.rs constants (GAMEBAR_KEY / GAME_MODE_*) back to the same values that apply set. It " +
    "introduces no state the Trust Ledger cannot already undo, and it is idempotent — it writes only when " +
    "Windows has reverted the pair behind the user's back.",
};

describe("mutation-boundary guard: Compy changes Windows from exactly one place", () => {
  const files = collect(BACKEND);
  const testOnly = testOnlyModules();

  it("has a real backend corpus (the walk is not silently empty)", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain(BOUNDARY);
  });

  it("reads the compiled-out module list from the real declarations", () => {
    // If this parse silently returned nothing, test-only modules would be scanned as production —
    // noisy but safe. If it over-matched, production modules would go unscanned — the dangerous
    // direction. Pin both ends against the declaration that exists today.
    expect([...testOnly]).toEqual([join(BACKEND, "fuzz_support.rs")]);
  });

  it("finds no Windows mutation outside the boundary or a reasoned exception", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file === BOUNDARY || file in EXCEPTIONS || testOnly.has(file)) continue;
      const found = detect(readFileSync(file, "utf8"));
      if (found.length) offenders.push(`${file} → ${found.join(", ")}`);
    }
    expect(
      offenders,
      "These files change Windows without going through actions.rs (snapshot → apply → verify → " +
        "receipt → rollback). Move the write into actions.rs behind a typed AppliedAction. If the line " +
        `merely NAMES a command as copy, mark that line \`${ALLOW_MARKER}\`; if a whole module is a ` +
        "reasoned exception, add an EXCEPTIONS entry saying why the Trust Ledger can still undo it.",
    ).toEqual([]);
  });

  it("keeps the boundary actually load-bearing", () => {
    // If actions.rs ever stops holding registry writes, either the boundary moved or the stripper
    // ate the file — both blind this guard, so both must fail loudly rather than pass quietly.
    expect(detect(readFileSync(BOUNDARY, "utf8"))).toContain("registry write (winreg API)");
  });

  it("keeps every exception live, so the list cannot rot into a rubber stamp", () => {
    for (const [file, reason] of Object.entries(EXCEPTIONS)) {
      expect(files, `${file} is exempted but no longer exists`).toContain(file);
      expect(
        detect(readFileSync(file, "utf8")).length,
        `${file} no longer mutates Windows — delete its exception rather than leaving a standing pass`,
      ).toBeGreaterThan(0);
      expect(reason.length, `${file} needs a real reason, not a placeholder`).toBeGreaterThan(80);
    }
  });

  it("keeps the line-level escape hatch small and visible", () => {
    // Not a cap for its own sake: the marker is the one way a mutation verb can sit in production
    // source unchallenged, so its spread is the guard's decay curve. Pinning the count means adding
    // one is a deliberate, reviewed diff line rather than a quiet drift back to the old world.
    const marked: string[] = [];
    for (const file of files) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (line.includes(ALLOW_MARKER)) marked.push(file);
      }
    }
    expect(marked.length, `${ALLOW_MARKER} lines: ${marked.join(", ")}`).toBeLessThanOrEqual(6);
    expect([...new Set(marked)]).toEqual([join(BACKEND, "leftovers.rs")]);
  });

  it("drops only the marked line, never its neighbours", () => {
    const mixed = `
      let note = "Removable with bcdedit /deletevalue (admin)"; // ${ALLOW_MARKER}: copy, not a command
      key.set_value("X", &1u32).ok();`;
    expect(detect(mixed)).toEqual(["registry write (winreg API)"]);
  });

  it("catches the exact shape of the defect it was written for (positive control)", () => {
    // Verbatim shape of the retired lib.rs command: a direct StartupApproved write with a
    // synthesised value and no snapshot anywhere in sight.
    const preFix = `
      #[tauri::command]
      fn set_startup_entry_enabled(name: String, enabled: bool) -> Result<(), String> {
          let hkcu = RegKey::predef(HKEY_CURRENT_USER);
          let (key, _) = hkcu.create_subkey(STARTUP_APPROVED_RUN_KEY).map_err(|e| e.to_string())?;
          let bytes = vec![if enabled { 0x02u8 } else { 0x03u8 }, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
          key.set_raw_value(&name, &RegValue { bytes, vtype: REG_BINARY }).map_err(|e| e.to_string())
      }`;
    expect(detect(preFix)).toContain("registry write (winreg API)");
  });

  it("does not fire on reads, on comments, or on owner-present QA fixtures", () => {
    const benign = `
      // Stop-Service is ELEVATED here → a REAL UAC prompt; see the QA notes.
      /* powercfg /setactive is documented in docs/POWER.md */
      fn read_only() -> Option<u32> {
          let out = quiet_command("powercfg").args(["/q", "SCHEME_CURRENT"]).output().ok()?;
          RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(PATH).ok()?.get_value("HwSchMode").ok()
      }

      #[cfg(test)]
      mod manual_qa {
          const SEED: &str = "Set-ItemProperty -Path 'HKLM:\\\\X' -Name 'Y' -Value 38";
          #[test]
          fn seeds_and_cleans() {
              let _ = elevated(SEED);
          }
      }`;
    expect(detect(benign)).toEqual([]);
  });

  it("does not treat #[cfg(not(test))] production code as a test fixture", () => {
    const production = `
      #[cfg(not(test))]
      fn writes_for_real() {
          key.set_value("X", &1u32).ok();
      }`;
    expect(detect(production)).toContain("registry write (winreg API)");
  });
});
