// 筋トレLAB — ホーム画面ウィジェット(今日のメニュー+進捗)
// KintoreWidgetターゲットに追加。データはApp Group経由でアプリ(KLNativePlugin.updateWidget)が書き込む
import WidgetKit
import SwiftUI

private let APP_GROUP = "group.com.hatarakuai.kintorelab"

struct KLTodayEntry: TimelineEntry {
    let date: Date
    let title: String
    let sub: String
    let done: Int
    let total: Int
}

struct KLTodayProvider: TimelineProvider {
    private func load() -> KLTodayEntry {
        let ud = UserDefaults(suiteName: APP_GROUP)
        let title = (ud?.string(forKey: "kl.title")).flatMap { $0.isEmpty ? nil : $0 } ?? "今日のメニュー"
        let sub = (ud?.string(forKey: "kl.sub")).flatMap { $0.isEmpty ? nil : $0 } ?? "アプリを開いて確認"
        let done = ud?.integer(forKey: "kl.done") ?? 0
        let total = ud?.integer(forKey: "kl.total") ?? 0
        return KLTodayEntry(date: Date(), title: title, sub: sub, done: done, total: total)
    }
    func placeholder(in context: Context) -> KLTodayEntry { load() }
    func getSnapshot(in context: Context, completion: @escaping (KLTodayEntry) -> Void) { completion(load()) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<KLTodayEntry>) -> Void) {
        // アプリ側がWidgetCenterで随時reloadする。保険として1時間ごとに更新
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date().addingTimeInterval(3600)
        completion(Timeline(entries: [load()], policy: .after(next)))
    }
}

struct KLTodayWidgetView: View {
    @Environment(\.widgetFamily) var family
    var entry: KLTodayEntry
    private let accent = Color(red: 0.78, green: 0.95, blue: 0.31)

    var body: some View {
        switch family {
        case .accessoryCircular: circularView
        case .accessoryRectangular: rectangularView
        default: fullView
        }
    }

    // ロック画面(丸): 進捗リング
    private var circularView: some View {
        Gauge(value: Double(min(entry.done, max(entry.total, 1))), in: 0...Double(max(entry.total, 1))) {
            Text("💪")
        } currentValueLabel: {
            Text(entry.total > 0 ? "\(entry.done)/\(entry.total)" : "–")
                .font(.system(size: 13, weight: .bold, design: .rounded))
        }
        .gaugeStyle(.accessoryCircular)
        .klAccessoryBackground()
    }

    // ロック画面(横長): メニュー名+進捗
    private var rectangularView: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(entry.title).font(.headline).lineLimit(1)
            Text(entry.total > 0 ? "進捗 \(entry.done)/\(entry.total)\(entry.done >= entry.total ? " 完遂🎉" : "")" : entry.sub)
                .font(.caption2)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .klAccessoryBackground()
    }

    private var fullView: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("筋トレLAB 🧪")
                .font(.caption2)
                .foregroundColor(.secondary)
            Text(entry.title)
                .font(.headline)
                .foregroundColor(.white)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
            Text(entry.sub)
                .font(.caption)
                .foregroundColor(.secondary)
                .lineLimit(2)
            Spacer(minLength: 0)
            if entry.total > 0 {
                HStack(spacing: 4) {
                    ForEach(0..<min(entry.total, 8), id: \.self) { i in
                        Circle()
                            .fill(i < entry.done ? accent : Color.gray.opacity(0.35))
                            .frame(width: 8, height: 8)
                    }
                    Text("\(entry.done)/\(entry.total)")
                        .font(.caption2)
                        .foregroundColor(entry.done >= entry.total ? accent : .secondary)
                    if entry.done >= entry.total {
                        Text("完遂🎉").font(.caption2).foregroundColor(accent)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(14)
        .klContainerBackground()
    }
}

// iOS 17のcontainerBackground必須化に両対応
extension View {
    @ViewBuilder func klContainerBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            self.containerBackground(for: .widget) { Color(red: 0.055, green: 0.063, blue: 0.075) }
        } else {
            self.background(Color(red: 0.055, green: 0.063, blue: 0.075))
        }
    }
    // ロック画面ウィジェット用(背景はシステム任せ=透明)
    @ViewBuilder func klAccessoryBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            self.containerBackground(for: .widget) { Color.clear }
        } else {
            self
        }
    }
}

struct KLTodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "KLTodayWidget", provider: KLTodayProvider()) { entry in
            KLTodayWidgetView(entry: entry)
        }
        .configurationDisplayName("今日のメニュー")
        .description("今日のトレーニングと進捗をひと目で。")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
    }
}
