// 筋トレLAB — KLNativeプラグインのCapacitor登録(Appターゲットに追加)
#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(KLNativePlugin, "KLNative",
  CAP_PLUGIN_METHOD(startTimerActivity, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(endTimerActivity, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(updateTimerActivity, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(updateWidget, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(requestReview, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(setBadge, CAPPluginReturnPromise);
)
