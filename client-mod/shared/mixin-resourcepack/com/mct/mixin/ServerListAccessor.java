package com.mct.mixin;

import com.mct.core.resourcepack.HiddenServerEntries;
import java.util.List;
import net.minecraft.client.network.ServerInfo;
import net.minecraft.client.option.ServerList;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(ServerList.class)
public interface ServerListAccessor extends HiddenServerEntries {
    @Override
    @Accessor("hiddenServers")
    List<ServerInfo> mct$getHiddenServers();
}
