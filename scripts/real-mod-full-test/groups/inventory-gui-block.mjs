export const inventoryGuiBlockGroup = {
  id: "inventory-gui-block",
  title: "背包、GUI、方块与截图",
  async run(context) {
    const {
      FIXTURE,
      SCREENSHOT_DIR,
      chestSlotPoint,
      closeGuiSetup,
      ensureFileExists,
      expect,
      openChestSetup,
      path,
      pointNear,
      resetFixture,
      runCli,
      runClientLeaf,
      runSetup,
      scheduleClientCommand,
      summary,
      unwrapRequestSuccess
    } = context;

    await resetFixture("setup reset before inventory");

    await runClientLeaf("inventory get", ["inventory", "get"], (data) => {
      expect(Array.isArray(data.slots), "inventory get slots missing");
      expect(data.slots.length > 0, "inventory get returned no slots");
    });

    await runClientLeaf("inventory slot", ["inventory", "slot", "0"], (data) => {
      expect(data.item?.type === "minecraft:dirt", "inventory slot 0 was not dirt");
    });

    await runClientLeaf("inventory held", ["inventory", "held"], (data) => {
      expect(data.item?.type === "minecraft:dirt", "inventory held was not dirt");
    });

    await runClientLeaf("inventory hotbar", ["inventory", "hotbar", "3"], (data) => {
      expect(data.selectedSlot === 3, "inventory hotbar did not switch to slot 3");
      expect(data.item?.type === "minecraft:writable_book", "inventory hotbar slot 3 was not writable book");
    });

    await runClientLeaf("inventory use", ["inventory", "use"], (data) => {
      expect(data.success === true, "inventory use did not succeed");
    });
    await closeGuiSetup("setup close book screen after inventory use");

    await resetFixture("setup reset before swap hands");
    await runSetup("setup select sword", ["inventory", "hotbar", "5"], (data) => {
      expect(data.selectedSlot === 5, "failed to select sword hotbar slot");
    });

    await runClientLeaf("inventory swap-hands", ["inventory", "swap-hands"], (data) => {
      expect(data.offHand?.type === "minecraft:diamond_sword", "swap hands did not move sword to offhand");
    });

    await resetFixture("setup reset before drop");
    await runSetup("setup select bread", ["inventory", "hotbar", "4"], (data) => {
      expect(data.item?.type === "minecraft:bread", "failed to select bread");
    });

    await runClientLeaf("inventory drop", ["inventory", "drop", "--all"], (data) => {
      expect(data.dropped === true, "inventory drop did not report success");
    });

    await resetFixture("setup reset before book commands");
    await runSetup("setup select writable book", ["inventory", "hotbar", "3"], (data) => {
      expect(data.item?.type === "minecraft:writable_book", "failed to select writable book");
    });

    const bookPages = ["Real Page 1", "Real Page 2"];
    await runClientLeaf("book write", ["book", "write", "--pages", ...bookPages], (data) => {
      expect(data.written === true, "book write failed");
      expect(Array.isArray(data.pages) && data.pages.length === 2, "book write pages missing");
    });

    await runClientLeaf("book read", ["book", "read"], (data) => {
      expect(Array.isArray(data.pages), "book read did not return pages");
      expect(data.pages.some((page) => page.includes("Real Page 1")), "book read missing written page");
    });

    await runClientLeaf("book sign", ["book", "sign", "--title", "Guide", "--author", "Bot"], (data) => {
      expect(data.signed === true, "book sign failed");
      expect(data.title === "Guide", "book sign title mismatch");
    });

    await resetFixture("setup reset before block and gui");

    await runClientLeaf(
      "block get",
      ["block", "get", String(FIXTURE.chest.x), String(FIXTURE.chest.y), String(FIXTURE.chest.z)],
      (data) => {
        expect(data.type === "minecraft:chest", "block get did not return chest fixture");
      }
    );

    await runClientLeaf(
      "block place",
      ["block", "place", String(FIXTURE.placeBlock.x), String(FIXTURE.placeBlock.y), String(FIXTURE.placeBlock.z), "--face", "up"],
      (data) => {
        expect(data.success === true, "block place failed");
        expect(data.placedType === "minecraft:dirt", "block place did not place dirt");
      }
    );

    await resetFixture("setup reset before block break");
    await runSetup("setup select pickaxe", ["inventory", "hotbar", "1"], (data) => {
      expect(data.item?.type === "minecraft:diamond_pickaxe", "failed to select pickaxe");
    });

    await runClientLeaf(
      "block break",
      ["block", "break", String(FIXTURE.breakBlock.x), String(FIXTURE.breakBlock.y), String(FIXTURE.breakBlock.z)],
      (data) => {
        expect(data.success === true, "block break failed");
        expect(data.blockType === "minecraft:air", "block break did not clear the target block");
      }
    );

    await resetFixture("setup reset before sign");

    await runClientLeaf("sign read", ["sign", "read", String(FIXTURE.sign.x), String(FIXTURE.sign.y), String(FIXTURE.sign.z)], (data) => {
      expect(Array.isArray(data.front), "sign read front text missing");
      expect(data.front[0] === "MCT Line 1", "sign read returned unexpected content");
    });

    await runClientLeaf(
      "sign edit",
      ["sign", "edit", String(FIXTURE.sign.x), String(FIXTURE.sign.y), String(FIXTURE.sign.z), "--lines", "A", "B", "C", "D"],
      (data) => {
        expect(data.front[0] === "A", "sign edit did not update the first line");
        expect(data.front[3] === "D", "sign edit did not update the fourth line");
      }
    );

    const scheduledOpenChest = scheduleClientCommand(
      ["block", "interact", String(FIXTURE.chest.x), String(FIXTURE.chest.y), String(FIXTURE.chest.z)],
      1000
    );
    await runClientLeaf("gui wait-open", ["gui", "wait-open", "--timeout", "6"], async (data) => {
      expect(data.opened === true, "gui wait-open did not detect chest");
      unwrapRequestSuccess(await scheduledOpenChest);
    });

    const chestGui = await runClientLeaf("gui info", ["gui", "info"], (data) => {
      expect(data.open === true, "gui info did not report an open screen");
      expect(typeof data.title === "string" && data.title.length > 0, "gui info title missing");
    });

    await runClientLeaf("gui snapshot", ["gui", "snapshot"], (data) => {
      expect(Array.isArray(data.slots), "gui snapshot slots missing");
      expect(data.slots.length > 20, "gui snapshot returned too few slots");
    });

    await runClientLeaf("gui slot", ["gui", "slot", "13"], (data) => {
      expect(data.item?.type === "minecraft:diamond", "gui slot 13 did not contain the fixture diamonds");
    });

    const slot3Point = chestSlotPoint(chestGui, 3);
    const slot5Point = chestSlotPoint(chestGui, 5);
    const slot13Point = chestSlotPoint(chestGui, 13);

    await runClientLeaf("input mouse-move", ["input", "mouse-move", String(slot13Point.x), String(slot13Point.y)], (data) => {
      expect(data.moved === true, "input mouse-move did not report success");
      expect(pointNear(data, slot13Point), "input mouse-move did not move near the target slot");
    });

    await runClientLeaf("input mouse-pos", ["input", "mouse-pos"], (data) => {
      expect(typeof data.x === "number" && typeof data.y === "number", "input mouse-pos did not return coordinates");
      expect(pointNear(data, slot13Point), "input mouse-pos did not reflect the latest mouse location");
    });

    await runClientLeaf("input click", ["input", "click", String(slot13Point.x), String(slot13Point.y)], async (data) => {
      expect(data.clicked === true, "input click did not report success");
      const snapshot = unwrapRequestSuccess(await runCli(["--client", "real", "gui", "snapshot"]));
      expect(snapshot.cursorItem?.type === "minecraft:diamond", "input click did not pick up the diamond stack");
    });

    await runSetup("setup return diamonds after raw click", ["gui", "click", "13", "--button", "left"], (data) => {
      expect(data.success === true, "failed to return diamonds after raw click");
    });

    await runClientLeaf(
      "input double-click",
      ["input", "double-click", String(slot13Point.x), String(slot13Point.y)],
      (data) => {
        expect(data.clicked === true, "input double-click did not report success");
        expect(data.count === 2, "input double-click did not report double click count");
      }
    );

    await runSetup("setup pick cobblestone for raw drag", ["gui", "click", "0", "--button", "left"], (data) => {
      expect(data.success === true, "failed to pick cobblestone before raw drag");
    });

    await runClientLeaf(
      "input drag",
      ["input", "drag", String(slot3Point.x), String(slot3Point.y), String(slot5Point.x), String(slot5Point.y), "--button", "left"],
      async (data) => {
        expect(data.dragged === true, "input drag did not report success");
        const snapshot = unwrapRequestSuccess(await runCli(["--client", "real", "gui", "snapshot"]));
        for (const slot of [3, 4, 5]) {
          const item = snapshot.slots.find((entry) => entry.slot === slot)?.item;
          expect(item?.type === "minecraft:cobblestone", `input drag did not distribute cobblestone to slot ${slot}`);
        }
      }
    );

    const capturePath = path.join(SCREENSHOT_DIR, "real-capture-gui.png");
    await runClientLeaf("screenshot", ["screenshot", "--output", capturePath, "--region", "0,0,200,200", "--gui"], async (data) => {
      await ensureFileExists(capturePath);
      expect(String(data.path).endsWith("real-capture-gui.png"), "screenshot did not return the expected output path");
      summary.screenshots.push({ ok: true, path: capturePath, source: "capture.screenshot" });
    });

    const guiShotPath = path.join(SCREENSHOT_DIR, "real-gui-screenshot.png");
    await runClientLeaf("gui screenshot", ["gui", "screenshot", "--output", guiShotPath], async (data) => {
      await ensureFileExists(guiShotPath);
      expect(String(data.path).endsWith("real-gui-screenshot.png"), "gui screenshot did not return the expected output path");
      summary.screenshots.push({ ok: true, path: guiShotPath, source: "gui.screenshot" });
    });

    await runClientLeaf(
      "wait",
      ["wait", "1", "--ticks", "20", "--until-health-above", "18", "--until-gui-open", "--until-on-ground", "--timeout", "5"],
      (data) => {
        expect(Number(data.waitedSeconds) >= 1.9, "wait completed too quickly");
        expect(data.guiOpen === true, "wait did not observe an open GUI");
        expect(data.onGround === true, "wait did not report onGround");
      }
    );

    await runClientLeaf("gui close", ["gui", "close"], (data) => {
      expect(data.success === true, "gui close failed");
    });

    await openChestSetup("setup reopen chest for gui click");
    await runClientLeaf("gui click", ["gui", "click", "13", "--button", "right"], (data) => {
      expect(data.success === true, "gui click failed");
    });
    await closeGuiSetup("setup close chest after gui click");

    await openChestSetup("setup reopen chest for gui drag");
    await runSetup("setup pick chest slot 0", ["gui", "click", "0", "--button", "left"], (data) => {
      expect(data.success === true, "failed to pick up chest item");
    });
    await runClientLeaf("gui drag", ["gui", "drag", "--slots", "1,2,3", "--button", "left"], (data) => {
      expect(data.success === true, "gui drag failed");
    });
    await closeGuiSetup("setup close chest after gui drag");

    await openChestSetup("setup reopen chest for gui wait-update");
    const scheduledGuiUpdate = scheduleClientCommand(["gui", "click", "22", "--button", "left"], 1000);
    await runClientLeaf("gui wait-update", ["gui", "wait-update", "--timeout", "6"], async (data) => {
      expect(data.updated === true, "gui wait-update did not detect a change");
      unwrapRequestSuccess(await scheduledGuiUpdate);
    });
    await closeGuiSetup("setup close chest after gui wait-update");

    await resetFixture("setup reset before block interact");
    await runClientLeaf(
      "block interact",
      ["block", "interact", String(FIXTURE.chest.x), String(FIXTURE.chest.y), String(FIXTURE.chest.z)],
      (data) => {
        expect(data.success === true, "block interact failed");
      }
    );
    await closeGuiSetup("setup close chest after block interact");
  }
};
