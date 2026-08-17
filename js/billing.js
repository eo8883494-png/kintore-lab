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
  const RC_API_KEY_IOS = 'appl_OzSSiamGbsTIqjxDRBTAfxmGjOi';
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
    const P = (window.Capacitor && window.Capacitor.Plugins) || null;
    if (!P) return null;
    // RevenueCat Capacitorプラグインの登録名は環境/版で異なり得るため、
    // 既知候補名→名前にpurchase/revenueを含むもの、の順で自動検出する。
    const names = ['PurchasesPlugin', 'Purchases', 'CapacitorPurchases', 'RevenueCat', 'RevenueCatPurchases'];
    for (let i = 0; i < names.length; i++) { if (P[names[i]]) return P[names[i]]; }
    const keys = Object.keys(P);
    for (let i = 0; i < keys.length; i++) { if (/purchase|revenue/i.test(keys[i])) return P[keys[i]]; }
    return null;
  }
  // 診断用: なぜ ready() が false かを人間可読で返す(トーストに出して原因特定)
  function diag() {
    const P = (window.Capacitor && window.Capacitor.Plugins) || {};
    return 'native=' + native() + ' key=' + keyLooksReal(platformKey()) + ' plugin=' + !!plugin() + ' [' + Object.keys(P).join(',') + ']';
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
      if (!act) return false;
      // 'pro' を優先。ただし本アプリはPro単一ティア(全商品が同じProを付与)なので、
      // Entitlement識別子が何であれ(例: RevenueCatで「筋トレLAB Pro」と命名)、
      // 有効なEntitlementが1つでもあればPro扱いにして取りこぼしを防ぐ。
      if (act[ENTITLEMENT_ID]) return true;
      return Object.keys(act).length > 0;
    } catch (e) { return false; }
  }

  // パッケージ → 'annual' | 'monthly' | その他。packageType が CUSTOM の構成でも
  // identifier($rc_annual / annual 等)から解決できるようにする。
  // getPlans と purchase は必ずこの同一関数で照合すること(食い違うと誤プラン課金になる)。
  function planIdOf(pkg) {
    const typeToId = { ANNUAL: 'annual', MONTHLY: 'monthly' };
    if (pkg && typeToId[pkg.packageType]) return typeToId[pkg.packageType];
    const id = String((pkg && pkg.identifier) || '').toLowerCase().replace(/^\$rc_/, '');
    if (id === 'annual' || id === 'yearly') return 'annual';
    if (id === 'monthly') return 'monthly';
    return id;
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
      await syncUser();          /* 匿名IDのままにしない。詳細は syncUser のコメント */
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
    } catch (e) {
      console.warn('[billing] configure failed', e);
      lastDiag = { stage: 'configure例外', error: errText(e) };
      return false;
    }
  }

  /* ===== 誰として買ったかを、端末ではなくアカウントに紐づける =====
     configure だけだと RevenueCat は「匿名ID」を作る。この匿名IDは
     **インストールごとに作り直される**ので、機種変して入れ直すと別人になり、
     前の権利に二度と届かない(Appleの購入履歴が同じでも復元できない)。
     実際に 2026-08-17 にこれが起きた: 旧端末 $RCA…b1d8 に付いていた
     オファーコード(friend-free-1y)の年額1年が、新端末 $RCA…5adb からは見えず、
     「購入を復元」も効かず、代わりに7日トライアルが新規に始まってしまった。
     復旧はダッシュボードから手で Transfer する以外に無かった。

     Firebase のログインがあるなら、その uid を RevenueCat の App User ID にする。
     こうすると別端末でも同じ人として扱われ、復元が普通に効く。
     ログインしていない間は匿名のまま(ログインを強制はしない)。 */
  let lastUid = null;
  async function syncUser() {
    if (!configured) return;
    const P = plugin(); if (!P) return;
    let uid = null;
    try { uid = (window.__klCloud && window.__klCloud.myUid && window.__klCloud.myUid()) || null; } catch (e) {}
    if (uid === lastUid) return;                 /* 変化なしは触らない */
    try {
      if (uid) {
        if (P.logIn) await P.logIn({ appUserID: uid });   /* 匿名で買った分はここで統合される */
      } else if (lastUid && P.logOut) {
        await P.logOut();                        /* サインアウト時だけ匿名に戻す */
      }
      lastUid = uid;
      await refreshEntitlement();                /* 付け替えた直後の状態を反映 */
    } catch (e) {
      console.warn('[billing] syncUser failed', e);
      lastDiag = { stage: 'logIn失敗', error: errText(e) };
    }
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

  // no_offering の原因特定用。どの段階で落ちたかを記録し、ペイウォールの診断から見られるようにする
  let lastDiag = { stage: 'init' };
  // エラー詳細を全部拾う(code/message だけだと underlyingError が切れて原因が読めない)
  function errText(e) {
    if (!e) return 'unknown';
    const parts = [];
    ['code', 'message', 'underlyingErrorMessage', 'readableErrorCode'].forEach(k => { if (e[k]) parts.push(k + '=' + e[k]); });
    if (!parts.length) { try { parts.push(JSON.stringify(e)); } catch (_) { parts.push(String(e)); } }
    return parts.join(' | ').slice(0, 600);
  }
  // 切り分け用: RevenueCatのOffering設定を介さず、商品IDを直接StoreKitに問い合わせる。
  // ここでも0件なら Apple側(商品状態/伝播/障害)、ここで取れるならRevenueCatのOffering設定が原因。
  async function probeProducts() {
    if (!configured) { const ok = await configure(); if (!ok) return 'configure失敗'; }
    const P = plugin();
    if (!P || !P.getProducts) return 'getProducts非対応';
    try {
      // v2 = 2026-07-29作り直し(旧yearly/monthlyはApple側で壊れ「ご利用いただけません」のまま)
      const res = await P.getProducts({ productIdentifiers: ['kintorelab_yearly2', 'kintorelab_monthly2'] });
      const list = (res && res.products) || [];
      if (!list.length) return '0件(StoreKitが商品を返さない=Apple側)';
      return list.map(p => (p.identifier || p.productIdentifier) + '=' + (p.priceString || '?')).join(', ');
    } catch (e) { return '例外: ' + errText(e); }
  }
  // ペイウォール用: 実際の Offering から価格入りプラン配列を返す。取れなければ null(=UIは既定文言)
  async function getPlans() {
    if (!configured) { const ok = await configure(); if (!ok) { lastDiag = { stage: 'configure失敗' }; return null; } }
    const P = plugin();
    if (!P || !P.getOfferings) { lastDiag = { stage: 'プラグイン無し' }; return null; }
    try {
      const res = await P.getOfferings();
      const allIds = res && res.all ? Object.keys(res.all) : [];
      const cur = res && res.current ? res.current : (res && res.all && Object.values(res.all)[0]);
      if (!cur || !Array.isArray(cur.availablePackages)) {
        // current が無い最頻の原因: どの商品も StoreKit から取得できず、Offering が空扱いになる
        // (RevenueCat は「App Store から商品を取得できない」時にこうなる)
        lastDiag = { stage: 'offering空', all: allIds.join(',') || '(0件)', current: !!(res && res.current) };
        return null;
      }
      lastDiag = { stage: 'OK', current: cur.identifier, pkgs: (cur.availablePackages || []).map(p => (p.product && (p.product.identifier || p.product.productIdentifier)) || p.identifier).join(',') };
      lastOffering = cur;
      const plans = cur.availablePackages.map(pkg => {
        const t = pkg.packageType || '';
        const id = planIdOf(pkg);
        const prod = pkg.product || {};
        // ⚠️ introPrice は「商品に導入オファーが設定されているか」でしかなく、
        //    このApple IDが使えるかは分からない(常にtrueになる)。資格は別APIで確認する。
        return {
          id,
          packageId: pkg.identifier,
          productId: (prod.identifier || prod.productIdentifier || ''),
          price: prod.priceString || '',
          period: t,
          trialEligible: null,   // 不明。checkTrialEligibility() で後から確定させる
        };
      }).filter(p => p.id === 'annual' || p.id === 'monthly');
      return plans.length ? plans : null;
    } catch (e) {
      console.warn('[billing] getOfferings failed', e);
      lastDiag = { stage: 'getOfferings例外', error: errText(e) };
      return null;
    }
  }

  // このApple IDが無料トライアルを使えるか確認する。
  // 戻り: true(使える) / false(消化済み等で使えない) / null(判定できない)
  // ※ 商品側の introPrice は「オファーが設定されているか」でしかなく資格判定にならない
  async function checkTrialEligibility(productIds) {
    const P = plugin();
    if (!P || !P.checkTrialOrIntroductoryPriceEligibility || !productIds || !productIds.length) return null;
    try {
      const res = await P.checkTrialOrIntroductoryPriceEligibility({ productIdentifiers: productIds });
      const map = (res && (res.eligibility || res)) || {};
      const vals = productIds.map(id => map[id]).filter(Boolean);
      if (!vals.length) return null;
      const statusOf = v => String((v && (v.status || v.eligibilityStatus)) != null ? (v.status || v.eligibilityStatus) : v).toUpperCase();
      if (vals.some(v => statusOf(v).includes('ELIGIBLE') && !statusOf(v).includes('INELIGIBLE'))) return true;
      if (vals.every(v => statusOf(v).includes('INELIGIBLE'))) return false;
      return null;
    } catch (e) { console.warn('[billing] trial eligibility failed', e); return null; }
  }

  // 購入。planId = 'annual' | 'monthly'。戻り: {ok} / {cancelled} / {error}
  async function purchase(planId) {
    if (!native() || !configured) return { error: 'not_ready' };
    const P = plugin();
    if (!P || !P.purchasePackage) return { error: 'not_ready' };
    // Offering 未取得なら取りに行く
    if (!lastOffering) { await getPlans(); }
    if (!lastOffering) return { error: 'no_offering' };
    // ⚠️ 一致するパッケージが無いときに先頭へフォールバックしてはいけない
    //    (月額を選んだのに年額を課金する事故になる)。見つからなければ購入しない。
    const pkg = (lastOffering.availablePackages || []).find(p => planIdOf(p) === planId);
    if (!pkg) return { error: 'no_package' };
    try {
      const res = await P.purchasePackage({ aPackage: pkg });
      const info = res && res.customerInfo ? res.customerInfo : res;
      const active = entitledFrom(info);
      applyEntitlement(active);
      // 決済は通ったがエンタイトルメント反映が遅れている場合(検証遅延・承認待ち)は
      // 「失敗」ではなく保留として返す(再購入を促さないため)
      return active ? { ok: true } : { ok: false, pending: true };
    } catch (e) {
      if (e && (e.userCancelled || e.code === '1' || /cancel/i.test(e.message || ''))) return { cancelled: true };
      console.warn('[billing] purchase failed', e);
      // コードとメッセージを両方返す。表示側でそのまま出せば、失敗の原因が
      // ストア側(例: レシート検証)なのか設定なのかを実機だけで切り分けられる
      const parts = [e && e.code, e && e.message].filter(Boolean);
      return { error: parts.join(': ') || 'purchase_failed' };
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

  window.__klBilling = { configure, refreshEntitlement, getPlans, purchase, restore, ready, diag, checkTrialEligibility, lastDiag: () => lastDiag, probeProducts, syncUser };
})();
