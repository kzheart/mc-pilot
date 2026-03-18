package com.mct.version.impl;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.mixin.AbstractSignEditScreenAccessor;
import com.mct.version.*;
import net.minecraft.block.entity.SignBlockEntity;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.ConnectScreen;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.ingame.AbstractSignEditScreen;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.network.ServerAddress;
import net.minecraft.client.network.ServerInfo;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.item.ItemStack;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.nbt.NbtElement;
import net.minecraft.nbt.NbtList;
import net.minecraft.network.packet.c2s.play.PlayerMoveC2SPacket;
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
            createInteractionAdapter()
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
                // If a resource pack confirmation screen is open, report pending.
                // Use class name (full, not simple) and title for detection.
                if (client.currentScreen != null) {
                    String screenFullClass = client.currentScreen.getClass().getName().toLowerCase(java.util.Locale.ROOT);
                    net.minecraft.text.Text titleText = client.currentScreen.getTitle();
                    String title = titleText != null ? titleText.getString().toLowerCase(java.util.Locale.ROOT) : "";
                    if (screenFullClass.contains("resource") || screenFullClass.contains("confirm")
                            || title.contains("resource pack") || title.contains("server pack")) {
                        stateTracker.recordResourcePackState("pending", 1);
                        return stateTracker.getResourcePackState();
                    }
                }
                // If stateTracker already has pending from a previous call, keep it
                Map<String, Object> current = stateTracker.getResourcePackState();
                if ("pending".equals(current.get("acceptanceStatus"))) {
                    return current;
                }
                ServerInfo si = client.getCurrentServerEntry();
                if (si == null) {
                    return stateTracker.getResourcePackState();
                }
                String s = switch (si.getResourcePackPolicy()) {
                    case ENABLED -> "enabled";
                    case DISABLED -> "disabled";
                    case PROMPT -> "prompt";
                };
                stateTracker.recordResourcePackState(s, 0);
                return stateTracker.getResourcePackState();
            }

            @Override
            public Map<String, Object> accept(MinecraftClient client, ClientStateTracker stateTracker) {
                // Close resource pack prompt by accepting it (click "Yes" equivalent via keyboard)
                if (client.currentScreen != null) {
                    // Reset policy to PROMPT so next connection still shows the dialog
                    ServerInfo si = client.getCurrentServerEntry();
                    if (si != null) {
                        si.setResourcePackPolicy(ServerInfo.ResourcePackPolicy.ENABLED);
                    }
                    client.setScreen(null);
                }
                stateTracker.recordResourcePackState("allowed", 0);
                return stateTracker.getResourcePackState();
            }

            @Override
            public Map<String, Object> reject(MinecraftClient client, ClientStateTracker stateTracker) {
                if (client.currentScreen != null) {
                    ServerInfo si = client.getCurrentServerEntry();
                    if (si != null) {
                        si.setResourcePackPolicy(ServerInfo.ResourcePackPolicy.PROMPT);
                    }
                    client.setScreen(null);
                }
                stateTracker.recordResourcePackState("declined", 0);
                return stateTracker.getResourcePackState();
            }

            private ServerInfo requireServerInfo(MinecraftClient client) {
                ServerInfo si = client.getCurrentServerEntry();
                if (si == null) {
                    throw new ActionException("INVALID_STATE");
                }
                return si;
            }
        };
    }

    private static ReconnectAdapter createReconnectAdapter() {
        return (client, parent, serverAddress, address) -> {
            ServerInfo serverInfo = new ServerInfo("MCT Auto Test", address, false);
            ConnectScreen.connect(parent, client, serverAddress, serverInfo, false);
        };
    }

    private static SignAdapter createSignAdapter() {
        return new SignAdapter() {
            @Override
            public Map<String, Object> readSign(SignBlockEntity sign) {
                return Map.of(
                    "front", signText(sign, true, false),
                    "back", signText(sign, false, false),
                    "waxed", sign.isWaxed()
                );
            }

            @Override
            public List<String> signText(SignBlockEntity sign, boolean front, boolean filtered) {
                ArrayList<String> lines = new ArrayList<>();
                for (int index = 0; index < 4; index++) {
                    lines.add(sign.getText(front).getMessage(index, filtered).getString());
                }
                return lines;
            }

            @Override
            public boolean isSignEditScreen(Screen screen) {
                return screen instanceof AbstractSignEditScreen;
            }

            @Override
            public void editSignLine(Object accessor, int row, String message) {
                AbstractSignEditScreenAccessor signAccessor = (AbstractSignEditScreenAccessor) accessor;
                signAccessor.mct$setCurrentRow(row);
                signAccessor.mct$setCurrentRowMessage(message);
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

    private static InteractionAdapter createInteractionAdapter() {
        return new InteractionAdapter() {
            @Override
            public ActionResult interactItem(ClientPlayerInteractionManager manager, ClientPlayerEntity player, Hand hand) {
                return manager.interactItem(player, hand);
            }

            @Override
            public ActionResult interactBlock(ClientPlayerInteractionManager manager, ClientPlayerEntity player, Hand hand, BlockHitResult hitResult) {
                return manager.interactBlock(player, hand, hitResult);
            }

            @Override
            public void sendCommand(ClientPlayerEntity player, String command) {
                boolean sent = player.networkHandler.sendCommand(command);
                if (!sent) {
                    player.networkHandler.sendChatCommand(command);
                }
            }

            @Override
            public void sendChatMessage(ClientPlayerEntity player, String message) {
                player.networkHandler.sendChatMessage(message);
            }
        };
    }
}
