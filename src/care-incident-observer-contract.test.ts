// Compy Care Tier 1 — plan task 9, the persisted local incident observer (the guard the plan names).
//
// The observer is the one piece of Compy that speaks WITHOUT being asked. That earns it the
// tightest contract in the app, because every way it could go wrong is a way to turn a PC doctor
// into adware:
//
//   1. It must have no background machinery. No timer, no service, no scheduled task, no polling
//      loop, no daemon thread. It runs on three named moments and then it is gone. The standing
//      owner bar — Compy is the least resource-hungry app on the PC — is not satisfied by a cheap
//      poll; it is satisfied by no poll.
//   2. It must be local. It reads Windows' own records and writes one small JSON file. A crash
//      observer that grew a transport would be an incident uploader, which is Tier 3 and needs its
//      own owner-signed exception.
//   3. It must never speak about CAUSE. Its DTO carries what happened, not why. The moment a
//      notification says "your GPU driver did this", Compy's hedge has become an alarm and the
//      honest-measurement law is broken by the one surface the user cannot opt out of reading.
//   4. It must not mutate Windows. It lives outside `actions.rs` and has no business there.
//   5. Dismiss must delete nothing. It clears Compy's pointer; the Event Log, the WER report and
//      the reliability record all stay.
//
// The Rust unit tests inside the module prove the OBSERVATION LOGIC (23 of them). This file proves
// the things a unit test structurally cannot: that no machinery exists, that the command surface
// agrees across four files, and that the boundary was not crossed.
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { productionSource, stripRustComments } from "./case-intelligence-outbound-guard.test";

const OBSERVER = join("src-tauri", "src", "incident_observer.rs");
const LIB = join("src-tauri", "src", "lib.rs");
const ACTIONS = join("src-tauri", "src", "actions.rs");
const BUILD = join("src-tauri", "build.rs");
const MAIN_CAP = join("src-tauri", "capabilities", "default.json");

const raw = readFileSync(OBSERVER, "utf8");
// Comments in this module legitimately NAME what it refuses to do ("no timer", "no service"), so a
// raw-text scan would make documenting the ban the thing that breaks it — the same trap
// case-intelligence-outbound-guard records. Executable source only.
const prod = stripRustComments(productionSource(raw));
const lib = readFileSync(LIB, "utf8");
const build = readFileSync(BUILD, "utf8");
const cap = JSON.parse(readFileSync(MAIN_CAP, "utf8"));

const COMMANDS = ["dismiss_care_incident", "get_pending_care_incident", "mark_care_incident_opened"];

describe("the module has no background machinery", () => {
  it("keeps its unit tests in one block at the tail, so 'production source' is honest", () => {
    // Every scan below reads only the slice before `#[cfg(test)]`. A second test block further up
    // would hide real code from all of it.
    const blocks = raw.split("#[cfg(test)]").length - 1;
    expect(blocks, `${blocks} #[cfg(test)] blocks — the production/test split this file relies on is gone`)
      .toBe(1);
    // ...and that nothing production-shaped lives after it. A cheap "is it near the end of the
    // file?" heuristic would be the wrong test: this module's 23 unit tests are legitimately ~45%
    // of it. What actually matters is that the tail is nothing BUT tests.
    const tail = raw.slice(raw.indexOf("#[cfg(test)]"));
    expect(tail, "the trailing #[cfg(test)] no longer opens the test module")
      .toMatch(/^#\[cfg\(test\)\]\nmod tests \{/);
    for (const shape of ["#[tauri::command]", "pub(crate) fn ", "pub(crate) struct ", "pub(crate) const "]) {
      expect(
        tail,
        `production code (${shape}) now sits AFTER the test block, where every scan in this file is blind to it`,
      ).not.toContain(shape);
    }
  });

  const machinery: { id: string; re: RegExp }[] = [
    { id: "a sleeping thread", re: /thread::sleep|sleep\s*\(/ },
    { id: "a periodic timer", re: /Interval|interval\(|every\(|Timer|set_timeout|tokio::time/ },
    { id: "an unbounded loop", re: /\bloop\s*\{/ },
    { id: "a scheduled task", re: /schtasks|TaskScheduler|Register-ScheduledTask/i },
    { id: "a Windows service", re: /CreateService|sc\.exe|New-Service|service_dispatcher/i },
    { id: "a run-key autostart", re: /CurrentVersion\\\\Run|RegisterApplicationRestart/i },
    { id: "a file watcher", re: /notify::|ReadDirectoryChanges|watcher|Watcher/ },
    { id: "an event subscription", re: /EvtSubscribe|WMI_EVENT|__InstanceCreationEvent/i },
  ];

  for (const { id, re } of machinery) {
    it(`has no ${id}`, () => {
      const hit = prod.match(re)?.[0];
      expect(
        hit,
        `the observer grew ${id} (\`${hit}\`). It is allowed exactly three moments — Launch, ` +
          `Foreground, SessionFinalized — and nothing that keeps running between them.`,
      ).toBeUndefined();
    });
  }

  it("spawns at most one thread, and that thread runs once", () => {
    // scan_async hands the scan off the caller's thread so a window is never blocked behind a
    // PowerShell/WMI probe. One spawn, no join loop, no handle kept.
    const spawns = prod.split(/thread::spawn/).length - 1;
    expect(spawns, `${spawns} thread spawns — the observer is only allowed the one hand-off`).toBe(1);
    expect(prod, "the spawned closure no longer runs a single scan")
      .toMatch(/std::thread::spawn\(move \|\| scan_now\(trigger\)\)/);
  });

  it("declares exactly the three named triggers", () => {
    const variants = prod.match(/pub\(crate\) enum ScanTrigger \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(variants, "the ScanTrigger enum is gone").not.toBe("");
    const names = [...variants.matchAll(/^\s{4}([A-Z]\w*),/gm)].map((m) => m[1]);
    expect(names, "the trigger set changed — a new trigger is a new cost and needs its own review")
      .toEqual(["Launch", "Foreground", "SessionFinalized"]);
  });

  it("wires all three triggers, and no fourth", () => {
    // Comment-stripped, unlike a first draft of this line: this is the one check in the file that
    // asserts a call site EXISTS rather than that a shape is absent, so a `// TODO: wire
    // ScanTrigger::Foreground here` would otherwise have satisfied it with no wiring at all.
    // (Caught by the #222 IPC contract audit, 2026-08-25.)
    const callSites = stripRustComments(lib) + stripRustComments(readFileSync(join("src-tauri", "src", "sessions.rs"), "utf8"));
    const wired = [...callSites.matchAll(/ScanTrigger::(\w+)/g)].map((m) => m[1]);
    expect([...new Set(wired)].sort(), "a trigger is unwired, or a new one appeared")
      .toEqual(["Foreground", "Launch", "SessionFinalized"]);
    for (const t of ["Launch", "Foreground", "SessionFinalized"]) {
      expect(
        callSites,
        `ScanTrigger::${t} is named but never handed to scan_async — the trigger is decoration`,
      ).toMatch(
        new RegExp(`scan_async\\(\\s*(?:crate::incident_observer::)?ScanTrigger::${t}\\s*[,)]`),
      );
    }
  });
});

describe("an incident while Compy was closed is caught on next launch", () => {
  it("exempts Launch from the throttle", () => {
    // Launch is once per process AND it is the only trigger that can catch a crash that happened
    // while Compy was not running. Throttling it would mean a user who crashed, rebooted and opened
    // Compy within five minutes — the exact user this feature exists for — is told nothing.
    expect(prod, "Launch is no longer exempt from the scan throttle")
      .toMatch(/if trigger == ScanTrigger::Launch \{\s*return true;/);
  });

  it("throttles the other two against a persisted watermark", () => {
    expect(prod, "the scan throttle is gone — every alt-tab now spends a WMI probe")
      .toMatch(/SCAN_MIN_INTERVAL_SECS/);
    expect(prod, "the throttle no longer reads the persisted last_scan_at THROUGH THE LOCK — an unlocked state.last_scan_at read is the TOCTOU this guard exists to catch")
      .toMatch(/should_scan\(trigger,\s*read_state\(\)\.last_scan_at\.as_deref\(\),/);
  });

  it("persists the watermark and the observations to one file under the Compy data root", () => {
    expect(prod, "the observer state no longer lives under the canonical data root")
      .toMatch(/crate::compy_data_dir\(\)/);
    expect(prod).toMatch(/incident-observer\.json/);
    expect(prod, "the state write is no longer atomic — a mid-write crash would corrupt the watermark")
      .toMatch(/sync_all\(\)[\s\S]{0,200}?rename\(/);
  });

  it("seeds silently on a virgin watermark", () => {
    // Installing Compy must not generate notifications about crashes that predate it.
    expect(prod, "the first-run seeding branch is gone — install now announces pre-Compy crashes")
      .toMatch(/if state\.last_scan_at\.is_none\(\) \{/);
    const seed = prod.slice(prod.indexOf("if state.last_scan_at.is_none() {"));
    const ret = seed.indexOf("return outcome;");
    expect(seed.slice(0, ret), "the seeding run now sets a toast or a card")
      .not.toMatch(/outcome\.toast|pending_card = Some/);
  });

  it("recovers from a corrupt or unknown-schema file by re-seeding, never by announcing", () => {
    expect(prod, "the corrupt-state quarantine is gone").toMatch(/fn quarantine\(/);
    expect(prod, "a quarantined state no longer returns a virgin watermark — recovery would announce")
      .toMatch(/fn load_or_quarantine/);
  });
});

describe("the observer stays local", () => {
  const outbound: { id: string; re: RegExp }[] = [
    { id: "an HTTP client", re: /reqwest|hyper::|ureq|curl|HttpClient|WinHttp/i },
    { id: "a socket", re: /TcpStream|UdpSocket|SocketAddr|connect\(/ },
    { id: "a URL", re: /https?:\/\// },
    { id: "an upload verb", re: /\.post\(|\.put\(|multipart|Body::from/ },
  ];

  for (const { id, re } of outbound) {
    it(`has no ${id}`, () => {
      const hit = prod.match(re)?.[0];
      expect(
        hit,
        `the observer names ${id} (\`${hit}\`). Uploading an incident is Tier 3 and needs its own ` +
          `owner-signed exception under the Capability Exception Gate — it can never arrive as a ` +
          `side effect of noticing a crash.`,
      ).toBeUndefined();
    });
  }

  it("reads its evidence through the existing local Black Box path", () => {
    expect(prod, "the observer no longer sources its evidence from the local crash reader")
      .toMatch(/crate::blackbox::collect_crash_blackbox\(\)/);
  });

  it("reads the scan without the station-only \"Changed before this\" layer", () => {
    // P6-changed: only the Rescue station pays for the intelligence gather. The background observer
    // must not reach it, directly or through the station's command.
    for (const name of ["attach_changed_before", "get_crash_blackbox"]) {
      expect(prod.includes(name), `the observer calls ${name}`).toBe(false);
    }
  });

  it("mints no identity of any kind", () => {
    // No account, no install id, no cookie, no machine fingerprint. There is nobody to be known to.
    const found = ["install_id", "machine_id", "device_id", "user_id", "Uuid", "uuid::", "MachineGuid"]
      .filter((n) => prod.includes(n));
    expect(found, `the observer mints an identity: ${found.join(", ")}`).toEqual([]);
  });
});

describe("the observer never states a cause", () => {
  const dto = prod.match(/pub\(crate\) struct PendingCareIncident \{([\s\S]*?)\n\}/)?.[1] ?? "";

  it("carries the DTO this guard is meant to police", () => {
    expect(dto, "PendingCareIncident is gone or was renamed").not.toBe("");
  });

  it("has no cause, confidence or advisory field", () => {
    // Tier 1's own advisories are hedged prose ("this is often caused by…") shown INSIDE the Black
    // Box next to their evidence and their limits. Lifting one into a notification strips the
    // hedge, the evidence and the limits, and leaves a diagnosis Compy has not earned.
    const banned = /cause|confidence|likely|probable|advice|advisory|assessment|diagnos|fix|recommend/i;
    const offenders = dto.split("\n").filter((l) => /^\s{4}pub\(crate\) \w+:/.test(l) && banned.test(l));
    expect(
      offenders,
      `the notification DTO now carries a verdict: ${offenders.join(" | ").trim()}. It may say WHAT ` +
        `happened and WHEN. Why belongs where the evidence is.`,
    ).toEqual([]);
  });

  it("selects what to announce from the incident KIND, never from an assessment", () => {
    const q = prod.match(/fn qualifies\(inc: &Incident\) -> bool \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(q, "the qualifying filter is gone").not.toBe("");
    expect(q, "the observer now decides what to announce by reading a hedged assessment")
      .not.toMatch(/assessment|advis|confidence|cause/i);
    expect(q, "the filter no longer keys off the incident kind").toMatch(/inc\.kind/);
  });

  it("fires at most one toast per scan", () => {
    // Four crashes discovered at once is one bad session, not four things to say.
    expect(prod, "the toast is no longer a single optional card")
      .toMatch(/pub\(crate\) toast: Option<PendingCareIncident>/);
    expect(prod, "the toast fire site is no longer a single if-let")
      .toMatch(/if let Some\(card\) = (?:outcome\.)?toast \{\s*notify\(&card\);/);
    // One card handed out per scan, and nothing fires notifications in a loop — that would be a
    // notification per crash found, which is the shape this whole module exists to avoid.
    expect(prod, "notifications are being fired from a loop")
      .not.toMatch(/for [\s\S]{0,60}?notify\(/);
  });

  it("keeps a cooldown so a crash loop cannot become a toast loop", () => {
    expect(prod, "TOAST_COOLDOWN_MINS is gone — a boot loop would toast on every launch")
      .toMatch(/TOAST_COOLDOWN_MINS/);
  });
});

describe("the observer is outside the mutation boundary and stays there", () => {
  it("never reaches into actions.rs", () => {
    expect(prod, "the observer now calls into the Windows-mutation boundary")
      .not.toMatch(/crate::actions|use crate::actions|actions::/);
  });

  it("is not referenced from actions.rs either", () => {
    const actions = stripRustComments(readFileSync(ACTIONS, "utf8"));
    expect(actions, "actions.rs now depends on the observer — the boundary gained a reason to change")
      .not.toMatch(/incident_observer/);
  });

  it("changes nothing about Windows", () => {
    const banned: { id: string; re: RegExp }[] = [
      { id: "a registry write", re: /RegSetValue|set_value|Set-ItemProperty|reg\.exe|reg add/i },
      { id: "a service change", re: /Set-Service|Stop-Service|ChangeServiceConfig/i },
      { id: "a power-plan switch", re: /powercfg/i },
      { id: "a package removal", re: /Remove-AppxPackage|winget uninstall/i },
      { id: "an elevation", re: /run_elevated|runas|--run-elevated/i },
    ];
    for (const { id, re } of banned) {
      expect(prod.match(re)?.[0], `the observer performs ${id}`).toBeUndefined();
    }
  });

  it("deletes no evidence on dismiss", () => {
    const body = prod.match(/pub\(crate\) fn dismiss_care_incident\(incident_id: String\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(body, "dismiss_care_incident is gone").not.toBe("");
    expect(
      body,
      "dismiss now removes something. It may clear Compy's pointer and nothing else — the Event Log " +
        "entry, the WER report and the reliability record are Windows' records, not ours to delete.",
    ).not.toMatch(/remove_file|remove_dir|Clear-EventLog|wevtutil|delete/i);
    expect(body, "dismiss no longer clears the pending pointer — the card would never go away")
      .toMatch(/clear_pending\(\)/);
  });

  it("keeps the observation after a dismiss, so the same crash cannot come back", () => {
    const body = prod.match(/pub\(crate\) fn dismiss_care_incident\(incident_id: String\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(body, "dismiss no longer stamps the observation — the next scan re-announces it")
      .toMatch(/dismissed_at = Some/);
    expect(body, "dismiss now removes the observation row, which makes the crash new again")
      .not.toMatch(/seen\.retain|seen\.remove/);
  });
});

describe("a dismissed crash stays dismissed (bug->guard, #222 backend review)", () => {
  // The review found the module breaking its own headline promise. `incident_id` is a hash over the
  // crash's traits INCLUDING its instant, and `blackbox::merge_into` moves that instant — and fills
  // in the faulting module — the moment a corroborating WER report lands. So one crash wears two ids
  // across two scans, the second id has "never been seen", and the card the user just dismissed is
  // announced again. Being told twice about something you dismissed is the behaviour that gets a
  // feature switched off, so the fix is pinned here and not left to a comment.

  it("records the matching traits on each remembered row, not just an id", () => {
    const row = prod.match(/pub\(crate\) struct ObservedIncident \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(row, "ObservedIncident is gone or was renamed").not.toBe("");
    for (const field of ["kind_tag", "app", "occurred_at"]) {
      expect(
        row,
        `ObservedIncident lost \`${field}\`. Without the traits recorded AT OBSERVATION TIME, a ` +
          `crash whose id shifts cannot be recognized, and a dismissed card comes back.`,
      ).toMatch(new RegExp(`\\b${field}:`));
    }
  });

  it("reconciles shifted identities before anything decides what is new", () => {
    const body = prod.match(/pub\(crate\) fn observe\(([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(body, "observe is gone or was renamed").not.toBe("");
    const reconcile = body.indexOf("reconcile_identity_shifts(");
    const fresh = body.indexOf("let fresh");
    expect(reconcile, "observe no longer reconciles identities — dismissed crashes will re-announce")
      .toBeGreaterThan(-1);
    expect(fresh, "observe no longer collects fresh incidents").toBeGreaterThan(-1);
    expect(reconcile, "reconciliation must run BEFORE freshness is decided, or it decides nothing")
      .toBeLessThan(fresh);
  });

  it("only adopts an identity whose predecessor has left the report", () => {
    const body = prod.match(/fn reconcile_identity_shifts\(([\s\S]*?)\n\}\n/)?.[1] ?? "";
    expect(body, "reconcile_identity_shifts is gone").not.toBe("");
    expect(
      body,
      "reconciliation stopped checking that the OLD id is absent from the current report. With both " +
        "ids live they are two real incidents — a genuine crash-loop repeat — and folding them hides one.",
    ).toMatch(/!live\(/);
  });

  it("cools down off the row's own family, never a live lookup of the old id", () => {
    const body = prod.match(/pub\(crate\) fn observe\(([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(body, "the cooldown reads the row's recorded family").toMatch(/o\.family\(\)\s*!=\s*key/);
    expect(
      body,
      "the cooldown is re-resolving announced ids against the live report again. That silently " +
        "fails for an id that shifted AND for one that aged off the report's cap — both toward " +
        "toasting a machine that is already visibly broken.",
    ).not.toMatch(/report[\s\S]{0,80}find\(\|i\| i\.incident_id == o\.incident_id\)/);
  });

  it("serializes every read-modify-write of the state file", () => {
    expect(prod, "the state lock is gone — a dismiss landing mid-scan is read before the click and " +
      "written back after it, and the card returns")
      .toMatch(/static STATE_LOCK: Mutex<\(\)> = Mutex::new\(\(\)\);/);
    for (const fn of ["with_state", "read_state"]) {
      expect(prod, `${fn} no longer takes the lock`).toMatch(
        new RegExp(`fn ${fn}[\\s\\S]{0,220}?lock_state\\(\\)`),
      );
    }
    expect(prod, "mutate bypasses the locked path again").toMatch(
      /fn mutate\([\s\S]{0,200}?with_state\(/,
    );
  });

  it("never writes through one shared temp filename", () => {
    expect(
      prod,
      'save_to went back to a fixed `.json.tmp`. That is ONE shared path: two writers interleave ' +
        "into it and the atomic rename then publishes a half-written file — the exact outcome the " +
        "rename exists to prevent.",
    ).not.toMatch(/with_extension\("json\.tmp"\)/);
    expect(prod, "the per-save temp path is gone").toMatch(/fn temp_path\(path: &Path\)/);
  });

  it("runs one scan at a time, without adding a background thread to do it", () => {
    expect(prod, "the single-scan claim is gone — Launch and Foreground land milliseconds apart and " +
      "both would spawn PowerShell before either wrote a watermark")
      .toMatch(/SCANNING\s*\.\s*compare_exchange\(/);
    // The claim must stay a flag, not become a waiting thread: this module's whole cost argument is
    // that it owns no cadence and blocks nothing.
    expect(prod, "the scan claim started waiting instead of declining").not.toMatch(
      /SCANNING[\s\S]{0,200}?(sleep|park|yield_now|while\s)/,
    );
  });
});

describe("the three commands agree across every authority", () => {
  // Q2's command-authority contract, applied to this module specifically: lib.rs registers, build.rs
  // declares, the capability grants, and the OVERLAY gets none of it. A command that is registered
  // but ungranted fails at runtime with a permission error no test would ever see.
  const handler = lib.match(/generate_handler!\[([\s\S]*?)\]\)/)?.[1] ?? "";
  const appCommands = build.match(/APP_COMMANDS[^=]*=\s*&?\[([\s\S]*?)\];/)?.[1] ?? "";
  const grants: string[] = (cap.permissions ?? []).filter((p: unknown) => typeof p === "string");

  it("found all four authorities", () => {
    expect(handler, "lib.rs generate_handler! is gone").not.toBe("");
    expect(appCommands, "build.rs APP_COMMANDS is gone").not.toBe("");
    expect(grants.length, "the main capability has no string permissions").toBeGreaterThan(0);
  });

  for (const c of COMMANDS) {
    it(`${c} is registered, declared and granted`, () => {
      expect(handler, `${c} is not registered in lib.rs generate_handler!`)
        .toMatch(new RegExp(`incident_observer::${c}\\b`));
      expect(appCommands, `${c} is missing from build.rs APP_COMMANDS`).toContain(`"${c}"`);
      const perm = `allow-${c.replace(/_/g, "-")}`;
      expect(grants, `${perm} is not granted to the main window — the command fails at runtime`)
        .toContain(perm);
    });
  }

  it("grants none of them to the overlay", () => {
    // The overlay is a borderless always-on-top surface over a game. It has no business reading or
    // retiring a crash card, and every command it can reach is surface the game-side window exposes.
    const overlay = JSON.parse(readFileSync(join("src-tauri", "capabilities", "overlay.json"), "utf8"));
    const overlayGrants: string[] = (overlay.permissions ?? []).filter((p: unknown) => typeof p === "string");
    for (const c of COMMANDS) {
      expect(overlayGrants, `the overlay can call ${c}`).not.toContain(`allow-${c.replace(/_/g, "-")}`);
    }
  });

  it("reads the Home card without scanning", () => {
    // Mounting Home must cost one small JSON read, not a WMI probe. This is the standing
    // least-resource-hungry bar at the surface the user opens most often.
    const body = prod.match(/pub\(crate\) fn get_pending_care_incident\(\) -> Option<PendingCareIncident> \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(body, "get_pending_care_incident is gone").not.toBe("");
    expect(body, "opening Home now triggers a crash scan")
      .not.toMatch(/scan_now|scan_async|get_crash_blackbox/);
  });
});
