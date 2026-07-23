// 筋トレLAB — 端末間同期 (Firebase / Google Sign-In)
// 専用 Firebase プロジェクト(kintore-lab)。データは /kintoreLab/{uid} に保存。
// ルールは本人のみ読み書き可 (auth.uid === $uid)。
// ログインは任意: 未ログインでもアプリは完全にローカルで動く。ここは「あれば同期する」追加層。
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getDatabase, ref, set, get, onValue, remove, query, orderByChild, limitToLast, equalTo, update } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";
import {
  getAuth, GoogleAuthProvider, OAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signInWithCredential, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging.js";

const VAPID_KEY = "BO4Smn0zkWu-S04O0uB82JVf9dDYkM5RonKKnnD6DD1Ez8-wouj_gJi_TGbMnhHZNcx1IXYphpXEk1trrkmgC8U";

const firebaseConfig = {
  apiKey: "AIzaSyB6cNjUGULa4Nkikb8z66eCWwYCTZTQ_T4",
  authDomain: "kintore-lab.firebaseapp.com",
  databaseURL: "https://kintore-lab-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "kintore-lab",
  storageBucket: "kintore-lab.firebasestorage.app",
  messagingSenderId: "1082300556359",
  appId: "1:1082300556359:web:53c260a798259ca8dabd62",
  measurementId: "G-DXJS557V3X"
};

let app, db, auth;
try {
  app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  auth = getAuth(app);
} catch (e) {
  console.warn('[cloud] Firebase init failed — 同期は無効、ローカルのみで動作します', e);
}

// この端末を識別するID (通知トークンを端末ごとに1件で管理する)
function deviceId() {
  let id = localStorage.getItem('kintoreLab.deviceId');
  if (!id) { id = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('kintoreLab.deviceId', id); }
  return id;
}

// このタブ固有のトークン (自分の書き込みエコーを無視するため)
const originToken = 'kl_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
let currentUser = null;
let unsub = null;          // onValue 解除関数
let pushTimer = null;
let lastUpdatedAt = 0;     // 直近に採用した _updatedAt
let syncing = false;
let lastSyncLabel = '';

// 同期する状態は /state に置く (通知トークン /pushTokens を state の set() で消さないため)
function uidRef(uid) { return ref(db, 'kintoreLab/' + uid + '/state'); }
function tokenRef(uid) { return ref(db, 'kintoreLab/' + uid + '/pushTokens/' + deviceId()); }

function nowLabel() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// クラウドへ書き込み (メタ付き)
function writeCloud(state, updatedAt) {
  if (!currentUser || !db) return Promise.resolve();
  const payload = { ...state, _origin: originToken, _updatedAt: updatedAt };
  syncing = true;
  refreshUI();
  return set(uidRef(currentUser.uid), payload)
    .then(() => { lastUpdatedAt = updatedAt; lastSyncLabel = nowLabel(); })
    .catch(err => { console.warn('[cloud] write failed', err); })
    .finally(() => { syncing = false; refreshUI(); });
}

// ローカル変更 → デバウンスしてクラウドへ (saveState から呼ばれる)
function push() {
  if (!currentUser || !db) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const state = window.__klGetState && window.__klGetState();
    if (state) writeCloud(state, Date.now());
  }, 1500);
}

// クラウドの変更を受信して統合
function handleRemote(payload) {
  if (!payload || typeof payload !== 'object') return;
  if (payload._origin === originToken) return;         // 自分の書き込みエコー
  const rt = Number(payload._updatedAt) || 0;
  const remoteState = { ...payload, _updatedAt: rt };
  const res = window.__klApplyRemote && window.__klApplyRemote(remoteState);
  if (!res) return;
  lastUpdatedAt = Math.max(lastUpdatedAt, rt);
  lastSyncLabel = nowLabel();
  // 統合でローカルの追加分が入った → クラウドへ書き戻す (相手にも反映)。
  // _updatedAt は max を使い、Date.now を使わないことで ping-pong を防ぐ
  if (res.changed) writeCloud(res.state, Math.max(rt, lastUpdatedAt) + 1);
  refreshUI();
}

function startListening(uid) {
  if (unsub) { unsub(); unsub = null; }
  unsub = onValue(uidRef(uid), snap => handleRemote(snap.val()));
}

// ログイン確定時: クラウドと初回マージ → 書き戻し → リッスン開始
async function onLogin(user) {
  currentUser = user;
  refreshUI();
  if (!db) return;
  try {
    syncing = true; refreshUI();
    let snap = await get(uidRef(user.uid));
    let payload = snap.exists() ? snap.val() : null;
    // 旧パス(/kintoreLab/{uid} 直下に state を置いていた版)からの移行
    if (!payload) {
      const legacy = await get(ref(db, 'kintoreLab/' + user.uid));
      const lv = legacy.exists() ? legacy.val() : null;
      if (lv && Array.isArray(lv.logs)) payload = lv; // 旧形式(直下に logs を持つ)なら採用
    }
    if (payload) {
      const rt = Number(payload._updatedAt) || 0;
      const res = window.__klApplyRemote(({ ...payload, _updatedAt: rt }));
      lastUpdatedAt = rt;
      // ローカルにクラウドへ未反映の分があれば書き戻す
      if (res && res.changed) await writeCloud(res.state, Date.now());
    } else {
      // クラウド未作成 → 今のローカルを初期データとして保存
      const state = window.__klGetState();
      await writeCloud(state, Date.now());
    }
    lastSyncLabel = nowLabel();
  } catch (e) {
    console.warn('[cloud] initial sync failed', e);
  } finally {
    syncing = false;
    startListening(user.uid);
    if (reminder.enabled) syncTokenRecord().catch(() => {}); // 通知ONならトークンを最新化
    refreshUI();
  }
}

function onLogout() {
  currentUser = null;
  if (unsub) { unsub(); unsub = null; }
  clearTimeout(pushTimer);
  refreshUI();
}

function refreshUI() { if (window.__klOnAuth) window.__klOnAuth(); }

// ===== プッシュ通知 (FCM) =====
// ローカルに保持するリマインダー設定 (端末ごと)
let reminder = loadReminderPref();
let messaging = null;
let swReg = null;
let fcmToken = null;

function loadReminderPref() {
  try { return { enabled: false, hour: 19, ...(JSON.parse(localStorage.getItem('kintoreLab.reminder') || '{}')) }; }
  catch (e) { return { enabled: false, hour: 19 }; }
}
function saveReminderPref() { try { localStorage.setItem('kintoreLab.reminder', JSON.stringify(reminder)); } catch (e) {} }

async function ensureMessaging() {
  if (messaging) return messaging;
  if (!app) return null;
  try { if (!(await isSupported())) return null; } catch (e) { return null; }
  try { messaging = getMessaging(app); } catch (e) { return null; }
  // 前面表示中に届いたら軽く知らせる
  try {
    onMessage(messaging, payload => {
      const d = (payload && (payload.notification || payload.data)) || {};
      if (window.toast) window.toast('🔔 ' + (d.title || '筋トレLAB') + ': ' + (d.body || 'トレの時間です'));
    });
  } catch (e) {}
  return messaging;
}

async function getFcmToken() {
  const m = await ensureMessaging();
  if (!m) throw new Error('この端末は通知に対応していません');
  if (!swReg) swReg = await navigator.serviceWorker.register('firebase-messaging-sw.js');
  await navigator.serviceWorker.ready;
  fcmToken = await getToken(m, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
  return fcmToken;
}

// トークン記録を /kintoreLab/{uid}/pushTokens/{deviceId} に保存
async function syncTokenRecord() {
  if (!currentUser || !db) return;
  if (!fcmToken) { try { await getFcmToken(); } catch (e) { return; } }
  const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Asia/Tokyo';
  await set(tokenRef(currentUser.uid), {
    token: fcmToken, hour: reminder.hour, tz,
    enabled: !!reminder.enabled, updatedAt: Date.now(),
  });
}

async function enableReminders(hour) {
  if (!currentUser) { alert('通知を使うにはまずGoogleでログインしてください。'); return { ok: false, reason: 'login' }; }
  if (!('Notification' in window)) { alert('この端末は通知に対応していません。'); return { ok: false, reason: 'unsupported' }; }
  let perm = Notification.permission;
  if (perm !== 'granted') perm = await Notification.requestPermission();
  if (perm !== 'granted') { return { ok: false, reason: 'denied' }; }
  reminder.enabled = true;
  if (typeof hour === 'number') reminder.hour = hour;
  saveReminderPref();
  try {
    await getFcmToken();
    await syncTokenRecord();
  } catch (e) {
    console.warn('[cloud] enableReminders failed', e);
    reminder.enabled = false; saveReminderPref();
    return { ok: false, reason: 'token', message: e.message };
  }
  refreshUI();
  return { ok: true };
}

async function disableReminders() {
  reminder.enabled = false;
  saveReminderPref();
  try { if (currentUser && db) await set(tokenRef(currentUser.uid), { token: fcmToken || '', hour: reminder.hour, enabled: false, updatedAt: Date.now() }); } catch (e) {}
  refreshUI();
  return { ok: true };
}

async function setReminderHour(hour) {
  reminder.hour = hour; saveReminderPref();
  if (reminder.enabled) { try { await syncTokenRecord(); } catch (e) {} }
  refreshUI();
}

// ===== みんなのメニュー(公開ギャラリー) =====
// 公開データは /kintoreLab/publicMenus/{id} に置く(誰でも読める・本人だけ書ける)。
// リンクは主要SNSのみ(サーバー側=Firebaseルールでも検証)。
function pubMenusRef() { return ref(db, 'kintoreLab/publicMenus'); }
function pubMenuRef(id) { return ref(db, 'kintoreLab/publicMenus/' + id); }

// menu: { pubId?, name, items:[{exId,name,part,sets,reps,rest}] }。link/platformは呼び出し側で検証済み前提
// extra: { icon, appeal } アイコン絵文字と自己アピール文(任意)
async function publishMenu(menu, link, platform, displayName, extra) {
  if (!currentUser || !db) return { ok: false, reason: 'login' };
  extra = extra || {};
  const id = menu.pubId || (currentUser.uid + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const payload = {
    uid: currentUser.uid,
    displayName: (displayName || currentUser.displayName || 'ユーザー').slice(0, 30),
    name: String(menu.name || '').slice(0, 40),
    icon: String(extra.icon || '').slice(0, 8),
    appeal: String(extra.appeal || '').slice(0, 120),
    items: (menu.items || []).slice(0, 15).map(it => ({
      exId: String(it.exId || '').slice(0, 60),
      name: String(it.name || '').slice(0, 40),
      part: String(it.part || '').slice(0, 20),
      sets: Number(it.sets) || 3,
      reps: String(it.reps || '').slice(0, 20),
      rest: Number(it.rest) || 90,
    })),
    link: link ? String(link).slice(0, 300) : '',
    platform: platform ? String(platform).slice(0, 20) : '',
    createdAt: Date.now(),
  };
  // 画像アバターは値がある時だけ含める(ルールにavatar検証が無くても公開が通るように)
  const avatar = String(extra.avatar || '').slice(0, 24000);
  if (avatar) payload.avatar = avatar;
  try { await set(pubMenuRef(id), payload); return { ok: true, id }; }
  catch (e) {
    // avatar付きで弾かれたら avatar 無しで再試行(ルール未反映でも必ず公開できるよう保険)
    if (payload.avatar) {
      const p2 = { ...payload }; delete p2.avatar;
      try { await set(pubMenuRef(id), p2); return { ok: true, id, avatarDropped: true }; }
      catch (e2) { console.warn('[cloud] publishMenu retry failed', e2); return { ok: false, reason: 'write', message: e2.message }; }
    }
    console.warn('[cloud] publishMenu failed', e);
    return { ok: false, reason: 'write', message: e.message };
  }
}

async function unpublishMenu(id) {
  if (!currentUser || !db) return { ok: false, reason: 'login' };
  try { await remove(pubMenuRef(id)); return { ok: true }; }
  catch (e) { console.warn('[cloud] unpublishMenu failed', e); return { ok: false, reason: 'write', message: e.message }; }
}

// 最新の公開メニューを取得。戻り値: 配列 / null(取得失敗=ルール未適用など)
async function listPublicMenus(max) {
  if (!db) return null;
  try {
    const snap = await get(query(pubMenusRef(), orderByChild('createdAt'), limitToLast(max || 60)));
    if (!snap.exists()) return [];
    const arr = [];
    snap.forEach(ch => { const v = ch.val(); if (v && Array.isArray(v.items)) arr.push({ id: ch.key, ...v }); });
    arr.reverse(); // 新しい順
    return arr;
  } catch (e) { console.warn('[cloud] listPublicMenus failed', e); return null; }
}

// プロフィール(表示名/アイコン/画像/アピール/リンク)を自分の公開済みメニュー全部に反映
async function updateMyMenusProfile(profile) {
  if (!currentUser || !db) return { ok: false, reason: 'login' };
  try {
    const snap = await get(query(pubMenusRef(), orderByChild('uid'), equalTo(currentUser.uid)));
    if (!snap.exists()) return { ok: true, updated: 0 };
    const updates = {};
    let n = 0;
    snap.forEach(ch => {
      const b = 'kintoreLab/publicMenus/' + ch.key + '/';
      updates[b + 'displayName'] = String(profile.displayName || 'ユーザー').slice(0, 30);
      updates[b + 'icon'] = String(profile.icon || '').slice(0, 8);
      updates[b + 'avatar'] = String(profile.avatar || '').slice(0, 24000);
      updates[b + 'appeal'] = String(profile.appeal || '').slice(0, 120);
      updates[b + 'link'] = String(profile.link || '').slice(0, 300);
      updates[b + 'platform'] = String(profile.platform || '').slice(0, 20);
      n++;
    });
    await update(ref(db), updates);
    return { ok: true, updated: n };
  } catch (e) { console.warn('[cloud] updateMyMenusProfile failed', e); return { ok: false, reason: 'write', message: e.message }; }
}

async function reportMenu(id) {
  if (!currentUser || !db) return { ok: false, reason: 'login' };
  try { await set(ref(db, 'kintoreLab/menuReports/' + id + '/' + currentUser.uid), { at: Date.now() }); return { ok: true }; }
  catch (e) { console.warn('[cloud] reportMenu failed', e); return { ok: false, reason: 'write', message: e.message }; }
}

// ===== ネイティブサインイン (Capacitor / iOS・Android) =====
// Google はセキュリティ上 WebView 内の OAuth をブロックするため、ネイティブ層で資格情報を取得し
// それを Firebase JS SDK に渡す(signInWithCredential)。これで onAuthStateChanged 以降の既存処理をそのまま使える。
function isNative() { try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch (e) { return false; } }
function nativeAuthPlugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FirebaseAuthentication) || null; }

async function nativeGoogleSignIn() {
  const FA = nativeAuthPlugin();
  if (!FA) throw new Error('ネイティブ認証プラグインが見つかりません');
  const res = await FA.signInWithGoogle({ skipNativeAuth: true }); // Firebaseへのサインインは下でJS SDKが行う
  const cr = (res && res.credential) || {};
  if (!cr.idToken) throw new Error('Googleの資格情報を取得できませんでした');
  const cred = GoogleAuthProvider.credential(cr.idToken, cr.accessToken || undefined);
  return signInWithCredential(auth, cred);
}

async function nativeAppleSignIn() {
  const FA = nativeAuthPlugin();
  if (!FA) throw new Error('ネイティブ認証プラグインが見つかりません');
  const res = await FA.signInWithApple({ skipNativeAuth: true });
  const cr = (res && res.credential) || {};
  if (!cr.idToken) throw new Error('Appleの資格情報を取得できませんでした');
  const provider = new OAuthProvider('apple.com');
  const cred = provider.credential({ idToken: cr.idToken, rawNonce: cr.nonce });
  return signInWithCredential(auth, cred);
}

// ===== 公開API (app.js から利用) =====
window.__klCloud = {
  available: !!auth,
  publishMenu, unpublishMenu, listPublicMenus, reportMenu, updateMyMenusProfile,
  myUid() { return currentUser ? currentUser.uid : null; },
  status() {
    return {
      user: currentUser ? { name: currentUser.displayName, email: currentUser.email, uid: currentUser.uid } : null,
      syncing, lastSync: lastSyncLabel,
    };
  },
  push,
  nativeAuth: isNative(),   // ネイティブ実行中なら true(UIのボタン出し分け用)
  signIn() {
    if (!auth) { alert('この環境では同期を利用できません。'); return; }
    if (isNative()) {
      nativeGoogleSignIn().catch(err => {
        console.warn('[cloud] native google signIn failed', err);
        if (!(err && String(err.message || err).includes('canceled'))) alert('Googleログインに失敗しました。時間をおいて再度お試しください。');
      });
      return;
    }
    const provider = new GoogleAuthProvider();
    signInWithPopup(auth, provider).catch(err => {
      // ポップアップがブロックされたらリダイレクト方式にフォールバック
      if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/cancelled-popup-request' || err.code === 'auth/operation-not-supported-in-this-environment')) {
        signInWithRedirect(auth, provider).catch(e2 => console.warn('[cloud] signIn failed', e2));
      } else {
        console.warn('[cloud] signIn failed', err);
      }
    });
  },
  signInApple() {
    if (!auth) { alert('この環境では同期を利用できません。'); return; }
    if (isNative()) {
      nativeAppleSignIn().catch(err => {
        console.warn('[cloud] native apple signIn failed', err);
        if (!(err && String(err.message || err).includes('canceled'))) alert('Appleログインに失敗しました。時間をおいて再度お試しください。');
      });
      return;
    }
    const provider = new OAuthProvider('apple.com');
    signInWithPopup(auth, provider).catch(err => console.warn('[cloud] apple signIn failed', err));
  },
  signOut() {
    // ネイティブのGoogle/Appleセッションも破棄してから JS SDK をサインアウト
    if (isNative()) { try { const FA = nativeAuthPlugin(); if (FA) FA.signOut(); } catch (e) {} }
    if (auth) signOut(auth);
  },
  // 通知リマインダー
  reminderStatus() {
    return { enabled: !!reminder.enabled, hour: reminder.hour, permission: (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported') };
  },
  enableReminders, disableReminders, setReminderHour,
};

// ===== 認証状態の監視 =====
if (auth) {
  setPersistence(auth, browserLocalPersistence).catch(() => {});
  getRedirectResult(auth).catch(() => {});
  onAuthStateChanged(auth, user => {
    if (user) onLogin(user);
    else onLogout();
  });
}
