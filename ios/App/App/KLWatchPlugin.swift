// 筋トレLAB — Apple Watch連携プラグイン(Appターゲットに追加)
// JSからは window.Capacitor.Plugins.KLWatch。
// ①updateWatchData: 今日のメニューJSONをWatchへ送る(applicationContext=最新のみ保持)
// ②Watchからの「セット完了」メッセージを 'watchSetDone' イベントでJSへ通知
import Foundation
import Capacitor
import WatchConnectivity

@objc(KLWatchPlugin)
public class KLWatchPlugin: CAPPlugin, CAPBridgedPlugin, WCSessionDelegate {
    // Capacitor 6/7 の登録に必須
    public let identifier = "KLWatchPlugin"
    public let jsName = "KLWatch"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "updateWatchData", returnType: CAPPluginReturnPromise)
    ]

    public override func load() {
        if WCSession.isSupported() {
            let s = WCSession.default
            s.delegate = self
            s.activate()
        }
    }

    @objc func updateWatchData(_ call: CAPPluginCall) {
        guard WCSession.isSupported() else { call.resolve(["ok": false, "reason": "unsupported"]); return }
        let json = call.getString("json") ?? "{}"
        do {
            try WCSession.default.updateApplicationContext(["menu": json])
            call.resolve(["ok": true])
        } catch {
            call.resolve(["ok": false, "error": error.localizedDescription])
        }
    }

    // ===== WCSessionDelegate =====
    public func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
    public func sessionDidBecomeInactive(_ session: WCSession) {}
    public func sessionDidDeactivate(_ session: WCSession) { session.activate() }

    public func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        guard let type = message["type"] as? String, type == "setDone" else { return }
        DispatchQueue.main.async {
            self.notifyListeners("watchSetDone", data: [
                "exId": message["exId"] as? String ?? "",
                "count": message["count"] as? Int ?? 0,
            ])
        }
    }
}
