package com.mct.version.impl;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.mixin.AbstractSignEditScreenAccessor;
import com.mct.version.*;
import net.minecraft.block.entity.SignBlockEntity;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.Element;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.ingame.AbstractSignEditScreen;
import net.minecraft.client.gui.screen.multiplayer.ConnectScreen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.network.ServerAddress;
import net.minecraft.client.network.ServerInfo;
import net.minecraft.client.resource.server.ServerResourcePackLoader;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.component.DataComponentTypes;
import net.minecraft.component.type.ItemEnchantmentsComponent;
import net.minecraft.component.type.NbtComponent;
import net.minecraft.component.type.WritableBookContentComponent;
import net.minecraft.component.type.WrittenBookContentComponent;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.item.ItemStack;
import net.minecraft.network.packet.c2s.play.PlayerMoveC2SPacket;
import net.minecraft.scoreboard.ScoreboardDisplaySlot;
import net.minecraft.scoreboard.ScoreboardEntry;
import net.minecraft.scoreboard.ScoreboardObjective;
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
        return text -> Text.Serialization.toJsonString(text, MinecraftClient.getInstance().world.getRegistryManager());
    }

    private static ScoreboardAdapter createScoreboardAdapter() {
        return scoreboard -> {
            ScoreboardObjective objective = scoreboard.getObjectiveForSlot(ScoreboardDisplaySlot.SIDEBAR);
            if (objective == null) {
                return Map.of("title", "", "entries", List.of());
            }
            ArrayList<Map<String, Object>> entries = new ArrayList<>();
            scoreboard.getScoreboardEntries(objective).stream()
                .filter(entry -> !entry.hidden())
                .sorted(Comparator.comparingInt(ScoreboardEntry::value).reversed())
                .forEach(entry -> entries.add(
                    Map.of("name", entry.name().getString(), "score", entry.value())));
            return Map.of("title", objective.getDisplayName().getString(), "entries", entries);
        };
    }

    private static ResourcePackAdapter createResourcePackAdapter() {
        return new ResourcePackAdapter() {
            @Override
            public Map<String, Object> status(MinecraftClient client, ClientStateTracker stateTracker) {
                requireLoader(client);
                return stateTracker.getResourcePackState();
            }

            @Override
            public Map<String, Object> accept(MinecraftClient client, ClientStateTracker stateTracker) {
                if (pressResourcePackPromptButton(client, true)) {
                    return status(client, stateTracker);
                }
                requireLoader(client).acceptAll();
                return status(client, stateTracker);
            }

            @Override
            public Map<String, Object> reject(MinecraftClient client, ClientStateTracker stateTracker) {
                if (pressResourcePackPromptButton(client, false)) {
                    return status(client, stateTracker);
                }
                requireLoader(client).declineAll();
                return status(client, stateTracker);
            }

            private ServerResourcePackLoader requireLoader(MinecraftClient client) {
                ServerResourcePackLoader loader = client.getServerResourcePackProvider();
                if (loader == null) {
                    throw new ActionException("INVALID_STATE");
                }
                return loader;
            }
        };
    }

    private static boolean pressResourcePackPromptButton(MinecraftClient client, boolean accept) {
        Screen screen = client.currentScreen;
        if (screen == null || !isResourcePackPrompt(screen)) {
            return false;
        }
        List<ButtonWidget> buttons = new ArrayList<>();
        for (Element child : screen.children()) {
            if (child instanceof ButtonWidget button) {
                buttons.add(button);
            }
        }
        if (buttons.isEmpty()) {
            return false;
        }
        buttons.get(accept ? 0 : Math.min(1, buttons.size() - 1)).onPress();
        return true;
    }

    private static boolean isResourcePackPrompt(Screen screen) {
        String screenClass = screen.getClass().getName().toLowerCase(java.util.Locale.ROOT);
        Text titleText = screen.getTitle();
        String title = titleText != null ? titleText.getString().toLowerCase(java.util.Locale.ROOT) : "";
        return screenClass.contains("resource")
            || screenClass.contains("confirm")
            || title.contains("resource pack")
            || title.contains("server pack");
    }

    private static ReconnectAdapter createReconnectAdapter() {
        return (client, parent, serverAddress, address) -> {
            ServerInfo serverInfo = new ServerInfo("MCT Auto Test", address, ServerInfo.ServerType.OTHER);
            ConnectScreen.connect(parent, client, serverAddress, serverInfo, false, null);
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
            WritableBookContentComponent writable = stack.get(DataComponentTypes.WRITABLE_BOOK_CONTENT);
            if (writable != null) {
                writable.stream(false).forEach(page -> pages.add(page));
                return pages;
            }
            WrittenBookContentComponent written = stack.get(DataComponentTypes.WRITTEN_BOOK_CONTENT);
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
                NbtComponent customData = stack.getOrDefault(DataComponentTypes.CUSTOM_DATA, NbtComponent.DEFAULT);
                if (!customData.equals(NbtComponent.DEFAULT)) {
                    result.put("nbt", customData.toString());
                }
            }

            @Override
            public List<Map<String, Object>> getEnchantments(ItemStack stack) {
                ArrayList<Map<String, Object>> values = new ArrayList<>();
                ItemEnchantmentsComponent enchantments = stack.getEnchantments();
                for (var entry : enchantments.getEnchantmentEntries()) {
                    String id = entry.getKey().getKey()
                        .map(key -> key.getValue().toString())
                        .orElse("unknown");
                    values.add(Map.of("id", id, "level", entry.getIntValue()));
                }
                return values;
            }

            @Override
            public String statusEffectId(StatusEffectInstance effect) {
                return effect.getEffectType().getKey()
                    .map(key -> key.getValue().toString())
                    .orElse("unknown");
            }
        };
    }

    private static ActionResultAdapter createActionResultAdapter() {
        return ActionResult::toString;
    }

    private static NetworkAdapter createNetworkAdapter() {
        return (player, yaw, pitch) ->
            player.networkHandler.sendPacket(
                new PlayerMoveC2SPacket.LookAndOnGround(yaw, pitch, player.isOnGround(), player.horizontalCollision));
    }

    private static ImageAdapter createImageAdapter() {
        return new ImageAdapter() {
            @Override
            public void setPixel(NativeImage image, int x, int y, int color) {
                image.setColorArgb(x, y, color);
            }

            @Override
            public int getPixel(NativeImage image, int x, int y) {
                return image.getColorArgb(x, y);
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
