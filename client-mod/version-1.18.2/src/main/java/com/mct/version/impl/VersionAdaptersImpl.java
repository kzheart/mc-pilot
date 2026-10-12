package com.mct.version.impl;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.mixin.AbstractSignEditScreenAccessor;
import com.mct.version.*;
import net.minecraft.block.entity.SignBlockEntity;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.ConnectScreen;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.ingame.SignEditScreen;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.network.ServerAddress;
import net.minecraft.client.network.ServerInfo;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.util.ScreenshotRecorder;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.item.ItemStack;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.nbt.NbtElement;
import net.minecraft.nbt.NbtList;
import net.minecraft.network.packet.c2s.play.PlayerMoveC2SPacket;
import net.minecraft.network.packet.c2s.play.UpdateSignC2SPacket;
import net.minecraft.util.math.BlockPos;
import net.minecraft.scoreboard.Scoreboard;
import net.minecraft.scoreboard.ScoreboardObjective;
import net.minecraft.scoreboard.ScoreboardPlayerScore;
import net.minecraft.text.Text;
import net.minecraft.client.network.ClientPlayerInteractionManager;
import net.minecraft.util.ActionResult;
import net.minecraft.util.Hand;
import net.minecraft.util.hit.BlockHitResult;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

public final class VersionAdaptersImpl {

    private VersionAdaptersImpl() {}

    public static ClientVersionModules create() {
        return new ClientVersionModules(
            createTextAdapter(),
            createScoreboardAdapter(),
            createResourcePackAdapter(),
            createReconnectAdapter(),
            createSignAdapter(),
            createBookAdapter(),
            createItemDataAdapter(),
            createActionResultAdapter(),
            createNetworkAdapter(),
            createImageAdapter(),
            createScreenshotAdapter(),
            createInteractionAdapter(),
            createCompatibility()
        );
    }

    private static TextAdapter createTextAdapter() {
        return text -> Text.Serializer.toJson(text);
    }

    private static ScoreboardAdapter createScoreboardAdapter() {
        return scoreboard -> {
            ScoreboardObjective objective = scoreboard.getObjectiveForSlot(Scoreboard.SIDEBAR_DISPLAY_SLOT_ID);
            if (objective == null) {
                return Map.of("title", "", "entries", List.of());
            }
            ArrayList<Map<String, Object>> entries = new ArrayList<>();
            scoreboard.getAllPlayerScores(objective).stream()
                .sorted(Comparator.comparingInt(ScoreboardPlayerScore::getScore).reversed())
                .forEach(entry -> entries.add(
                    Map.of("name", entry.getPlayerName(), "score", entry.getScore())));
            return Map.of("title", objective.getDisplayName().getString(), "entries", entries);
        };
    }

    private static ResourcePackAdapter createResourcePackAdapter() {
        return new ResourcePackAdapter() {
            @Override
            public Map<String, Object> status(MinecraftClient client, ClientStateTracker stateTracker) {
                boolean prompt = com.mct.core.resourcepack.ResourcePackSupport.isPrompt(client);
                ServerInfo info = client.getCurrentServerEntry();
                String acceptance = prompt ? "pending" : info == null ? "unknown"
                    : info.getResourcePackPolicy() == ServerInfo.ResourcePackPolicy.ENABLED ? "allowed"
                    : info.getResourcePackPolicy() == ServerInfo.ResourcePackPolicy.DISABLED ? "declined" : "prompt";
                stateTracker.recordResourcePackState(acceptance, prompt ? 1 : 0);
                return stateTracker.getResourcePackState();
            }

            @Override
            public Map<String, Object> accept(MinecraftClient client, ClientStateTracker stateTracker) {
                if (!com.mct.core.resourcepack.ResourcePackSupport.answerPrompt(client, true)) {
                    throw new ActionException("INVALID_STATE");
                }
                return status(client, stateTracker);
            }

            @Override
            public Map<String, Object> reject(MinecraftClient client, ClientStateTracker stateTracker) {
                if (!com.mct.core.resourcepack.ResourcePackSupport.answerPrompt(client, false)) {
                    throw new ActionException("INVALID_STATE");
                }
                return status(client, stateTracker);
            }
        };
    }

    private static ReconnectAdapter createReconnectAdapter() {
        return (client, parent, serverAddress, address) -> {
            ServerInfo serverInfo = new ServerInfo("MCT Auto Test", address, false);
            serverInfo = com.mct.core.resourcepack.ResourcePackSupport.connectionInfo(client, serverInfo);
            ConnectScreen.connect(parent, client, serverAddress, serverInfo);
        };
    }

    private static SignAdapter createSignAdapter() {
        return new SignAdapter() {
            @Override
            public Map<String, Object> readSign(SignBlockEntity sign) {
                return Map.of(
                    "front", signText(sign, true, false),
                    "back", List.of("", "", "", ""),
                    "waxed", false
                );
            }

            @Override
            public List<String> signText(SignBlockEntity sign, boolean front, boolean filtered) {
                ArrayList<String> lines = new ArrayList<>();
                for (int index = 0; index < 4; index++) {
                    lines.add(sign.getTextOnRow(index, filtered).getString());
                }
                return lines;
            }

            @Override
            public boolean isSignEditScreen(Screen screen) {
                return screen instanceof SignEditScreen;
            }

            @Override
            public void editSignLine(Object accessor, int row, String message) {
                AbstractSignEditScreenAccessor signAccessor = (AbstractSignEditScreenAccessor) accessor;
                signAccessor.mct$setCurrentRow(row);
                signAccessor.mct$getText()[row] = message;
            }

            @Override
            public void sendSignUpdate(ClientPlayerEntity player, BlockPos pos, String[] lines) {
                player.networkHandler.sendPacket(new UpdateSignC2SPacket(pos, lines[0], lines[1], lines[2], lines[3]));
            }
        };
    }

    private static BookAdapter createBookAdapter() {
        return stack -> {
            ArrayList<String> pages = new ArrayList<>();
            if (stack.hasNbt() && stack.getNbt() != null) {
                net.minecraft.client.gui.screen.ingame.BookScreen.filterPages(stack.getNbt(), pages::add);
            }
            return pages;
        };
    }

    private static ItemDataAdapter createItemDataAdapter() {
        return new ItemDataAdapter() {
            @Override
            public void appendCustomData(ItemStack stack, Map<String, Object> result) {
                if (stack.hasNbt()) {
                    NbtCompound nbt = stack.getNbt();
                    result.put("nbt", nbt != null ? nbt.toString() : null);
                }
            }

            @Override
            public List<Map<String, Object>> getEnchantments(ItemStack stack) {
                ArrayList<Map<String, Object>> values = new ArrayList<>();
                NbtList enchantments = stack.getEnchantments();
                if (!enchantments.isEmpty()) {
                    for (NbtElement element : enchantments) {
                        if (!(element instanceof NbtCompound compound)) {
                            continue;
                        }
                        values.add(Map.of("id", compound.getString("id"), "level", compound.getShort("lvl")));
                    }
                }
                return values;
            }

            @Override
            public String statusEffectId(StatusEffectInstance effect) {
                return String.valueOf(McRegistries.statusEffectId(effect.getEffectType()));
            }
        };
    }

    private static ActionResultAdapter createActionResultAdapter() {
        return ActionResult::name;
    }

    private static NetworkAdapter createNetworkAdapter() {
        return (player, yaw, pitch) ->
            player.networkHandler.sendPacket(new PlayerMoveC2SPacket.LookAndOnGround(yaw, pitch, player.isOnGround()));
    }

    private static ImageAdapter createImageAdapter() {
        return new ImageAdapter() {
            @Override
            public void setPixel(NativeImage image, int x, int y, int color) {
                image.setColor(x, y, color);
            }

            @Override
            public int getPixel(NativeImage image, int x, int y) {
                return image.getColor(x, y);
            }
        };
    }

    private static ScreenshotAdapter createScreenshotAdapter() {
        return client -> CompletableFuture.completedFuture(ScreenshotRecorder.takeScreenshot(client.getFramebuffer()));
    }

    private static InteractionAdapter createInteractionAdapter() {
        return new InteractionAdapter() {
            @Override
            public ActionResult interactItem(ClientPlayerInteractionManager manager, ClientPlayerEntity player, Hand hand) {
                return manager.interactItem(player, player.clientWorld, hand);
            }

            @Override
            public ActionResult interactBlock(ClientPlayerInteractionManager manager, ClientPlayerEntity player, Hand hand, BlockHitResult hitResult) {
                return manager.interactBlock(player, player.clientWorld, hand, hitResult);
            }

            @Override
            public void sendCommand(ClientPlayerEntity player, String command) {
                String msg = command.startsWith("/") ? command : "/" + command;
                player.sendChatMessage(msg);
            }

            @Override
            public void sendChatMessage(ClientPlayerEntity player, String message) {
                player.sendChatMessage(message);
            }
        };
    }

    private static VersionCompatibility createCompatibility() {
        return new VersionCompatibility() {
            @Override
            public net.minecraft.client.world.ClientWorld getClientWorld(ClientPlayerEntity player) {
                return player.clientWorld;
            }

            @Override
            public net.minecraft.util.math.Vec3d getPlayerPos(ClientPlayerEntity player) {
                return player.getPos();
            }

            @Override
            public int getSelectedSlot(net.minecraft.entity.player.PlayerInventory inventory) {
                return inventory.selectedSlot;
            }

            @Override
            public void setSelectedSlot(net.minecraft.entity.player.PlayerInventory inventory, int slot) {
                inventory.selectedSlot = slot;
            }

            @Override
            public net.minecraft.util.math.Direction directionByName(String name) {
                return net.minecraft.util.math.Direction.byName(name);
            }

            @Override
            public String gameModeName(net.minecraft.world.GameMode gameMode) {
                return gameMode.getName();
            }

            @Override
            public String profileName(net.minecraft.client.network.PlayerListEntry entry) {
                return entry.getProfile().getName();
            }

            @Override
            public String worldDifficultyName(net.minecraft.client.world.ClientWorld world) {
                return world.getDifficulty().getName();
            }

            @Override
            public long worldTime(net.minecraft.client.world.ClientWorld world) {
                return world.getTime();
            }
        };
    }
}
