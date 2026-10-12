package com.mct.core.resourcepack;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/** Observed vanilla resource-pack progress; accepting a pack never means it loaded. */
public final class ResourcePackLifecycle {
    private final LinkedHashMap<String, Pack> packs = new LinkedHashMap<>();
    private String policy = "accept";
    private String acceptanceStatus = "pending";
    private int managerPackCount;
    private boolean pendingPrompt;
    private boolean lifecycleSupported;

    public synchronized void reset(String policy) {
        this.policy = policy;
        acceptanceStatus = "pending";
        managerPackCount = 0;
        pendingPrompt = false;
        packs.clear();
    }

    public synchronized void supported() {
        lifecycleSupported = true;
    }

    public synchronized void managerState(String status, int count) {
        acceptanceStatus = status;
        managerPackCount = Math.max(0, count);
    }

    public synchronized void offered(String id, boolean required) {
        Pack pack = new Pack(id);
        pack.required = required;
        packs.put(id, pack);
    }

    public synchronized void prompt(boolean pending) {
        pendingPrompt = pending;
    }

    public synchronized void status(String id, String status) {
        Pack pack = packs.get(id);
        if (pack == null) return;
        switch (status.toUpperCase(Locale.ROOT)) {
            case "ACCEPTED":
                pack.error = null;
                pack.state = "downloading";
                acceptanceStatus = "allowed";
                break;
            case "DOWNLOADED":
                pack.error = null;
                pack.state = "applying";
                break;
            case "SUCCESSFULLY_LOADED":
                pack.error = null;
                pack.state = "loaded";
                break;
            case "DECLINED":
                pack.error = null;
                pack.state = "rejected";
                acceptanceStatus = "declined";
                break;
            case "FAILED_DOWNLOAD":
            case "INVALID_URL":
            case "FAILED_RELOAD":
                pack.state = "failed";
                pack.error = status.toLowerCase(Locale.ROOT);
                break;
            case "DISCARDED":
                // A replacement or server removal is not a failed download.
                if (!"offered".equals(pack.state)) packs.remove(id);
                return;
            default:
                return;
        }
    }

    /** Transport completed, but this adapter cannot observe successful resource application. */
    public synchronized void unverified(String id) {
        Pack pack = packs.get(id);
        if (pack == null) return;
        lifecycleSupported = false;
        pack.state = "unverified";
        pack.error = null;
    }

    public synchronized void remove(String id) {
        packs.remove(id);
    }

    public synchronized void removeAll() {
        packs.clear();
        managerPackCount = 0;
        pendingPrompt = false;
    }

    public synchronized Map<String, Object> snapshot() {
        String state = "idle";
        String error = null;
        boolean required = false;
        boolean rejectedRequired = false;
        boolean rejected = false;
        boolean allLoaded = !packs.isEmpty();
        ArrayList<Map<String, Object>> entries = new ArrayList<>();
        for (Pack pack : packs.values()) {
            LinkedHashMap<String, Object> entry = new LinkedHashMap<>();
            entry.put("id", pack.id);
            entry.put("state", pack.state);
            entry.put("required", pack.required);
            if (pack.error != null) entry.put("error", pack.error);
            entries.add(entry);
            required |= pack.required;
            allLoaded &= "loaded".equals(pack.state);
            rejected |= "rejected".equals(pack.state);
            rejectedRequired |= pack.required && "rejected".equals(pack.state);
            if (pack.error != null) error = pack.error;
            if ("downloading".equals(pack.state)) state = "downloading";
            else if ("applying".equals(pack.state) && !"downloading".equals(state)) state = "applying";
            else if ("offered".equals(pack.state) && ("idle".equals(state) || "unverified".equals(state))) state = "accepted";
            else if ("unverified".equals(pack.state) && "idle".equals(state)) state = "unverified";
        }
        if (allLoaded) state = "loaded";
        else if (rejected && "idle".equals(state)) state = "rejected";
        if (pendingPrompt) state = "prompt";
        if (rejectedRequired) state = "rejected";
        if (error != null) state = "failed";
        boolean pending = "prompt".equals(state) || "accepted".equals(state)
            || "downloading".equals(state) || "applying".equals(state);
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        result.put("lifecycleSupported", lifecycleSupported);
        result.put("acceptanceStatus", acceptanceStatus);
        result.put("packCount", lifecycleSupported ? packs.size() : Math.max(managerPackCount, packs.size()));
        result.put("policy", policy);
        result.put("state", state);
        result.put("pending", pending);
        result.put("pendingPrompt", pendingPrompt);
        result.put("loaded", "loaded".equals(state));
        result.put("required", "rejected".equals(state) ? rejectedRequired : required);
        result.put("packs", entries);
        if (error != null) result.put("error", error);
        return result;
    }

    public static boolean blocksAutoReconnect(Map<String, Object> snapshot) {
        Object state = snapshot.get("state");
        return Boolean.TRUE.equals(snapshot.get("pending"))
            || "prompt".equals(state) || "accepted".equals(state)
            || "downloading".equals(state) || "applying".equals(state)
            || "failed".equals(state)
            || ("rejected".equals(state) && Boolean.TRUE.equals(snapshot.get("required")));
    }

    private static final class Pack {
        final String id;
        boolean required;
        String state = "offered";
        String error;
        Pack(String id) { this.id = id; }
    }
}
