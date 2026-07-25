// 筋トレLAB — Siriショートカット(App Intents・iOS16+)(Appターゲットに追加)
// 「ヘイSiri、筋トレLABで休憩タイマー」等。実行するとアプリが開き、
// UserDefaultsの保留アクション経由でJS側(consumeNativeAction)が処理する
import Foundation
import AppIntents

@available(iOS 16.0, *)
struct KLStartRestTimerIntent: AppIntent {
    static var title: LocalizedStringResource = "休憩タイマーを開始"
    static var description = IntentDescription("筋トレLABの休憩タイマーを開始します")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "秒数", default: 90)
    var seconds: Int

    @MainActor
    func perform() async throws -> some IntentResult {
        let obj: [String: Any] = ["action": "restTimer", "seconds": max(10, min(600, seconds))]
        if let data = try? JSONSerialization.data(withJSONObject: obj),
           let s = String(data: data, encoding: .utf8) {
            UserDefaults.standard.set(s, forKey: "kl.pendingAction")
        }
        return .result()
    }
}

@available(iOS 16.0, *)
struct KLOpenTodayIntent: AppIntent {
    static var title: LocalizedStringResource = "今日のメニューを開く"
    static var description = IntentDescription("筋トレLABの今日のトレーニングメニューを開きます")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        UserDefaults.standard.set("{\"action\":\"openToday\"}", forKey: "kl.pendingAction")
        return .result()
    }
}

@available(iOS 16.0, *)
struct KLShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: KLStartRestTimerIntent(), phrases: [
            "\(.applicationName)で休憩タイマー",
            "\(.applicationName)のタイマーを開始",
            "\(.applicationName)で休憩",
        ], shortTitle: "休憩タイマー", systemImageName: "timer")
        AppShortcut(intent: KLOpenTodayIntent(), phrases: [
            "\(.applicationName)で今日のメニュー",
            "\(.applicationName)を開いて",
        ], shortTitle: "今日のメニュー", systemImageName: "dumbbell")
    }
}
