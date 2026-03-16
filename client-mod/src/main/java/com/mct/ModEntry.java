package com.mct;

import com.mct.core.protocol.MessageHandler;

public final class ModEntry {

    private final MessageHandler messageHandler = new MessageHandler();

    public String getModId() {
        return "mct";
    }

    public MessageHandler getMessageHandler() {
        return messageHandler;
    }
}
