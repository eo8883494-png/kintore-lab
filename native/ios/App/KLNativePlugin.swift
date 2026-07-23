// 筋トレLAB — カスタムCapacitorプラグイン(Appターゲットに追加)
// JSからは window.Capacitor.Plugins.KLNative として見える。
// 機能: ①休憩/インターバルタイマーのLive Activity開始・終了 ②ホームウィジェットへのデータ書き出し
import Foundation
import Capacitor
import ActivityKit
import WidgetKit

@objc(KLNativePlugin)
public class KLNativePlugin: CAPPlugin {

    // タイマーのLive Activityを開始(既存があれば終了してから)
    @objc func startTimerActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { call.resolve(["ok": false, "reason": "unsupported"]); return }
        let endMs = call.getDouble("endAt") ?? 0
        let label = call.getString("label") ?? "休憩"
        let kind = call.getString("kind") ?? "rest"
        guard endMs > 0 else { call.resolve(["ok": false, "reason": "noEnd"]); return }
        let end = Date(timeIntervalSince1970: endMs / 1000)
        Task {
            for a in Activity<KLTimerAttributes>.activities {
                await a.end(nil, dismissalPolicy: .immediate)
            }
            let attrs = KLTimerAttributes(kind: kind)
            let state = KLTimerAttributes.ContentState(endDate: end, label: label)
            do {
                if #available(iOS 16.2, *) {
                    _ = try Activity.request(attributes: attrs,
                                             content: .init(state: state, staleDate: end.addingTimeInterval(60)))
                } else {
                    _ = try Activity.request(attributes: attrs, contentState: state)
                }
                call.resolve(["ok": true])
            } catch {
                call.resolve(["ok": false, "error": error.localizedDescription])
            }
        }
    }

    // タイマーのLive Activityを終了
    @objc func endTimerActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { call.resolve(); return }
        Task {
            for a in Activity<KLTimerAttributes>.activities {
                await a.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve()
        }
    }

    // ホームウィジェットのデータを書き出して再描画を依頼
    @objc func updateWidget(_ call: CAPPluginCall) {
        let ud = UserDefaults(suiteName: "group.com.hatarakuai.kintorelab")
        ud?.set(call.getString("title") ?? "", forKey: "kl.title")
        ud?.set(call.getString("sub") ?? "", forKey: "kl.sub")
        ud?.set(call.getInt("done") ?? 0, forKey: "kl.done")
        ud?.set(call.getInt("total") ?? 0, forKey: "kl.total")
        if #available(iOS 14.0, *) { WidgetCenter.shared.reloadAllTimelines() }
        call.resolve()
    }
}
