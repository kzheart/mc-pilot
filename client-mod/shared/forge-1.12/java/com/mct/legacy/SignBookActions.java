package com.mct.legacy;

import com.google.gson.JsonObject;
import io.netty.buffer.Unpooled;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import net.minecraft.client.entity.EntityPlayerSP;
import net.minecraft.client.gui.inventory.GuiEditSign;
import net.minecraft.init.Items;
import net.minecraft.item.ItemStack;
import net.minecraft.nbt.NBTTagCompound;
import net.minecraft.nbt.NBTTagList;
import net.minecraft.nbt.NBTTagString;
import net.minecraft.network.PacketBuffer;
import net.minecraft.network.play.client.CPacketCustomPayload;
import net.minecraft.network.play.client.CPacketUpdateSign;
import net.minecraft.tileentity.TileEntity;
import net.minecraft.tileentity.TileEntitySign;
import net.minecraft.util.EnumActionResult;
import net.minecraft.util.EnumHand;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Vec3d;
import net.minecraft.util.text.ITextComponent;
import net.minecraft.util.text.TextComponentString;

/** sign.read / sign.edit / book.read / book.write / book.sign */
public final class SignBookActions extends LegacyActions {

    private static final long BOOK_UPDATE_COOLDOWN_MILLIS = 1500L;

    private volatile long lastBookUpdateAt;

    @Override
    public Map<String, Object> handle(String action, JsonObject params) {
        if ("sign.read".equals(action)) {
            return onClient(() -> readSign(requireSign(params)));
        }
        if ("sign.edit".equals(action)) {
            return editSign(params);
        }
        if ("book.read".equals(action)) {
            return onClient(this::readBook);
        }
        if ("book.write".equals(action)) {
            return writeBook(params);
        }
        if ("book.sign".equals(action)) {
            return signBook(params);
        }
        throw new LegacyActionException("INVALID_ACTION");
    }

    private Map<String, Object> readSign(TileEntitySign sign) {
        List<String> front = new ArrayList<String>();
        for (int index = 0; index < 4; index++) {
            ITextComponent line = sign.signText[index];
            front.add(line != null ? line.getUnformattedText() : "");
        }
        List<String> back = new ArrayList<String>();
        for (int index = 0; index < 4; index++) {
            back.add("");
        }
        return map("front", front, "back", back, "waxed", false);
    }

    private Map<String, Object> editSign(JsonObject params) {
        List<String> lines = Params.stringList(params, "lines");
        if (lines.size() != 4) {
            throw new LegacyActionException("INVALID_PARAMS");
        }
        String[] values = new String[4];
        for (int index = 0; index < 4; index++) {
            values[index] = lines.get(index) != null ? lines.get(index) : "";
        }

        BlockPos pos = onClient(() -> {
            TileEntitySign sign = requireSign(params);
            BlockPos target = sign.getPos();
            if (!(client.currentScreen instanceof GuiEditSign)) {
                EntityPlayerSP player = requirePlayer();
                Vec3d hit = new Vec3d(target.getX() + 0.5D, target.getY() + 0.5D, target.getZ() + 0.5D);
                requireController().processRightClickBlock(
                    player, client.world, target, WorldActions.inferHitSide(player, target), hit, EnumHand.MAIN_HAND
                );
            }
            return target;
        });

        pollUntil(3.0D, () -> client.currentScreen instanceof GuiEditSign, done -> done);

        onClient(() -> {
            EntityPlayerSP player = requirePlayer();
            if (client.currentScreen instanceof GuiEditSign) {
                TileEntitySign editing = Reflect.get(client.currentScreen, GuiEditSign.class, "tileSign", "field_146848_f");
                for (int index = 0; index < 4; index++) {
                    editing.signText[index] = new TextComponentString(values[index]);
                }
                editing.markDirty();
                client.displayGuiScreen(null);
                client.setIngameFocus();
            }
            ITextComponent[] components = new ITextComponent[4];
            for (int index = 0; index < 4; index++) {
                components[index] = new TextComponentString(values[index]);
            }
            player.connection.sendPacket(new CPacketUpdateSign(pos, components));
            return true;
        });

        return pollOnClient(
            3.0D,
            () -> {
                JsonObject query = new JsonObject();
                query.addProperty("x", pos.getX());
                query.addProperty("y", pos.getY());
                query.addProperty("z", pos.getZ());
                return readSign(requireSign(query));
            },
            data -> {
                Object front = data.get("front");
                if (!(front instanceof List) || ((List<?>) front).size() < 4) {
                    return false;
                }
                List<?> text = (List<?>) front;
                return values[0].equals(String.valueOf(text.get(0)))
                    && values[1].equals(String.valueOf(text.get(1)))
                    && values[2].equals(String.valueOf(text.get(2)))
                    && values[3].equals(String.valueOf(text.get(3)));
            },
            "TIMEOUT"
        );
    }

    private Map<String, Object> readBook() {
        ItemStack stack = requirePlayer().getHeldItemMainhand();
        if (stack.getItem() != Items.WRITABLE_BOOK && stack.getItem() != Items.WRITTEN_BOOK) {
            throw new LegacyActionException("INVALID_STATE");
        }
        return map("pages", readPages(stack), "item", Data.itemToMap(stack));
    }

    private Map<String, Object> writeBook(JsonObject params) {
        List<String> requested = Params.stringList(params, "pages");
        List<String> pages = new ArrayList<String>();
        for (String page : requested) {
            pages.add(page != null ? page : "");
        }
        waitForBookUpdateCooldown();
        Map<String, Object> result = onClient(() -> {
            EntityPlayerSP player = requirePlayer();
            ItemStack stack = player.getHeldItemMainhand();
            if (stack.getItem() != Items.WRITABLE_BOOK) {
                throw new LegacyActionException("INVALID_STATE");
            }
            writePagesTag(stack, pages);
            PacketBuffer buffer = new PacketBuffer(Unpooled.buffer());
            buffer.writeItemStack(stack);
            player.connection.sendPacket(new CPacketCustomPayload("MC|BEdit", buffer));
            lastBookUpdateAt = System.currentTimeMillis();
            return map("written", true, "pages", pages, "item", Data.itemToMap(stack));
        });
        MainThread.sleep(BOOK_UPDATE_COOLDOWN_MILLIS);
        return result;
    }

    private Map<String, Object> signBook(JsonObject params) {
        String title = Params.requireString(params, "title");
        waitForBookUpdateCooldown();
        Map<String, Object> result = onClient(() -> {
            EntityPlayerSP player = requirePlayer();
            ItemStack stack = player.getHeldItemMainhand();
            if (stack.getItem() != Items.WRITABLE_BOOK) {
                throw new LegacyActionException("INVALID_STATE");
            }
            String author = Params.string(params, "author", player.getName());
            // 1.12's MC|BSign expects the held writable_book (with title/author tags); the server converts it.
            ItemStack signed = stack.copy();
            writePagesTag(signed, readPages(stack));
            signed.setTagInfo("author", new NBTTagString(author));
            signed.setTagInfo("title", new NBTTagString(title));
            PacketBuffer buffer = new PacketBuffer(Unpooled.buffer());
            buffer.writeItemStack(signed);
            player.connection.sendPacket(new CPacketCustomPayload("MC|BSign", buffer));
            lastBookUpdateAt = System.currentTimeMillis();
            return map("signed", true, "title", title, "author", author);
        });
        MainThread.sleep(BOOK_UPDATE_COOLDOWN_MILLIS);
        return result;
    }

    private void waitForBookUpdateCooldown() {
        long remaining = BOOK_UPDATE_COOLDOWN_MILLIS - (System.currentTimeMillis() - lastBookUpdateAt);
        if (remaining > 0L) {
            MainThread.sleep(remaining);
        }
    }

    private List<String> readPages(ItemStack stack) {
        List<String> pages = new ArrayList<String>();
        NBTTagCompound tag = stack.getTagCompound();
        if (tag != null && tag.hasKey("pages", 9)) {
            NBTTagList list = tag.getTagList("pages", 8);
            for (int index = 0; index < list.tagCount(); index++) {
                String value = list.getStringTagAt(index);
                if (stack.getItem() == Items.WRITTEN_BOOK) {
                    try {
                        ITextComponent component = ITextComponent.Serializer.jsonToComponent(value);
                        pages.add(component != null ? component.getUnformattedText() : value);
                    } catch (RuntimeException ignored) {
                        pages.add(value);
                    }
                } else {
                    pages.add(value);
                }
            }
        }
        return pages;
    }

    private void writePagesTag(ItemStack stack, List<String> pages) {
        NBTTagList list = new NBTTagList();
        for (String page : pages) {
            list.appendTag(new NBTTagString(page));
        }
        stack.setTagInfo("pages", list);
    }

    private TileEntitySign requireSign(JsonObject params) {
        requirePlayer();
        TileEntity blockEntity = client.world.getTileEntity(blockPos(params));
        if (!(blockEntity instanceof TileEntitySign)) {
            throw new LegacyActionException("BLOCK_NOT_FOUND");
        }
        return (TileEntitySign) blockEntity;
    }
}
