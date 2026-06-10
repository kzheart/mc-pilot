import Foundation
import ScreenCaptureKit

enum WindowLocatorError: Error, CustomStringConvertible {
    case permissionDenied
    case contentUnavailable(String)
    case windowNotFound(pid: pid_t, titleHint: String?)

    var description: String {
        switch self {
        case .permissionDenied:
            return "screen recording permission not granted; "
                + "enable it for your terminal in System Settings > Privacy & Security > Screen Recording"
        case .contentUnavailable(let message):
            return "cannot enumerate shareable windows: \(message)"
        case .windowNotFound(let pid, let titleHint):
            return "no recordable window found for pid \(pid)"
                + (titleHint.map { " or title hint \"\($0)\"" } ?? "")
        }
    }
}

enum WindowLocator {
    /// pid 精确匹配 → 子孙进程 pid → 窗口标题兜底,三层失败抛错
    static func locate(pid: pid_t, titleHint: String?) throws -> SCWindow {
        guard CGPreflightScreenCaptureAccess() else {
            throw WindowLocatorError.permissionDenied
        }

        let windows = try shareableWindows()
        let candidatePids = Set([pid] + descendantPids(of: pid, maxDepth: 3))

        if let window = pickLargest(windows.filter { window in
            guard let app = window.owningApplication else { return false }
            return candidatePids.contains(app.processID)
        }) {
            return window
        }

        let hint = titleHint ?? "Minecraft"
        if let window = pickLargest(windows.filter { window in
            (window.title ?? "").localizedCaseInsensitiveContains(hint)
        }) {
            return window
        }

        throw WindowLocatorError.windowNotFound(pid: pid, titleHint: titleHint)
    }

    private static func shareableWindows() throws -> [SCWindow] {
        let semaphore = DispatchSemaphore(value: 0)
        var result: Result<[SCWindow], Error> = .failure(
            WindowLocatorError.contentUnavailable("timed out")
        )

        SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { content, error in
            if let content {
                result = .success(content.windows)
            } else {
                result = .failure(
                    WindowLocatorError.contentUnavailable(error?.localizedDescription ?? "unknown error")
                )
            }
            semaphore.signal()
        }

        _ = semaphore.wait(timeout: .now() + 10)
        return try result.get()
    }

    /// 过滤工具条/弹层等小窗口,取面积最大者
    private static func pickLargest(_ windows: [SCWindow]) -> SCWindow? {
        windows
            .filter { $0.windowLayer == 0 && $0.frame.width >= 100 && $0.frame.height >= 100 }
            .max { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }
    }

    private static func descendantPids(of parent: pid_t, maxDepth: Int) -> [pid_t] {
        guard maxDepth > 0 else { return [] }
        let children = childPids(of: parent)
        return children + children.flatMap { descendantPids(of: $0, maxDepth: maxDepth - 1) }
    }

    private static func childPids(of parent: pid_t) -> [pid_t] {
        // proc_info.h 中的 PROC_PPID_ONLY,Swift 未导出该常量
        let procPpidOnly: UInt32 = 6
        var pids = [pid_t](repeating: 0, count: 2048)
        let byteCount = proc_listpids(
            procPpidOnly,
            UInt32(parent),
            &pids,
            Int32(pids.count * MemoryLayout<pid_t>.size)
        )
        guard byteCount > 0 else { return [] }
        let count = Int(byteCount) / MemoryLayout<pid_t>.size
        return Array(pids.prefix(count)).filter { $0 > 0 }
    }
}
