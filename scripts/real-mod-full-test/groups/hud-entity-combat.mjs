export const hudEntityCombatGroup = {
  id: "hud-entity-combat",
  title: "HUD、实体与战斗",
  async run(context) {
    const {
      FIXTURE,
      applyHudSetup,
      expect,
      resetFixture,
      runClientLeaf,
      runSetup,
      state
    } = context;

    await resetFixture("setup reset before hud");
    await applyHudSetup();

    await runClientLeaf("hud scoreboard", ["hud", "scoreboard"], (data) => {
      expect(data.title === "MCT Sidebar", "hud scoreboard title mismatch");
      expect(Array.isArray(data.entries) && data.entries.length >= 3, "hud scoreboard entries missing");
    });

    await runClientLeaf("hud tab", ["hud", "tab"], (data) => {
      expect(data.header === "MCT Header", "hud tab header mismatch");
      expect(Array.isArray(data.players) && data.players.length >= 1, "hud tab players missing");
    });

    await runClientLeaf("hud bossbar", ["hud", "bossbar"], (data) => {
      expect(Array.isArray(data.bossBars) && data.bossBars.length >= 1, "hud bossbar missing");
    });

    await runClientLeaf("hud actionbar", ["hud", "actionbar"], (data) => {
      expect(String(data.text).includes("MCT Actionbar"), "hud actionbar mismatch");
    });

    await runClientLeaf("hud title", ["hud", "title"], (data) => {
      expect(data.title === "MCT Title", "hud title mismatch");
      expect(data.subtitle === "MCT Subtitle", "hud subtitle mismatch");
    });

    await runClientLeaf("hud nametag", ["hud", "nametag", "--player", "TEST1"], (data) => {
      expect(data.prefix === "MCT[", "hud nametag prefix mismatch");
      expect(data.suffix === "]", "hud nametag suffix mismatch");
    });

    await resetFixture("setup reset before entity");

    await runClientLeaf("entity list", ["entity", "list", "--radius", "16"], (data) => {
      expect(Array.isArray(data.entities), "entity list missing entities");
      expect(data.entities.length >= 3, "entity list returned too few entities");
      state.cachedEntityIds = Object.fromEntries(data.entities.map((entity) => [entity.name, entity.id]));
      expect(state.cachedEntityIds["MCT Trader"], "entity list missing MCT Trader");
      expect(state.cachedEntityIds["MCT Mount"], "entity list missing MCT Mount");
      expect(state.cachedEntityIds["MCT Target"], "entity list missing MCT Target");
    });

    await runClientLeaf("entity info", ["entity", "info", "--id", String(state.cachedEntityIds["MCT Trader"])], (data) => {
      expect(data.name === "MCT Trader", "entity info returned the wrong entity");
      expect(data.type === "minecraft:villager", "entity info type mismatch");
    });

    await runClientLeaf("entity attack", ["entity", "attack", "--name", "MCT Target"], (data) => {
      expect(data.success === true, "entity attack failed");
      expect(data.entityType === "minecraft:zombie", "entity attack hit the wrong entity");
    });

    await runClientLeaf("entity interact", ["entity", "interact", "--name", "MCT Trader"], (data) => {
      expect(data.success === true, "entity interact failed");
      expect(data.entityType === "minecraft:villager", "entity interact hit the wrong entity");
    });
    await context.closeGuiSetup("setup close villager gui after entity interact");

    await resetFixture("setup reset before combat kill");
    await runSetup("setup select sword for combat kill", ["inventory", "hotbar", "5"], (data) => {
      expect(data.item?.type === "minecraft:diamond_sword", "failed to select sword before combat kill");
    });
    await runClientLeaf("combat kill", ["combat", "kill", "--nearest", "--type", "zombie", "--timeout", "20"], (data) => {
      expect(data.killed === true, "combat kill did not report a kill");
      expect(Number(data.hits) >= 1, "combat kill did not register any hits");
    });

    await resetFixture("setup reset before combat engage");
    await runSetup("setup select sword for combat engage", ["inventory", "hotbar", "5"], (data) => {
      expect(data.item?.type === "minecraft:diamond_sword", "failed to select sword before combat engage");
    });
    await runSetup("setup move away before combat engage", ["move", "to", String(FIXTURE.chest.x), String(FIXTURE.chest.y), String(FIXTURE.chest.z)], (data) => {
      expect(data.arrived === true || Number(data.distance) < 1.5, "failed to move away before combat engage");
    });
    await runClientLeaf("combat engage", ["combat", "engage", "--name", "MCT Target", "--timeout", "25"], (data) => {
      expect(data.killed === true, "combat engage did not report a kill");
      expect(Number(data.hits) >= 1, "combat engage did not register any hits");
    });

    await resetFixture("setup reset before combat chase");
    await runSetup("setup select sword for combat chase", ["inventory", "hotbar", "5"], (data) => {
      expect(data.item?.type === "minecraft:diamond_sword", "failed to select sword before combat chase");
    });
    await runSetup("setup move away before combat chase", ["move", "to", String(FIXTURE.chest.x), String(FIXTURE.chest.y), String(FIXTURE.chest.z)], (data) => {
      expect(data.arrived === true || Number(data.distance) < 1.5, "failed to move away before combat chase");
    });
    await runClientLeaf("combat chase", ["combat", "chase", "--name", "MCT Target", "--timeout", "25"], (data) => {
      expect(data.killed === true, "combat chase did not report a kill");
      expect(Number(data.hits) >= 1, "combat chase did not register any hits");
    });

    await resetFixture("setup reset before combat clear");
    await runSetup("setup select sword for combat clear", ["inventory", "hotbar", "5"], (data) => {
      expect(data.item?.type === "minecraft:diamond_sword", "failed to select sword before combat clear");
    });
    await runClientLeaf("combat clear", ["combat", "clear", "--type", "zombie", "--radius", "16", "--timeout", "25"], (data) => {
      expect(Number(data.killed) >= 1, "combat clear did not kill any zombie");
      expect(Number(data.remaining) === 0, "combat clear left zombies alive");
    });

    await resetFixture("setup reset before combat pickup");
    await runSetup("setup drop bread for combat pickup", ["inventory", "hotbar", "4"], (data) => {
      expect(data.item?.type === "minecraft:bread", "failed to select bread before combat pickup");
    });
    await runSetup("setup create pickup drops", ["inventory", "drop", "--all"], (data) => {
      expect(data.dropped === true, "failed to create dropped items for combat pickup");
    });
    await runClientLeaf("combat pickup", ["combat", "pickup", "--radius", "5", "--timeout", "10"], (data) => {
      expect(Array.isArray(data.picked), "combat pickup did not return picked items");
      expect(data.picked.some((item) => item.type === "minecraft:bread"), "combat pickup did not collect the dropped bread");
    });

    await resetFixture("setup reset before mount");
    await runClientLeaf("entity mount", ["entity", "mount", "--name", "MCT Mount"], (data) => {
      expect(data.success === true, "entity mount failed");
      expect(typeof data.vehicleId === "number", "entity mount did not return vehicle id");
    });

    await runClientLeaf("entity steer", ["entity", "steer", "--forward", "--jump"], (data) => {
      expect(typeof data.newPos?.x === "number", "entity steer did not return position");
    });

    await runClientLeaf("entity dismount", ["entity", "dismount"], (data) => {
      expect(data.success === true, "entity dismount failed");
    });
  }
};
