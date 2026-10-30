import CoreImage
import CoreMedia
import Foundation
import ImageIO
import VideoToolbox

final class H264Encoder {
    let width: Int
    let height: Int
    let fps: Int
    let bitrate: Int
    var onFrame: ((Data, Bool) -> Void)?

    private var session: VTCompressionSession?
    private var pixelPool: CVPixelBufferPool?
    private let ciContext = CIContext(options: [.cacheIntermediates: false])

    init(width: Int, height: Int, fps: Int, bitrate: Int) throws {
        self.width = width
        self.height = height
        self.fps = fps
        self.bitrate = bitrate

        let attributes: [CFString: Any] = [
            kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
            kCVPixelBufferWidthKey: width,
            kCVPixelBufferHeightKey: height,
            kCVPixelBufferIOSurfacePropertiesKey: [:]
        ]
        var pool: CVPixelBufferPool?
        let poolStatus = CVPixelBufferPoolCreate(nil, nil, attributes as CFDictionary, &pool)
        guard poolStatus == kCVReturnSuccess, let pool else { throw EncoderError.pool(poolStatus) }
        pixelPool = pool

        var created: VTCompressionSession?
        let specification: CFDictionary?
        if #available(iOS 17.4, *) {
            specification = [kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder: true] as CFDictionary
        } else {
            // Older iOS versions still choose the built-in H.264 hardware encoder by default.
            specification = nil
        }
        let status = VTCompressionSessionCreate(
            allocator: kCFAllocatorDefault,
            width: Int32(width), height: Int32(height),
            codecType: kCMVideoCodecType_H264,
            encoderSpecification: specification,
            imageBufferAttributes: attributes as CFDictionary,
            compressedDataAllocator: nil,
            outputCallback: encoderCallback,
            refcon: Unmanaged.passUnretained(self).toOpaque(),
            compressionSessionOut: &created
        )
        guard status == noErr, let created else { throw EncoderError.session(status) }
        session = created
        set(kVTCompressionPropertyKey_RealTime, kCFBooleanTrue)
        set(kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse)
        set(kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_High_AutoLevel)
        set(kVTCompressionPropertyKey_ExpectedFrameRate, fps as CFNumber)
        set(kVTCompressionPropertyKey_AverageBitRate, bitrate as CFNumber)
        set(kVTCompressionPropertyKey_DataRateLimits,
            [bitrate / 8, 1] as CFArray)
        set(kVTCompressionPropertyKey_MaxKeyFrameInterval, fps as CFNumber)
        set(kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, 1 as CFNumber)
        VTCompressionSessionPrepareToEncodeFrames(created)
    }

    deinit {
        if let session {
            VTCompressionSessionCompleteFrames(session, untilPresentationTimeStamp: .invalid)
            VTCompressionSessionInvalidate(session)
        }
    }

    func encode(_ source: CVPixelBuffer, orientation: CGImagePropertyOrientation,
                presentationTime: CMTime) {
        guard let session, let pixelPool else { return }
        var target: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(nil, pixelPool, &target) == kCVReturnSuccess,
              let target else { return }

        var image = CIImage(cvPixelBuffer: source).oriented(orientation)
        let extent = image.extent
        image = image.transformed(by: CGAffineTransform(translationX: -extent.origin.x,
                                                        y: -extent.origin.y))
        let sx = CGFloat(width) / extent.width
        let sy = CGFloat(height) / extent.height
        image = image.transformed(by: CGAffineTransform(scaleX: sx, y: sy))
        ciContext.render(image, to: target,
                         bounds: CGRect(x: 0, y: 0, width: width, height: height),
                         colorSpace: CGColorSpaceCreateDeviceRGB())

        let duration = CMTime(value: 1, timescale: CMTimeScale(fps))
        VTCompressionSessionEncodeFrame(session, imageBuffer: target,
                                        presentationTimeStamp: presentationTime,
                                        duration: duration, frameProperties: nil,
                                        sourceFrameRefcon: nil, infoFlagsOut: nil)
    }

    private func set(_ key: CFString, _ value: CFTypeRef) {
        if let session { VTSessionSetProperty(session, key: key, value: value) }
    }

    fileprivate func consume(_ sampleBuffer: CMSampleBuffer) {
        guard CMSampleBufferDataIsReady(sampleBuffer),
              let block = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer,
                                                                   createIfNecessary: false) as? [[CFString: Any]]
        let keyframe = !((attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool) ?? false)
        var output = Data()
        let startCode: [UInt8] = [0, 0, 0, 1]

        if keyframe, let format = CMSampleBufferGetFormatDescription(sampleBuffer) {
            for index in 0..<2 {
                var pointer: UnsafePointer<UInt8>?
                var size = 0
                var count = 0
                let status = CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
                    format, parameterSetIndex: index,
                    parameterSetPointerOut: &pointer, parameterSetSizeOut: &size,
                    parameterSetCountOut: &count, nalUnitHeaderLengthOut: nil)
                if status == noErr, let pointer {
                    output.append(contentsOf: startCode)
                    output.append(pointer, count: size)
                }
            }
        }

        let total = CMBlockBufferGetDataLength(block)
        var avcc = Data(count: total)
        avcc.withUnsafeMutableBytes { raw in
            if let base = raw.baseAddress {
                CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: total,
                                           destination: base)
            }
        }
        var offset = 0
        while offset + 4 <= avcc.count {
            let nalLength = avcc[offset..<(offset + 4)].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
            offset += 4
            let end = offset + Int(nalLength)
            guard nalLength > 0, end <= avcc.count else { break }
            output.append(contentsOf: startCode)
            output.append(avcc.subdata(in: offset..<end))
            offset = end
        }
        if !output.isEmpty { onFrame?(output, keyframe) }
    }
}

private let encoderCallback: VTCompressionOutputCallback = {
    refcon, _, status, _, sampleBuffer in
    guard status == noErr, let refcon, let sampleBuffer else { return }
    Unmanaged<H264Encoder>.fromOpaque(refcon).takeUnretainedValue().consume(sampleBuffer)
}

enum EncoderError: Error {
    case pool(OSStatus)
    case session(OSStatus)
}
