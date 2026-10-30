import AudioToolbox
import CoreMedia
import Foundation
import ImageIO
import ReplayKit

struct CaptureConfig: Equatable {
    var resolution = 1080
    var fps = 60
    var bitrate = 12_000_000
}

final class ScreenStreamer {
    private let videoServer: TCPServer
    private let audioServer: TCPServer
    private let controlServer: ControlServer
    private let configLock = NSLock()
    private var activeConfig = CaptureConfig()
    private var pendingConfig = CaptureConfig()
    private var encoder: H264Encoder?
    private var lastVideoPTS = -Double.infinity
    var paused = false

    init() throws {
        videoServer = try TCPServer(port: 12005, label: "org.iphoneusbmirror.video")
        audioServer = try TCPServer(port: 12006, label: "org.iphoneusbmirror.audio")
        controlServer = try ControlServer(port: 12007)
        controlServer.handler = { [weak self] request in self?.handle(request) ?? ["ok": false] }
    }

    func start() {
        videoServer.start()
        audioServer.start()
        controlServer.start()
    }

    func stop() {
        encoder = nil
        videoServer.stop()
        audioServer.stop()
        controlServer.stop()
    }

    func processVideo(_ sampleBuffer: CMSampleBuffer) {
        guard !paused, videoServer.canSend,
              let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        applyPendingConfig()
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let seconds = CMTimeGetSeconds(pts)
        guard seconds.isFinite,
              seconds - lastVideoPTS >= (0.90 / Double(activeConfig.fps)) else { return }
        lastVideoPTS = seconds

        let orientation = videoOrientation(sampleBuffer)
        let sourceWidth = CVPixelBufferGetWidth(pixelBuffer)
        let sourceHeight = CVPixelBufferGetHeight(pixelBuffer)
        let swapsAxes = orientation == .left || orientation == .right ||
                        orientation == .leftMirrored || orientation == .rightMirrored
        let orientedWidth = swapsAxes ? sourceHeight : sourceWidth
        let orientedHeight = swapsAxes ? sourceWidth : sourceHeight
        let dimensions = targetDimensions(width: orientedWidth, height: orientedHeight,
                                          shortEdge: activeConfig.resolution)
        if encoder?.width != dimensions.0 || encoder?.height != dimensions.1 ||
           encoder?.fps != activeConfig.fps || encoder?.bitrate != activeConfig.bitrate {
            do {
                let next = try H264Encoder(width: dimensions.0, height: dimensions.1,
                                           fps: activeConfig.fps, bitrate: activeConfig.bitrate)
                next.onFrame = { [weak self] data, _ in
                    _ = self?.videoServer.sendDroppingIfBusy(data)
                }
                encoder = next
            } catch {
                encoder = nil
                return
            }
        }
        encoder?.encode(pixelBuffer, orientation: orientation, presentationTime: pts)
    }

    func processAudio(_ sampleBuffer: CMSampleBuffer) {
        guard !paused, audioServer.canSend,
              let format = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbdPointer = CMAudioFormatDescriptionGetStreamBasicDescription(format),
              let block = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }
        let asbd = asbdPointer.pointee
        guard asbd.mFormatID == kAudioFormatLinearPCM,
              asbd.mBitsPerChannel == 32,
              (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0 else { return }
        let frames = CMSampleBufferGetNumSamples(sampleBuffer)
        let channels = Int(asbd.mChannelsPerFrame)
        guard frames > 0, channels > 0, channels <= 8 else { return }
        let total = CMBlockBufferGetDataLength(block)
        var source = Data(count: total)
        source.withUnsafeMutableBytes { raw in
            if let base = raw.baseAddress {
                CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: total,
                                           destination: base)
            }
        }
        let nonInterleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0
        var samples = [Float](repeating: 0, count: frames * channels)
        source.withUnsafeBytes { raw in
            let values = raw.bindMemory(to: Float.self)
            guard values.count >= frames * channels else { return }
            if nonInterleaved {
                for frame in 0..<frames {
                    for channel in 0..<channels {
                        samples[frame * channels + channel] = values[channel * frames + frame]
                    }
                }
            } else {
                for index in 0..<(frames * channels) { samples[index] = values[index] }
            }
        }
        var payload = Data()
        var rate = UInt32(asbd.mSampleRate.rounded()).bigEndian
        var channelCount = UInt16(channels).bigEndian
        var sampleFormat = UInt16(1).bigEndian // Float32 little-endian
        payload.append(Data(bytes: &rate, count: 4))
        payload.append(Data(bytes: &channelCount, count: 2))
        payload.append(Data(bytes: &sampleFormat, count: 2))
        samples.withUnsafeBytes { payload.append(contentsOf: $0) }
        var packetLength = UInt32(payload.count).bigEndian
        var packet = Data(bytes: &packetLength, count: 4)
        packet.append(payload)
        _ = audioServer.sendDroppingIfBusy(packet)
    }

    private func handle(_ request: [String: Any]) -> [String: Any] {
        switch request["method"] as? String {
        case "ping":
            return ["ok": true, "deviceTime": ProcessInfo.processInfo.systemUptime]
        case "setConfig":
            guard let params = request["params"] as? [String: Any] else { return ["ok": false] }
            configLock.lock()
            if let resolution = params["resolution"] as? Int, [720, 1080].contains(resolution) {
                pendingConfig.resolution = resolution
            }
            if let fps = params["fps"] as? Int, [30, 60].contains(fps) {
                pendingConfig.fps = fps
            }
            if let bitrate = params["bitrate"] as? Int {
                pendingConfig.bitrate = min(20_000_000, max(1_000_000, bitrate))
            }
            let result = pendingConfig
            configLock.unlock()
            return ["ok": true, "resolution": result.resolution,
                    "fps": result.fps, "bitrate": result.bitrate]
        default:
            return ["ok": false, "error": "unknown method"]
        }
    }

    private func applyPendingConfig() {
        configLock.lock()
        let next = pendingConfig
        configLock.unlock()
        if next != activeConfig {
            activeConfig = next
            encoder = nil
            lastVideoPTS = -Double.infinity
        }
    }

    private func videoOrientation(_ sampleBuffer: CMSampleBuffer) -> CGImagePropertyOrientation {
        var mode: CMAttachmentMode = 0
        if let value = CMGetAttachment(sampleBuffer, key: RPVideoSampleOrientationKey as CFString,
                                       attachmentModeOut: &mode) as? NSNumber,
           let orientation = CGImagePropertyOrientation(rawValue: value.uint32Value) {
            return orientation
        }
        return .up
    }

    private func targetDimensions(width: Int, height: Int, shortEdge: Int) -> (Int, Int) {
        let scale = min(1.0, Double(shortEdge) / Double(min(width, height)))
        let outputWidth = max(2, Int((Double(width) * scale).rounded()) & ~1)
        let outputHeight = max(2, Int((Double(height) * scale).rounded()) & ~1)
        return (outputWidth, outputHeight)
    }
}
