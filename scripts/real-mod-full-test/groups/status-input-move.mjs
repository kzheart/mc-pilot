export const statusInputMoveGroup = {
  id: "status-input-move",
  title: "状态、输入与移动",
  async run(context) {
    const {
      FIXTURE,
      approx,
      closeGuiSetup,
      expect,
      pollClientRequest,
      resetFixture,
      runCli,
      runClientLeaf,
      runSetup,
      unwrapRequestSuccess
    } = context;

    await runClientLeaf("status health", ["status", "health"], (data) => {
      expect(approx(data.health, 20, 0.5), "unexpected health value");
      expect(data.food === 20, "unexpected food value");
    });

    await runClientLeaf("status effects", ["status", "effects"], (data) => {
      expect(Array.isArray(data.effects), "status effects did not return an array");
    });

    await runClientLeaf("status experience", ["status", "experience"], (data) => {
      expect(data.level === 30, "unexpected experience level");
      expect(data.points === 101, `status experience points did not match fixture XP: ${JSON.stringify(data)}`);
      expect(data.nextLevelPoints === 112, "status experience nextLevelPoints did not match level 30 formula");
      expect(data.pointsToNextLevel === 11, "status experience pointsToNextLevel did not match fixture XP");
      expect(typeof data.totalExperience === "number" && data.totalExperience > data.nextLevelPoints, "status experience totalExperience was missing");
    });

    await runClientLeaf("status gamemode", ["status", "gamemode"], (data) => {
      expect(data.gameMode === "survival", "unexpected game mode");
    });

    await runClientLeaf("status world", ["status", "world"], (data) => {
      expect(String(data.dimension).includes("overworld"), "unexpected world dimension");
    });

    await runClientLeaf("status all", ["status", "all"], (data) => {
      expect(data.health?.food === 20, "status all missing health");
      expect(data.experience?.points === 101, "status all missing normalized experience points");
      expect(data.position?.onGround === true, "status all missing position");
    });

    const screenSize = await runClientLeaf("screen size", ["screen", "size"], (data) => {
      expect(Number(data.width) > 0, "screen width was not positive");
      expect(Number(data.height) > 0, "screen height was not positive");
    });

    await resetFixture("setup reset before raw keyboard input");

    await runClientLeaf("input key down", ["input", "key", "down", "shift"], (data) => {
      expect(data.down === true, "input key down did not report success");
      expect(Array.isArray(data.keys) && data.keys.includes("shift"), "input key down did not retain shift");
    });

    await runClientLeaf("input keys-down", ["input", "keys-down"], (data) => {
      expect(Array.isArray(data.keys), "input keys-down did not return an array");
      expect(data.keys.includes("shift"), "input keys-down did not include shift");
    });

    await runClientLeaf("input key up", ["input", "key", "up", "shift"], (data) => {
      expect(data.up === true, "input key up did not report success");
      expect(Array.isArray(data.keys) && !data.keys.includes("shift"), "input key up did not release shift");
    });

    await runClientLeaf("input key press", ["input", "key", "press", "inventory"], (data) => {
      expect(data.pressed === true, "input key press did not report success");
    });
    await runSetup("setup wait inventory screen for raw key press", ["gui", "wait-open", "--timeout", "5"], (data) => {
      expect(data.opened === true, "raw input key press did not open inventory");
    });
    await pollClientRequest(
      "setup inspect inventory after raw key press",
      ["gui", "info"],
      (data) => data.open === true && Number(data.size) > 0
    );
    await closeGuiSetup("setup close inventory after raw key press");

    await runSetup("setup select first hotbar slot before raw scroll", ["inventory", "hotbar", "0"], (data) => {
      expect(data.item?.type === "minecraft:dirt", "failed to reset hotbar before raw scroll");
    });

    await runClientLeaf(
      "input scroll",
      ["input", "scroll", String(Math.round(screenSize.width / 2)), String(Math.round(screenSize.height / 2)), "--delta", "1"],
      async (data) => {
        expect(data.scrolled === true, "input scroll did not report success");
        const held = unwrapRequestSuccess(await runCli(["--client", "real", "inventory", "held"]));
        expect(held.item?.type !== "minecraft:dirt", "input scroll did not change the selected hotbar slot");
      }
    );

    await resetFixture("setup reset before input key hold");

    await runClientLeaf("input key hold", ["input", "key", "hold", "w", "--duration", "800"], async (data) => {
      expect(data.held === true, "input key hold did not report success");
      expect(Number(data.actualDuration) >= 700, "input key hold returned an unexpectedly short duration");
      const position = unwrapRequestSuccess(await runCli(["--client", "real", "position", "get"]));
      const moved = Math.hypot(position.x - FIXTURE.teleport.x, position.z - FIXTURE.teleport.z);
      expect(moved > 0.5, "input key hold did not move the player");
    });

    await resetFixture("setup reset before movement");

    await runClientLeaf("look set", ["look", "set", "--yaw", "90", "--pitch", "-15"], (data) => {
      expect(approx(data.yaw, 90, 0.1), "look set yaw mismatch");
      expect(approx(data.pitch, -15, 0.1), "look set pitch mismatch");
    });

    await runClientLeaf("rotation get", ["rotation", "get"], (data) => {
      expect(approx(data.yaw, 90, 0.25), "rotation yaw mismatch");
      expect(approx(data.pitch, -15, 0.25), "rotation pitch mismatch");
    });

    await runClientLeaf("look at", ["look", "at", String(FIXTURE.chest.x), String(FIXTURE.chest.y), String(FIXTURE.chest.z)], (data) => {
      expect(typeof data.yaw === "number", "look at yaw missing");
      expect(typeof data.pitch === "number", "look at pitch missing");
    });

    await runClientLeaf("look entity", ["look", "entity", "--name", "MCT Trader"], (data) => {
      expect(typeof data.entityId === "number", "look entity did not return entity id");
    });

    await runClientLeaf("move jump", ["move", "jump"], (data) => {
      expect(data.success === true, "move jump failed");
    });

    await runClientLeaf("move sneak", ["move", "sneak", "on"], (data) => {
      expect(data.sneaking === true, "move sneak did not enable sneaking");
    });

    await runClientLeaf("move sprint", ["move", "sprint", "on"], (data) => {
      expect(data.sprinting === true, "move sprint did not enable sprint");
    });

    await runClientLeaf("move forward", ["move", "forward", "2"], (data) => {
      const dx = Number(data.newPos?.x) - FIXTURE.teleport.x;
      const dz = Number(data.newPos?.z) - FIXTURE.teleport.z;
      expect(Math.hypot(dx, dz) > 0.5, "move forward did not change position");
    });

    await runClientLeaf("move back", ["move", "back", "1"], (data) => {
      expect(typeof data.newPos?.x === "number", "move back did not return position");
    });

    await runClientLeaf("move left", ["move", "left", "1"], (data) => {
      expect(typeof data.newPos?.x === "number", "move left did not return position");
    });

    await runClientLeaf("move right", ["move", "right", "1"], (data) => {
      expect(typeof data.newPos?.x === "number", "move right did not return position");
    });

    await runClientLeaf("move to", ["move", "to", String(FIXTURE.chest.x), String(FIXTURE.chest.y), String(FIXTURE.chest.z)], (data) => {
      expect(data.arrived === true || Number(data.distance) < 1.5, "move to did not arrive near target");
    });
  }
};
