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

        // onScreenWindowsOnly: false —— 客户端窗口常被遮挡或处于后台 Space,
        // 仍需能定位;后续按目标 pid 过滤,不会误选其他应用的窗口
        SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: false) { content, error in
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

    /// 用 sysctl(KERN_PROC_ALL) 取全进程表的 (pid, ppid),再过滤直接子进程。
    /// 比 proc_listpids(PROC_PPID_ONLY) 可靠:后者在部分 macOS 版本下对包装进程返回空。
    private static func childPids(of parent: pid_t) -> [pid_t] {
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0]
        var length = 0
        guard sysctl(&mib, 4, nil, &length, nil, 0) == 0, length > 0 else { return [] }

        let stride = MemoryLayout<kinfo_proc>.stride
        var procs = [kinfo_proc](repeating: kinfo_proc(), count: length / stride)
        guard sysctl(&mib, 4, &procs, &length, nil, 0) == 0 else { return [] }

        let count = length / stride
        return procs.prefix(count).compactMap { proc in
            proc.kp_eproc.e_ppid == parent ? proc.kp_proc.p_pid : nil
        }
    }
}
