// D2b: a rec whose live state couldn't be read says so on its card; "can't tell" is never shown as "off".
// D2b r1 (F2): a rec held back only because Compy couldn't check its hardware is listed under
// "Couldn't check right now" with its reason and NO override, never under "Not for this rig".
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import i18n from "../i18n";
import { CouldntCheckGroup, StateUnreadLine, splitNotForThisRig } from "./Fix";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

const EEE_UNREAD_REASON = "Couldn't check Energy-Efficient Ethernet on your wired adapter right now.";

describe("StateUnreadLine", () => {
  it("says Compy couldn't read the setting when the read did not finish", () => {
    const { container } = render(<StateUnreadLine rec={{ state_unread: true }} />);
    expect(container.textContent).toBe(
      "Compy couldn't read this setting right now, so it can't say whether it is on or off.",
    );
  });

  it("says it in Chinese in a zh-CN UI", async () => {
    await i18n.changeLanguage("zh-CN");
    const { container } = render(<StateUnreadLine rec={{ state_unread: true }} />);
    expect(container.textContent).toBe("Compy 现在无法读取这项设置，因此无法判断它是开启还是关闭。");
  });

  it("renders nothing when the state was read", () => {
    expect(render(<StateUnreadLine rec={{ state_unread: false }} />).container.textContent).toBe("");
    expect(render(<StateUnreadLine rec={{}} />).container.textContent).toBe("");
  });
});

describe("couldn't check right now", () => {
  const unread = { id: "eee-disable", title: "Turn off Energy-Efficient Ethernet", eligible: false, state_unread: true, ineligible_reason: EEE_UNREAD_REASON };
  const portless = { id: "nagle", title: "Wired only", eligible: false, ineligible_reason: "Needs a wired Ethernet port." };

  it("an unread rec leaves Not for this rig and joins its own group; a detected one stays", () => {
    const { notForThisRig, couldntCheck } = splitNotForThisRig([unread, portless], new Set());
    expect(notForThisRig.map((r) => r.id)).toEqual(["nagle"]);
    expect(couldntCheck.map((r) => r.id)).toEqual(["eee-disable"]);
  });

  it("an ineligible rec with a failed live read stays in Not for this rig, override kept (D2b r2)", () => {
    // The backend leaves state_unread false for a DETECTED hardware reason even when its live read failed.
    const held = { id: "eee-disable", title: "EEE", eligible: false, state_unread: false, ineligible_reason: "Needs a wired Ethernet port." };
    expect(splitNotForThisRig([held], new Set()).notForThisRig.map((r) => r.id)).toEqual(["eee-disable"]);
    const withOverride = splitNotForThisRig([held], new Set(["eee-disable"]));
    expect(withOverride.overriddenRecs.map((r) => r.id)).toEqual(["eee-disable"]);
    expect(withOverride.couldntCheck).toEqual([]);
  });

  it("lists the rec under its own heading with the reason, and offers no override", () => {
    const { container } = render(<CouldntCheckGroup recs={[unread]} />);
    const text = container.textContent ?? "";
    expect(text).toContain("Couldn't check right now");
    expect(text).toContain(EEE_UNREAD_REASON);
    expect(text).not.toMatch(/Not for this rig|don't apply|supports this/i);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("is in Chinese in a zh-CN UI, reason included", async () => {
    await i18n.changeLanguage("zh-CN");
    const text = render(<CouldntCheckGroup recs={[unread]} />).container.textContent ?? "";
    expect(text).toContain("现在无法检查");
    expect(text).toContain("现在无法检查有线网络适配器上的「节能以太网」设置。");
  });

  it("renders nothing when every rec was checked", () => {
    expect(render(<CouldntCheckGroup recs={[]} />).container.textContent).toBe("");
  });
});
