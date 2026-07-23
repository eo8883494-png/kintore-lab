// 筋トレLAB Watch — メイン画面(今日のメニュー+タップでセット完了+手首の休憩タイマー)
import SwiftUI
import WatchKit

struct ContentView: View {
    @ObservedObject var ws = WatchSession.shared
    @State private var restRemain: Int = 0
    @State private var restLabel: String = ""
    @State private var restTimer: Timer? = nil
    private let accent = Color(red: 0.78, green: 0.95, blue: 0.31)

    var body: some View {
        if restRemain > 0 {
            // 休憩タイマー(全画面)
            VStack(spacing: 4) {
                Text(restLabel)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                Text("\(restRemain)")
                    .font(.system(size: 56, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundColor(accent)
                Text("秒休憩")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                Button("スキップ") { stopRest() }
                    .font(.caption)
                    .tint(.gray)
            }
        } else {
            List {
                Section {
                    ForEach(ws.menu.items) { it in
                        Button { tapped(it) } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(it.name).font(.body).lineLimit(1)
                                    Text("\(it.reps)回 × \(it.sets)セット")
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                                Text(it.done >= it.sets ? "✓" : "\(it.done)/\(it.sets)")
                                    .font(.headline)
                                    .monospacedDigit()
                                    .foregroundColor(it.done >= it.sets ? accent : .primary)
                            }
                        }
                    }
                } header: {
                    Text(ws.menu.title).font(.caption2)
                }
                if ws.menu.items.isEmpty {
                    Text("今日は休息日 😴\n(またはiPhoneでアプリを開いて同期)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
    }

    // 行タップ = 1セット完了 → iPhoneへ送信 → 休憩タイマー開始(満了時は成功ハプティクス)
    private func tapped(_ it: KLItem) {
        guard it.done < it.sets else { return }
        let newCount = it.done + 1
        WatchSession.shared.sendSetDone(exId: it.exId, count: newCount)
        if let idx = WatchSession.shared.menu.items.firstIndex(where: { $0.exId == it.exId }) {
            WatchSession.shared.menu.items[idx].done = newCount // 楽観更新(iPhone側の正が後で届く)
        }
        if newCount >= it.sets {
            WKInterfaceDevice.current().play(.success)
        } else {
            WKInterfaceDevice.current().play(.click)
            startRest(sec: it.rest, label: it.name)
        }
    }

    private func startRest(sec: Int, label: String) {
        restRemain = max(1, sec)
        restLabel = label + " の休憩"
        restTimer?.invalidate()
        restTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            restRemain -= 1
            if restRemain == 3 { WKInterfaceDevice.current().play(.directionUp) }
            if restRemain <= 0 {
                WKInterfaceDevice.current().play(.notification)
                stopRest()
            }
        }
    }

    private func stopRest() {
        restTimer?.invalidate()
        restTimer = nil
        restRemain = 0
    }
}
