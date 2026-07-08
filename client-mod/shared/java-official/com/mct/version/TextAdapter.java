package com.mct.version;

import net.minecraft.network.chat.Component;

public interface TextAdapter {

    String toJsonString(Component text);
}
