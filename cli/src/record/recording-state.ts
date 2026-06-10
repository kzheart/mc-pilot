import { resolveGlobalStateDir } from "../util/paths.js";
import { StateStore } from "../util/state.js";

const RECORDINGS_STATE_FILE = "recordings.json";

export interface ActiveRecording {
  recordingId: string;
  clientName: string;
  backend: string;
  helperPid: number;
  /** recordings/<id> 绝对路径 */
  dir: string;
  outputPath: string;
  eventLogPath: string;
  /** 首帧毫秒时间戳 */
  startedAt: number;
  fps: number;
  projectId: string | null;
}

export interface RecordingsState {
  active: Record<string, ActiveRecording>;
}

const EMPTY_STATE: RecordingsState = { active: {} };

/**
 * 跨进程录制状态(~/.mct/state/recordings.json):
 * agent 的每条 mct 命令都是独立短命进程,"是否在录制"必须落盘共享。
 */
export class RecordingStateStore extends StateStore {
  constructor() {
    super(resolveGlobalStateDir());
  }

  async readRecordings(): Promise<RecordingsState> {
    return this.readJson<RecordingsState>(RECORDINGS_STATE_FILE, EMPTY_STATE);
  }

  async updateRecordings<T>(mutate: (state: RecordingsState) => Promise<T> | T): Promise<T> {
    return this.withLock("recordings", async () => {
      const state = await this.readJson<RecordingsState>(RECORDINGS_STATE_FILE, EMPTY_STATE);
      const result = await mutate(state);
      await this.writeJson(RECORDINGS_STATE_FILE, state);
      return result;
    });
  }
}

/** timeline hook 专用:任何异常都吞掉返回 null,绝不影响游戏命令本身 */
export async function readActiveRecording(clientName: string): Promise<ActiveRecording | null> {
  try {
    const state = await new RecordingStateStore().readRecordings();
    return state.active[clientName] ?? null;
  } catch {
    return null;
  }
}
