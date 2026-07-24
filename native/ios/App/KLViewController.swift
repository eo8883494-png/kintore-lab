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
        // Watch連携を組み込む時は KLWatchPlugin.swift をAppターゲットに追加した上で
        // 次の行のコメントを外す:
        // bridge?.registerPluginInstance(KLWatchPlugin())
    }
}
