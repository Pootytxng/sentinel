// D2b: a rec whose live state couldn't be read says so on its card; "can't tell" is never shown as "off".
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import i18n from "../i18n";
import { StateUnreadLine } from "./Fix";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

describe("StateUnreadLine", () => {
  it("says Compy couldn't read the setting when the read did not finish", () => {
    const { container } = render(<StateUnreadLine rec={{ state_unread: true }} />);
    expect(container.textContent).toBe(
      "Compy couldn't read this power setting, so it can't say whether it is on or off.",
    );
  });

  it("says it in Chinese in a zh-CN UI", async () => {
    await i18n.changeLanguage("zh-CN");
    const { container } = render(<StateUnreadLine rec={{ state_unread: true }} />);
    expect(container.textContent).toBe("Compy 无法读取这项电源设置，因此无法判断它是开启还是关闭。");
  });

  it("renders nothing when the state was read", () => {
    expect(render(<StateUnreadLine rec={{ state_unread: false }} />).container.textContent).toBe("");
    expect(render(<StateUnreadLine rec={{}} />).container.textContent).toBe("");
  });
});
