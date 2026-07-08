package com.mct.core.state;

import com.mct.core.protocol.JsonUtil;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.OpenOption;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 事件总线：把关键运行时事件追加写入 JSONL 文件，并维护一个"自上次响应以来发生的事件"指针，
 * 供 WebSocket 响应层夹带给调用方。
 *
 * 日志路径：${MCT_HOME:-~/.mct}/logs/<clientName>/events.jsonl
 */
public final class EventRecorder {

    private static final EventRecorder INSTANCE = new EventRecorder();
    private static final OpenOption[] APPEND_OPTIONS = new OpenOption[] {
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE,
        StandardOpenOption.APPEND
    };

    private final Object writeLock = new Object();
    private final Path logFile;

    private int pendingCount = 0;
    private String lastType = null;

    private EventRecorder() {
        this.logFile = resolveLogFile();
    }

    public static EventRecorder getInstance() {
        return INSTANCE;
    }

    public Path getLogFile() {
        return logFile;
    }

    /**
     * 记录一个事件：写入 JSONL 并累加 pending 计数。
     * 任何 I/O 异常都会被吞掉（打印 stderr），绝不让事件记录影响主流程。
     */
    public void record(String type, Map<String, Object> payload) {
        LinkedHashMap<String, Object> entry = new LinkedHashMap<>();
        long now = Instant.now().toEpochMilli();
        entry.put("t", now);
        entry.put("iso", Instant.ofEpochMilli(now).toString());
        entry.put("type", type);
        if (payload != null && !payload.isEmpty()) {
            entry.put("payload", payload);
        }

        String line = JsonUtil.toJson(entry) + "\n";

        synchronized (writeLock) {
            pendingCount++;
            lastType = type;
            if (logFile == null) {
                return;
            }
            try {
                Path parent = logFile.getParent();
                if (parent != null && !Files.isDirectory(parent)) {
                    Files.createDirectories(parent);
                }
                Files.write(logFile, line.getBytes(StandardCharsets.UTF_8), APPEND_OPTIONS);
            } catch (IOException e) {
                System.err.println("[mct] Failed to append event log: " + e.getMessage());
            }
        }
    }

    /**
     * 读取并重置"自上次调用以来"的事件指针。
     * 在每个 WS 响应构造完成后调用。
     */
    public Pointer drainPointer() {
        synchronized (writeLock) {
            Pointer p = new Pointer(pendingCount, lastType);
            pendingCount = 0;
            lastType = null;
            return p;
        }
    }

    private static Path resolveLogFile() {
        try {
            String home = System.getenv("MCT_HOME");
            if (home == null || home.isEmpty()) {
                home = System.getProperty("user.home") + "/.mct";
            }
            String clientName = System.getenv("MCT_CLIENT_NAME");
            if (clientName == null || clientName.isEmpty()) {
                clientName = "default";
            }
            return Paths.get(home, "logs", clientName, "events.jsonl");
        } catch (Exception e) {
            System.err.println("[mct] EventRecorder failed to resolve log path: " + e.getMessage());
            return null;
        }
    }

    public static final class Pointer {
        public final int count;
        public final String lastType;

        public Pointer(int count, String lastType) {
            this.count = count;
            this.lastType = lastType;
        }
    }
}
