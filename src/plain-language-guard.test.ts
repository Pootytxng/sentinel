import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — same pattern as voice-guard.test.ts.)

// Consumer-language / anti-hype guard (Measurement Platform 2.0, Task H — the "consumer-UI
// plain-language" guard). Section 3 of the train names an AVOID list of hype/jargon framings that
// betray the measurement brand — either overclaiming ("AI-powered", "guaranteed faster"), asserting
// a certainty Compy hasn't earned ("exact cause", "perfect match"), or printing a made-up number
// where only a band is honest ("optimization score", a "%% bottleneck" figure).
//
// This is a PHRASE guard, not a word guard, and that distinction is deliberate. The honest doctrine
// voice USES several of these words in negations that must survive — "not benchmark-grade proof",
// "not a magic boost", the rollback "Guarantee", a hardware-"universal" entry. Banning the bare word
// would punish the correct copy. So only exact hype phrases with zero legitimate use are listed; each
// was verified absent from src/ when this guard was written. It mirrors voice-guard.test.ts (retired
// defensive phrases) and the Rust-side no_verdict_note_ever_carries_a_numeric_confidence guard, which
// bans the same numeric-confidence framing on the experiment note. Confidence is a BAND, never a
// number (docs/METHODOLOGY.md §10).
//
// If this fails: rewrite in measured voice — cite what was measured and its evidence band, never a
// fabricated certainty or score. Do not add your phrase here to pass; that defeats the guard.
const BANNED_PHRASES = [
  "ai-powered", // the measurement brand proves; it does not wave an "AI" flag
  "ai powered",
  "guaranteed faster", // no unqualified performance promise (flagged in friendly-labels.ts as the anti-pattern)
  "exact cause", // correlation is not causation — a candidate to check, never "the exact cause"
  "perfect match", // sessions are "comparable"/"limited", never a "perfect match"
  "optimization score", // no invented composite number
  "% bottleneck", // e.g. "92% bottleneck" — a bottleneck is a band/verdict, not a percentage
  "100% faster", // fabricated magnitude
];

// Scan rendered app copy. Vendor components (third-party class names like `magic-bento-card`) and the
// guard files themselves are excluded — they don't carry consumer-facing product claims.
// `.json` IS SCANNED, and its absence was this guard's biggest hole. Until 2026-08-18 the filter
// below read only `tsx?`, so the guard covered 199 files and NONE of the 18 locale files -- 237,925
// bytes of the exact consumer copy it exists to police (measured, not estimated). Its own header
// says it mirrors voice-guard.test.ts; voice-guard has scanned `tsx?|css|json` the whole time, so
// the two siblings disagreed about where the copy lives and only one of them was right. That is how
// a phrase ruled jargon could walk back in with every guard still green.
//
// `data/` is excluded on purpose and is NOT a baseline-to-pass. It is the Blackbook knowledge
// corpus, where naming the anti-pattern IS the content: data/tricks.json catalogues scam tactics
// for the reader (its "fake optimization score" entry quotes the very phrase banned above), and
// data/terms.json is a glossary that defines technical words. Policing those deletes the education.
const EXCLUDE = /(\.test\.tsx?$)|(-guard\.tsx?$)|(\/vendor\/)|(voice-guard)|(^data\/)/;

// Strip code comments before scanning: the guard targets USER-FACING copy, and a comment that NAMES
// the anti-pattern to warn future devs off it (e.g. friendly-labels.ts documents `no "guaranteed
// faster"`) is exactly the copy we want to keep, not flag. `//` is only treated as a comment when it
// is NOT part of a `://` scheme, so a URL inside a string literal doesn't swallow the rest of a line.
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments (not the // in http://)
}

describe("plain-language guard: hype/jargon framings stay out of app copy", () => {
  it("no banned hype phrase appears in src/ rendered copy", () => {
    const files = (readdirSync("src", { recursive: true }) as string[]).filter(
      (f) => /\.(tsx?|json)$/.test(f) && !EXCLUDE.test(f.replace(/\\/g, "/")),
    );
    const offenders: string[] = [];
    for (const rel of files) {
      const text = stripComments(readFileSync(join("src", rel), "utf8")).toLowerCase();
      for (const phrase of BANNED_PHRASES) {
        if (text.includes(phrase)) offenders.push(`${rel}: "${phrase}"`);
      }
    }
    expect(offenders, `hype/jargon phrase found — rewrite in measured voice:\n${offenders.join("\n")}`).toEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------------------------
// ENGINEER-SPEAK on consumer surfaces (conformance audit 2026-08-18, C-06 + C-08). The owner read
// his own front door and found it written for the person who built it: `ETW · external ·
// anti-cheat safe`, `no temp — this build ships no kernel driver`. The facts were true and worth
// keeping; the voice was wrong. C-08's title is the rule — KEEP THE HONESTY, CHANGE THE VOICE.
//
// This bans the WORD on consumer surfaces, not the FACT. Every term below already has a home that
// survives: `<Term id="etw">` and `<Term id="kernel-driver">` render a glossary explainer, so the
// sentence can read "watched from outside your game" while the precise term stays one hover away,
// and src/data/terms.json (excluded above) defines them at length. Nothing was made vaguer to pass
// this test — "no injection, no kernel driver" became "nothing added to the game, nothing installed
// deep inside Windows", which is the same claim in words a gamer already owns.
//
// WORD BOUNDARIES ARE LOAD-BEARING. Measured while writing this: a substring search for "etw"
// matched 23 locale strings, 17 of them the word "n-etw-ork". A guard that banned the word
// "network" would have been deleted within the week, and deservedly.
const JARGON: { term: string; re: RegExp; say: string }[] = [
  { term: "ETW", re: /\bETW\b/i, say: '"watched from outside your game"' },
  { term: "kernel driver", re: /\bkernel[- ]driver/i, say: '"installed deep inside Windows"' },
  { term: "user space", re: /\buser[- ]space\b/i, say: '"outside Windows\' core"' },
  { term: "user-mode", re: /\buser[- ]mode\b/i, say: '"outside Windows\' core"' },
  { term: "NVML", re: /\bNVML\b/i, say: '"your graphics driver\'s own sensors"' },
  { term: "ADLX", re: /\bADLX\b/i, say: '"your graphics driver\'s own sensors"' },
  { term: "PDH", re: /\bPDH\b/i, say: '"Windows\' own counters"' },
  { term: "IPC", re: /\bIPC\b/i, say: "plain words for how the parts talk" },
  { term: "payload", re: /\bpayload\b/i, say: '"exactly what would be sent"' },
  { term: "registry key", re: /\bregistry key\b/i, say: '"the Windows setting it changes"' },
];

// Two survivors, each allowed for a stated reason rather than because fixing them was awkward.
// A new entry here needs the same: a reason the TERM ITSELF is the point of the sentence.
const ALLOWED: Record<string, string> = {
  "en/monitor.json:monitorPanels.nvidiaUnverifiedTitle":
    "LOCKED rule 5 (CLAUDE.md): the NVIDIA sensor line must keep saying its readings are not yet " +
    "hardware-verified. Rewording a locked honesty claim to satisfy a copy guard is the wrong trade.",
  "zh-CN/monitor.json:monitorPanels.nvidiaUnverifiedTitle": "translation of the LOCKED rule 5 line above.",
  "en/settings.json:behavior.expertView.sub":
    "Expert View's whole promise is showing the exact registry key a tweak touches. Naming it IS " +
    "the feature being described, and this row is what a tinkerer opts INTO.",
};

function copyStrings(): { id: string; text: string }[] {
  const root = join("src", "i18n", "locales");
  const out: { id: string; text: string }[] = [];
  const files = (readdirSync(root, { recursive: true }) as string[])
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => f.endsWith(".json"));
  const walk = (node: unknown, path: string, file: string) => {
    if (typeof node === "string") out.push({ id: `${file}:${path}`, text: node });
    else if (node && typeof node === "object")
      for (const [k, v] of Object.entries(node as Record<string, unknown>))
        walk(v, path ? `${path}.${k}` : k, file);
  };
  for (const rel of files) walk(JSON.parse(readFileSync(join(root, rel), "utf8")), "", rel);
  return out;
}

describe("plain-language guard: engineer-speak stays off consumer surfaces", () => {
  it("catches the real strings it was written for, and does NOT fire on 'network'", () => {
    // DISARM PROOF. These are the exact strings this guard was written to kill, quoted from the
    // copy as it stood before 2026-08-18. If an edit ever loosens a pattern into uselessness, these
    // fail first — a guard that cannot catch its own founding offenders is decoration.
    const caught = (s: string) => JARGON.some((j) => j.re.test(s));
    expect(caught("ETW · external · anti-cheat safe — no injection, no kernel driver."), "the Monitor honesty line").toBe(true);
    expect(caught("no temp — this build ships no kernel driver"), "the Home callout the owner flagged").toBe(true);
    expect(caught("No kernel driver — stays in user space"), "the setup-tour rule").toBe(true);
    expect(caught("GPU sensors via vendor libraries (NVML / ADLX)"), "the monitoring help line").toBe(true);
    expect(caught("You can inspect the exact payload below"), "the receipts consent hint").toBe(true);
    // The trap that would have made this guard unlivable.
    expect(caught("Network driver updated recently"), "'network' contains 'etw' — must NOT match").toBe(false);
    expect(caught("your network connection"), "'network' again").toBe(false);
    // And the replacements it accepted must actually pass, or the fix was not a fix.
    expect(caught("Watched from outside your game — nothing added to the game, nothing installed deep inside Windows. Safe with anti-cheat."), "the replacement copy").toBe(false);
    expect(caught("no CPU temp — needs a sensor app"), "the replacement callout").toBe(false);
  });

  it("no engineer-speak term appears in any locale string", () => {
    const offenders: string[] = [];
    for (const { id, text } of copyStrings()) {
      if (id in ALLOWED) continue;
      for (const j of JARGON) if (j.re.test(text)) offenders.push(`${id}\n    "${j.term}" — say ${j.say} instead`);
    }
    expect(
      offenders,
      "engineer-speak reached a consumer surface. Keep the fact, change the voice — the technical " +
        "term still lives in <Term> and src/data/terms.json:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
