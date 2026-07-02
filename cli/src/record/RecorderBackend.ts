export interface RecordTarget {
  clientName: string;
  pid: number;
}

export interface RecordStartOptions {
  fps?: number;
  windowTitle?: string;
}

export interface RecordingHandle {
  backend: string;
  helperPid: number;
  outputPath: string;
  /** helper 报告的首帧毫秒时间戳,时间轴对齐基准 */
  startedAt: number;
  fps: number;
}

export interface StopTarget {
  helperPid: number;
  outputPath: string;
  startedAt: number;
  fps: number;
  /** helper stdout 事件日志路径,stop 从中读 stopped 事件 */
  eventLogPath: string;
}

export interface RecordingArtifact {
  kind: "video" | "frames";
  path: string;
  startedAt: number;
  fps: number;
  frames?: number;
  /** helper 已不在(客户端崩溃等),产物按中断处理 */
  interrupted?: boolean;
}

export interface RecorderBackend {
  readonly name: string;
  isSupported(): Promise<{ ok: boolean; reason?: string }>;
  start(
    target: RecordTarget,
    outputDir: string,
    opts: RecordStartOptions,
  ): Promise<RecordingHandle>;
  stop(target: StopTarget): Promise<RecordingArtifact>;
}
