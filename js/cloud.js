// 筋トレLAB — 端末間同期 (Firebase / Google Sign-In)
// zzZFM と同じ Firebase プロジェクト(zzzfm-beaaa)を共用。データは /kintoreLab/{uid} に保存。
// ログインは任意: 未ログインでもアプリは完全にローカルで動く。ここは「あれば同期する」追加層。
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getDatabase, ref, set, get, onValue } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyD3KXbGaNLcfVImgeWPkdwl8byS-c54YYE",
  authDomain: "zzzfm-beaaa.firebaseapp.com",
  databaseURL: "https://zzzfm-beaaa-default-rtdb.firebaseio.com",
  projectId: "zzzfm-beaaa",
  storageBucket: "zzzfm-beaaa.firebasestorage.app",
  messagingSenderId: "586925220038",
  appId: "1:586925220038:web:1960d6fb18a53c2ed7f7c7"
};

let app, db, auth;
try {
  app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  auth = getAuth(app);
} catch (e) {
  console.warn('[cloud] Firebase init failed — 同期は無効、ローカルのみで動作します', e);
}

// このタブ固有のトークン (自分の書き込みエコーを無視するため)
const originToken = 'kl_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
let currentUser = null;
let unsub = null;          // onValue 解除関数
let pushTimer = null;
let lastUpdatedAt = 0;     // 直近に採用した _updatedAt
let syncing = false;
let lastSyncLabel = '';

function uidRef(uid) { return ref(db, 'kintoreLab/' + uid); }

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
    const snap = await get(uidRef(user.uid));
    if (snap.exists()) {
      const payload = snap.val();
      const rt = Number(payload && payload._updatedAt) || 0;
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

// ===== 公開API (app.js から利用) =====
window.__klCloud = {
  available: !!auth,
  status() {
    return {
      user: currentUser ? { name: currentUser.displayName, email: currentUser.email, uid: currentUser.uid } : null,
      syncing, lastSync: lastSyncLabel,
    };
  },
  push,
  signIn() {
    if (!auth) { alert('この環境では同期を利用できません。'); return; }
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
  signOut() { if (auth) signOut(auth); },
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
