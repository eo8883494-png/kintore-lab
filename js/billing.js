/* ===== 課金 (RevenueCat / @revenuecat/purchases-capacitor@7) =====
 * ビルド無し方針のため、npmラッパーをimportせず Capacitor が登録する
 * 生プラグイン window.Capacitor.Plugins.PurchasesPlugin を直接叩く
 * (cloud.js が FirebaseAuthentication を叩くのと同じ流儀)。
 * Web / プラグイン未導入では全て安全に no-op。
 *
 * 前提のネイティブ側セットアップ(Mac・native/ios/README.md 参照):
 *   1) npm i @revenuecat/purchases-capacitor@7 && npx cap sync
 *   2) 下の RC_API_KEY_IOS / RC_API_KEY_ANDROID を RevenueCat の
 *      「APIキー(Public app-specific)」に差し替え
 *   3) RevenueCat で Entitlement 'pro' と Offering(annual/monthly)を作成
 *   4) App Store Connect で product `kintorelab_yearly` / `kintorelab_monthly`
 *      (7日 introductory free trial 付き)を作成し RevenueCat に紐付け
 * app.js の isPro()/S.pro をエンタイトルメントのキャッシュとして更新する。
 */
(function () {
  'use strict';

  // ▼▼ 差し替え必須(RevenueCat ダッシュボード → Project → API keys)▼▼
  const RC_API_KEY_IOS = 'appl_REPLACE_WITH_REVENUECAT_IOS_PUBLIC_KEY';
  const RC_API_KEY_ANDROID = 'goog_REPLACE_WITH_REVENUECAT_ANDROID_PUBLIC_KEY';
  // ▲▲ ここまで ▲▲

  const ENTITLEMENT_ID = 'pro'; // RevenueCat の Entitlement 識別子

  let configured = false;
  let lastOffering = null;   // 直近 getOfferings の current(購入時にパッケージ本体を引く)
  let listenerBound = false;

  function native() {
    try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
    catch (e) { return false; }
  }
  function plugin() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PurchasesPlugin) || null;
  }
  function platformKey() {
    try {
      const p = (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform()) || 'ios';
      return p === 'android' ? RC_API_KEY_ANDROID : RC_API_KEY_IOS;
    } catch (e) { return RC_API_KEY_IOS; }
  }
  function keyLooksReal(k) { return typeof k === 'string' && k.length > 12 && !/REPLACE_WITH/.test(k); }

  // エンタイトルメントを app.js 側に反映(true/false 両方向 = 解約で失効も反映)
  function applyEntitlement(active) {
    try {
      if (window.__klPro && window.__klPro.setEntitlement) window.__klPro.setEntitlement(!!active);
    } catch (e) { /* no-op */ }
  }
  function entitledFrom(customerInfo) {
    try {
      const act = customerInfo && customerInfo.entitlements && customerInfo.entitlements.active;
      return !!(act && act[ENTITLEMENT_ID]);
    } catch (e) { return false; }
  }

  // ===== 公開 API =====

  // 起動時に一度だけ(ネイティブのみ)。キー未設定なら黙って何もしない=Web挙動を維持
  async function configure() {
    if (configured || !native()) return false;
    const P = plugin();
    const key = platformKey();
    if (!P || !P.configure || !keyLooksReal(key)) return false;
    try {
      await P.configure({ apiKey: key });
      configured = true;
      // 課金情報の更新を購読(別端末での購入/解約・トライアル満了→自動課金を追従)
      if (!listenerBound && P.addListener) {
        try {
          P.addListener('customerInfoUpdate', (info) => {
            applyEntitlement(entitledFrom(info && info.customerInfo ? info.customerInfo : info));
          });
          listenerBound = true;
        } catch (e) { /* リスナ非対応でも致命ではない */ }
      }
      return true;
    } catch (e) { console.warn('[billing] configure failed', e); return false; }
  }

  // 現在の課金状態を取得して S.pro を同期。起動・復帰時に呼ぶ
  async function refreshEntitlement() {
    if (!configured) { const ok = await configure(); if (!ok) return null; }
    const P = plugin();
    if (!P || !P.getCustomerInfo) return null;
    try {
      const res = await P.getCustomerInfo();
      const info = res && res.customerInfo ? res.customerInfo : res;
      const active = entitledFrom(info);
      applyEntitlement(active);
      return active;
    } catch (e) { console.warn('[billing] refreshEntitlement failed', e); return null; }
  }

  // ペイウォール用: 実際の Offering から価格入りプラン配列を返す。取れなければ null(=UIは既定文言)
  async function getPlans() {
    if (!configured) { const ok = await configure(); if (!ok) return null; }
    const P = plugin();
    if (!P || !P.getOfferings) return null;
    try {
      const res = await P.getOfferings();
      const cur = res && res.current ? res.current : (res && res.all && Object.values(res.all)[0]);
      if (!cur || !Array.isArray(cur.availablePackages)) return null;
      lastOffering = cur;
      const typeToId = { ANNUAL: 'annual', MONTHLY: 'monthly' };
      const plans = cur.availablePackages.map(pkg => {
        const t = pkg.packageType || '';
        const id = typeToId[t] || (pkg.identifier || '').toLowerCase();
        const prod = pkg.product || {};
        return {
          id,
          packageId: pkg.identifier,
          price: prod.priceString || '',
          period: t,
        };
      }).filter(p => p.id === 'annual' || p.id === 'monthly');
      return plans.length ? plans : null;
    } catch (e) { console.warn('[billing] getOfferings failed', e); return null; }
  }

  // 購入。planId = 'annual' | 'monthly'。戻り: {ok} / {cancelled} / {error}
  async function purchase(planId) {
    if (!native() || !configured) return { error: 'not_ready' };
    const P = plugin();
    if (!P || !P.purchasePackage) return { error: 'not_ready' };
    // Offering 未取得なら取りに行く
    if (!lastOffering) { await getPlans(); }
    if (!lastOffering) return { error: 'no_offering' };
    const typeToId = { ANNUAL: 'annual', MONTHLY: 'monthly' };
    const pkg = (lastOffering.availablePackages || []).find(p => (typeToId[p.packageType] || '') === planId)
      || (lastOffering.availablePackages || [])[0];
    if (!pkg) return { error: 'no_package' };
    try {
      const res = await P.purchasePackage({ aPackage: pkg });
      const info = res && res.customerInfo ? res.customerInfo : res;
      const active = entitledFrom(info);
      applyEntitlement(active);
      return { ok: active };
    } catch (e) {
      if (e && (e.userCancelled || e.code === '1' || /cancel/i.test(e.message || ''))) return { cancelled: true };
      console.warn('[billing] purchase failed', e);
      return { error: (e && e.message) || 'purchase_failed' };
    }
  }

  // 購入復元(機種変更・再インストール時)
  async function restore() {
    if (!native() || !configured) { const ok = await configure(); if (!ok) return { error: 'not_ready' }; }
    const P = plugin();
    if (!P || !P.restorePurchases) return { error: 'not_ready' };
    try {
      const res = await P.restorePurchases();
      const info = res && res.customerInfo ? res.customerInfo : res;
      const active = entitledFrom(info);
      applyEntitlement(active);
      return { ok: active };
    } catch (e) { console.warn('[billing] restore failed', e); return { error: (e && e.message) || 'restore_failed' }; }
  }

  // ネイティブ課金が実際に使えるか(ペイウォールCTAの出し分け用)
  function ready() { return native() && !!plugin() && keyLooksReal(platformKey()); }

  window.__klBilling = { configure, refreshEntitlement, getPlans, purchase, restore, ready };
})();
