// 筋トレLAB — カスタムCapacitorプラグイン(Appターゲットに追加)
// JSからは window.Capacitor.Plugins.KLNative として見える。
// 機能: ①休憩/インターバルタイマーのLive Activity開始・終了 ②ホームウィジェットへのデータ書き出し
import Foundation
import Capacitor
import ActivityKit
import WidgetKit
import StoreKit
import UserNotifications
import CoreSpotlight
import UniformTypeIdentifiers

@objc(KLNativePlugin)
public class KLNativePlugin: CAPPlugin, CAPBridgedPlugin {
    // Capacitor 6/7 はこの準拠が無いとプラグインを認識・登録しない(.mのCAP_PLUGINだけでは不足)
    public let identifier = "KLNativePlugin"
    public let jsName = "KLNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startTimerActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endTimerActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateTimerActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateWidget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestReview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBadge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumePendingAction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "indexSpotlight", returnType: CAPPluginReturnPromise)
    ]

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

    // Siriショートカット/Spotlightが仕込んだ保留アクションを取り出して消費(JSが起動/復帰時に呼ぶ)
    @objc func consumePendingAction(_ call: CAPPluginCall) {
        let ud = UserDefaults.standard
        guard let json = ud.string(forKey: "kl.pendingAction"),
              let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            call.resolve([:])
            return
        }
        ud.removeObject(forKey: "kl.pendingAction")
        var res = JSObject()
        for (k, v) in obj {
            if let s = v as? String { res[k] = s }
            else if let n = v as? NSNumber { res[k] = n.doubleValue }
        }
        call.resolve(res)
    }

    // 種目をSpotlightにインデックス(検索→タップでアプリ内の種目モーダルを開く)
    @objc func indexSpotlight(_ call: CAPPluginCall) {
        guard let items = call.getArray("items") as? [[String: Any]] else { call.resolve(["ok": false]); return }
        var searchable: [CSSearchableItem] = []
        for it in items {
            guard let id = it["id"] as? String, let title = it["title"] as? String else { continue }
            let attr = CSSearchableItemAttributeSet(contentType: UTType.text)
            attr.title = title
            attr.contentDescription = it["desc"] as? String
            attr.keywords = it["keywords"] as? [String]
            let item = CSSearchableItem(uniqueIdentifier: "ex:" + id, domainIdentifier: "exercises", attributeSet: attr)
            item.expirationDate = Date.distantFuture
            searchable.append(item)
        }
        CSSearchableIndex.default().indexSearchableItems(searchable) { err in
            call.resolve(["ok": err == nil, "count": searchable.count])
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
