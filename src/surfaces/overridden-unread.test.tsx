// D2c: a held-back rec the user overrode back into the list ("My hardware supports this") whose live
// read failed says Compy couldn't read the setting, so its not-applied switch never reads as "off".
// The line is always visible on the slim row (never only inside the collapsed detail).
// D4: the fixture is the one combination Rust produces today (eee-disable: a hardware gate AND a live
// read that can fail; recommendations.rs a_held_back_rec_still_carries_its_failed_live_read_for_an_override),
// the switch is described by the line (a screen reader never hears a bare "off"), and <Fix> itself
// routes an overridden rec into a row that shows it.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import i18n from "../i18n";
import Fix, { SlimFixRow, StateUnreadLine } from "./Fix";

afterEach(async () => {
  cleanup();
  localStorage.clear();
  await i18n.changeLanguage("en");
});

const EN = "Compy couldn't read this setting right now, so it can't say whether it is on or off.";
const ZH = "Compy 现在无法读取这项设置，因此无法判断它是开启还是关闭。";

// eee-disable held back on a rig with no wired port (the detected reason, so state_unread is false and
// it stays overridable), whose live EEE read did not finish (live_read_unread).
const overridden = {
  id: "eee-disable",
  title: "Disable Energy Efficient Ethernet on the gaming NIC",
  description: "",
  impact: "More consistent latency on the wired gaming NIC; reduces ping variance",
  currently_applied: false,
  provenance: "expected-impact" as const,
  severity: "safe" as const,
  eligible: false,
  ineligible_reason: "Needs a wired Ethernet port — this rig has none (Wi-Fi / other only).",
  state_unread: false,
  live_read_unread: true,
};

/** The row's switch, and the text of the element its aria-describedby names (null when it names none). */
function switchFor(container: HTMLElement, title: string) {
  const sw = [...container.querySelectorAll<HTMLElement>('[role="switch"]')].find((b) =>
    (b.getAttribute("aria-label") ?? "").includes(title),
  );
  if (!sw) throw new Error(`no switch for ${title}`);
  const ref = sw.getAttribute("aria-describedby");
  return { sw, described: ref ? (document.getElementById(ref)?.textContent ?? null) : null };
}

function slim(rec: typeof overridden) {
  return render(
    <ul>
      <SlimFixRow
        rec={rec}
        applied={false}
        activeChange={undefined}
        busy={false}
        onToggle={vi.fn()}
        onWhatsThis={vi.fn()}
        onDismiss={vi.fn()}
      />
    </ul>,
  );
}

describe("an overridden rec whose live read failed", () => {
  it("the line shows for a failed live read even when the bucket flag is off", () => {
    expect(render(<StateUnreadLine rec={{ live_read_unread: true }} />).container.textContent).toBe(EN);
    expect(render(<StateUnreadLine rec={{ state_unread: false, live_read_unread: false }} />).container.textContent).toBe("");
  });

  it("its slim row says couldn't read without being opened, in en and zh-CN", async () => {
    const { container } = slim(overridden);
    expect(container.querySelector(".slimrow-detail"), "the detail is still collapsed").toBeNull();
    expect(container.textContent).toContain(EN);
    cleanup();
    await i18n.changeLanguage("zh-CN");
    expect(slim(overridden).container.textContent).toContain(ZH);
  });

  it("a row whose read finished carries no such line", () => {
    expect(slim({ ...overridden, live_read_unread: false }).container.textContent).not.toContain(EN);
  });

  it("the switch is described by the couldn't-read line, and by nothing when the read finished", () => {
    const { container } = slim(overridden);
    const { sw, described } = switchFor(container, overridden.title);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(described).toBe(EN);
    cleanup();
    const read = slim({ ...overridden, live_read_unread: false });
    expect(switchFor(read.container, overridden.title).sw.hasAttribute("aria-describedby")).toBe(false);
  });

  it("<Fix> puts the overridden rec in a row that says couldn't read, its switch described by it", () => {
    localStorage.setItem("compy_eligibility_overrides", JSON.stringify([overridden.id]));
    const { container } = render(
      <Fix
        recs={[overridden]}
        startup={[]}
        changes={[]}
        busyId={null}
        isAppliable={(id) => id === overridden.id}
        activeChangeFor={() => undefined}
        onToggleRec={vi.fn()}
        onToggleStartup={vi.fn()}
        onRollback={vi.fn()}
        onApplyBatch={vi.fn().mockResolvedValue({ applied: 0, skipped: [] })}
        onOpenLibrary={vi.fn()}
        vendor="amd"
        view="fixes"
      />,
    );
    const { sw, described } = switchFor(container, overridden.title);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(described).toBe(EN);
    // Without the override the same rec stays in "Not for this rig": no switch row for it.
    cleanup();
    localStorage.clear();
    const held = render(
      <Fix
        recs={[overridden]}
        startup={[]}
        changes={[]}
        busyId={null}
        isAppliable={(id) => id === overridden.id}
        activeChangeFor={() => undefined}
        onToggleRec={vi.fn()}
        onToggleStartup={vi.fn()}
        onRollback={vi.fn()}
        onApplyBatch={vi.fn().mockResolvedValue({ applied: 0, skipped: [] })}
        onOpenLibrary={vi.fn()}
        vendor="amd"
        view="fixes"
      />,
    );
    expect(() => switchFor(held.container, overridden.title)).toThrow();
  });
});
