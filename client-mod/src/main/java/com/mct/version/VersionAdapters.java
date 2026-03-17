package com.mct.version;

//? if >=1.20.3 {
import net.minecraft.text.Text;
import net.minecraft.scoreboard.ScoreboardEntry;
import net.minecraft.client.gui.screen.multiplayer.ConnectScreen;
import net.minecraft.client.resource.server.ServerResourcePackLoader;
//?} else {
/*import net.minecraft.text.Text;
import net.minecraft.scoreboard.ScoreboardPlayerScore;
import net.minecraft.client.gui.screen.ConnectScreen;*/
//?}

//? if >=1.20.2
import net.minecraft.scoreboard.ScoreboardDisplaySlot;

//? if >=1.19.4 {
import net.minecraft.client.gui.screen.ingame.AbstractSignEditScreen;
//?} else {
/*import net.minecraft.client.gui.screen.ingame.SignEditScreen;*/
//?}

import com.mct.core.util.ActionException;
import com.mct.mixin.AbstractSignEditScreenAccessor;
import net.minecraft.block.entity.SignBlockEntity;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.network.ServerAddress;
import net.minecraft.client.network.ServerInfo;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.item.ItemStack;
import net.minecraft.network.packet.c2s.play.PlayerMoveC2SPacket;
import net.minecraft.scoreboard.Scoreboard;
import net.minecraft.scoreboard.ScoreboardObjective;
import net.minecraft.util.ActionResult;
import com.mct.core.state.ClientStateTracker;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

public final class VersionAdapters {

    private VersionAdapters() {}

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
            createImageAdapter()
        );
    }

    private static TextAdapter createTextAdapter() {
        //? if >=1.20.5 {
        /*return text -> Text.Serialization.toJsonString(text, MinecraftClient.getInstance().world.getRegistryManager());*/
        //?} else if >=1.20.3 {
        return Text.Serialization::toJsonString;
        //?} else {
        /*return text -> Text.Serializer.toJson(text);*/
        //?}
    }

    private static ScoreboardAdapter createScoreboardAdapter() {
        return scoreboard -> {
            //? if >=1.20.2 {
            ScoreboardObjective objective = scoreboard.getObjectiveForSlot(ScoreboardDisplaySlot.SIDEBAR);
            //?} else {
            /*ScoreboardObjective objective = scoreboard.getObjectiveForSlot(Scoreboard.SIDEBAR_DISPLAY_SLOT_ID);*/
            //?}

            if (objective == null) {
                return Map.of("title", "", "entries", List.of());
            }

            ArrayList<Map<String, Object>> entries = new ArrayList<>();
            //? if >=1.20.3 {
            scoreboard.getScoreboardEntries(objective).stream()
                .filter(entry -> !entry.hidden())
                .sorted(Comparator.comparingInt(ScoreboardEntry::value).reversed())
                .forEach(entry -> entries.add(
                    Map.of("name", entry.name().getString(), "score", entry.value())));
            //?} else {
            /*scoreboard.getAllPlayerScores(objective).stream()
                .sorted(Comparator.comparingInt(ScoreboardPlayerScore::getScore).reversed())
                .forEach(entry -> entries.add(
                    Map.of("name", entry.getPlayerName(), "score", entry.getScore())));*/
            //?}
            return Map.of("title", objective.getDisplayName().getString(), "entries", entries);
        };
    }

    private static ResourcePackAdapter createResourcePackAdapter() {
        //? if >=1.20.3 {
        return new ResourcePackAdapter() {
            @Override
            public Map<String, Object> status(MinecraftClient client, ClientStateTracker stateTracker) {
                requireLoader(client);
                return stateTracker.getResourcePackState();
            }

            @Override
            public Map<String, Object> accept(MinecraftClient client, ClientStateTracker stateTracker) {
                requireLoader(client).acceptAll();
                return status(client, stateTracker);
            }

            @Override
            public Map<String, Object> reject(MinecraftClient client, ClientStateTracker stateTracker) {
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
        //?} else {
        /*return new ResourcePackAdapter() {
            @Override
            public Map<String, Object> status(MinecraftClient client, ClientStateTracker stateTracker) {
                ServerInfo si = requireServerInfo(client);
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
                requireServerInfo(client).setResourcePackPolicy(ServerInfo.ResourcePackPolicy.ENABLED);
                stateTracker.recordResourcePackState("enabled", 0);
                return stateTracker.getResourcePackState();
            }

            @Override
            public Map<String, Object> reject(MinecraftClient client, ClientStateTracker stateTracker) {
                requireServerInfo(client).setResourcePackPolicy(ServerInfo.ResourcePackPolicy.DISABLED);
                stateTracker.recordResourcePackState("disabled", 0);
                return stateTracker.getResourcePackState();
            }

            private ServerInfo requireServerInfo(MinecraftClient client) {
                ServerInfo si = client.getCurrentServerEntry();
                if (si == null) {
                    throw new ActionException("INVALID_STATE");
                }
                return si;
            }
        };*/
        //?}
    }

    private static ReconnectAdapter createReconnectAdapter() {
        return (client, parent, serverAddress, address) -> {
            //? if >=1.20.2 {
            ServerInfo serverInfo = new ServerInfo("MCT Auto Test", address, ServerInfo.ServerType.OTHER);
            //?} else {
            /*ServerInfo serverInfo = new ServerInfo("MCT Auto Test", address, false);*/
            //?}
            //? if >=1.20.5 {
            /*ConnectScreen.connect(parent, client, serverAddress, serverInfo, false, null);*/
            //?} else {
            ConnectScreen.connect(parent, client, serverAddress, serverInfo, false);
            //?}
        };
    }

    private static SignAdapter createSignAdapter() {
        return new SignAdapter() {
            @Override
            public Map<String, Object> readSign(SignBlockEntity sign) {
                //? if >=1.20 {
                return Map.of(
                    "front", signText(sign, true, false),
                    "back", signText(sign, false, false),
                    "waxed", sign.isWaxed()
                );
                //?} else {
                /*return Map.of(
                    "front", signText(sign, true, false),
                    "back", List.of("", "", "", ""),
                    "waxed", false
                );*/
                //?}
            }

            @Override
            public List<String> signText(SignBlockEntity sign, boolean front, boolean filtered) {
                ArrayList<String> lines = new ArrayList<>();
                //? if >=1.20 {
                for (int index = 0; index < 4; index++) {
                    lines.add(sign.getText(front).getMessage(index, filtered).getString());
                }
                //?} else {
                /*for (int index = 0; index < 4; index++) {
                    lines.add(sign.getTextOnRow(index, filtered).getString());
                }*/
                //?}
                return lines;
            }

            @Override
            public boolean isSignEditScreen(Screen screen) {
                //? if >=1.19.4 {
                return screen instanceof AbstractSignEditScreen;
                //?} else {
                /*return screen instanceof SignEditScreen;*/
                //?}
            }

            @Override
            public void editSignLine(Object accessor, int row, String message) {
                AbstractSignEditScreenAccessor signAccessor = (AbstractSignEditScreenAccessor) accessor;
                signAccessor.mct$setCurrentRow(row);
                //? if >=1.19.4 {
                signAccessor.mct$setCurrentRowMessage(message);
                //?} else {
                /*signAccessor.mct$getText()[row] = message;*/
                //?}
            }
        };
    }

    private static BookAdapter createBookAdapter() {
        return stack -> {
            ArrayList<String> pages = new ArrayList<>();
            //? if >=1.20.5 {
            /*net.minecraft.component.type.WritableBookContentComponent writable = stack.get(net.minecraft.component.DataComponentTypes.WRITABLE_BOOK_CONTENT);
            if (writable != null) {
                writable.stream(false).forEach(pages::add);
            } else {
                net.minecraft.component.type.WrittenBookContentComponent written = stack.get(net.minecraft.component.DataComponentTypes.WRITTEN_BOOK_CONTENT);
                if (written != null) {
                    written.pages().forEach(page -> pages.add(page.raw().getString()));
                }
            }*/
            //?} else {
            if (stack.hasNbt() && stack.getNbt() != null) {
                net.minecraft.client.gui.screen.ingame.BookScreen.filterPages(stack.getNbt(), pages::add);
            }
            //?}
            return pages;
        };
    }

    private static ItemDataAdapter createItemDataAdapter() {
        return new ItemDataAdapter() {
            @Override
            public void appendCustomData(ItemStack stack, Map<String, Object> result) {
                //? if >=1.20.5 {
                /*net.minecraft.component.type.NbtComponent customData = stack.getOrDefault(
                    net.minecraft.component.DataComponentTypes.CUSTOM_DATA,
                    net.minecraft.component.type.NbtComponent.DEFAULT
                );
                if (!customData.equals(net.minecraft.component.type.NbtComponent.DEFAULT)) {
                    result.put("nbt", customData.toString());
                }*/
                //?} else {
                if (stack.hasNbt()) {
                    net.minecraft.nbt.NbtCompound nbt = stack.getNbt();
                    result.put("nbt", nbt != null ? nbt.toString() : null);
                }
                //?}
            }

            @Override
            public List<Map<String, Object>> getEnchantments(ItemStack stack) {
                ArrayList<Map<String, Object>> values = new ArrayList<>();
                //? if >=1.20.5 {
                /*net.minecraft.component.type.ItemEnchantmentsComponent enchantments = stack.getEnchantments();
                if (!enchantments.isEmpty()) {
                    for (var entry : enchantments.getEnchantmentEntries()) {
                        values.add(
                            Map.of(
                                "id", String.valueOf(net.minecraft.registry.Registries.ENCHANTMENT.getKey(entry.getKey().value())
                                    .map(key -> key.getValue().toString()).orElse("unknown")),
                                "level", entry.getIntValue()
                            )
                        );
                    }
                }*/
                //?} else {
                net.minecraft.nbt.NbtList enchantments = stack.getEnchantments();
                if (!enchantments.isEmpty()) {
                    for (net.minecraft.nbt.NbtElement element : enchantments) {
                        if (!(element instanceof net.minecraft.nbt.NbtCompound compound)) {
                            continue;
                        }
                        values.add(
                            Map.of(
                                "id", compound.getString("id"),
                                "level", compound.getShort("lvl")
                            )
                        );
                    }
                }
                //?}
                return values;
            }

            @Override
            public String statusEffectId(StatusEffectInstance effect) {
                //? if >=1.20.5 {
                /*return String.valueOf(effect.getEffectType().getKey()
                    .map(key -> key.getValue().toString()).orElse("unknown"));*/
                //?} else {
                return String.valueOf(McRegistries.statusEffectId(effect.getEffectType()));
                //?}
            }
        };
    }

    private static ActionResultAdapter createActionResultAdapter() {
        return actionResult -> {
            //? if >=1.21.2 {
            /*return actionResult.toString();*/
            //?} else {
            return actionResult.name();
            //?}
        };
    }

    private static NetworkAdapter createNetworkAdapter() {
        return (player, yaw, pitch) -> {
            //? if >=1.21.2 {
            /*player.networkHandler.sendPacket(new PlayerMoveC2SPacket.LookAndOnGround(yaw, pitch, player.isOnGround(), player.horizontalCollision));*/
            //?} else {
            player.networkHandler.sendPacket(new PlayerMoveC2SPacket.LookAndOnGround(yaw, pitch, player.isOnGround()));
            //?}
        };
    }

    private static ImageAdapter createImageAdapter() {
        return new ImageAdapter() {
            @Override
            public void setPixel(NativeImage image, int x, int y, int color) {
                //? if >=1.21.2 {
                /*image.setColorArgb(x, y, color);*/
                //?} else {
                image.setColor(x, y, color);
                //?}
            }

            @Override
            public int getPixel(NativeImage image, int x, int y) {
                //? if >=1.21.2 {
                /*return image.getColorArgb(x, y);*/
                //?} else {
                return image.getColor(x, y);
                //?}
            }
        };
    }
}
