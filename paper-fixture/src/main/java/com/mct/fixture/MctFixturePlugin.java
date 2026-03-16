package com.mct.fixture;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.util.Vector;

public final class MctFixturePlugin extends JavaPlugin {

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("Only players can use this command.");
            return true;
        }

        World world = Bukkit.getWorlds().get(0);
        world.getBlockAt(12, 79, 34).setType(Material.STONE, false);
        world.getBlockAt(12, 80, 34).setType(Material.AIR, false);
        world.getBlockAt(12, 81, 34).setType(Material.AIR, false);

        Location target = new Location(world, 12.5D, 80.0D, 34.5D, 0F, 0F);
        player.teleport(target);
        player.setVelocity(new Vector(0D, 0D, 0D));
        player.setFallDistance(0F);
        player.setGravity(false);
        player.sendMessage("MCT fixture teleported you.");
        return true;
    }
}
