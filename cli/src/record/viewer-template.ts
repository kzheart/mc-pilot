import type { TimelineEntry } from "./recording-state.js";

export interface ViewerEventEntry {
  t: number;
  iso?: string;
  type: string;
  payload?: Record<string, unknown>;
}

export interface ViewerData {
  recordingId: string;
  clientName: string;
  /** 首帧毫秒时间戳,视频 0 秒对应的墙钟时间 */
  startedAt: number;
  stoppedAt?: number;
  status: string;
  /** 相对 viewer.html 的视频路径 */
  videoPath: string;
  timeline: TimelineEntry[];
  events: ViewerEventEntry[];
}

/** 数据内联进单文件 html,目录整体拷贝后仍可离线打开 */
export function renderViewerHtml(data: ViewerData): string {
  const inlineJson = JSON.stringify(data).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mct recording · ${escapeHtml(data.recordingId)}</title>
<style>
  :root {
    --bg: #14161a; --panel: #1d2026; --line: #2b2f37; --text: #e6e8ec; --dim: #8b919c;
    --accent: #4da3ff; --ok: #3fb950; --err: #f85149; --event: #b48ead;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 13px/1.5 -apple-system, "SF Mono", Menlo, monospace; height: 100vh; display: flex; flex-direction: column; }
  header { padding: 10px 16px; border-bottom: 1px solid var(--line); display: flex; gap: 18px; align-items: baseline; flex-wrap: wrap; }
  header h1 { font-size: 14px; margin: 0; font-weight: 600; }
  header .meta { color: var(--dim); }
  main { flex: 1; display: flex; min-height: 0; }
  .player { flex: 1; display: flex; align-items: center; justify-content: center; background: #000; min-width: 0; }
  .player video { max-width: 100%; max-height: 100%; }
  aside { width: 380px; border-left: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; }
  .filters { padding: 8px 12px; border-bottom: 1px solid var(--line); display: flex; gap: 14px; color: var(--dim); }
  .filters label { cursor: pointer; user-select: none; }
  #items { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }
  #items li { padding: 6px 12px; border-bottom: 1px solid var(--line); cursor: pointer; display: flex; gap: 8px; align-items: baseline; }
  #items li:hover { background: var(--panel); }
  #items li.current { background: #26303f; border-left: 3px solid var(--accent); padding-left: 9px; }
  .ts { color: var(--dim); min-width: 52px; text-align: right; }
  .badge { font-size: 11px; padding: 0 6px; border-radius: 8px; border: 1px solid var(--line); }
  .badge.cmd-ok { color: var(--ok); border-color: var(--ok); }
  .badge.cmd-err { color: var(--err); border-color: var(--err); }
  .badge.event { color: var(--event); border-color: var(--event); }
  .label { word-break: break-all; }
  .detail { color: var(--dim); word-break: break-all; }
  .empty { padding: 24px; color: var(--dim); text-align: center; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(data.recordingId)}</h1>
  <span class="meta">client: ${escapeHtml(data.clientName)}</span>
  <span class="meta">status: ${escapeHtml(data.status)}</span>
  <span class="meta" id="started-meta"></span>
</header>
<main>
  <section class="player"><video id="video" controls src="${escapeHtml(data.videoPath)}"></video></section>
  <aside>
    <div class="filters">
      <label><input type="checkbox" id="show-commands" checked> commands</label>
      <label><input type="checkbox" id="show-events" checked> events</label>
    </div>
    <ol id="items"></ol>
  </aside>
</main>
<script>
const DATA = ${inlineJson};

const video = document.getElementById("video");
const list = document.getElementById("items");
const showCommands = document.getElementById("show-commands");
const showEvents = document.getElementById("show-events");

document.getElementById("started-meta").textContent =
  "started: " + new Date(DATA.startedAt).toISOString();

function fmtOffset(seconds) {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1).padStart(4, "0");
  return m + ":" + s;
}

const items = [
  ...DATA.timeline.map((entry) => ({
    kind: "command",
    t: entry.t,
    label: entry.action,
    badge: entry.success ? "cmd-ok" : "cmd-err",
    badgeText: entry.success ? "cmd" : "fail",
    detail: JSON.stringify(entry.params) + " · " + entry.durationMs + "ms" + (entry.error ? " · " + entry.error : "")
  })),
  ...DATA.events.map((entry) => ({
    kind: "event",
    t: entry.t,
    label: entry.type,
    badge: "event",
    badgeText: "evt",
    detail: entry.payload ? JSON.stringify(entry.payload) : ""
  }))
]
  .map((item) => ({ ...item, offset: Math.max(0, (item.t - DATA.startedAt) / 1000) }))
  .sort((a, b) => a.t - b.t);

function render() {
  list.innerHTML = "";
  const visible = items.filter((item) =>
    (item.kind === "command" ? showCommands.checked : showEvents.checked)
  );
  if (!visible.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "no entries";
    list.appendChild(li);
    return;
  }
  for (const item of visible) {
    const li = document.createElement("li");
    li.dataset.offset = item.offset;
    li.innerHTML =
      '<span class="ts">' + fmtOffset(item.offset) + '</span>' +
      '<span class="badge ' + item.badge + '">' + item.badgeText + '</span>' +
      '<span class="label">' + escapeText(item.label) +
      (item.detail ? ' <span class="detail">' + escapeText(item.detail) + '</span>' : '') +
      '</span>';
    li.addEventListener("click", () => {
      video.currentTime = item.offset;
      video.play();
    });
    list.appendChild(li);
  }
}

function escapeText(text) {
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

function highlight() {
  const now = video.currentTime;
  let current = null;
  for (const li of list.children) {
    if (li.dataset.offset === undefined) continue;
    if (Number(li.dataset.offset) <= now) current = li;
    li.classList.remove("current");
  }
  if (current) {
    current.classList.add("current");
    const rect = current.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    if (rect.top < listRect.top || rect.bottom > listRect.bottom) {
      current.scrollIntoView({ block: "center" });
    }
  }
}

video.addEventListener("timeupdate", highlight);
showCommands.addEventListener("change", () => { render(); highlight(); });
showEvents.addEventListener("change", () => { render(); highlight(); });
render();
</script>
</body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
