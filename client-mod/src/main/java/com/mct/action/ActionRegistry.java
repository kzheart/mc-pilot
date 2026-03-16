package com.mct.action;

import java.util.Set;

public final class ActionRegistry {

    public Set<String> getSupportedActions() {
        return Set.of("chat.send", "chat.command", "move.to", "gui.click");
    }
}
