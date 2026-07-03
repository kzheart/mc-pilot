package com.mct.version;

import java.util.List;
import java.util.Map;
import net.minecraft.block.entity.SignBlockEntity;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.util.math.BlockPos;

public interface SignAdapter {

    Map<String, Object> readSign(SignBlockEntity sign);

    List<String> signText(SignBlockEntity sign, boolean front, boolean filtered);

    boolean isSignEditScreen(Screen screen);

    void editSignLine(Object accessor, int row, String message);

    void sendSignUpdate(ClientPlayerEntity player, BlockPos pos, String[] lines);
}
