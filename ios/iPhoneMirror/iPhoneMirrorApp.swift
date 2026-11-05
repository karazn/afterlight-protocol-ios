import SwiftUI
import ReplayKit

@main
struct iPhoneMirrorApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

struct ContentView: View {
    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0.04, green: 0.06, blue: 0.10),
                                    Color(red: 0.08, green: 0.12, blue: 0.20)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()
            VStack(spacing: 24) {
                Image(systemName: "iphone.gen3.radiowaves.left.and.right")
                    .font(.system(size: 64)).foregroundStyle(.blue)
                Text("USB Mirror").font(.largeTitle.bold())
                Text("Подключите iPhone кабелем к Windows, запустите Windows-клиент, нажмите кнопку ниже, выберите USB Mirror и подтвердите «Начать трансляцию».")
                    .multilineTextAlignment(.center).foregroundStyle(.secondary)
                BroadcastPicker()
                    .frame(width: 72, height: 72)
                Text("iOS всегда требует вашего подтверждения перед захватом экрана.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .padding(28)
        }
        .preferredColorScheme(.dark)
    }
}

struct BroadcastPicker: UIViewRepresentable {
    func makeUIView(context: Context) -> RPSystemBroadcastPickerView {
        let picker = RPSystemBroadcastPickerView(
            frame: CGRect(x: 0, y: 0, width: 72, height: 72)
        )
        // Free sideloading tools may rewrite both the app and extension bundle IDs
        // while signing. Leaving this nil lets ReplayKit discover the installed
        // upload extension under its actual, post-signing identifier.
        picker.preferredExtension = nil
        picker.showsMicrophoneButton = false
        picker.backgroundColor = .systemBlue
        picker.layer.cornerRadius = 18
        picker.clipsToBounds = true
        if let button = picker.subviews.compactMap({ $0 as? UIButton }).first {
            button.frame = picker.bounds
            button.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            button.setImage(UIImage(systemName: "play.fill"), for: .normal)
            button.tintColor = .white
        }
        return picker
    }
    func updateUIView(_ uiView: RPSystemBroadcastPickerView, context: Context) {
        if let button = uiView.subviews.compactMap({ $0 as? UIButton }).first {
            button.frame = uiView.bounds
        }
    }
}

