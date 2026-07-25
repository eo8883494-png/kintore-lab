// 筋トレLAB Watch — iPhoneとの通信(WatchConnectivity)
// 受信: applicationContext["menu"] = 今日のメニューJSON
// 送信: {type:"setDone", exId, count} = セット完了タップ
import Foundation
import WatchConnectivity

struct KLItem: Identifiable, Codable {
    var exId: String
    var name: String
    var sets: Int
    var done: Int
    var reps: String
    var rest: Int
    var id: String { exId }
}

struct KLMenu: Codable {
    var title: String
    var items: [KLItem]
}

final class WatchSession: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchSession()
    @Published var menu = KLMenu(title: "iPhoneで筋トレLABを開くと同期されます", items: [])

    private override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if let json = session.receivedApplicationContext["menu"] as? String { apply(json) }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        if let json = applicationContext["menu"] as? String { apply(json) }
    }

    private func apply(_ json: String) {
        guard let data = json.data(using: .utf8),
              let m = try? JSONDecoder().decode(KLMenu.self, from: data) else { return }
        DispatchQueue.main.async { self.menu = m }
    }

    func sendSetDone(exId: String, count: Int) {
        guard WCSession.default.activationState == .activated, WCSession.default.isReachable else { return }
        WCSession.default.sendMessage(["type": "setDone", "exId": exId, "count": count], replyHandler: nil, errorHandler: nil)
    }
}
