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
                Text("Подключите iPhone кабелем к Windows, запустите Windows-клиент, затем нажмите кнопку ниже и выберите USB Mirror.")
                    .multilineTextAlignment(.center).foregroundStyle(.secondary)
                BroadcastPicker()
                    .frame(width: 72, height: 72)
                    .background(.blue, in: RoundedRectangle(cornerRadius: 18))
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
        let picker = RPSystemBroadcastPickerView(frame: .zero)
        picker.preferredExtension = "org.iphoneusbmirror.app.broadcast"
        picker.showsMicrophoneButton = false
        if let button = picker.subviews.compactMap({ $0 as? UIButton }).first {
            button.setImage(UIImage(systemName: "play.fill"), for: .normal)
            button.tintColor = .white
        }
        return picker
    }
    func updateUIView(_ uiView: RPSystemBroadcastPickerView, context: Context) {}
}

