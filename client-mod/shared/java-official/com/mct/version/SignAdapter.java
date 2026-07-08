package com.mct.version;

import java.util.List;
import java.util.Map;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.entity.SignBlockEntity;

public interface SignAdapter {

    Map<String, Object> readSign(SignBlockEntity sign);

    List<String> signText(SignBlockEntity sign, boolean front, boolean filtered);

    boolean isSignEditScreen(Screen screen);

    void editSignLine(Object accessor, int row, String message);

    void sendSignUpdate(LocalPlayer player, BlockPos pos, String[] lines);
}
