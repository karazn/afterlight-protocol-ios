import ReplayKit

final class SampleHandler: RPBroadcastSampleHandler {
    private var streamer: ScreenStreamer?

    override func broadcastStarted(withSetupInfo setupInfo: [String : NSObject]?) {
        do {
            let streamer = try ScreenStreamer()
            self.streamer = streamer
            streamer.start()
        } catch {
            finishBroadcastWithError(error)
        }
    }

    override func broadcastPaused() { streamer?.paused = true }
    override func broadcastResumed() { streamer?.paused = false }

    override func broadcastFinished() {
        streamer?.stop()
        streamer = nil
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer,
                                      with sampleBufferType: RPSampleBufferType) {
        switch sampleBufferType {
        case .video: streamer?.processVideo(sampleBuffer)
        case .audioApp: streamer?.processAudio(sampleBuffer)
        case .audioMic: break
        @unknown default: break
        }
    }
}
