// 筋トレLAB — Live Activity 属性定義
// ⚠️ このファイルは App と KintoreWidget の両方のターゲットに追加すること
// (アプリ側からActivityを開始し、ウィジェット拡張側がUIを描くため、型を共有する必要がある)
import ActivityKit
import Foundation

struct KLTimerAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var endDate: Date   // タイマー終了時刻(この時刻へ向けて自動カウントダウン表示)
        var label: String   // 例: 「ベンチプレス の休憩」「インターバル」
    }
    var kind: String        // "rest" | "interval"
}
