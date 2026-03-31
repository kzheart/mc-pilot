import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Power, PowerOff } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useServerStore } from "@/stores/server-store";

async function loadXterm() {
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit")
  ]);
  if (!document.querySelector("style[data-xterm-css]")) {
    const style = document.createElement("style");
    style.setAttribute("data-xterm-css", "");
    const css = await import("@xterm/xterm/css/xterm.css?inline");
    style.textContent = css.default;
    document.head.appendChild(style);
  }
  return { Terminal, FitAddon };
}

export function ServerConsolePage() {
  const { project, name } = useParams<{ project: string; name: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const autostart = searchParams.get("autostart") === "1";
  const t = useI18n((s) => s.t);
  const runtime = useServerStore((s) => s.runtime);
  const fetch = useServerStore((s) => s.fetch);

  const termRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);

  const [connected, setConnected] = useState(false);
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
        scrollback: 10000,
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

      // Forward all input directly to PTY (Tab completion works natively)
      terminal.onData((data: string) => {
        window.electronAPI.ptyWrite(key, data);
      });
      terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        window.electronAPI.ptyResize(key, cols, rows);
      });

      requestAnimationFrame(() => {
        fitAddon.fit();
        terminal.focus();
      });

      return terminal;
    } catch (err) {
      setError(`Terminal init failed: ${err}`);
      return null;
    }
  }, [key]);

  // Start (or take over) server with PTY
  const startPtySession = useCallback(async () => {
    if (!project || !name) return;
    setStarting(true);
    setError(null);

    const terminal = await initTerminal();
    if (!terminal) { setStarting(false); return; }

    terminal.writeln(`\x1b[90m--- Starting server ${key} ---\x1b[0m\r\n`);

    const result = await window.electronAPI.ptySpawn(project, name);
    if (!result.success) {
      setError(result.error ?? "Failed to start");
      terminal.writeln(`\x1b[31mError: ${result.error}\x1b[0m`);
      setStarting(false);
      return;
    }

    setConnected(true);
    setStarting(false);
    fitAddonRef.current?.fit();
    fetch();
  }, [project, name, key, initTerminal, fetch]);

  // Attach to existing PTY session with scrollback replay
  const attachPtySession = useCallback(async () => {
    const terminal = await initTerminal();
    if (!terminal) return;

    const scrollback = await window.electronAPI.ptyGetScrollback(key);
    if (scrollback) {
      terminal.write(scrollback);
    }

    setConnected(true);
    fitAddonRef.current?.fit();
    terminal.focus();
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
        setConnected(false);
        terminalRef.current?.writeln("\r\n\x1b[90m--- Server process exited ---\x1b[0m");
        fetch();
      }
    });
    return () => { unsubData(); unsubExit(); };
  }, [key, fetch]);

  // Auto-detect on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hasPty = await window.electronAPI.ptyHasSession(key);
      if (cancelled) return;
      if (hasPty) {
        attachPtySession();
      } else if (isRunning || autostart) {
        startPtySession();
      }
    })();
    return () => { cancelled = true; };
  }, [key, isRunning, autostart, attachPtySession, startPtySession]);

  // Listen for state changes
  useEffect(() => {
    fetch();
    const unsub = window.electronAPI.onStateChange((type) => {
      if (type === "servers") fetch();
    });
    return unsub;
  }, [fetch]);

  // Detect external stop
  useEffect(() => {
    if (connected && !isRunning) {
      setConnected(false);
      terminalRef.current?.writeln("\r\n\x1b[90m--- Server stopped ---\x1b[0m");
    }
  }, [connected, isRunning]);

  // Fit on window resize
  useEffect(() => {
    const handleResize = () => fitAddonRef.current?.fit();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [key]);

  const handleStop = () => {
    window.electronAPI.ptyKill(key);
  };

  const showStartButton = !connected && !isRunning && !starting;
  const showStopButton = connected;

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
          <p className="text-xs text-muted-foreground">{project}</p>
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

      {/* Terminal */}
      <div
        className="relative flex-1 rounded-lg border border-border overflow-hidden"
        style={{ minHeight: 200, background: "#1a1a1a" }}
      >
        <div ref={termRef} style={{ height: "100%", width: "100%", padding: 8 }} />

        {!connected && !starting && !termReady && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground bg-[#1a1a1a]">
            <div className="text-center">
              <p className="text-sm">{t("console.not_running")}</p>
              <p className="text-xs mt-1">{t("console.not_running_hint")}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
