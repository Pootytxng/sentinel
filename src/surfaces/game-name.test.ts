import { describe, it, expect } from "vitest";
import { prettyGameName } from "./game-name";

describe("prettyGameName", () => {
  it("strips a trailing .exe (case-insensitive) for display", () => {
    expect(prettyGameName("Diablo IV.exe")).toBe("Diablo IV");
    expect(prettyGameName("doom.EXE")).toBe("doom");
    expect(prettyGameName("Cyberpunk2077.Exe")).toBe("Cyberpunk2077");
  });

  it("leaves casing + internal dots alone (no mangling of real game names)", () => {
    expect(prettyGameName("DOOMEternalx64vk.exe")).toBe("DOOMEternalx64vk");
    expect(prettyGameName("rdr2")).toBe("rdr2"); // no extension → unchanged
    expect(prettyGameName("serioussam.exe.exe")).toBe("serioussam.exe"); // only ONE trailing .exe
  });

  it("strips the Unreal shipping-binary suffix (packaging boilerplate, not the game's name)", () => {
    expect(prettyGameName("PALWORLD-WIN64-SHIPPING.exe")).toBe("PALWORLD");
    expect(prettyGameName("FortniteClient-Win64-Shipping.exe")).toBe("FortniteClient");
    expect(prettyGameName("Stalker2_WinGDK_Shipping.exe")).toBe("Stalker2");
    expect(prettyGameName("shippingco.exe")).toBe("shippingco"); // substring ≠ suffix
  });

  it("handles empty / missing input", () => {
    expect(prettyGameName("")).toBe("");
    expect(prettyGameName(null)).toBe("");
    expect(prettyGameName(undefined)).toBe("");
    expect(prettyGameName("  game.exe  ")).toBe("game");
  });
});
