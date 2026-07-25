// 筋トレLAB Watch — ワークアウトセッション(HealthKit)
// 開始するとAppleの「ワークアウト」として記録され、心拍数の取得+アクティビティリングへの加算が行われる。
// 種別=筋力トレーニング(traditionalStrengthTraining)・屋内。
// ⚠️ KintoreWatchターゲットに HealthKit capability と
//    Info.plist の NSHealthShareUsageDescription / NSHealthUpdateUsageDescription が必要(README参照)
import Foundation
import HealthKit

final class WorkoutManager: NSObject, ObservableObject {
    static let shared = WorkoutManager()
    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    @Published var active = false
    @Published var heartRate: Double = 0
    @Published var kcal: Double = 0
    @Published var startedAt: Date? = nil
    @Published var lastError: String? = nil   // 権限拒否・開始失敗をUIに出す(無反応を防ぐ)

    func requestAuth(_ done: @escaping (Bool) -> Void) {
        guard HKHealthStore.isHealthDataAvailable() else {
            DispatchQueue.main.async { self.lastError = "この端末ではヘルスケアを利用できません" }
            done(false); return
        }
        // 強制アンラップはしない(nilならクラッシュせずエラー表示にする)
        var share: Set<HKSampleType> = [HKObjectType.workoutType()]
        var read: Set<HKObjectType> = []
        if let energy = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
            share.insert(energy); read.insert(energy)
        }
        if let hr = HKQuantityType.quantityType(forIdentifier: .heartRate) { read.insert(hr) }
        store.requestAuthorization(toShare: share, read: read) { ok, _ in
            DispatchQueue.main.async {
                if !ok { self.lastError = "ヘルスケアの許可が必要です(Watchの設定→プライバシー→ヘルスケア)" }
                done(ok)
            }
        }
    }

    func start() {
        guard !active else { return }
        requestAuth { ok in
            guard ok else { return }   // 理由は requestAuth 内で lastError にセット済み
            DispatchQueue.main.async { self.lastError = nil }
            let cfg = HKWorkoutConfiguration()
            cfg.activityType = .traditionalStrengthTraining
            cfg.locationType = .indoor
            do {
                let s = try HKWorkoutSession(healthStore: self.store, configuration: cfg)
                let b = s.associatedWorkoutBuilder()
                b.dataSource = HKLiveWorkoutDataSource(healthStore: self.store, workoutConfiguration: cfg)
                s.delegate = self
                b.delegate = self
                self.session = s
                self.builder = b
                let start = Date()
                s.startActivity(with: start)
                b.beginCollection(withStart: start) { _, _ in }
                DispatchQueue.main.async {
                    self.active = true
                    self.startedAt = start
                    self.heartRate = 0
                    self.kcal = 0
                }
            } catch {
                // 無反応だとユーザーは壊れたと感じるので必ず理由を出す
                DispatchQueue.main.async { self.lastError = "ワークアウトを開始できませんでした" }
            }
        }
    }

    func end() {
        session?.end()
    }
}

extension WorkoutManager: HKWorkoutSessionDelegate {
    func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
        if toState == .ended {
            builder?.endCollection(withEnd: date) { _, _ in
                self.builder?.finishWorkout { _, _ in
                    DispatchQueue.main.async {
                        self.active = false
                        self.startedAt = nil
                        self.session = nil
                        self.builder = nil
                    }
                }
            }
        }
    }
    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        DispatchQueue.main.async { self.active = false; self.startedAt = nil }
    }
}

extension WorkoutManager: HKLiveWorkoutBuilderDelegate {
    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        for t in collectedTypes {
            guard let qt = t as? HKQuantityType, let stats = workoutBuilder.statistics(for: qt) else { continue }
            DispatchQueue.main.async {
                switch qt.identifier {
                case HKQuantityTypeIdentifier.heartRate.rawValue:
                    let bpm = stats.mostRecentQuantity()?.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
                    if let bpm = bpm { self.heartRate = bpm }
                case HKQuantityTypeIdentifier.activeEnergyBurned.rawValue:
                    let sum = stats.sumQuantity()?.doubleValue(for: .kilocalorie())
                    if let sum = sum { self.kcal = sum }
                default: break
                }
            }
        }
    }
    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
}
