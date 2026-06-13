import AppKit
import AVFoundation
import Foundation
import ScreenCaptureKit

enum WindowRecorderError: Error, CustomStringConvertible {
    case writerSetupFailed(String)
    case captureStartFailed(String)
    case streamFailed(String)
    case firstFrameTimeout

    var description: String {
        switch self {
        case .writerSetupFailed(let message): return "cannot create mp4 writer: \(message)"
        case .captureStartFailed(let message): return "cannot start capture: \(message)"
        case .streamFailed(let message): return "capture stream failed: \(message)"
        case .firstFrameTimeout: return "no frame received within 15s; window may be minimized or hidden"
        }
    }
}

/// SCStream 单窗口采集 + AVAssetWriter h264 编码 mp4。
/// start 的回调携带首帧墙钟毫秒时间戳(时间轴对齐基准);stop 同步走完 finishWriting 保证 mp4 完整。
final class WindowRecorder: NSObject, SCStreamOutput, SCStreamDelegate {
    private static let averageBitRate = 4_000_000
    private static let firstFrameTimeoutSeconds = 15.0

    private let window: SCWindow
    private let outputURL: URL
    private let fps: Int
    private let outputQueue = DispatchQueue(label: "mct.recorder.frames")

    private var stream: SCStream?
    private var writer: AVAssetWriter?
    private var writerInput: AVAssetWriterInput?

    private var startCompletion: ((Result<Int64, Error>) -> Void)?
    private var sessionStarted = false
    private var stopping = false
    private var frameCount = 0

    init(window: SCWindow, outputURL: URL, fps: Int) {
        self.window = window
        self.outputURL = outputURL
        self.fps = fps
    }

    func start(completion: @escaping (Result<Int64, Error>) -> Void) {
        outputQueue.async {
            self.startCompletion = completion
            do {
                try self.setUpWriter()
                try self.setUpStream()
            } catch {
                self.finishStart(.failure(error))
                return
            }

            self.stream?.startCapture { error in
                if let error {
                    self.outputQueue.async {
                        self.finishStart(.failure(WindowRecorderError.captureStartFailed(error.localizedDescription)))
                    }
                    return
                }
                self.outputQueue.asyncAfter(deadline: .now() + Self.firstFrameTimeoutSeconds) {
                    // 首帧已到则 startCompletion 已置 nil,定时器作废;否则才判超时失败,
                    // 避免长录制(>首帧超时)时这个延迟闭包误触发 finishStart 把进程杀掉
                    guard self.startCompletion != nil else { return }
                    self.finishStart(.failure(WindowRecorderError.firstFrameTimeout))
                }
            }
        }
    }

    func stop(completion: @escaping (Int) -> Void) {
        outputQueue.async {
            guard !self.stopping else { return }
            self.stopping = true

            let finalize = {
                self.outputQueue.async {
                    guard let writer = self.writer, self.sessionStarted, writer.status == .writing else {
                        self.writer?.cancelWriting()
                        completion(self.frameCount)
                        return
                    }
                    self.writerInput?.markAsFinished()
                    writer.finishWriting {
                        completion(self.frameCount)
                    }
                }
            }

            if let stream = self.stream {
                stream.stopCapture { _ in finalize() }
            } else {
                finalize()
            }
        }
    }

    // MARK: - SCStreamOutput / SCStreamDelegate

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sampleBuffer.isValid, isCompleteFrame(sampleBuffer) else { return }
        outputQueue.async {
            self.append(sampleBuffer)
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        outputQueue.async {
            self.finishStart(.failure(WindowRecorderError.streamFailed(error.localizedDescription)))
        }
    }

    // MARK: - 内部实现(均在 outputQueue 上执行)

    private func setUpWriter() throws {
        try? FileManager.default.removeItem(at: outputURL)
        let writer: AVAssetWriter
        do {
            writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
        } catch {
            throw WindowRecorderError.writerSetupFailed(error.localizedDescription)
        }

        let (width, height) = captureSize()
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: Self.averageBitRate,
                AVVideoExpectedSourceFrameRateKey: fps,
                AVVideoMaxKeyFrameIntervalKey: fps * 2,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
            ]
        ])
        input.expectsMediaDataInRealTime = true

        guard writer.canAdd(input) else {
            throw WindowRecorderError.writerSetupFailed("writer rejected video input")
        }
        writer.add(input)
        guard writer.startWriting() else {
            throw WindowRecorderError.writerSetupFailed(writer.error?.localizedDescription ?? "startWriting failed")
        }

        self.writer = writer
        self.writerInput = input
    }

    private func setUpStream() throws {
        let (width, height) = captureSize()
        let configuration = SCStreamConfiguration()
        configuration.width = width
        configuration.height = height
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.showsCursor = true
        configuration.queueDepth = 5

        let filter = SCContentFilter(desktopIndependentWindow: window)
        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        do {
            try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: outputQueue)
        } catch {
            throw WindowRecorderError.captureStartFailed(error.localizedDescription)
        }
        self.stream = stream
    }

    /// 窗口 point 尺寸 × 屏幕缩放,取偶数(h264 要求)
    private func captureSize() -> (Int, Int) {
        let scale = NSScreen.main?.backingScaleFactor ?? 2
        let width = max(2, Int(window.frame.width * scale) & ~1)
        let height = max(2, Int(window.frame.height * scale) & ~1)
        return (width, height)
    }

    private func isCompleteFrame(_ sampleBuffer: CMSampleBuffer) -> Bool {
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false)
            as? [[SCStreamFrameInfo: Any]],
            let statusValue = attachments.first?[.status] as? Int,
            let status = SCFrameStatus(rawValue: statusValue) else {
            return false
        }
        return status == .complete
    }

    private func append(_ sampleBuffer: CMSampleBuffer) {
        guard !stopping, let writer, let writerInput else { return }

        if !sessionStarted {
            sessionStarted = true
            writer.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
            finishStart(.success(Int64(Date().timeIntervalSince1970 * 1000)))
        }

        if writerInput.isReadyForMoreMediaData, writerInput.append(sampleBuffer) {
            frameCount += 1
        }
    }

    /// started 回调只触发一次;首帧成功后再失败(如流中断)时直接报错退出
    private func finishStart(_ result: Result<Int64, Error>) {
        if let completion = startCompletion {
            startCompletion = nil
            completion(result)
            return
        }
        if case .failure(let error) = result, !stopping {
            fail(String(describing: error))
        }
    }
}
