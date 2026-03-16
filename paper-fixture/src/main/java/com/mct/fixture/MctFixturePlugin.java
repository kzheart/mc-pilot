package com.mct.fixture;

import java.util.List;
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.attribute.Attribute;
import org.bukkit.block.Block;
import org.bukkit.block.Chest;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.boss.BarColor;
import org.bukkit.boss.BarStyle;
import org.bukkit.boss.BossBar;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.AbstractHorse;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Horse;
import org.bukkit.entity.Item;
import org.bukkit.entity.Player;
import org.bukkit.entity.Villager;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.Merchant;
import org.bukkit.inventory.MerchantRecipe;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scoreboard.Criteria;
import org.bukkit.scoreboard.DisplaySlot;
import org.bukkit.scoreboard.Objective;
import org.bukkit.scoreboard.Scoreboard;
import org.bukkit.scoreboard.Team;
import org.bukkit.util.BoundingBox;
import org.bukkit.util.Vector;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerInteractEvent;

public final class MctFixturePlugin extends JavaPlugin implements Listener {

    private static final String FIXTURE_ENTITY_TAG = "mct_fixture";
    private static final int FLOOR_Y = 79;
    private static final int PLAY_Y = 80;

    private static final int CHEST_X = 10;
    private static final int CHEST_Z = 34;
    private static final int CRAFT_X = 12;
    private static final int CRAFT_Z = 34;
    private static final int ANVIL_X = 14;
    private static final int ANVIL_Z = 34;
    private static final int BREAK_X = 15;
    private static final int BREAK_Z = 35;
    private static final int PLACE_X = 14;
    private static final int PLACE_Z = 36;
    private static final int SIGN_X = 16;
    private static final int SIGN_Z = 36;
    private static final int ENCHANT_X = 16;
    private static final int ENCHANT_Z = 40;
    private static final int RESET_X = 18;
    private static final int RESET_Z = 37;

    private static final double VILLAGER_X = 10.5D;
    private static final double VILLAGER_Z = 39.5D;
    private static final double ZOMBIE_X = 12.5D;
    private static final double ZOMBIE_Z = 39.5D;
    private static final double HORSE_X = 16.5D;
    private static final double HORSE_Z = 38.5D;

    private BossBar bossBar;

    @Override
    public void onEnable() {
        Bukkit.getPluginManager().registerEvents(this, this);
    }

    @Override
    public void onDisable() {
        if (bossBar != null) {
            bossBar.removeAll();
            bossBar = null;
        }
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("Only players can use this command.");
            return true;
        }

        if (command.getName().equalsIgnoreCase("mcttp")) {
            resetFixture(player);
            player.sendMessage("MCT fixture reset complete.");
            return true;
        }

        if (args.length == 0) {
            sender.sendMessage("Usage: /mctfixture <reset|hud|resourcepack|opensign|drops>");
            return true;
        }

        switch (args[0].toLowerCase()) {
            case "reset" -> {
                resetFixture(player);
                player.sendMessage("MCT fixture reset complete.");
                return true;
            }
            case "hud" -> {
                applyHud(player);
                player.sendMessage("MCT HUD updated.");
                return true;
            }
            case "resourcepack" -> {
                if (args.length < 2) {
                    sender.sendMessage("Usage: /mctfixture resourcepack <url>");
                    return true;
                }
                player.setResourcePack(args[1], "", false, Component.text("MCT test resource pack"));
                player.sendMessage("MCT resource pack requested.");
                return true;
            }
            case "opensign" -> {
                openFixtureSign(player);
                player.sendMessage("MCT sign editor opened.");
                return true;
            }
            case "drops" -> {
                spawnFixtureDrops(player.getWorld());
                player.sendMessage("MCT drops spawned.");
                return true;
            }
            default -> {
                sender.sendMessage("Unknown subcommand.");
                return true;
            }
        }
    }

    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        Bukkit.getScheduler().runTaskLater(this, () -> {
            if (player.isOnline()) {
                resetFixture(player);
            }
        }, 1L);
        Bukkit.getScheduler().runTaskLater(this, () -> {
            if (player.isOnline()) {
                resetFixture(player);
            }
        }, 20L);
    }

    @EventHandler
    public void onPlayerInteract(PlayerInteractEvent event) {
        if (event.getAction() != Action.RIGHT_CLICK_BLOCK || event.getClickedBlock() == null) {
            return;
        }
        Block block = event.getClickedBlock();
        if (block.getX() != RESET_X || block.getY() != PLAY_Y || block.getZ() != RESET_Z) {
            if (block.getX() != SIGN_X || block.getY() != PLAY_Y || block.getZ() != SIGN_Z) {
                return;
            }
            event.setCancelled(true);
            openFixtureSign(event.getPlayer());
            return;
        }
        event.setCancelled(true);
        resetFixture(event.getPlayer());
    }

    private void resetFixture(Player player) {
        World world = player.getWorld();
        prepareWorld(world);
        buildArena(world);
        clearFixtureEntities(world);
        spawnFixtureEntities(world, player);
        populateChest(world);
        populateSign(world);
        resetPlayer(player, world);
        applyHud(player);
        Bukkit.getScheduler().runTask(this, () -> {
            populateChest(world);
            populateSign(world);
        });
    }

    private void prepareWorld(World world) {
        world.setTime(6000L);
        world.setStorm(false);
        world.setThundering(false);
        world.getChunkAt(0, 2).load();
        world.getChunkAt(1, 2).load();
    }

    private void buildArena(World world) {
        for (int x = 8; x <= 22; x++) {
            for (int z = 32; z <= 44; z++) {
                for (int y = FLOOR_Y - 3; y <= FLOOR_Y; y++) {
                    world.getBlockAt(x, y, z).setType(Material.STONE, false);
                }
                for (int y = PLAY_Y; y <= PLAY_Y + 4; y++) {
                    world.getBlockAt(x, y, z).setType(Material.AIR, false);
                }
            }
        }

        for (int x = 8; x <= 22; x++) {
            for (int y = PLAY_Y + 1; y <= PLAY_Y + 2; y++) {
                world.getBlockAt(x, y, 32).setType(Material.GLASS, false);
                world.getBlockAt(x, y, 44).setType(Material.GLASS, false);
            }
        }
        for (int z = 32; z <= 44; z++) {
            for (int y = PLAY_Y + 1; y <= PLAY_Y + 2; y++) {
                world.getBlockAt(8, y, z).setType(Material.GLASS, false);
                world.getBlockAt(22, y, z).setType(Material.GLASS, false);
            }
        }

        world.getBlockAt(CHEST_X, PLAY_Y, CHEST_Z).setType(Material.CHEST, false);
        world.getBlockAt(CRAFT_X, PLAY_Y, CRAFT_Z).setType(Material.CRAFTING_TABLE, false);
        world.getBlockAt(ANVIL_X, PLAY_Y, ANVIL_Z).setType(Material.ANVIL, false);
        world.getBlockAt(BREAK_X, PLAY_Y, BREAK_Z).setType(Material.STONE, false);
        world.getBlockAt(PLACE_X, FLOOR_Y, PLACE_Z).setType(Material.STONE, false);
        world.getBlockAt(PLACE_X, PLAY_Y, PLACE_Z).setType(Material.AIR, false);
        world.getBlockAt(SIGN_X, FLOOR_Y, SIGN_Z).setType(Material.STONE, false);
        world.getBlockAt(SIGN_X, PLAY_Y, SIGN_Z).setType(Material.OAK_SIGN, false);
        world.getBlockAt(ENCHANT_X, PLAY_Y, ENCHANT_Z).setType(Material.ENCHANTING_TABLE, false);
        world.getBlockAt(RESET_X, PLAY_Y, RESET_Z).setType(Material.LEVER, false);

        int[][] bookshelves = {
            {ENCHANT_X - 2, ENCHANT_Z - 2},
            {ENCHANT_X - 2, ENCHANT_Z - 1},
            {ENCHANT_X - 2, ENCHANT_Z},
            {ENCHANT_X - 2, ENCHANT_Z + 1},
            {ENCHANT_X - 2, ENCHANT_Z + 2},
            {ENCHANT_X + 2, ENCHANT_Z - 2},
            {ENCHANT_X + 2, ENCHANT_Z - 1},
            {ENCHANT_X + 2, ENCHANT_Z},
            {ENCHANT_X + 2, ENCHANT_Z + 1},
            {ENCHANT_X + 2, ENCHANT_Z + 2},
            {ENCHANT_X - 1, ENCHANT_Z - 2},
            {ENCHANT_X, ENCHANT_Z - 2},
            {ENCHANT_X + 1, ENCHANT_Z - 2},
            {ENCHANT_X - 1, ENCHANT_Z + 2},
            {ENCHANT_X + 1, ENCHANT_Z + 2}
        };
        for (int[] bookshelf : bookshelves) {
            world.getBlockAt(bookshelf[0], PLAY_Y, bookshelf[1]).setType(Material.BOOKSHELF, false);
        }
    }

    private void clearFixtureEntities(World world) {
        BoundingBox bounds = new BoundingBox(8, PLAY_Y, 32, 22, PLAY_Y + 4, 44);
        for (Entity entity : world.getNearbyEntities(bounds)) {
            if (entity instanceof Player) {
                continue;
            }
            entity.remove();
        }
    }

    private void spawnFixtureEntities(World world, Player player) {
        Villager villager = (Villager) world.spawnEntity(new Location(world, VILLAGER_X, PLAY_Y, VILLAGER_Z), EntityType.VILLAGER);
        markFixtureEntity(villager);
        villager.setAI(false);
        villager.setInvulnerable(false);
        villager.setProfession(Villager.Profession.LIBRARIAN);
        villager.setVillagerType(Villager.Type.PLAINS);
        villager.setVillagerLevel(2);
        MerchantRecipe recipe = new MerchantRecipe(new ItemStack(Material.DIAMOND, 1), 9999);
        recipe.addIngredient(new ItemStack(Material.EMERALD, 4));
        Merchant merchant = Bukkit.createMerchant("MCT Trader");
        merchant.setRecipes(List.of(recipe));
        villager.setRecipes(merchant.getRecipes());
        villager.customName(Component.text("MCT Trader"));
        villager.setCustomNameVisible(true);

        Entity zombie = world.spawnEntity(new Location(world, ZOMBIE_X, PLAY_Y, ZOMBIE_Z), EntityType.ZOMBIE);
        markFixtureEntity(zombie);
        zombie.setInvulnerable(false);
        zombie.setGravity(true);
        zombie.setVelocity(new Vector(0, 0, 0));
        if (zombie instanceof org.bukkit.entity.LivingEntity living) {
            living.setAI(false);
            if (living.getAttribute(Attribute.GENERIC_KNOCKBACK_RESISTANCE) != null) {
                living.getAttribute(Attribute.GENERIC_KNOCKBACK_RESISTANCE).setBaseValue(1.0D);
            }
            living.getEquipment().setHelmet(new ItemStack(Material.LEATHER_HELMET));
        }
        zombie.customName(Component.text("MCT Target"));
        zombie.setCustomNameVisible(true);

        Horse horse = (Horse) world.spawnEntity(new Location(world, HORSE_X, PLAY_Y, HORSE_Z), EntityType.HORSE);
        markFixtureEntity(horse);
        horse.setAdult();
        horse.setAI(false);
        horse.setTamed(true);
        horse.setOwner(player);
        horse.setDomestication(horse.getMaxDomestication());
        horse.setJumpStrength(0.9D);
        horse.getInventory().setSaddle(new ItemStack(Material.SADDLE));
        horse.customName(Component.text("MCT Mount"));
        horse.setCustomNameVisible(true);
    }

    private void spawnFixtureDrops(World world) {
        Item diamond = world.dropItem(new Location(world, 9.5D, PLAY_Y + 0.2D, 37.5D), new ItemStack(Material.DIAMOND, 3));
        markFixtureEntity(diamond);
        diamond.setPickupDelay(0);
        diamond.setVelocity(new Vector(0, 0, 0));

        Item bread = world.dropItem(new Location(world, 15.5D, PLAY_Y + 0.2D, 37.5D), new ItemStack(Material.BREAD, 2));
        markFixtureEntity(bread);
        bread.setPickupDelay(0);
        bread.setVelocity(new Vector(0, 0, 0));
    }

    private void populateChest(World world) {
        Block block = world.getBlockAt(CHEST_X, PLAY_Y, CHEST_Z);
        if (block.getType() != Material.CHEST) {
            block.setType(Material.CHEST, false);
        }
        Chest chest = (Chest) block.getState();
        chest.update(true, false);
        Inventory inventory = ((Chest) block.getState()).getBlockInventory();
        inventory.clear();
        inventory.setItem(0, new ItemStack(Material.COBBLESTONE, 32));
        inventory.setItem(1, new ItemStack(Material.OAK_LOG, 16));
        inventory.setItem(2, new ItemStack(Material.GOLD_INGOT, 12));
        inventory.setItem(13, new ItemStack(Material.DIAMOND, 3));
        inventory.setItem(22, new ItemStack(Material.BREAD, 5));
        getLogger().info("Fixture chest populated slot0=" + inventory.getItem(0) + " slot13=" + inventory.getItem(13));
    }

    private void populateSign(World world) {
        Sign sign = (Sign) world.getBlockAt(SIGN_X, PLAY_Y, SIGN_Z).getState();
        sign.setLine(0, "MCT Line 1");
        sign.setLine(1, "MCT Line 2");
        sign.setLine(2, "MCT Line 3");
        sign.setLine(3, "MCT Line 4");
        sign.setEditable(true);
        sign.update(true, false);
    }

    private void openFixtureSign(Player player) {
        World world = player.getWorld();
        Sign sign = (Sign) world.getBlockAt(SIGN_X, PLAY_Y, SIGN_Z).getState();
        sign.setEditable(true);
        sign.setWaxed(false);
        sign.update(true, false);
        player.openSign(sign, Side.FRONT);
    }

    private void resetPlayer(Player player, World world) {
        player.closeInventory();
        Location target = new Location(world, 12.5D, PLAY_Y, 37.5D, 180.0F, 0.0F);
        boolean teleported = player.teleport(target);
        player.setVelocity(new Vector(0, 0, 0));
        player.setFallDistance(0.0F);
        player.setGravity(true);
        player.setGameMode(GameMode.SURVIVAL);
        player.setHealth(player.getMaxHealth());
        player.setFoodLevel(20);
        player.setSaturation(20.0F);
        player.setLevel(30);
        player.setExp(0.9F);
        player.getInventory().clear();
        player.getInventory().setHeldItemSlot(0);
        player.getInventory().setItem(0, new ItemStack(Material.DIRT, 64));
        player.getInventory().setItem(1, new ItemStack(Material.DIAMOND_PICKAXE, 1));
        player.getInventory().setItem(2, new ItemStack(Material.IRON_SWORD, 1));
        player.getInventory().setItem(3, new ItemStack(Material.WRITABLE_BOOK, 1));
        player.getInventory().setItem(4, new ItemStack(Material.BREAD, 8));
        player.getInventory().setItem(5, new ItemStack(Material.DIAMOND_SWORD, 1));
        player.getInventory().setItem(6, new ItemStack(Material.DIAMOND, 4));
        player.getInventory().setItem(7, new ItemStack(Material.STICK, 8));
        player.getInventory().setItem(8, new ItemStack(Material.EMERALD, 32));
        player.getInventory().setItem(9, new ItemStack(Material.LAPIS_LAZULI, 32));
        player.getInventory().setItemInOffHand(new ItemStack(Material.SHIELD, 1));
        player.updateInventory();
        getLogger().info("Reset player teleported=" + teleported + " target=" + target + " actual=" + player.getLocation());
    }

    private void applyPersistentHud(Player player) {
        Scoreboard scoreboard = Bukkit.getScoreboardManager().getNewScoreboard();
        Objective objective = scoreboard.registerNewObjective("mct_sidebar", Criteria.DUMMY, "MCT Sidebar");
        objective.setDisplaySlot(DisplaySlot.SIDEBAR);
        objective.getScore("Ready").setScore(3);
        objective.getScore("Arena").setScore(2);
        objective.getScore("CLI/Mod").setScore(1);
        Team team = scoreboard.registerNewTeam("mct_name");
        team.setPrefix("MCT[");
        team.setSuffix("]");
        team.addEntry(player.getName());
        player.setScoreboard(scoreboard);
        player.setPlayerListHeaderFooter("MCT Header", "MCT Footer");

        if (bossBar != null) {
            bossBar.removeAll();
        }
        bossBar = Bukkit.createBossBar("MCT Boss", BarColor.BLUE, BarStyle.SEGMENTED_10);
        bossBar.setProgress(0.6D);
        bossBar.addPlayer(player);
        bossBar.setVisible(true);
    }

    private void applyHud(Player player) {
        applyPersistentHud(player);
        player.sendActionBar("MCT Actionbar");
        player.sendTitle("MCT Title", "MCT Subtitle", 0, 60, 20);
    }

    private void markFixtureEntity(Entity entity) {
        entity.addScoreboardTag(FIXTURE_ENTITY_TAG);
        entity.setPersistent(false);
    }
}
