// 筋トレLAB — カスタムプラグインの手動登録(Appターゲットに追加)
// Capacitor 6以降、アプリ内カスタムプラグインは自動登録されない(公式仕様)。
// CAPBridgeViewController を継承したこのVCで registerPluginInstance する。
// ⚠️ Main.storyboard の View Controller の Custom Class を
//    CAPBridgeViewController → KLViewController に変更すること(Identity Inspector)。
import UIKit
import Capacitor

class KLViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(KLNativePlugin())
        // ⚠️ KLWatchPlugin.swift をAppターゲットに追加していない場合はこの行を消すこと(ビルドが通らない)
        bridge?.registerPluginInstance(KLWatchPlugin())
    }
}
