import { Command } from "commander";

import { MctError } from "../util/errors.js";
import { createRequestAction, parseJson } from "./request-helpers.js";

function normalizeCraftRecipe(raw: unknown) {
  if (Array.isArray(raw)) {
    return raw;
  }

  if (raw && typeof raw === "object" && Array.isArray((raw as { slots?: unknown }).slots)) {
    const slots = (raw as { slots: unknown[] }).slots;
    if (slots.length !== 9) {
      throw new MctError({ code: "INVALID_PARAMS", message: "recipe.slots must contain exactly 9 entries" }, 4);
    }
    return [slots.slice(0, 3), slots.slice(3, 6), slots.slice(6, 9)];
  }

  throw new MctError(
    {
      code: "INVALID_PARAMS",
      message: "recipe must be a 3x3 row array or {\"slots\":[...9 entries...]}"
    },
    4
  );
}

export function createCraftCommand() {
  return new Command("craft")
    .description(
      "Crafting table recipe\n" +
        "Prerequisite: open crafting table with \"block interact <x> <y> <z>\"\n" +
        "Auto-places materials from inventory, crafts, and moves result to inventory.\n" +
        "GUI closes automatically after crafting."
    )
    .requiredOption(
      "--recipe <json>",
      "Recipe JSON: 3 row arrays, or {\"slots\":[...9 entries...]} in row-major order.\n" +
        "Use item IDs without namespace (e.g. \"oak_planks\", not \"minecraft:oak_planks\").\n" +
        "Example: '[[\"oak_planks\",null,null],[\"oak_planks\",null,null],[null,null,null]]'"
    )
    .action(createRequestAction("craft.craft", ({ options }) => ({ recipe: normalizeCraftRecipe(parseJson(String(options.recipe), "recipe")) })));
}

export function createRecipeCommand() {
  const command = new Command("recipe").description("Task-level recipe helpers");

  command
    .command("craft-table")
    .description("Craft with the currently open crafting table")
    .requiredOption("--recipe <json>", "Recipe JSON: 3 row arrays or {\"slots\":[...9 entries...]}")
    .action(createRequestAction("craft.craft", ({ options }) => ({ recipe: normalizeCraftRecipe(parseJson(String(options.recipe), "recipe")) })));

  return command;
}

export function createAnvilCommand() {
  return new Command("anvil")
    .description(
      "Anvil rename operation\n" +
        "Prerequisite: open anvil with \"block interact <x> <y> <z>\"\n" +
        "Auto-moves item from inventory slot to anvil, renames it, and moves result back.\n" +
        "GUI closes automatically."
    )
    .requiredOption("--input-slot <slot>", "Inventory slot of the item to rename (0-8: hotbar, 9-35: main)", Number)
    .requiredOption("--rename <name>", "New item name")
    .action(
      createRequestAction("craft.anvil", ({ options }) => ({
        inputSlot: options.inputSlot,
        rename: options.rename
      }))
    );
}

export function createEnchantCommand() {
  return new Command("enchant")
    .description(
      "Enchanting table operation\n" +
        "Prerequisite: open enchanting table with \"block interact <x> <y> <z>\"\n" +
        "You must first place the item and lapis lazuli manually via \"gui click\".\n" +
        "Use \"gui snapshot\" to inspect slot layout. This command only selects the enchantment option."
    )
    .requiredOption("--option <index>", "Enchantment option: 0 = top, 1 = middle, 2 = bottom", Number)
    .action(createRequestAction("craft.enchant", ({ options }) => ({ option: options.option })));
}

export function createTradeCommand() {
  return new Command("trade")
    .description(
      "Villager trading\n" +
        "Prerequisite: open trade GUI with \"entity interact --nearest --type villager\"\n" +
        "Use \"gui snapshot\" to inspect available trades.\n" +
        "Selects the trade by index, auto-takes the result into inventory.\n" +
        "Requires payment items already in inventory."
    )
    .requiredOption("--index <index>", "Trade index (0-based)", Number)
    .action(createRequestAction("craft.trade", ({ options }) => ({ index: options.index })));
}
