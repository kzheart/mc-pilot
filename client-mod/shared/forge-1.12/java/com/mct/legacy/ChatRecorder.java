package com.mct.legacy;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import net.minecraft.util.text.ITextComponent;
import net.minecraft.util.text.ChatType;
import net.minecraftforge.client.event.ClientChatReceivedEvent;
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent;

/** Records incoming chat / action-bar messages, shaped like the modern ClientStateTracker. */
public final class ChatRecorder {

    private static final int MAX_MESSAGES = 500;
    private static final Pattern SENDER_PATTERN = Pattern.compile("^<([^>]+)>\\s*(.*)$");

    public static final class Message {
        final long timestamp;
        final String sender;
        final String content;
        final String plain;
        final String raw;

        Message(long timestamp, String sender, String content, String plain, String raw) {
            this.timestamp = timestamp;
            this.sender = sender;
            this.content = content;
            this.plain = plain;
            this.raw = raw;
        }

        public String content() {
            return content;
        }

        public long timestamp() {
            return timestamp;
        }

        public Map<String, Object> toMap() {
            Map<String, Object> result = new LinkedHashMap<String, Object>();
            result.put("timestamp", Instant.ofEpochMilli(timestamp).toString());
            result.put("sender", sender);
            result.put("content", content);
            result.put("plain", plain);
            result.put("raw", raw);
            return result;
        }
    }

    private final Deque<Message> messages = new ArrayDeque<Message>();
    private volatile String actionBarText = "";
    private volatile String actionBarRaw = "";

    @SubscribeEvent
    public void onChatReceived(ClientChatReceivedEvent event) {
        ITextComponent component = event.getMessage();
        if (component == null) {
            return;
        }
        String plain = component.getUnformattedText();
        String raw = ITextComponent.Serializer.componentToJson(component);
        if (event.getType() == ChatType.GAME_INFO) {
            actionBarText = plain;
            actionBarRaw = raw;
            return;
        }
        Matcher matcher = SENDER_PATTERN.matcher(plain);
        String sender = matcher.matches() ? matcher.group(1) : null;
        String content = matcher.matches() ? matcher.group(2) : plain;
        synchronized (messages) {
            if (messages.size() >= MAX_MESSAGES) {
                messages.removeFirst();
            }
            messages.addLast(new Message(System.currentTimeMillis(), sender, content, plain, raw));
        }
    }

    public List<Map<String, Object>> history(int limit) {
        synchronized (messages) {
            List<Message> all = new ArrayList<Message>(messages);
            int skip = Math.max(0, all.size() - Math.max(1, limit));
            List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
            for (int index = skip; index < all.size(); index++) {
                result.add(all.get(index).toMap());
            }
            return result;
        }
    }

    public Map<String, Object> last() {
        synchronized (messages) {
            Message record = messages.peekLast();
            return record != null ? record.toMap() : new LinkedHashMap<String, Object>();
        }
    }

    public Map<String, Object> findLatest(Pattern pattern, long notBeforeMillis) {
        synchronized (messages) {
            Message latest = null;
            for (Message record : messages) {
                if (record.timestamp >= notBeforeMillis && pattern.matcher(record.content).find()) {
                    latest = record;
                }
            }
            return latest != null ? latest.toMap() : new LinkedHashMap<String, Object>();
        }
    }

    public int clear() {
        synchronized (messages) {
            int removed = messages.size();
            messages.clear();
            return removed;
        }
    }

    public Map<String, Object> actionBarState() {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("text", actionBarText);
        result.put("raw", actionBarRaw);
        return result;
    }
}
