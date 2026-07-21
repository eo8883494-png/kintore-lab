// 筋トレLAB — トレ通知の送信 (GitHub Actions から1時間ごとに実行)
// 各ユーザーの端末トークンを見て、その端末のタイムゾーンで「設定時刻 & トレの日」なら
// FCM でプッシュを送る。1日1回まで (lastSent で重複防止)。秘密鍵は GH Secret から読む。
import admin from 'firebase-admin';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
// 鍵未設定なら「まだセットアップ前」として静かに正常終了(毎時の失敗通知を避ける)
if (!raw) { console.log('FIREBASE_SERVICE_ACCOUNT 未設定 — 送信をスキップ(セットアップ待ち)'); process.exit(0); }

let sa;
try { sa = JSON.parse(raw); } catch (e) { console.error('サービスアカウントJSONの解析に失敗', e.message); process.exit(1); }

admin.initializeApp({
  credential: admin.credential.cert(sa),
  databaseURL: 'https://kintore-lab-default-rtdb.asia-southeast1.firebasedatabase.app',
});
const db = admin.database();
const messaging = admin.messaging();

const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function localParts(tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map(x => [x.type, x.value]));
  let hour = parseInt(p.hour, 10); if (hour === 24) hour = 0;
  return { date: `${p.year}-${p.month}-${p.day}`, hour, weekday: WD[p.weekday] };
}

const APP_URL = 'https://eo8883494-png.github.io/kintore-lab/';
const ICON = APP_URL + 'assets/icons/icon-192.png';

const snap = await db.ref('kintoreLab').get();
const all = snap.val() || {};
let checked = 0, sent = 0, cleaned = 0;

for (const uid of Object.keys(all)) {
  const node = all[uid] || {};
  const tokens = node.pushTokens || {};
  const plan = node.state && node.state.plan;
  for (const devId of Object.keys(tokens)) {
    const rec = tokens[devId];
    if (!rec || !rec.enabled || !rec.token) continue;
    checked++;
    const tz = rec.tz || 'Asia/Tokyo';
    let lp;
    try { lp = localParts(tz); } catch (e) { lp = localParts('Asia/Tokyo'); }
    if (lp.hour !== Number(rec.hour)) continue;   // 設定時刻の枠でのみ送る
    if (rec.lastSent === lp.date) continue;         // その日はもう送った

    // トレの日か判定: プランがあれば該当曜日のみ、無ければ毎日
    let dayName = null, isTrainingDay = true;
    if (plan && Array.isArray(plan.days)) {
      const pd = plan.days.find(x => Number(x.weekday) === lp.weekday);
      dayName = pd ? pd.name : null;
      isTrainingDay = !!pd;
    }
    if (!isTrainingDay) continue; // 休息日は送らない (lastSentは触らず次のトレ日に送る)

    const title = '筋トレLAB';
    const body = dayName ? `今日は「${dayName}」の日💪 忘れずに!` : 'トレーニングの時間です💪';
    try {
      await messaging.send({
        token: rec.token,
        webpush: { notification: { title, body, icon: ICON }, fcmOptions: { link: APP_URL } },
      });
      await db.ref(`kintoreLab/${uid}/pushTokens/${devId}/lastSent`).set(lp.date);
      sent++;
    } catch (e) {
      const code = (e && e.errorInfo && e.errorInfo.code) || (e && e.code) || '';
      if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token') || code.includes('invalid-argument')) {
        await db.ref(`kintoreLab/${uid}/pushTokens/${devId}`).remove(); // 失効トークンを掃除
        cleaned++;
      } else {
        console.error('送信エラー', uid, devId, code || e.message);
      }
    }
  }
}
console.log(`checked=${checked} sent=${sent} cleaned=${cleaned}`);
process.exit(0);
