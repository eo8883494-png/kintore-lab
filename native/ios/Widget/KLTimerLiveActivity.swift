// 筋トレLAB — ロック画面/Dynamic Islandのタイマー表示(Live Activity)
// KintoreWidgetターゲットに追加。KLTimerAttributes.swiftも同ターゲットに含めること
import ActivityKit
import WidgetKit
import SwiftUI

@available(iOS 16.1, *)
struct KLTimerLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: KLTimerAttributes.self) { context in
            // ロック画面 / 通知センター
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("筋トレLAB ⏱️")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    Text(context.state.label)
                        .font(.headline)
                        .lineLimit(1)
                }
                Spacer()
                Text(timerInterval: Date()...max(Date(), context.state.endDate), countsDown: true)
                    .font(.system(size: 34, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundColor(Color(red: 0.78, green: 0.95, blue: 0.31)) // アプリのアクセント色
                    .frame(maxWidth: 110, alignment: .trailing)
            }
            .padding(16)
            .activityBackgroundTint(Color.black.opacity(0.82))
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.label).font(.headline).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: Date()...max(Date(), context.state.endDate), countsDown: true)
                        .font(.title2).bold().monospacedDigit()
                        .frame(maxWidth: 90, alignment: .trailing)
                }
            } compactLeading: {
                Text("⏱️")
            } compactTrailing: {
                Text(timerInterval: Date()...max(Date(), context.state.endDate), countsDown: true)
                    .monospacedDigit()
                    .frame(maxWidth: 52)
            } minimal: {
                Text("⏱️")
            }
        }
    }
}
