// D2c: a held-back rec the user overrode back into the list ("My hardware supports this") whose live
// read failed says Compy couldn't read the setting, so its not-applied switch never reads as "off".
// The line is always visible on the slim row (never only inside the collapsed detail).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import i18n from "../i18n";
import { SlimFixRow, StateUnreadLine } from "./Fix";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

const EN = "Compy couldn't read this setting right now, so it can't say whether it is on or off.";
const ZH = "Compy 现在无法读取这项设置，因此无法判断它是开启还是关闭。";

const overridden = {
  id: "nagle-disable",
  title: "Disable Nagle's algorithm",
  description: "",
  impact: "Lower latency for some online games.",
  currently_applied: false,
  provenance: "expected-impact" as const,
  severity: "moderate" as const,
  eligible: false,
  ineligible_reason: "Needs a wired Ethernet port.",
  state_unread: false,
  live_read_unread: true,
};

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
});
