// 筋トレLAB — KLWatchプラグインのCapacitor登録(Appターゲットに追加)
#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(KLWatchPlugin, "KLWatch",
  CAP_PLUGIN_METHOD(updateWatchData, CAPPluginReturnPromise);
)
