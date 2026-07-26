package com.mct.fixture.legacy;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Collections;
import net.md_5.bungee.api.ChatMessageType;
import net.md_5.bungee.api.chat.TextComponent;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.attribute.Attribute;
import org.bukkit.block.Block;
import org.bukkit.block.Chest;
import org.bukkit.block.Sign;
import org.bukkit.boss.BarColor;
import org.bukkit.boss.BarStyle;
import org.bukkit.boss.BossBar;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Horse;
import org.bukkit.entity.Item;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Villager;
import org.bukkit.entity.Zombie;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.MerchantRecipe;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scoreboard.DisplaySlot;
import org.bukkit.scoreboard.Objective;
import org.bukkit.scoreboard.Scoreboard;
import org.bukkit.scoreboard.Team;
import org.bukkit.util.Vector;

/** 1.12.2 twin of MctFixturePlugin: same commands, arena layout, and inventory contract. */
public final class MctFixtureLegacyPlugin extends JavaPlugin implements Listener {

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
        Player player = sender instanceof Player
            ? (Player) sender
            : Bukkit.getOnlinePlayers().stream().findFirst().orElse(null);
        if (player == null) {
            sender.sendMessage("No online player is available for this command.");
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

        String sub = args[0].toLowerCase();
        if ("reset".equals(sub)) {
            resetFixture(player);
            player.sendMessage("MCT fixture reset complete.");
        } else if ("hud".equals(sub)) {
            applyHud(player);
            player.sendMessage("MCT HUD updated.");
        } else if ("resourcepack".equals(sub)) {
            if (args.length < 2) {
                sender.sendMessage("Usage: /mctfixture resourcepack <url>");
                return true;
            }
            player.setResourcePack(args[1]);
            player.sendMessage("MCT resource pack requested.");
        } else if ("opensign".equals(sub)) {
            armFixtureSign(player);
            player.sendMessage("MCT sign editor opened.");
        } else if ("drops".equals(sub)) {
            spawnFixtureDrops(player.getWorld());
            player.sendMessage("MCT drops spawned.");
        } else {
            sender.sendMessage("Unknown subcommand.");
        }
        return true;
    }

    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        final Player player = event.getPlayer();
        Bukkit.getScheduler().runTaskLater(this, () -> {
            if (player.isOnline()) {
                applyPersistentHud(player);
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
            armFixtureSign(event.getPlayer());
            return;
        }
        event.setCancelled(true);
        resetFixture(event.getPlayer());
    }

    private void resetFixture(final Player player) {
        final World world = player.getWorld();
        prepareWorld(world);
        buildArena(world);
        clearFixtureEntities(world);
        spawnFixtureEntities(world, player);
        populateChest(world);
        populateSign(world, player);
        resetPlayer(player, world);
        applyHud(player);
        Bukkit.getScheduler().runTask(this, () -> {
            populateChest(world);
            populateSign(world, player);
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
        world.getBlockAt(CRAFT_X, PLAY_Y, CRAFT_Z).setType(Material.WORKBENCH, false);
        world.getBlockAt(ANVIL_X, PLAY_Y, ANVIL_Z).setType(Material.ANVIL, false);
        world.getBlockAt(BREAK_X, PLAY_Y, BREAK_Z).setType(Material.STONE, false);
        world.getBlockAt(PLACE_X, FLOOR_Y, PLACE_Z).setType(Material.STONE, false);
        world.getBlockAt(PLACE_X, PLAY_Y, PLACE_Z).setType(Material.AIR, false);
        world.getBlockAt(SIGN_X, FLOOR_Y, SIGN_Z).setType(Material.STONE, false);
        world.getBlockAt(SIGN_X, PLAY_Y, SIGN_Z).setType(Material.SIGN_POST, false);
        world.getBlockAt(ENCHANT_X, PLAY_Y, ENCHANT_Z).setType(Material.ENCHANTMENT_TABLE, false);
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
        Location center = new Location(world, 15.0D, PLAY_Y + 2, 38.0D);
        for (Entity entity : world.getNearbyEntities(center, 8.0D, 4.0D, 7.0D)) {
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
        MerchantRecipe recipe = new MerchantRecipe(new ItemStack(Material.DIAMOND, 1), 9999);
        recipe.addIngredient(new ItemStack(Material.EMERALD, 4));
        villager.setRecipes(Collections.singletonList(recipe));
        villager.setCustomName("MCT Trader");
        villager.setCustomNameVisible(true);

        Zombie zombie = (Zombie) world.spawnEntity(new Location(world, ZOMBIE_X, PLAY_Y, ZOMBIE_Z), EntityType.ZOMBIE);
        markFixtureEntity(zombie);
        zombie.setBaby(false);
        zombie.setInvulnerable(false);
        zombie.setGravity(true);
        zombie.setVelocity(new Vector(0, 0, 0));
        zombie.setAI(false);
        if (zombie.getAttribute(Attribute.GENERIC_KNOCKBACK_RESISTANCE) != null) {
            zombie.getAttribute(Attribute.GENERIC_KNOCKBACK_RESISTANCE).setBaseValue(1.0D);
        }
        zombie.getEquipment().setHelmet(new ItemStack(Material.LEATHER_HELMET));
        zombie.setCustomName("MCT Target");
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
        horse.setCustomName("MCT Mount");
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
        inventory.setItem(1, new ItemStack(Material.LOG, 16));
        inventory.setItem(2, new ItemStack(Material.GOLD_INGOT, 12));
        inventory.setItem(13, new ItemStack(Material.DIAMOND, 3));
        inventory.setItem(22, new ItemStack(Material.BREAD, 5));
    }

    private void populateSign(World world, Player player) {
        Block block = world.getBlockAt(SIGN_X, PLAY_Y, SIGN_Z);
        if (!(block.getState() instanceof Sign)) {
            return;
        }
        Sign sign = (Sign) block.getState();
        sign.setLine(0, "MCT Line 1");
        sign.setLine(1, "MCT Line 2");
        sign.setLine(2, "MCT Line 3");
        sign.setLine(3, "MCT Line 4");
        sign.update(true, false);
        armSignForEditing(world, player);
    }

    private void armFixtureSign(Player player) {
        armSignForEditing(player.getWorld(), player);
    }

    /**
     * 1.12's PlayerConnection only accepts CPacketUpdateSign when the sign tile is
     * editable AND owned by the sending player; there is no Bukkit API for that,
     * so set both NMS fields reflectively (single fixed version: v1_12_R1).
     */
    private void armSignForEditing(World world, Player player) {
        try {
            Object craftWorld = world;
            Method getHandle = craftWorld.getClass().getMethod("getHandle");
            Object nmsWorld = getHandle.invoke(craftWorld);

            Class<?> blockPositionClass = Class.forName("net.minecraft.server.v1_12_R1.BlockPosition");
            Object blockPosition = blockPositionClass
                .getConstructor(int.class, int.class, int.class)
                .newInstance(SIGN_X, PLAY_Y, SIGN_Z);
            Method getTileEntity = nmsWorld.getClass().getMethod("getTileEntity", blockPositionClass);
            Object tileEntity = getTileEntity.invoke(nmsWorld, blockPosition);
            if (tileEntity == null) {
                return;
            }

            Object nmsPlayer = player.getClass().getMethod("getHandle").invoke(player);
            Class<?> entityHumanClass = Class.forName("net.minecraft.server.v1_12_R1.EntityHuman");
            for (Field field : tileEntity.getClass().getDeclaredFields()) {
                if (java.lang.reflect.Modifier.isStatic(field.getModifiers())) {
                    continue;
                }
                field.setAccessible(true);
                if (field.getType() == boolean.class) {
                    field.set(tileEntity, true);
                } else if (entityHumanClass.isAssignableFrom(field.getType())) {
                    field.set(tileEntity, nmsPlayer);
                } else if (field.getType() == java.util.UUID.class) {
                    // Paper 1.12 validates against TileEntitySign.signEditor (UUID), not the vanilla EntityHuman field.
                    field.set(tileEntity, player.getUniqueId());
                }
            }
        } catch (Exception exception) {
            getLogger().warning("Failed to arm sign for editing: " + exception);
        }
    }

    private void resetPlayer(final Player player, World world) {
        player.closeInventory();
        final Location target = new Location(world, 12.5D, PLAY_Y, 37.5D, 180.0F, 0.0F);
        player.teleport(target);
        stabilizePlayerAt(player, target);
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
        player.getInventory().setItem(3, new ItemStack(Material.BOOK_AND_QUILL, 1));
        player.getInventory().setItem(4, new ItemStack(Material.BREAD, 8));
        player.getInventory().setItem(5, new ItemStack(Material.DIAMOND_SWORD, 1));
        player.getInventory().setItem(6, new ItemStack(Material.DIAMOND, 4));
        player.getInventory().setItem(7, new ItemStack(Material.STICK, 8));
        player.getInventory().setItem(8, new ItemStack(Material.EMERALD, 32));
        // 1.12 lapis lazuli is ink_sack with data value 4.
        player.getInventory().setItem(9, new ItemStack(Material.INK_SACK, 32, (short) 4));
        player.getInventory().setItemInOffHand(new ItemStack(Material.SHIELD, 1));
        player.updateInventory();
        Bukkit.getScheduler().runTaskLater(this, () -> stabilizePlayerAt(player, target), 1L);
        Bukkit.getScheduler().runTaskLater(this, () -> stabilizePlayerAt(player, target), 3L);
    }

    private void stabilizePlayerAt(Player player, Location target) {
        if (!player.isOnline()) {
            return;
        }
        player.teleport(target);
        player.setVelocity(new Vector(0, 0, 0));
        player.setFallDistance(0.0F);
    }

    private void applyPersistentHud(Player player) {
        Scoreboard scoreboard = Bukkit.getScoreboardManager().getNewScoreboard();
        Objective objective = scoreboard.registerNewObjective("mct_sidebar", "dummy");
        objective.setDisplayName("MCT Sidebar");
        objective.setDisplaySlot(DisplaySlot.SIDEBAR);
        objective.getScore("Ready").setScore(3);
        objective.getScore("Arena").setScore(2);
        objective.getScore("CLI/Mod").setScore(1);
        Team team = scoreboard.registerNewTeam("mct_name");
        team.setPrefix("MCT[");
        team.setSuffix("]");
        team.addEntry(player.getName());
        player.setScoreboard(scoreboard);
        player.setPlayerListHeaderFooter(new TextComponent("MCT Header"), new TextComponent("MCT Footer"));

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
        player.spigot().sendMessage(ChatMessageType.ACTION_BAR, new TextComponent("MCT Actionbar"));
        player.sendTitle("MCT Title", "MCT Subtitle", 0, 60, 20);
    }

    private void markFixtureEntity(Entity entity) {
        entity.addScoreboardTag(FIXTURE_ENTITY_TAG);
        if (entity instanceof LivingEntity) {
            ((LivingEntity) entity).setRemoveWhenFarAway(false);
        }
    }
}
