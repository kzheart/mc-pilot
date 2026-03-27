import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Power, PowerOff } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useServerStore } from "@/stores/server-store";

async function loadXterm() {
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit")
  ]);
  if (!document.querySelector("link[data-xterm-css]")) {
    const link = document.createElement("style");
    link.setAttribute("data-xterm-css", "");
    const css = await import("@xterm/xterm/css/xterm.css?inline");
    link.textContent = css.default;
    document.head.appendChild(link);
  }
  return { Terminal, FitAddon };
}

type ConsoleMode = "idle" | "pty" | "fifo";

export function ServerConsolePage() {
  const { project, name } = useParams<{ project: string; name: string }>();
  const navigate = useNavigate();
  const t = useI18n((s) => s.t);
  const runtime = useServerStore((s) => s.runtime);
  const fetch = useServerStore((s) => s.fetch);

  const termRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const inputBufRef = useRef("");

  const [mode, setMode] = useState<ConsoleMode>("idle");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [termReady, setTermReady] = useState(false);

  const key = `${project}/${name}`;
  const runtimeEntry = runtime[key];
  const isRunning = !!runtimeEntry;

  const initTerminal = useCallback(async () => {
    if (!termRef.current || terminalRef.current) return null;

    try {
      const { Terminal, FitAddon } = await loadXterm();

      const terminal = new Terminal({
        fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
        fontSize: 13,
        lineHeight: 1.3,
        cursorBlink: true,
        theme: {
          background: "#1a1a1a",
          foreground: "#e0e0e0",
          cursor: "#e0e0e0",
          selectionBackground: "#404040",
          black: "#1a1a1a",
          red: "#e06c75",
          green: "#98c379",
          yellow: "#e5c07b",
          blue: "#61afef",
          magenta: "#c678dd",
          cyan: "#56b6c2",
          white: "#e0e0e0",
          brightBlack: "#5c6370",
          brightRed: "#e06c75",
          brightGreen: "#98c379",
          brightYellow: "#e5c07b",
          brightBlue: "#61afef",
          brightMagenta: "#c678dd",
          brightCyan: "#56b6c2",
          brightWhite: "#ffffff"
        }
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(termRef.current);
      fitAddon.fit();

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      setTermReady(true);

      return terminal;
    } catch (err) {
      setError(`Terminal init failed: ${err}`);
      return null;
    }
  }, []);

  // === PTY mode: start server from GUI with full PTY ===
  const startPtySession = useCallback(async () => {
    if (!project || !name) return;
    setStarting(true);
    setError(null);

    const terminal = await initTerminal();
    if (!terminal) { setStarting(false); return; }

    terminal.writeln(`\x1b[90m--- Starting server ${key} ---\x1b[0m\r\n`);

    // Forward user input directly to PTY
    terminal.onData((data: string) => {
      window.electronAPI.ptyWrite(key, data);
    });
    terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      window.electronAPI.ptyResize(key, cols, rows);
    });

    const result = await window.electronAPI.ptySpawn(project, name);
    if (!result.success) {
      setError(result.error ?? "Failed to start");
      terminal.writeln(`\x1b[31mError: ${result.error}\x1b[0m`);
      setStarting(false);
      return;
    }

    setMode("pty");
    setStarting(false);
    fitAddonRef.current?.fit();
    fetch();
  }, [project, name, key, initTerminal, fetch]);

  // === FIFO mode: attach to CLI-started server ===
  const startFifoSession = useCallback(async () => {
    if (!runtimeEntry) return;
    setError(null);

    const terminal = await initTerminal();
    if (!terminal) return;

    terminal.writeln(`\x1b[90m--- Attached to server ${key} ---\x1b[0m\r\n`);

    const stdinPipe = runtimeEntry.stdinPipe;

    // Handle user input: buffer line and send on Enter
    terminal.onData((data: string) => {
      if (!stdinPipe) return;

      for (const ch of data) {
        if (ch === "\r" || ch === "\n") {
          // Send buffered line to FIFO
          const line = inputBufRef.current;
          inputBufRef.current = "";
          terminal.write("\r\n");
          if (line.length > 0) {
            window.electronAPI.writeServerStdin(stdinPipe, line + "\n").catch(() => {
              terminal.writeln(`\x1b[31mFailed to send command\x1b[0m`);
            });
          }
        } else if (ch === "\x7f" || ch === "\b") {
          // Backspace
          if (inputBufRef.current.length > 0) {
            inputBufRef.current = inputBufRef.current.slice(0, -1);
            terminal.write("\b \b");
          }
        } else if (ch >= " ") {
          inputBufRef.current += ch;
          terminal.write(ch);
        }
      }
    });

    // Start log stream
    await window.electronAPI.logStreamStart(key, runtimeEntry.logPath);
    setMode("fifo");
    fitAddonRef.current?.fit();
  }, [key, runtimeEntry, initTerminal]);

  // Attach to existing PTY session
  const attachPtySession = useCallback(async () => {
    const terminal = await initTerminal();
    if (!terminal) return;

    terminal.onData((data: string) => {
      window.electronAPI.ptyWrite(key, data);
    });
    terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      window.electronAPI.ptyResize(key, cols, rows);
    });

    setMode("pty");
    fitAddonRef.current?.fit();
  }, [key, initTerminal]);

  // Listen for PTY data/exit
  useEffect(() => {
    const unsubData = window.electronAPI.onPtyData((k, data) => {
      if (k === key && terminalRef.current) {
        terminalRef.current.write(data);
      }
    });
    const unsubExit = window.electronAPI.onPtyExit((k) => {
      if (k === key) {
        setMode("idle");
        terminalRef.current?.writeln("\r\n\x1b[90m--- Server process exited ---\x1b[0m");
        fetch();
      }
    });
    return () => { unsubData(); unsubExit(); };
  }, [key, fetch]);

  // Listen for log stream data (FIFO mode)
  useEffect(() => {
    const unsub = window.electronAPI.onLogStreamData((k, data) => {
      if (k === key && terminalRef.current) {
        terminalRef.current.write(data);
      }
    });
    return unsub;
  }, [key]);

  // Auto-detect mode on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hasPty = await window.electronAPI.ptyHasSession(key);
      if (cancelled) return;
      if (hasPty) {
        attachPtySession();
      } else if (isRunning) {
        startFifoSession();
      }
    })();
    return () => { cancelled = true; };
  }, [key, isRunning, attachPtySession, startFifoSession]);

  // Listen for state changes to detect server stop from outside
  useEffect(() => {
    const unsub = window.electronAPI.onStateChange((type) => {
      if (type === "servers") fetch();
    });
    return unsub;
  }, [fetch]);

  // When server stops externally while in FIFO mode
  useEffect(() => {
    if (mode === "fifo" && !isRunning) {
      window.electronAPI.logStreamStop(key);
      setMode("idle");
      terminalRef.current?.writeln("\r\n\x1b[90m--- Server stopped ---\x1b[0m");
    }
  }, [mode, isRunning, key]);

  // Fit on window resize
  useEffect(() => {
    const handleResize = () => fitAddonRef.current?.fit();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      window.electronAPI.logStreamStop(key);
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [key]);

  const handleStop = () => {
    if (mode === "pty") {
      window.electronAPI.ptyKill(key);
    } else if (mode === "fifo" && runtimeEntry?.stdinPipe) {
      // Send "stop" command to Minecraft server
      window.electronAPI.writeServerStdin(runtimeEntry.stdinPipe, "stop\n").catch(() => {});
    }
  };

  const showStartButton = mode === "idle" && !isRunning && !starting;
  const showStopButton = mode === "pty" || mode === "fifo";

  return (
    <div className="flex h-full flex-col" style={{ minHeight: 0 }}>
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 shrink-0">
        <button
          onClick={() => navigate("/servers")}
          className="flex size-8 items-center justify-center rounded-md hover:bg-accent transition-colors"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">{name}</h1>
          <p className="text-xs text-muted-foreground">
            {project}
            {mode === "fifo" && (
              <span className="ml-2 text-warning">FIFO</span>
            )}
            {mode === "pty" && (
              <span className="ml-2 text-success">PTY</span>
            )}
          </p>
        </div>

        {showStartButton && (
          <button
            onClick={startPtySession}
            className="flex items-center gap-2 rounded-md bg-success px-3 py-1.5 text-sm font-medium text-background hover:bg-success/90 transition-colors"
          >
            <Power className="size-4" />
            {t("console.start")}
          </button>
        )}

        {showStopButton && (
          <button
            onClick={handleStop}
            className="flex items-center gap-2 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
          >
            <PowerOff className="size-4" />
            {t("console.stop")}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 shrink-0 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Terminal area */}
      <div
        className="flex-1 rounded-lg border border-border overflow-hidden"
        style={{ minHeight: 200, background: "#1a1a1a" }}
      >
        {mode === "idle" && !starting && !termReady ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="text-center">
              <p className="text-sm">{t("console.not_running")}</p>
              <p className="text-xs mt-1">{t("console.not_running_hint")}</p>
            </div>
          </div>
        ) : (
          <div ref={termRef} style={{ height: "100%", width: "100%", padding: 8 }} />
        )}
      </div>
    </div>
  );
}
