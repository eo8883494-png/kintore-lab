// 筋トレLAB — カスタムCapacitorプラグイン(Appターゲットに追加)
// JSからは window.Capacitor.Plugins.KLNative として見える。
// 機能: ①休憩/インターバルタイマーのLive Activity開始・終了 ②ホームウィジェットへのデータ書き出し
import Foundation
import Capacitor
import ActivityKit
import WidgetKit
import StoreKit
import UserNotifications

@objc(KLNativePlugin)
public class KLNativePlugin: CAPPlugin {

    // App Storeの標準レビューダイアログを要求(Apple側で年3回まで表示制御される)
    @objc func requestReview(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
                if #available(iOS 14.0, *) {
                    SKStoreReviewController.requestReview(in: scene)
                }
            }
            call.resolve()
        }
    }

    // アプリアイコンのバッジ数を設定(0でクリア)
    @objc func setBadge(_ call: CAPPluginCall) {
        let n = call.getInt("count") ?? 0
        DispatchQueue.main.async {
            if #available(iOS 16.0, *) {
                UNUserNotificationCenter.current().setBadgeCount(n) { _ in }
            } else {
                UIApplication.shared.applicationIconBadgeNumber = n
            }
            call.resolve()
        }
    }

    // 進行中のLive Activityを更新(インターバルのフェーズ切替表示用)
    @objc func updateTimerActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { call.resolve(); return }
        let endMs = call.getDouble("endAt") ?? 0
        let label = call.getString("label") ?? ""
        guard endMs > 0 else { call.resolve(); return }
        let end = Date(timeIntervalSince1970: endMs / 1000)
        Task {
            let state = KLTimerAttributes.ContentState(endDate: end, label: label)
            for a in Activity<KLTimerAttributes>.activities {
                if #available(iOS 16.2, *) {
                    await a.update(ActivityContent(state: state, staleDate: end.addingTimeInterval(60)))
                } else {
                    await a.update(using: state)
                }
            }
            call.resolve()
        }
    }

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
