package com.mct.version.impl;

import com.mct.core.network.PacketSender;
import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.mixin.AbstractSignEditScreenAccessor;
import com.mct.version.*;
import com.mojang.blaze3d.platform.NativeImage;
import com.mojang.serialization.JsonOps;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.events.GuiEventListener;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.inventory.AbstractSignEditScreen;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.client.resources.server.DownloadedPackSource;
import net.minecraft.core.BlockPos;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.ComponentSerialization;
import net.minecraft.network.protocol.game.ServerboundMovePlayerPacket;
import net.minecraft.network.protocol.game.ServerboundSignUpdatePacket;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.CustomData;
import net.minecraft.world.item.component.WritableBookContent;
import net.minecraft.world.item.component.WrittenBookContent;
import net.minecraft.world.item.enchantment.ItemEnchantments;
import net.minecraft.world.level.block.entity.SignBlockEntity;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.scores.DisplaySlot;
import net.minecraft.world.scores.Objective;
import net.minecraft.world.scores.PlayerScoreEntry;

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
        return text -> ComponentSerialization.CODEC.encodeStart(JsonOps.INSTANCE, text)
            .result()
            .map(Object::toString)
            .orElse("\"\"");
    }

    private static ScoreboardAdapter createScoreboardAdapter() {
        return scoreboard -> {
            Objective objective = scoreboard.getDisplayObjective(DisplaySlot.SIDEBAR);
            if (objective == null) {
                return Map.of("title", "", "entries", List.of());
            }
            ArrayList<Map<String, Object>> entries = new ArrayList<>();
            scoreboard.listPlayerScores(objective).stream()
                .filter(entry -> !entry.isHidden())
                .sorted(Comparator.comparingInt(PlayerScoreEntry::value).reversed())
                .forEach(entry -> entries.add(
                    Map.of("name", entry.ownerName().getString(), "score", entry.value())));
            return Map.of("title", objective.getDisplayName().getString(), "entries", entries);
        };
    }

    private static ResourcePackAdapter createResourcePackAdapter() {
        return new ResourcePackAdapter() {
            @Override
            public Map<String, Object> status(Minecraft client, ClientStateTracker stateTracker) {
                requireLoader(client);
                return stateTracker.getResourcePackState();
            }

            @Override
            public Map<String, Object> accept(Minecraft client, ClientStateTracker stateTracker) {
                if (pressResourcePackPromptButton(client, true)) {
                    return status(client, stateTracker);
                }
                requireLoader(client).allowServerPacks();
                return status(client, stateTracker);
            }

            @Override
            public Map<String, Object> reject(Minecraft client, ClientStateTracker stateTracker) {
                if (pressResourcePackPromptButton(client, false)) {
                    return status(client, stateTracker);
                }
                requireLoader(client).rejectServerPacks();
                return status(client, stateTracker);
            }

            private DownloadedPackSource requireLoader(Minecraft client) {
                DownloadedPackSource loader = client.getDownloadedPackSource();
                if (loader == null) {
                    throw new ActionException("INVALID_STATE");
                }
                return loader;
            }
        };
    }

    private static boolean pressResourcePackPromptButton(Minecraft client, boolean accept) {
        Screen screen = ClientVersionModulesHolder.get().compatibility().getScreen(client);
        if (screen == null || !isResourcePackPrompt(screen)) {
            return false;
        }
        List<Button> buttons = new ArrayList<>();
        for (GuiEventListener child : screen.children()) {
            if (child instanceof Button button) {
                buttons.add(button);
            }
        }
        if (buttons.isEmpty()) {
            return false;
        }
        buttons.get(accept ? 0 : Math.min(1, buttons.size() - 1)).onPress(null);
        return true;
    }

    private static boolean isResourcePackPrompt(Screen screen) {
        String screenClass = screen.getClass().getName().toLowerCase(java.util.Locale.ROOT);
        Component titleText = screen.getTitle();
        String title = titleText != null ? titleText.getString().toLowerCase(java.util.Locale.ROOT) : "";
        return screenClass.contains("resource")
            || screenClass.contains("confirm")
            || title.contains("resource pack")
            || title.contains("server pack");
    }

    private static ReconnectAdapter createReconnectAdapter() {
        return (client, parent, serverAddress, address) -> {
            ServerData serverInfo = new ServerData("MCT Auto Test", address, ServerData.Type.OTHER);
            ConnectScreen.startConnecting(parent, client, serverAddress, serverInfo, false, null);
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

            @Override
            public void sendSignUpdate(LocalPlayer player, BlockPos pos, String[] lines) {
                PacketSender.send(player.connection, new ServerboundSignUpdatePacket(pos, true, lines[0], lines[1], lines[2], lines[3]));
            }
        };
    }

    private static BookAdapter createBookAdapter() {
        return stack -> {
            ArrayList<String> pages = new ArrayList<>();
            WritableBookContent writable = stack.get(DataComponents.WRITABLE_BOOK_CONTENT);
            if (writable != null) {
                writable.getPages(false).forEach(pages::add);
                return pages;
            }
            WrittenBookContent written = stack.get(DataComponents.WRITTEN_BOOK_CONTENT);
            if (written != null) {
                written.pages().forEach(page -> pages.add(page.raw().getString()));
            }
            return pages;
        };
    }

    private static ItemDataAdapter createItemDataAdapter() {
        return new ItemDataAdapter() {
            @Override
            public void appendCustomData(ItemStack stack, Map<String, Object> result) {
                CustomData customData = stack.getOrDefault(DataComponents.CUSTOM_DATA, CustomData.EMPTY);
                if (!customData.equals(CustomData.EMPTY)) {
                    result.put("nbt", customData.toString());
                }
            }

            @Override
            public List<Map<String, Object>> getEnchantments(ItemStack stack) {
                ArrayList<Map<String, Object>> values = new ArrayList<>();
                ItemEnchantments enchantments = stack.getEnchantments();
                for (var entry : enchantments.entrySet()) {
                    String id = entry.getKey().unwrapKey()
                        .map(key -> key.identifier().toString())
                        .orElse("unknown");
                    values.add(Map.of("id", id, "level", entry.getIntValue()));
                }
                return values;
            }

            @Override
            public String statusEffectId(MobEffectInstance effect) {
                return effect.getEffect().unwrapKey()
                    .map(key -> key.identifier().toString())
                    .orElse("unknown");
            }
        };
    }

    private static ActionResultAdapter createActionResultAdapter() {
        return InteractionResult::toString;
    }

    private static NetworkAdapter createNetworkAdapter() {
        return (player, yaw, pitch) ->
            PacketSender.send(player.connection,
                new ServerboundMovePlayerPacket.Rot(yaw, pitch, player.onGround(), player.horizontalCollision));
    }

    private static ImageAdapter createImageAdapter() {
        return new ImageAdapter() {
            @Override
            public void setPixel(NativeImage image, int x, int y, int color) {
                image.setPixel(x, y, color);
            }

            @Override
            public int getPixel(NativeImage image, int x, int y) {
                return image.getPixel(x, y);
            }
        };
    }

    private static ScreenshotAdapter createScreenshotAdapter() {
        return ScreenshotSupport::takeScreenshot;
    }

    private static InteractionAdapter createInteractionAdapter() {
        return new InteractionAdapter() {
            @Override
            public InteractionResult interactItem(MultiPlayerGameMode manager, LocalPlayer player, InteractionHand hand) {
                return manager.useItem(player, hand);
            }

            @Override
            public InteractionResult interactBlock(MultiPlayerGameMode manager, LocalPlayer player, InteractionHand hand, BlockHitResult hitResult) {
                return manager.useItemOn(player, hand, hitResult);
            }

            @Override
            public void sendCommand(LocalPlayer player, String command) {
                player.connection.sendCommand(command);
            }

            @Override
            public void sendChatMessage(LocalPlayer player, String message) {
                player.connection.sendChat(message);
            }
        };
    }

    private static VersionCompatibility createCompatibility() {
        return new VersionCompatibility() {
            @Override
            public net.minecraft.client.multiplayer.ClientLevel getClientWorld(LocalPlayer player) {
                return (net.minecraft.client.multiplayer.ClientLevel) player.level();
            }

            @Override
            public net.minecraft.world.phys.Vec3 getPlayerPos(LocalPlayer player) {
                return player.position();
            }

            @Override
            public int getSelectedSlot(net.minecraft.world.entity.player.Inventory inventory) {
                return inventory.getSelectedSlot();
            }

            @Override
            public void setSelectedSlot(net.minecraft.world.entity.player.Inventory inventory, int slot) {
                inventory.setSelectedSlot(slot);
            }

            @Override
            public net.minecraft.core.Direction directionByName(String name) {
                return net.minecraft.core.Direction.byName(name);
            }

            @Override
            public String gameModeName(net.minecraft.world.level.GameType gameMode) {
                return gameMode.getName();
            }

            @Override
            public String profileName(net.minecraft.client.multiplayer.PlayerInfo entry) {
                return entry.getProfile().name();
            }

            @Override
            public String worldDifficultyName(net.minecraft.client.multiplayer.ClientLevel world) {
                return world.getLevelData().getDifficulty().getSerializedName();
            }

            @Override
            public long worldTime(net.minecraft.client.multiplayer.ClientLevel world) {
                return world.getOverworldClockTime();
            }

            @Override
            public void dispatchKey(Minecraft client, int keyCode, int scancode, int action) {
                ((com.mct.core.input.KeyboardInputBridge) client.keyboardHandler).mct$onKey(client.getWindow().handle(), keyCode, scancode, action, 0);
            }
        };
    }
}
