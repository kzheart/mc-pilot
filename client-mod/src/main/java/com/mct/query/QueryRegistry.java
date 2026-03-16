package com.mct.query;

import java.util.Set;

public final class QueryRegistry {

    public Set<String> getSupportedQueries() {
        return Set.of("position.get", "status.all", "gui.info");
    }
}
