// 筋トレLAB — ウィジェットバンドル(KintoreWidgetターゲットのエントリポイント)
// ⚠️ Xcodeがテンプレートで生成した ○○Bundle.swift / ○○.swift / ○○LiveActivity.swift は削除し、
//    このフォルダの3ファイル(+Shared/KLTimerAttributes.swift)に置き換えること
import WidgetKit
import SwiftUI

@main
struct KLWidgetBundle: WidgetBundle {
    var body: some Widget {
        KLTodayWidget()
        if #available(iOS 16.1, *) {
            KLTimerLiveActivity()
        }
    }
}
