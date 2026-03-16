export const workstationFlowGroup = {
  id: "workstation-flow",
  title: "交易、工作站与界面流程",
  async run(context) {
    const {
      FIXTURE,
      closeGuiSetup,
      expect,
      prepareEnchantSetup,
      resetFixture,
      runCli,
      runClientLeaf,
      runSetup,
      unwrapRequestSuccess
    } = context;

    await resetFixture("setup reset before trade");
    await runSetup("setup open villager trade", ["entity", "interact", "--name", "MCT Trader"], (data) => {
      expect(data.success === true, "failed to open villager trade");
    });

    await runClientLeaf("trade", ["trade", "--index", "0"], (data) => {
      expect(data.success === true, "trade failed");
      expect(data.result?.type === "minecraft:diamond", "trade result was not a diamond");
    });
    await closeGuiSetup("setup close trade gui");

    await resetFixture("setup reset before craft");
    await runSetup(
      "setup open crafting table",
      ["block", "interact", String(FIXTURE.craft.x), String(FIXTURE.craft.y), String(FIXTURE.craft.z)],
      (data) => {
        expect(data.success === true, "failed to open crafting table");
      }
    );
    await runSetup("setup wait craft gui", ["gui", "wait-open", "--timeout", "5"], (data) => {
      expect(data.opened === true, "craft gui did not open");
    });

    await runClientLeaf(
      "craft",
      ["craft", "--recipe", '[[null,"diamond",null],[null,"stick",null],[null,"stick",null]]'],
      (data) => {
        expect(data.crafted === true, "craft command failed");
        expect(data.result?.type === "minecraft:diamond_shovel", "craft result was not a diamond shovel");
      }
    );
    await closeGuiSetup("setup close craft gui");

    await resetFixture("setup reset before anvil");
    await runSetup(
      "setup open anvil",
      ["block", "interact", String(FIXTURE.anvil.x), String(FIXTURE.anvil.y), String(FIXTURE.anvil.z)],
      (data) => {
        expect(data.success === true, "failed to open anvil");
      }
    );
    await runSetup("setup wait anvil gui", ["gui", "wait-open", "--timeout", "5"], (data) => {
      expect(data.opened === true, "anvil gui did not open");
    });

    const anvilSnapshot = await runSetup("setup anvil snapshot for raw typing", ["gui", "snapshot"], (data) => {
      expect(Array.isArray(data.slots), "anvil snapshot slots missing");
    });
    const anvilSwordSlot = anvilSnapshot.slots.find((slot) => slot.item?.type === "minecraft:diamond_sword")?.slot;
    expect(Number.isInteger(anvilSwordSlot), "diamond sword slot not found in anvil gui");

    await runSetup("setup pick sword for raw typing", ["gui", "click", String(anvilSwordSlot), "--button", "left"], (data) => {
      expect(data.success === true, "failed to pick sword for raw typing");
    });
    await runSetup("setup place sword into anvil input", ["gui", "click", "0", "--button", "left"], (data) => {
      expect(data.success === true, "failed to place sword into anvil input");
    });

    await runClientLeaf("input type", ["input", "type", "RawName"], async (data) => {
      expect(data.typed === true, "input type did not report success");
      const snapshot = unwrapRequestSuccess(await runCli(["--client", "real", "gui", "snapshot"]));
      const preview = snapshot.slots.find((slot) => slot.slot === 2)?.item;
      expect(String(preview?.displayName ?? "").includes("RawName"), "input type did not update the anvil preview name");
    });

    await runClientLeaf("input key combo", ["input", "key", "combo", "backspace"], async (data) => {
      expect(data.pressed === true, "input key combo did not report success");
      const snapshot = unwrapRequestSuccess(await runCli(["--client", "real", "gui", "snapshot"]));
      const preview = snapshot.slots.find((slot) => slot.slot === 2)?.item;
      expect(String(preview?.displayName ?? "").includes("RawNam"), "input key combo did not update the anvil preview name");
      expect(!String(preview?.displayName ?? "").includes("RawName"), "input key combo did not remove the trailing character");
    });

    await closeGuiSetup("setup close anvil after raw typing");

    await resetFixture("setup reset before standard anvil");
    await runSetup(
      "setup reopen anvil",
      ["block", "interact", String(FIXTURE.anvil.x), String(FIXTURE.anvil.y), String(FIXTURE.anvil.z)],
      (data) => {
        expect(data.success === true, "failed to reopen anvil");
      }
    );
    await runSetup("setup wait reopened anvil gui", ["gui", "wait-open", "--timeout", "5"], (data) => {
      expect(data.opened === true, "reopened anvil gui did not open");
    });

    await runClientLeaf("anvil", ["anvil", "--input-slot", "5", "--rename", "Renamed"], (data) => {
      expect(data.success === true, "anvil command failed");
      expect(String(data.result?.displayName).includes("Renamed"), "anvil did not rename the item");
    });
    await closeGuiSetup("setup close anvil gui");

    await resetFixture("setup reset before enchant");
    await prepareEnchantSetup();
    await runClientLeaf("enchant", ["enchant", "--option", "0"], (data) => {
      expect(data.success === true, "enchant command failed");
      expect(data.selectedOption === 0, "enchant command selected unexpected option");
    });
    await closeGuiSetup("setup close enchant gui");
  }
};
