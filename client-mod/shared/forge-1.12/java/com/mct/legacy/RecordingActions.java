package com.mct.legacy;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.mct.core.recording.RecordingController;
import java.util.Map;

/** Runs on the existing bounded request worker, never the client/render thread. */
public final class RecordingActions implements ActionRouter.Handler {
    private static final Gson GSON = new Gson();
    @Override public Map<String, Object> handle(String action, JsonObject params) {
        try {
            return RecordingController.getInstance().handle(action, GSON.fromJson(params, Map.class));
        } catch (RecordingController.RecordingException failure) {
            throw new LegacyActionException(failure.getCode(), failure.getMessage());
        }
    }
}
