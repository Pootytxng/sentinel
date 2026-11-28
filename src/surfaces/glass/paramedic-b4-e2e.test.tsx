// B4: the other half of the end-to-end test. `paramedic::tests::recovery_f3::b4_e2e_…` drives real scans through
// drift.rs into drift.json, reads the file back through the diagnosis's own reader, and pins what the card is handed
// (the readiness drifts and the diagnosis, setting off and then back on) in this fixture byte for byte. Here the card
// renders exactly that: the setting named from the drift, the turn-on offered by the ledger's id, and the recovery's
// own words. Read at run time (not imported) so a missing fixture fails this test, never the build.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

const answer = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve(answer.value) }));

import "../../i18n";
import type { Drift, ParamedicDiagnosis } from "../../types";
import { ParamedicCard } from "./ParamedicCard";
import { ConfirmProvider } from "../../design/ConfirmDialog";

type Stage = { drifts: Drift[]; diagnosis: ParamedicDiagnosis };
const wire = JSON.parse(readFileSync(join("src", "test", "fixtures", "paramedic-b4-drift-to-card.wire.json"), "utf8")) as { off: Stage; back: Stage };
const TITLE = "Trim Windows visual effects";

afterEach(() => {
  cleanup();
  answer.value = null;
});

const openAll = () => {
  for (let i = 0; i < 6; i++) {
    const closed = screen.queryAllByRole("button").filter((b) => b.getAttribute("aria-expanded") === "false");
    if (closed.length === 0) return;
    closed.forEach((b) => fireEvent.click(b));
  }
};

async function show(stage: Stage, reverted: { rec_id: string; title: string }[]) {
  answer.value = stage.diagnosis;
  render(
    <ConfirmProvider>
      <ParamedicCard drifts={stage.drifts} reverted={reverted} onChanged={vi.fn()} />
    </ConfirmProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Check my PC" }));
  await waitFor(() => expect(screen.queryAllByTestId("paramedic-candidate").length).toBeGreaterThan(0));
  openAll();
}

describe("B4 end to end: a scan written to drift.json, as the card shows it", () => {
  it("off: the setting is named from the scan's drift and offered back on by the ledger's id", async () => {
    // The ledger row shares the id the scan carried; its title is what the button names.
    await show(wire.off, [{ rec_id: "visual-effects", title: TITLE }]);
    expect(screen.getByTestId("paramedic").textContent).toContain(TITLE);
    expect(screen.getAllByTestId("paramedic-turn-on").map((b) => b.textContent)).toEqual([`Turn “${TITLE}” back on`]);
    cleanup();
    // Another recommendation under the same title: no button (matched by id, never by title).
    await show(wire.off, [{ rec_id: "visual-effects-other", title: TITLE }]);
    expect(screen.queryByTestId("paramedic-turn-on")).toBeNull();
  });

  it("back: two clear sessions after it was read on, said as the recovery's own words with the timing chip and Possible", async () => {
    await show(wire.back, []);
    expect(screen.getByTestId("paramedic-verdict").textContent).toBe(
      "Compy read the setting back on before those two sessions. Among the changes Compy keeps track of (drivers, Windows updates, game files, installed programs), it found no other one in that stretch. That's consistent with the setting being what mattered, but it doesn't prove it.",
    );
    const row = screen.getAllByTestId("paramedic-candidate").find((r) => /Matches the timing/.test(r.textContent ?? ""));
    expect(row, "the setting's row carries the timing chip").toBeTruthy();
    expect(within(row as HTMLElement).getByTestId("paramedic-row-certainty").textContent).toBe("Possible");
    expect(screen.getByTestId("paramedic").textContent).toContain(TITLE);
    expect(screen.queryByTestId("paramedic-turn-on")).toBeNull();
  });
});
