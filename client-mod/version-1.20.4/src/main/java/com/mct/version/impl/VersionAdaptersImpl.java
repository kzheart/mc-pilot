package com.mct.version.impl;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.mixin.AbstractSignEditScreenAccessor;
import com.mct.version.*;
import net.minecraft.block.entity.SignBlockEntity;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.ingame.AbstractSignEditScreen;
import net.minecraft.client.gui.screen.multiplayer.ConnectScreen;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.network.ServerAddress;
import net.minecraft.client.network.ServerInfo;
import net.minecraft.client.resource.server.ServerResourcePackLoader;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.item.ItemStack;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.nbt.NbtElement;
import net.minecraft.nbt.NbtList;
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
        return Text.Serialization::toJsonString;
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
    }

    private static ReconnectAdapter createReconnectAdapter() {
        return (client, parent, serverAddress, address) -> {
            ServerInfo serverInfo = new ServerInfo("MCT Auto Test", address, ServerInfo.ServerType.OTHER);
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
