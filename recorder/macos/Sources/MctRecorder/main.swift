import Foundation
import ScreenCaptureKit

// MARK: - CLI 参数

struct CliOptions {
    var pid: pid_t
    var output: String
    var fps: Int
    var windowTitle: String?
}

func fail(_ message: String, exitCode: Int32 = 1) -> Never {
    RecorderEvents.error(message)
    exit(exitCode)
}

func parseOptions(_ arguments: [String]) -> CliOptions {
    var pid: pid_t?
    var output: String?
    var fps = 30
    var windowTitle: String?

    var index = 1
    func nextValue(for flag: String) -> String {
        index += 1
        guard index < arguments.count else {
            fail("missing value for \(flag)", exitCode: 2)
        }
        return arguments[index]
    }

    while index < arguments.count {
        let argument = arguments[index]
        switch argument {
        case "--preflight":
            // 权限/环境预检模式:输出结果后直接退出,授权通过为 0
            let granted = CGPreflightScreenCaptureAccess()
            RecorderEvents.emit(["event": "preflight", "screenCapture": granted])
            exit(granted ? 0 : 1)
        case "--pid":
            guard let value = Int32(nextValue(for: "--pid")), value > 0 else {
                fail("--pid must be a positive integer", exitCode: 2)
            }
            pid = value
        case "--output":
            output = nextValue(for: "--output")
        case "--fps":
            guard let value = Int(nextValue(for: "--fps")), (1...120).contains(value) else {
                fail("--fps must be between 1 and 120", exitCode: 2)
            }
            fps = value
        case "--window-title":
            windowTitle = nextValue(for: "--window-title")
        default:
            fail("unknown argument: \(argument)", exitCode: 2)
        }
        index += 1
    }

    guard let pid else { fail("--pid is required", exitCode: 2) }
    guard let output else { fail("--output is required", exitCode: 2) }
    return CliOptions(pid: pid, output: output, fps: fps, windowTitle: windowTitle)
}

// MARK: - stdout JSON 事件

enum RecorderEvents {
    private static let lock = NSLock()

    static func emit(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        lock.lock()
        defer { lock.unlock() }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }

    static func started(timestampMs: Int64) {
        emit(["event": "started", "timestamp": timestampMs])
    }

    static func stopped(frames: Int) {
        emit(["event": "stopped", "frames": frames])
    }

    static func error(_ message: String) {
        emit(["event": "error", "message": message])
    }
}

// MARK: - 停止协调(SIGTERM / stdin / 目标进程退出,只生效一次)

final class StopController {
    enum Reason: String {
        case signal
        case stdin
        case targetExited
    }

    private let lock = NSLock()
    private let queue: DispatchQueue
    private var stopRequested = false
    private var handler: (() -> Void)?
    private(set) var reason: Reason?

    init(queue: DispatchQueue) {
        self.queue = queue
    }

    func onStop(_ handler: @escaping () -> Void) {
        lock.lock()
        defer { lock.unlock() }
        if stopRequested {
            queue.async(execute: handler)
        } else {
            self.handler = handler
        }
    }

    func requestStop(_ reason: Reason) {
        lock.lock()
        defer { lock.unlock() }
        guard !stopRequested else { return }
        stopRequested = true
        self.reason = reason
        if let handler {
            self.handler = nil
            queue.async(execute: handler)
        }
    }
}

// MARK: - 主流程

let options = parseOptions(CommandLine.arguments)
let controlQueue = DispatchQueue(label: "mct.recorder.control")
let stopController = StopController(queue: controlQueue)

guard kill(options.pid, 0) == 0 else {
    fail("target pid \(options.pid) is not running")
}

let outputURL = URL(fileURLWithPath: options.output)
do {
    try FileManager.default.createDirectory(
        at: outputURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
    )
} catch {
    fail("cannot create output directory: \(error.localizedDescription)")
}

// SIGTERM / SIGINT → 优雅停止(必须先 SIG_IGN 再用 DispatchSource 接管)
signal(SIGTERM, SIG_IGN)
signal(SIGINT, SIG_IGN)
let sigtermSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: controlQueue)
sigtermSource.setEventHandler { stopController.requestStop(.signal) }
sigtermSource.resume()
let sigintSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: controlQueue)
sigintSource.setEventHandler { stopController.requestStop(.signal) }
sigintSource.resume()

// stdin 收到 "stop" 行 → 停止;EOF(父进程退出)不触发停止,录制继续
Thread.detachNewThread {
    while let line = readLine(strippingNewline: true) {
        if line.trimmingCharacters(in: .whitespaces) == "stop" {
            stopController.requestStop(.stdin)
            break
        }
    }
}

// 目标 pid 退出 → 自动 finalize,防孤儿进程
let processSource = DispatchSource.makeProcessSource(
    identifier: options.pid,
    eventMask: .exit,
    queue: controlQueue
)
processSource.setEventHandler { stopController.requestStop(.targetExited) }
processSource.resume()

// 窗口定位 + 录制
let targetWindow: SCWindow
do {
    targetWindow = try WindowLocator.locate(pid: options.pid, titleHint: options.windowTitle)
} catch {
    fail(String(describing: error))
}

let recorder = WindowRecorder(window: targetWindow, outputURL: outputURL, fps: options.fps)
recorder.start { result in
    switch result {
    case .success(let firstFrameMs):
        RecorderEvents.started(timestampMs: firstFrameMs)
    case .failure(let error):
        fail(String(describing: error))
    }
}

stopController.onStop {
    recorder.stop { frames in
        RecorderEvents.stopped(frames: frames)
        exit(0)
    }
    // finishWriting 卡死兜底,避免 helper 永不退出
    controlQueue.asyncAfter(deadline: .now() + 20) {
        fail("finalize timed out after 20s")
    }
}

dispatchMain()
