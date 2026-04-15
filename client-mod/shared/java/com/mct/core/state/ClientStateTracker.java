package com.mct.core.state;

import com.mct.version.ClientVersionModulesHolder;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;
import net.minecraft.text.Text;

public final class ClientStateTracker {

    private static final int MAX_CHAT_MESSAGES = 500;
    private static final int MAX_DEATH_RECORDS = 50;
    private static final Pattern CHAT_SENDER_PATTERN = Pattern.compile("^<([^>]+)>\\s*(.*)$");
    private static final ClientStateTracker INSTANCE = new ClientStateTracker();

    private final Deque<ChatMessageRecord> chatMessages = new ArrayDeque<>();
    private final Deque<DeathRecord> deathRecords = new ArrayDeque<>();
    private HudTitleState hudTitleState = HudTitleState.empty();
    private HudActionBarState hudActionBarState = HudActionBarState.empty();
    private TabListState tabListState = TabListState.empty();
    private List<Map<String, Object>> bossBars = List.of();
    private ResourcePackState resourcePackState = ResourcePackState.empty();

    private ClientStateTracker() {
    }

    public static ClientStateTracker getInstance() {
        return INSTANCE;
    }

    public synchronized void recordChat(Text message) {
        String plain = message.getString();
        java.util.regex.Matcher matcher = CHAT_SENDER_PATTERN.matcher(plain);
        String sender = matcher.matches() ? matcher.group(1) : null;
        String content = matcher.matches() ? matcher.group(2) : plain;
        append(
            chatMessages,
            new ChatMessageRecord(
                Instant.now().toEpochMilli(),
                sender,
                content,
                plain,
                ClientVersionModulesHolder.get().text().toJsonString(message)
            ),
            MAX_CHAT_MESSAGES
        );
        LinkedHashMap<String, Object> payload = new LinkedHashMap<>();
        payload.put("sender", sender);
        payload.put("content", content);
        EventRecorder.getInstance().record("chat.received", payload);
    }

    public synchronized List<Map<String, Object>> getChatHistory(int limit) {
        return snapshot(chatMessages, Math.max(1, limit), ChatMessageRecord::toMap);
    }

    public synchronized Map<String, Object> getLastChatMessage() {
        ChatMessageRecord record = chatMessages.peekLast();
        return record != null ? record.toMap() : Map.of();
    }

    public synchronized Map<String, Object> findLatestChatMessage(Pattern pattern, long notBeforeMillis) {
        return findLatest(chatMessages, record -> record.timestamp >= notBeforeMillis && pattern.matcher(record.content).find(), ChatMessageRecord::toMap);
    }

    public synchronized void recordActionBar(Text message) {
        hudActionBarState = new HudActionBarState(
            message != null ? message.getString() : "",
            message != null ? ClientVersionModulesHolder.get().text().toJsonString(message) : ""
        );
    }

    public synchronized Map<String, Object> getActionBarState() {
        return hudActionBarState.toMap();
    }

    public synchronized void recordTitle(Text title, Text subtitle, int fadeIn, int stay, int fadeOut) {
        hudTitleState = new HudTitleState(
            title != null ? title.getString() : "",
            subtitle != null ? subtitle.getString() : "",
            fadeIn,
            stay,
            fadeOut
        );
    }

    public synchronized Map<String, Object> getTitleState() {
        return hudTitleState.toMap();
    }

    public synchronized void recordTabList(Text header, Text footer) {
        tabListState = new TabListState(
            header != null ? header.getString() : "",
            footer != null ? footer.getString() : ""
        );
    }

    public synchronized Map<String, Object> getTabListState() {
        return tabListState.toMap();
    }

    public synchronized void recordBossBars(List<Map<String, Object>> values) {
        bossBars = List.copyOf(values);
    }

    public synchronized List<Map<String, Object>> getBossBars() {
        return bossBars;
    }

    public synchronized void recordResourcePackState(String acceptanceStatus, int packCount) {
        resourcePackState = new ResourcePackState(
            Objects.requireNonNullElse(acceptanceStatus, "unknown"),
            Math.max(0, packCount)
        );
    }

    public synchronized Map<String, Object> getResourcePackState() {
        return resourcePackState.toMap();
    }

    public synchronized void recordDeath(String deathMessage, double x, double y, double z) {
        append(
            deathRecords,
            new DeathRecord(Instant.now().toEpochMilli(), deathMessage, x, y, z),
            MAX_DEATH_RECORDS
        );
        LinkedHashMap<String, Object> payload = new LinkedHashMap<>();
        payload.put("message", deathMessage);
        payload.put("x", x);
        payload.put("y", y);
        payload.put("z", z);
        EventRecorder.getInstance().record("player.died", payload);
    }

    public synchronized List<Map<String, Object>> getRecentDeaths(int limit) {
        return snapshot(deathRecords, Math.max(1, limit), DeathRecord::toMap);
    }

    public synchronized int getDeathCount() {
        return deathRecords.size();
    }

    private <T> void append(Deque<T> deque, T value, int maxSize) {
        if (deque.size() >= maxSize) {
            deque.removeFirst();
        }
        deque.addLast(value);
    }

    private <T> List<Map<String, Object>> snapshot(Deque<T> deque, int limit, java.util.function.Function<T, Map<String, Object>> mapper) {
        ArrayList<Map<String, Object>> result = new ArrayList<>();
        int skipped = Math.max(0, deque.size() - limit);
        int index = 0;
        for (T value : deque) {
            if (index++ < skipped) {
                continue;
            }
            result.add(mapper.apply(value));
        }
        return result;
    }

    private <T> Map<String, Object> findLatest(
        Deque<T> deque,
        java.util.function.Predicate<T> matcher,
        java.util.function.Function<T, Map<String, Object>> mapper
    ) {
        T latest = null;
        for (T value : deque) {
            if (matcher.test(value)) {
                latest = value;
            }
        }
        return latest != null ? mapper.apply(latest) : Map.of();
    }

    private static final class ChatMessageRecord {
        final long timestamp;
        final String sender;
        final String content;
        final String plain;
        final String raw;

        ChatMessageRecord(long timestamp, String sender, String content, String plain, String raw) {
            this.timestamp = timestamp;
            this.sender = sender;
            this.content = content;
            this.plain = plain;
            this.raw = raw;
        }

        Map<String, Object> toMap() {
            LinkedHashMap<String, Object> result = new LinkedHashMap<>();
            result.put("timestamp", Instant.ofEpochMilli(timestamp).toString());
            result.put("sender", sender);
            result.put("content", content);
            result.put("plain", plain);
            result.put("raw", raw);
            return result;
        }
    }

    private static final class HudTitleState {
        final String title;
        final String subtitle;
        final int fadeIn;
        final int stay;
        final int fadeOut;

        HudTitleState(String title, String subtitle, int fadeIn, int stay, int fadeOut) {
            this.title = title;
            this.subtitle = subtitle;
            this.fadeIn = fadeIn;
            this.stay = stay;
            this.fadeOut = fadeOut;
        }

        static HudTitleState empty() {
            return new HudTitleState("", "", 0, 0, 0);
        }

        Map<String, Object> toMap() {
            return Map.of(
                "title", title,
                "subtitle", subtitle,
                "fadeIn", fadeIn,
                "stay", stay,
                "fadeOut", fadeOut
            );
        }
    }

    private static final class HudActionBarState {
        final String text;
        final String raw;

        HudActionBarState(String text, String raw) {
            this.text = text;
            this.raw = raw;
        }

        static HudActionBarState empty() {
            return new HudActionBarState("", "");
        }

        Map<String, Object> toMap() {
            return Map.of("text", text, "raw", raw);
        }
    }

    private static final class TabListState {
        final String header;
        final String footer;

        TabListState(String header, String footer) {
            this.header = header;
            this.footer = footer;
        }

        static TabListState empty() {
            return new TabListState("", "");
        }

        Map<String, Object> toMap() {
            return Map.of("header", header, "footer", footer);
        }
    }

    private static final class ResourcePackState {
        final String acceptanceStatus;
        final int packCount;

        ResourcePackState(String acceptanceStatus, int packCount) {
            this.acceptanceStatus = acceptanceStatus;
            this.packCount = packCount;
        }

        static ResourcePackState empty() {
            return new ResourcePackState("pending", 0);
        }

        Map<String, Object> toMap() {
            return Map.of(
                "acceptanceStatus", acceptanceStatus,
                "packCount", packCount
            );
        }
    }

    private static final class DeathRecord {
        final long timestamp;
        final String message;
        final double x;
        final double y;
        final double z;

        DeathRecord(long timestamp, String message, double x, double y, double z) {
            this.timestamp = timestamp;
            this.message = message;
            this.x = x;
            this.y = y;
            this.z = z;
        }

        Map<String, Object> toMap() {
            LinkedHashMap<String, Object> result = new LinkedHashMap<>();
            result.put("timestamp", Instant.ofEpochMilli(timestamp).toString());
            result.put("message", message);
            result.put("x", x);
            result.put("y", y);
            result.put("z", z);
            return result;
        }
    }
}
