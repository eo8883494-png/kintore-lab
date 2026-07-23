// 筋トレLAB — アプリ本体 (状態管理・ルーティング・各画面)

// ===== DB 正規化 (オリジナル種目も合流させるため再構築可能にする) =====
const DB = { byPart: {}, byId: {} };
function rebuildDB(customList) {
  DB.byPart = {}; DB.byId = {};
  Object.keys(EXDB_RAW).forEach(part => {
    DB.byPart[part] = (EXDB_RAW[part] || []).map(ex => ({ ...ex, part }));
    DB.byPart[part].forEach(ex => { DB.byId[ex.id] = ex; });
  });
  (customList || []).forEach(ex => {
    if (DB.byId[ex.id]) return;
    const p = { ...ex, custom: true };
    (DB.byPart[p.part] = DB.byPart[p.part] || []).push(p);
    DB.byId[p.id] = p;
  });
}
rebuildDB();
const EQUIP_NAMES = { bodyweight: '自重', dumbbell: 'ダンベル', barbell: 'バーベル', machine: 'マシン', cable: 'ケーブル' };

// みんなのメニューに貼れるSNSリンク(主要SNS限定・フィッシング/スパム防止。Firebaseルールでも同等に検証)
const SNS_RE = /^https:\/\/(?:www\.|m\.|vm\.)?(?:instagram\.com|youtube\.com|youtu\.be|tiktok\.com|x\.com|twitter\.com|threads\.net)\/[^\s]*$/i;
function detectPlatform(url) {
  if (typeof url !== 'string' || !SNS_RE.test(url)) return null;
  const h = url.toLowerCase();
  if (h.includes('instagram.com')) return 'Instagram';
  if (h.includes('youtube.com') || h.includes('youtu.be')) return 'YouTube';
  if (h.includes('tiktok.com')) return 'TikTok';
  if (h.includes('x.com') || h.includes('twitter.com')) return 'X';
  if (h.includes('threads.net')) return 'Threads';
  return 'SNS';
}

// みんなのメニューで選べるアイコン(絵文字プリセット。自由入力は不可でモデレーション簡略化)
const PUB_ICONS = ['💪', '🔥', '⚡', '🏋️', '🦍', '🐺', '🐉', '🦁', '🐻', '🦏', '🥇', '👑', '🎯', '🚀', '😤', '💯', '🧊', '🥶', '🦵', '🍚', '🥩', '🌱', '⭐', '😎'];

// アバター画像のdataURLが安全か厳格チェック(XSS防止: img srcに入れる前に必ず通す)
const AVATAR_RE = /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/;
function isValidAvatar(s) { return typeof s === 'string' && s.length <= 24000 && AVATAR_RE.test(s); }

// 画像ファイル → 正方形に中央クロップ→128px JPEG dataURL(サイズ上限に収める)
function avatarFromFile(file, cb) {
  const img = new Image();
  img.onload = () => {
    const size = 128;
    const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d');
    const s = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    URL.revokeObjectURL(img.src);
    let q = 0.7, url = cv.toDataURL('image/jpeg', q);
    while (url.length > 20000 && q > 0.3) { q -= 0.1; url = cv.toDataURL('image/jpeg', q); }
    cb(url.length <= 24000 && AVATAR_RE.test(url) ? url : null);
  };
  img.onerror = () => { URL.revokeObjectURL(img.src); cb(null); };
  img.src = URL.createObjectURL(file);
}

// ===== 状態 =====
const LS_KEY = 'kintoreLab.v1';

function defaultState() {
  return { profile: null, focus: {}, exclude: {}, plan: null, logs: [], weights: [], lastW: {}, lastR: {}, nextId: 1, dayDone: {}, mealSeed: 0, swap: null, swapDismiss: '', customEx: [], myMenus: [], myToday: null, timerPresets: [], mealTargets: null, publicName: '', publicIcon: '', publicAvatar: '', publicAppeal: '', publicLink: '', fillDays: false, activeRest: false, setCount: {}, recoveryDone: {}, pro: false };
}

// 数値検証: 範囲外・非数は fallback
function numIn(v, lo, hi, fb) {
  v = Number(v);
  return isFinite(v) && v >= lo && v <= hi ? v : fb;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 外部データ(localStorage・インポートJSON)を信頼せず、全フィールドを検証して再構築する
function sanitizeState(s) {
  const out = defaultState();
  if (!s || typeof s !== 'object') return out;

  if (s.profile && typeof s.profile === 'object') {
    const p = s.profile;
    out.profile = {
      sex: p.sex === 'f' ? 'f' : 'm',
      age: Math.round(numIn(p.age, 10, 100, 30)),
      h: numIn(p.h, 100, 230, 170),
      w: numIn(p.w, 20, 300, 65),
      level: [1, 2, 3].indexOf(Number(p.level)) >= 0 ? Number(p.level) : 1,
      env: SCIENCE.envs[p.env] ? p.env : 'home_db',
      goal: SCIENCE.goals[p.goal] ? p.goal : 'hyp',
      days: Math.round(numIn(p.days, 1, 7, 3)),
      minutes: Math.round(numIn(p.minutes, 15, 120, 45)),
      gear: { bar: !!(p.gear && p.gear.bar), bench: !(p.gear && p.gear.bench === false) },
    };
  }

  if (s.focus && typeof s.focus === 'object') {
    Object.keys(s.focus).forEach(k => {
      if (SCIENCE.partMap[k] && (s.focus[k] === 'grow' || s.focus[k] === 'tone')) out.focus[k] = s.focus[k];
    });
  }

  // やらない部位(除外)。focusとは排他: 除外なら優先は付けない
  if (s.exclude && typeof s.exclude === 'object') {
    Object.keys(s.exclude).forEach(k => {
      if (SCIENCE.partMap[k] && s.exclude[k]) { out.exclude[k] = true; delete out.focus[k]; }
    });
  }

  let maxId = 0;
  if (Array.isArray(s.logs)) {
    s.logs.forEach(l => {
      if (!l || typeof l !== 'object') return;
      if (typeof l.date !== 'string' || !DATE_RE.test(l.date)) return;
      if (typeof l.exId !== 'string' || !Array.isArray(l.sets)) return;
      const sets = l.sets
        .map(x => ({ w: numIn(x && x.w, 0, 2000, 0), r: Math.round(numIn(x && x.r, 0, 1000, 0)) }))
        .filter(x => x.r > 0);
      if (!sets.length) return;
      const id = Number(l.id);
      out.logs.push({ id: Number.isInteger(id) && id > 0 ? id : 0, date: l.date, exId: l.exId.slice(0, 60), sets });
    });
    out.logs.forEach(l => { if (l.id > maxId) maxId = l.id; });
    const seen = new Set();
    out.logs.forEach(l => { if (!l.id || seen.has(l.id)) l.id = ++maxId; seen.add(l.id); });
  }

  if (Array.isArray(s.weights)) {
    s.weights.forEach(w => {
      if (!w || typeof w.date !== 'string' || !DATE_RE.test(w.date)) return;
      const kg = numIn(w.kg, 20, 300, 0);
      if (kg) out.weights.push({ date: w.date, kg });
    });
    out.weights.sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  if (s.lastW && typeof s.lastW === 'object') {
    Object.keys(s.lastW).forEach(k => {
      const v = numIn(s.lastW[k], 0.5, 2000, 0);
      if (v) out.lastW[k.slice(0, 60)] = v;
    });
  }
  if (s.lastR && typeof s.lastR === 'object') {
    Object.keys(s.lastR).forEach(k => {
      const v = Math.round(numIn(s.lastR[k], 1, 1000, 0));
      if (v) out.lastR[k.slice(0, 60)] = v;
    });
  }

  if (s.dayDone && typeof s.dayDone === 'object') {
    Object.keys(s.dayDone).forEach(dt => {
      if (!DATE_RE.test(dt) || !s.dayDone[dt] || typeof s.dayDone[dt] !== 'object') return;
      const m = {};
      Object.keys(s.dayDone[dt]).forEach(ex => {
        const raw = s.dayDone[dt][ex];
        if (typeof raw === 'number' && Number.isInteger(raw)) {
          m[ex.slice(0, 60)] = { id: raw, src: 'plan' }; // 旧形式を正規化
        } else if (raw && typeof raw === 'object' && Number.isInteger(Number(raw.id))) {
          m[ex.slice(0, 60)] = { id: Number(raw.id), src: typeof raw.src === 'string' ? raw.src.slice(0, 40) : 'plan' };
        }
      });
      out.dayDone[dt] = m;
    });
  }

  out.plan = sanitizePlan(s.plan);
  out.nextId = Math.max(Math.round(numIn(s.nextId, 1, 1e9, 1)), maxId + 1);
  out.mealSeed = Math.round(numIn(s.mealSeed, 0, 1e9, 0));
  if (s.swap && typeof s.swap === 'object' && typeof s.swap.date === 'string' && DATE_RE.test(s.swap.date)) {
    const idx = Number(s.swap.idx);
    if (out.plan && Number.isInteger(idx) && idx >= 0 && idx < out.plan.days.length) out.swap = { date: s.swap.date, idx };
  }
  if (typeof s.swapDismiss === 'string' && DATE_RE.test(s.swapDismiss)) out.swapDismiss = s.swapDismiss;

  // オリジナル種目
  if (Array.isArray(s.customEx)) {
    const seenC = new Set();
    s.customEx.slice(0, 50).forEach((ex, i) => {
      if (!ex || typeof ex !== 'object' || typeof ex.name !== 'string' || !ex.name.trim()) return;
      const part = SCIENCE.partMap[ex.part] ? ex.part : 'abs';
      const eq = ['bodyweight', 'dumbbell', 'barbell', 'machine', 'cable'].indexOf(ex.equipment) >= 0 ? ex.equipment : 'bodyweight';
      const id = typeof ex.id === 'string' && /^custom-\d+$/.test(ex.id) ? ex.id : 'custom-' + (i + 1);
      if (seenC.has(id)) return;
      seenC.add(id);
      out.customEx.push({
        id, name: ex.name.slice(0, 30), part, equipment: eq,
        sub: [SCIENCE.partMap[part].name], level: 1, mets: numIn(ex.mets, 2, 9, 4), compound: false,
        form: ['自分の種目: いつものフォームでOK', '効かせたい部位を意識する', '無理のない重量で丁寧に'],
        mistake: '', repHyp: '10-15', repStr: '8-12', repEnd: '15-20', custom: true,
      });
    });
  }

  // マイメニュー
  if (Array.isArray(s.myMenus)) {
    const seenM = new Set();
    s.myMenus.slice(0, 20).forEach(m => {
      if (!m || typeof m !== 'object' || typeof m.name !== 'string' || !Array.isArray(m.items)) return;
      const items = m.items.slice(0, 15).map(it => (it && typeof it.exId === 'string') ? {
        exId: it.exId.slice(0, 60),
        part: SCIENCE.partMap[it.part] ? it.part : 'abs',
        sets: Math.round(numIn(it.sets, 1, 10, 3)),
        reps: typeof it.reps === 'string' ? it.reps.slice(0, 20) : '10-15',
        rest: Math.round(numIn(it.rest, 15, 600, 90)),
        priority: false,
      } : null).filter(Boolean);
      if (!items.length) return;
      let id = Number(m.id);
      if (!Number.isInteger(id) || id <= 0) id = out.myMenus.length + 1;
      while (seenM.has(id)) id++;
      seenM.add(id);
      const entry = { id, name: m.name.slice(0, 20), items };
      // みんなのメニュー公開状態(公開済みなら保持)
      if (typeof m.pubId === 'string' && m.pubId) entry.pubId = m.pubId.slice(0, 80);
      if (typeof m.pubLink === 'string' && m.pubLink) entry.pubLink = m.pubLink.slice(0, 300);
      if (m.published) entry.published = true;
      out.myMenus.push(entry);
    });
  }
  if (s.myToday && typeof s.myToday === 'object' && typeof s.myToday.date === 'string' && DATE_RE.test(s.myToday.date)) {
    const mid = Number(s.myToday.id);
    if (out.myMenus.some(m => m.id === mid)) out.myToday = { date: s.myToday.date, id: mid };
  }
  // インターバルタイマーの保存プリセット
  if (Array.isArray(s.timerPresets)) {
    s.timerPresets.slice(0, 30).forEach(t => {
      if (!t || typeof t !== 'object' || typeof t.name !== 'string' || !t.name.trim()) return;
      out.timerPresets.push({
        name: t.name.slice(0, 20),
        prep: Math.round(numIn(t.prep, 0, 60, 5)),
        work: Math.round(numIn(t.work, 1, 3600, 60)),
        rest: Math.round(numIn(t.rest, 0, 3600, 30)),
        reps: Math.round(numIn(t.reps, 1, 100, 8)),
        sets: Math.round(numIn(t.sets, 1, 50, 1)),
        setRest: Math.round(numIn(t.setRest, 0, 3600, 60)),
      });
    });
  }
  // 食事の手動PFC目標(設定時のみ・カロリーはP/F/Cから導出)
  if (s.mealTargets && typeof s.mealTargets === 'object' && s.mealTargets.custom) {
    out.mealTargets = {
      custom: true,
      p: Math.round(numIn(s.mealTargets.p, 20, 400, 120)),
      f: Math.round(numIn(s.mealTargets.f, 10, 300, 60)),
      c: Math.round(numIn(s.mealTargets.c, 0, 1000, 250)),
    };
  }
  // みんなのメニューの表示名・アイコン・アピール(次回公開時の既定として保持)
  if (typeof s.publicName === 'string') out.publicName = s.publicName.slice(0, 30);
  if (typeof s.publicIcon === 'string') out.publicIcon = s.publicIcon.slice(0, 8);
  if (typeof s.publicAppeal === 'string') out.publicAppeal = s.publicAppeal.slice(0, 120);
  if (typeof s.publicLink === 'string') out.publicLink = s.publicLink.slice(0, 300);
  if (isValidAvatar(s.publicAvatar)) out.publicAvatar = s.publicAvatar;
  out.fillDays = !!s.fillDays;     // 除外しても指定日数で組む(オプトイン)
  out.activeRest = !!s.activeRest; // 休養日にアクティブレストを提案(オプトイン)
  // セット進捗カウント(日付→'ctx|exId'→完了セット数)
  if (s.setCount && typeof s.setCount === 'object') {
    Object.keys(s.setCount).forEach(dt => {
      if (!DATE_RE.test(dt) || !s.setCount[dt] || typeof s.setCount[dt] !== 'object') return;
      const m = {};
      Object.keys(s.setCount[dt]).forEach(k => { const n = Math.round(numIn(s.setCount[dt][k], 0, 30, 0)); if (n > 0) m[k.slice(0, 80)] = n; });
      if (Object.keys(m).length) out.setCount[dt] = m;
    });
  }
  // アクティブレスト実施記録(日付→moveId→true)
  if (s.recoveryDone && typeof s.recoveryDone === 'object') {
    Object.keys(s.recoveryDone).forEach(dt => {
      if (!DATE_RE.test(dt) || !s.recoveryDone[dt] || typeof s.recoveryDone[dt] !== 'object') return;
      const m = {};
      Object.keys(s.recoveryDone[dt]).forEach(k => { if (s.recoveryDone[dt][k]) m[k.slice(0, 40)] = true; });
      if (Object.keys(m).length) out.recoveryDone[dt] = m;
    });
  }
  out.pro = !!s.pro; // Pro購入フラグ(買い切り解除。一度trueなら維持=mergeでsticky-true)
  return out;
}

function sanitizePlan(pl) {
  if (!pl || typeof pl !== 'object' || !Array.isArray(pl.days) || !pl.days.length) return null;
  const days = [];
  for (const d of pl.days) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.items)) return null;
    const wd = Number(d.weekday);
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) return null;
    const items = [];
    for (const it of d.items) {
      if (!it || typeof it.exId !== 'string') continue;
      const ex = DB.byId[it.exId];
      items.push({
        exId: it.exId.slice(0, 60),
        part: SCIENCE.partMap[it.part] ? it.part : (ex ? ex.part : 'chest'),
        sets: Math.round(numIn(it.sets, 1, 10, 3)),
        reps: typeof it.reps === 'string' ? it.reps.slice(0, 20) : '8-12',
        rest: Math.round(numIn(it.rest, 15, 600, 90)),
        priority: !!it.priority,
      });
    }
    days.push({ name: typeof d.name === 'string' ? d.name.slice(0, 40) : 'メニュー', weekday: wd, items, minutes: 0 });
  }
  const plan = {
    days,
    weeklySets: {},
    seed: Math.round(numIn(pl.seed, 0, 1e12, 0)),
    createdAt: typeof pl.createdAt === 'string' ? pl.createdAt.slice(0, 10) : '',
  };
  SCIENCE.parts.forEach(p => { plan.weeklySets[p.key] = 0; });
  days.forEach(d => {
    d.items.forEach(it => { plan.weeklySets[it.part] += it.sets; });
    d.minutes = dayMinutes(d.items);
  });
  return plan;
}

// ===== 端末間マージ =====
// 方針: トレ記録(logs)と体重(weights)は両端末を統合して絶対に消さない。
// 設定類(profile/plan/lastW等)は新しい方(_updatedAt)を採用。
// オリジナル種目/マイメニューはID衝突を remap して安全に統合する。
function customContentKey(e) { return `${e.name}|${e.part}|${e.equipment}`; }
function logContentKey(l) { return `${l.date}|${l.exId}|${(l.sets || []).map(s => `${s.w || 0}x${s.r || 0}`).join(',')}`; }
function menuContentKey(m) { return `${m.name}|${m.items.map(i => i.exId).join(',')}`; }

function mergeStates(local, remote) {
  const a = sanitizeState(local), b = sanitizeState(remote);
  const at = Number(local && local._updatedAt) || 0;
  const bt = Number(remote && remote._updatedAt) || 0;
  const remotePrimary = bt >= at; // 同値ならリモート(=同期済み)を優先
  const primary = remotePrimary ? b : a;
  const secondary = remotePrimary ? a : b;

  // 1) オリジナル種目: 内容で統合。二次側の衝突IDだけ改番し、参照を remap する
  const byId = {}, byContent = {};
  let maxN = 0;
  const merged = [];
  const takeN = id => { const n = Number((String(id).match(/\d+$/) || [0])[0]); if (n > maxN) maxN = n; };
  primary.customEx.forEach(e => { byId[e.id] = e; byContent[customContentKey(e)] = e.id; takeN(e.id); merged.push(e); });
  const remap = {};
  secondary.customEx.forEach(e => {
    const ck = customContentKey(e);
    if (byContent[ck] != null) { remap[e.id] = byContent[ck]; return; } // 同じ種目が既にある
    let id = e.id;
    if (byId[id]) id = 'custom-' + (++maxN); else takeN(id); // 別内容でID衝突→改番
    remap[e.id] = id;
    const ne = { ...e, id };
    byId[id] = ne; byContent[ck] = id; merged.push(ne);
  });
  const remapEx = id => remap[id] || id;

  // 2) logs: 内容キーで union (二次側の exId は remap 済みで突き合わせる)
  const logMap = new Map();
  primary.logs.forEach(l => logMap.set(logContentKey(l), { ...l }));
  secondary.logs.forEach(l0 => {
    const l = { ...l0, exId: remapEx(l0.exId) };
    const k = logContentKey(l);
    if (!logMap.has(k)) logMap.set(k, l);
  });
  let nid = 1;
  const logs = [...logMap.values()].sort((x, y) => (x.date < y.date ? -1 : 1)).map(l => ({ ...l, id: nid++ }));

  // 3) weights: 日付で union (primary 優先)
  const wMap = new Map();
  secondary.weights.forEach(w => wMap.set(w.date, w));
  primary.weights.forEach(w => wMap.set(w.date, w));
  const weights = [...wMap.values()].sort((x, y) => (x.date < y.date ? -1 : 1));

  // 4) マイメニュー: remap 後に内容で union、改番。primary の myToday を追従
  let mid = 1;
  const menuIdMap = new Map(); // contentKey -> new id
  const menuMap = new Map();
  const primaryMenus = primary.myMenus.map(m => ({ ...m, _src: 'p' }));
  const secondaryMenus = secondary.myMenus.map(m => ({ ...m, items: m.items.map(i => ({ ...i, exId: remapEx(i.exId) })), _src: 's' }));
  [...primaryMenus, ...secondaryMenus].forEach(m => {
    const k = menuContentKey(m);
    if (menuMap.has(k)) return;
    const nm = { id: mid++, name: m.name, items: m.items.map(({ _src, ...it }) => it) };
    if (m.pubId) nm.pubId = m.pubId;
    if (m.pubLink) nm.pubLink = m.pubLink;
    if (m.published) nm.published = true;
    menuMap.set(k, nm); menuIdMap.set(k, nm.id);
  });
  const myMenus = [...menuMap.values()];
  let myToday = null;
  if (primary.myToday) {
    const srcMenu = primary.myMenus.find(m => m.id === primary.myToday.id);
    if (srcMenu) { const nid2 = menuIdMap.get(menuContentKey(srcMenu)); if (nid2 != null) myToday = { date: primary.myToday.date, id: nid2 }; }
  }

  // 5) lastW/lastR: 統合 (primary 優先)、dayDone は logs から今日分だけ再構築
  const lastW = { ...secondary.lastW, ...primary.lastW };
  const lastR = { ...secondary.lastR, ...primary.lastR };
  const today = todayStr();
  const dayDone = {};
  logs.filter(l => l.date === today).forEach(l => { (dayDone[today] = dayDone[today] || {})[l.exId] = { id: l.id, src: 'plan' }; });

  const out = defaultState();
  Object.assign(out, {
    profile: primary.profile, focus: primary.focus, exclude: primary.exclude, plan: primary.plan,
    mealSeed: primary.mealSeed, swap: primary.swap, swapDismiss: primary.swapDismiss,
    logs, weights, lastW, lastR, customEx: merged, myMenus, myToday, dayDone,
    nextId: nid,
    pro: primary.pro || secondary.pro, // 買い切りentitlementは端末間でsticky-true(消えない)
  });
  // タイマープリセット: 内容で union(primary優先・上限30)
  const tpMap = new Map();
  [...primary.timerPresets, ...secondary.timerPresets].forEach(t => { const k = JSON.stringify(t); if (!tpMap.has(k)) tpMap.set(k, t); });
  out.timerPresets = [...tpMap.values()].slice(0, 30);
  out.mealTargets = primary.mealTargets || secondary.mealTargets; // 手動目標はprimary優先
  // 公開プロフィール(表示名・アイコン・画像・アピール・リンク)を引き継ぐ(mergeで消さない)
  out.publicName = primary.publicName || secondary.publicName || '';
  out.publicIcon = primary.publicIcon || secondary.publicIcon || '';
  out.publicAvatar = primary.publicAvatar || secondary.publicAvatar || '';
  out.publicAppeal = primary.publicAppeal || secondary.publicAppeal || '';
  out.publicLink = primary.publicLink || secondary.publicLink || '';
  out.fillDays = primary.fillDays;      // オプトイン設定はprimary優先
  out.activeRest = primary.activeRest;
  // セット進捗: 日付ごとに union(primary優先で上書き)
  const sc = {};
  [secondary.setCount, primary.setCount].forEach(src => { if (src) Object.keys(src).forEach(dt => { sc[dt] = { ...(sc[dt] || {}), ...src[dt] }; }); });
  out.setCount = sc;
  // アクティブレスト実施記録: 日付ごとに union
  const rd = {};
  [secondary.recoveryDone, primary.recoveryDone].forEach(src => { if (src) Object.keys(src).forEach(dt => { rd[dt] = { ...(rd[dt] || {}), ...src[dt] }; }); });
  out.recoveryDone = rd;
  return out;
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultState();
    return sanitizeState(JSON.parse(raw));
  } catch (e) {
    console.warn('state load failed', e);
    return defaultState();
  }
}
let applyingRemote = false; // リモート適用中はクラウドへ再pushしない (エコー防止)
function saveState() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); }
  catch (e) { console.warn('state save failed', e); }
  if (!applyingRemote && window.__klCloud && window.__klCloud.push) window.__klCloud.push(S);
}

// ===== Pro (買い切り) — 2026-07-22 ドーマント実装 =====
// 現状は「無料検証フェーズ」= どの機能もロックしない(isPro参照箇所ゼロ)。
// Web牽引ゲート到達時に PRO_UI_ENABLED=true + 各機能を if(!isPro()) でゲートすれば解禁。
// アンロック機構(状態フラグ/解除コード/端末間sticky-true同期)だけ先に通しておく。
const PRO_UI_ENABLED = false;           // trueにすると設定にProコード入力欄が出る(launch時)
const PRO_CODE = 'KLPRO-SETME';         // launch時に確定=BOOTH/note配布コード。ドーマント中は未使用
function isPro() { return !!(S && S.pro); }
// 解除コード適用: 成功でtrue。S.proを立ててsaveState()→cloud syncにも伝播、mergeでsticky維持。
function applyProCode(code) {
  if (typeof code !== 'string' || code.trim().toUpperCase() !== PRO_CODE) return false;
  if (!S.pro) { S.pro = true; saveState(); }
  return true;
}
window.__klPro = { isPro, applyCode: applyProCode, uiEnabled: PRO_UI_ENABLED };

// ===== cloud.js とのブリッジ =====
// 現在の状態を取得 (クラウドへ書き込む用)
window.__klGetState = () => S;
// リモート(別端末/初回ログイン)の状態をローカルに統合して反映
// 戻り値 { changed, state }: changed=trueなら統合でローカルに追加が入った=クラウドへ書き戻す
window.__klApplyRemote = (remoteState) => {
  applyingRemote = true;
  let changed = false;
  try {
    const before = JSON.stringify(S);
    const merged = mergeStates(S, remoteState);
    changed = JSON.stringify(merged) !== before;
    S = merged;
    localStorage.setItem(LS_KEY, JSON.stringify(S));
    rebuildDB(S.customEx);
    simState = null;
    if (!$('#modal-bg')) route();
  } catch (e) { console.warn('remote merge failed', e); }
  applyingRemote = false;
  return { changed, state: S };
};
// ログイン状態が変わったら該当画面(ツール)を再描画
window.__klOnAuth = () => { if (currentView() === 'tools' && !$('#modal-bg')) route(); };

// 状態の初期化は全ヘルパー定義後に行う (const のTDZを踏まないよう必ずこの位置)
let S = loadState();
rebuildDB(S.customEx); // オリジナル種目をDBに合流
// 保存済みデータを正規形に書き直しておく (旧形式とのバイト差分で同期処理が空振りしないように)
try { if (localStorage.getItem(LS_KEY)) localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { /* 書けない環境は無視 */ }
function newId() { const id = S.nextId++; saveState(); return id; }

// ===== 汎用UI =====
function $(sel, root) { return (root || document).querySelector(sel); }
function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

let toastTimer = null;
function toast(msg) {
  let t = $('#toast');
  if (t) t.remove();
  t = document.createElement('div');
  t.id = 'toast'; t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2200);
}
window.toast = toast; // cloud.js (通知) から利用

function openModal(html) {
  closeModal();
  const bg = document.createElement('div');
  bg.className = 'modal-bg'; bg.id = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.addEventListener('click', e => { if (e.target === bg) closeModal(); });
  document.body.appendChild(bg);
  return bg;
}
function closeModal() { const m = $('#modal-bg'); if (m) m.remove(); }

// セグメントボタン生成
function segHtml(name, options, current, extraCls) {
  return `<div class="seg ${extraCls || ''}" data-seg="${name}">` +
    options.map(o => `<button type="button" data-val="${o.val}" class="${String(o.val) === String(current) ? 'on' : ''}">${esc(o.label)}</button>`).join('') +
    `</div>`;
}
function bindSeg(root, onChange) {
  $all('.seg', root).forEach(seg => {
    seg.addEventListener('click', e => {
      const btn = e.target.closest('button[data-val]');
      if (!btn) return;
      $all('button', seg).forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      onChange(seg.dataset.seg, btn.dataset.val);
    });
  });
}
function segVal(root, name) {
  const btn = $(`.seg[data-seg="${name}"] button.on`, root);
  return btn ? btn.dataset.val : null;
}

// ===== ルーティング =====
const VIEWS = ['home', 'plan', 'sim', 'meals', 'log', 'tools'];
function currentView() {
  const h = location.hash.replace('#', '');
  return VIEWS.includes(h) ? h : 'home';
}
function route() {
  const v = currentView();
  VIEWS.forEach(name => {
    $('#view-' + name).classList.toggle('active', name === v);
    $(`#tab-${name}`).classList.toggle('active', name === v);
  });
  renderView(v);
  updateRestFab(); // タブ切替で浮遊タイマーの表示/非表示を追従
}
window.addEventListener('hashchange', route);

function renderView(v) {
  if (v === 'home') renderHome();
  else if (v === 'plan') renderPlan();
  else if (v === 'sim') renderSim();
  else if (v === 'meals') renderMeals();
  else if (v === 'log') renderLog();
  else if (v === 'tools') renderTools();
}

// ===== ボディマップ =====
function bodymapSvg(side) {
  const R = (part, shapes) => `<g class="bm-part" data-part="${part}">${shapes}</g>`;
  const el = (cx, cy, rx, ry, cls) => `<ellipse class="${cls || 'bm-region'}" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`;
  const rr = (x, y, w, h, r, cls) => `<rect class="${cls || 'bm-region'}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;
  let s = `<svg viewBox="0 0 120 250" xmlns="http://www.w3.org/2000/svg">`;
  // 共通ベース: 頭・首・骨盤・足
  s += `<circle class="bm-base" cx="60" cy="18" r="12"/>` + rr(54, 29, 12, 8, 3, 'bm-base');
  if (side === 'front') {
    s += rr(46, 100, 28, 14, 6, 'bm-base'); // 骨盤
    s += el(52, 192, 5.5, 22, 'bm-base') + el(68, 192, 5.5, 22, 'bm-base'); // 脛
    s += R('shoulder', el(38, 48, 9, 7.5) + el(82, 48, 9, 7.5));
    s += R('chest', el(51, 59, 10, 10) + el(69, 59, 10, 10));
    s += R('arms', el(30, 74, 6.5, 12) + el(90, 74, 6.5, 12) + el(26, 102, 5.5, 12) + el(94, 102, 5.5, 12));
    s += R('abs', rr(49, 71, 22, 30, 7));
    s += R('legs', el(51, 141, 9.5, 26) + el(69, 141, 9.5, 26));
  } else {
    s += el(52, 218, 5, 8, 'bm-base') + el(68, 218, 5, 8, 'bm-base'); // 足首
    s += R('back', el(60, 48, 14, 9) + el(48, 74, 11, 17) + el(72, 74, 11, 17) + rr(52, 91, 16, 12, 4));
    s += R('shoulder', el(37, 48, 8.5, 7) + el(83, 48, 8.5, 7));
    s += R('arms', el(30, 74, 6.5, 12) + el(90, 74, 6.5, 12) + el(26, 102, 5.5, 12) + el(94, 102, 5.5, 12));
    s += R('glutes', el(51, 114, 9.5, 10.5) + el(69, 114, 9.5, 10.5));
    s += R('legs', el(51, 152, 9.5, 24) + el(69, 152, 9.5, 24));
    s += R('calves', el(51, 198, 6.5, 16) + el(69, 198, 6.5, 16));
  }
  s += `</svg>`;
  return s;
}

function applyFocusToMaps(root) {
  $all('.bm-part', root).forEach(g => {
    const part = g.dataset.part;
    const st = S.focus[part];
    const ex = !!S.exclude[part];
    $all('.bm-region', g).forEach(r => {
      r.classList.toggle('grow', st === 'grow');
      r.classList.toggle('tone', st === 'tone');
      r.classList.toggle('exclude', ex);
    });
  });
  const chips = $('#focus-chips', root);
  if (chips) {
    const fKeys = Object.keys(S.focus);
    const xKeys = Object.keys(S.exclude);
    const parts = [];
    fKeys.forEach(k => parts.push(`<span class="chip ${S.focus[k]}">${esc(SCIENCE.partMap[k].name)} ${S.focus[k] === 'grow' ? 'でかく' : '引き締め'}</span>`));
    xKeys.forEach(k => parts.push(`<span class="chip exclude">${esc(SCIENCE.partMap[k].name)} やらない</span>`));
    chips.innerHTML = parts.length ? parts.join('') : '<span class="chip">未選択(全体バランスで生成)</span>';
  }
}

// ===== オンボーディング / プロフィール編集 =====
function openProfileWizard(isFirst) {
  // ドラフトはコピーで持つ: 「完了!」以外の閉じ方では S.profile に触れない
  const p = S.profile ? { ...S.profile } : { sex: 'm', age: 30, h: 170, w: 65, level: 1, env: 'home_db', goal: 'hyp', days: 3, minutes: 45 };
  p.gear = { bar: !!(p.gear && p.gear.bar), bench: !(p.gear && p.gear.bench === false) };
  let step = 0;
  const steps = [
    () => `
      <div class="field"><label>性別(計算に使用)</label>${segHtml('sex', [{ val: 'm', label: '男性' }, { val: 'f', label: '女性' }], p.sex)}</div>
      <div class="grid3">
        <div class="field"><label>年齢</label><input type="number" id="ob-age" value="${p.age}" min="12" max="90"></div>
        <div class="field"><label>身長 cm</label><input type="number" id="ob-h" value="${p.h}" min="120" max="220"></div>
        <div class="field"><label>体重 kg</label><input type="number" id="ob-w" value="${p.w}" min="30" max="200" step="0.1"></div>
      </div>`,
    () => `<div class="field"><label>筋トレ経験</label>${segHtml('level', [1, 2, 3].map(l => ({ val: l, label: SCIENCE.levels[l] })), p.level, 'wrap')}</div>
      <p class="card-note">初心者ほど伸びしろが大きく、シミュレーターの増加ペースも速くなります。</p>`,
    () => `<div class="field"><label>トレーニング環境</label>${segHtml('env', Object.keys(SCIENCE.envs).map(k => ({ val: k, label: SCIENCE.envs[k].name })), p.env, 'wrap')}</div>
      <div class="field"><label>自宅にあるもの(自宅トレの場合)</label>
        <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:700;margin-bottom:8px"><input type="checkbox" id="ob-gear-bar" ${p.gear.bar ? 'checked' : ''}> 懸垂バー・ぶら下がれる場所</label>
        <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:700"><input type="checkbox" id="ob-gear-bench" ${p.gear.bench ? 'checked' : ''}> ベンチや丈夫な椅子(台にできる)</label>
      </div>
      <p class="card-note">環境と器具に合わせて種目を絞り込みます(懸垂バーが無ければ懸垂系は出しません)。あとで変更できます。</p>`,
    () => `<div class="field"><label>いちばんの目標</label>${segHtml('goal', Object.keys(SCIENCE.goals).map(k => ({ val: k, label: SCIENCE.goals[k].name })), p.goal, 'wrap')}</div>
      <p class="card-note">セット数・レップ数・インターバルの設計が変わります。</p>`,
    () => `
      <div class="field"><label>週に何日やる?</label>${segHtml('days', [1, 2, 3, 4, 5, 6, 7].map(d => ({ val: d, label: d + '日' })), p.days)}</div>
      <div class="field"><label>1回の時間 <span class="range-val" id="ob-min-val">${p.minutes}分</span></label>
        <input type="range" id="ob-min" min="15" max="120" step="5" value="${p.minutes}"></div>
      <p class="card-note">この2つで「どれだけ伸びるか」がほぼ決まります。シミュレーターで試せます。</p>`,
  ];
  const titles = ['基本情報', '経験レベル', '環境', '目標', '頻度と時間'];

  function render() {
    const bg = openModal(`
      <div class="ob-progress">${steps.map((_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>
      <h2>${isFirst ? 'ようこそ!' : 'プロフィール編集'} — ${titles[step]}</h2>
      <p class="modal-sub">${isFirst ? 'あなた専用のメニューと効率予測を作ります(30秒)' : '変更すると次回のメニュー生成に反映されます'}</p>
      <div id="ob-body">${steps[step]()}</div>
      <div style="display:flex;gap:10px;margin-top:18px">
        ${step > 0 ? '<button class="btn ghost" id="ob-back">戻る</button>' : ''}
        <button class="btn" id="ob-next">${step === steps.length - 1 ? '完了!' : '次へ'}</button>
      </div>`);
    bindSeg(bg, (name, val) => {
      if (name === 'sex') p.sex = val;
      if (name === 'level') p.level = Number(val);
      if (name === 'env') p.env = val;
      if (name === 'goal') p.goal = val;
      if (name === 'days') p.days = Number(val);
    });
    const rng = $('#ob-min', bg);
    if (rng) rng.addEventListener('input', () => { p.minutes = Number(rng.value); $('#ob-min-val', bg).textContent = p.minutes + '分'; });
    const back = $('#ob-back', bg);
    if (back) back.addEventListener('click', () => { grab(bg); step--; render(); });
    $('#ob-next', bg).addEventListener('click', () => {
      grab(bg);
      if (step < steps.length - 1) { step++; render(); return; }
      S.profile = p;
      saveState();
      closeModal();
      if (!S.plan) {
        S.plan = generatePlan(DB, p, S.focus, Math.floor(Math.random() * 1e9));
        S.swap = null;
        saveState();
        toast('プロフィール保存 & 初回メニューを生成!');
      } else {
        toast('プロフィールを保存しました');
      }
      route();
    });
  }
  function grab(bg) {
    const age = $('#ob-age', bg), h = $('#ob-h', bg), w = $('#ob-w', bg);
    if (age) p.age = Math.round(numIn(age.value, 10, 100, p.age));
    if (h) p.h = numIn(h.value, 100, 230, p.h);
    if (w) p.w = numIn(w.value, 20, 300, p.w);
    const gb = $('#ob-gear-bar', bg), gc = $('#ob-gear-bench', bg);
    if (gb) p.gear = { bar: gb.checked, bench: gc ? gc.checked : true };
  }
  render();
}

// 動画検索用: 種目名から括弧書き(和名併記)を除く
function exSearchName(ex) {
  return ex.name.replace(/[(\(][^))]*[)\)]/g, '').trim() || ex.name;
}

// ===== 種目詳細モーダル =====
// restSec を渡すと「この種目の休憩タイマー」ボタンを表示する
function openExerciseModal(exId, restSec) {
  const ex = DB.byId[exId];
  if (!ex) return;
  const bg = openModal(`
    <h2>${esc(ex.name)}</h2>
    <p class="modal-sub">${esc(SCIENCE.partMap[ex.part].name)} / ${EQUIP_NAMES[ex.equipment]} / ${'★'.repeat(ex.level)}${'☆'.repeat(3 - ex.level)} ${ex.compound ? '/ 多関節(コンパウンド)' : '/ 単関節(アイソレーション)'}</p>
    <div class="field"><label>効く部位</label><div>${ex.sub.map(s => `<span class="chip">${esc(s)}</span>`).join(' ')}</div></div>
    <div class="field"><label>フォームのコツ</label><ul style="padding-left:18px;font-size:13.5px">${ex.form.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>
    <div class="field"><label>よくある失敗</label><p style="font-size:13.5px;color:var(--warn)">⚠ ${esc(ex.mistake)}</p></div>
    <div class="field"><label>${ex.isometric ? '目的別キープ時間(秒)' : '目的別レップ数(回)'}</label>
      <table class="rm-table"><tr><th>筋肥大</th><th>筋力</th><th>引き締め</th></tr>
      <tr><td>${esc(ex.repHyp)}</td><td>${esc(ex.repStr)}</td><td>${esc(ex.repEnd)}</td></tr></table>
    </div>
    ${ex.equipment !== 'bodyweight' ? '<div class="field"><label>重量の決め方</label><p style="font-size:12.5px;color:var(--ink-dim)">指定回数の下限がフォームを保ってギリギリできる重さが適正。迷ったら軽めで始めて、毎回2.5%(または最小プレート1枚)ずつ足す。</p></div>' : ''}
    ${restSec ? `<button class="btn" id="ex-timer" style="margin-bottom:10px">⏱ 休憩タイマー ${Math.round(restSec)}秒 スタート</button>` : ''}
    <a class="btn ${restSec ? 'ghost' : ''}" style="margin-bottom:10px;text-decoration:none" target="_blank" rel="noopener"
       href="https://www.youtube.com/results?search_query=${encodeURIComponent(exSearchName(ex) + ' フォーム やり方')}">🎬 フォーム動画を見る (YouTube)</a>
    <button class="btn ghost" onclick="closeModal()">閉じる</button>`);
  const tb = $('#ex-timer', bg);
  if (tb) tb.addEventListener('click', () => {
    startRestTimer(restSec, ex.name + ' の休憩');
    closeModal();
    toast(`⏱ 休憩${Math.round(restSec)}秒スタート`);
  });
}

// reps文字列 "8-12" → 中央値
function repMid(reps) {
  const m = String(reps).match(/(\d+)\s*-\s*(\d+)/);
  if (m) return Math.round((Number(m[1]) + Number(m[2])) / 2);
  const n = parseInt(reps, 10);
  return isNaN(n) ? 10 : n;
}

// ===== HOME =====
const TIPS = [
  '筋肉はトレ中ではなく休んでいる間に成長する。睡眠不足はセット数の努力を大きく目減りさせる。',
  'タンパク質は一度に大量より、1日3〜5回に分けた方が合成効率が高い。',
  '重量を毎回2.5%ずつでも増やせれば、1年後には別人になっている(漸進性過負荷)。',
  '筋肉痛が無くても筋肉は成長する。痛み=効果ではない。',
  '最後のセットは「あと2回できるかどうか」の強度が筋肥大のスイートスポット。',
  'フォームが崩れた1回は、きれいな0回より価値が低い。重量より フォーム。',
  '同じ部位は48〜72時間空ける。連日やるなら部位を変える。',
  'トレ前のカフェインは挙上回数を数%伸ばす。トレ後よりトレ前30分。',
  '有酸素は筋トレの後。先にやると挙上重量が落ちる。',
  '停滞したらセット数を1〜2週間半分に落とす(ディロード)と、また伸び始める。',
  '体重×2gのタンパク質。これだけで筋トレ効果の土台の半分は確保できる。',
  '記録をつける人はつけない人より伸びる。前回の自分がライバル。',
];

// dayDoneエントリの正規化: 旧形式(数値)は plan コンテキスト扱い
function ddGet(dayMap, exId) {
  const v = dayMap && dayMap[exId];
  if (v == null) return null;
  if (typeof v === 'number') return { id: v, src: 'plan' };
  return v; // { id, src }
}
// 今日実施中のコンテキストキー (通常プラン or 特定マイメニュー)
function ctxKeyOf(ctx) {
  return ctx && ctx.myMenu && S.myToday ? 'menu:' + S.myToday.id : 'plan';
}

// 直近7日で「プラン日なのに記録ゼロ」の未消化日を探す
// (最後にトレした日より前・プラン作成日より前は見ない)
function findMissedDay() {
  if (!S.plan) return null;
  const today = todayStr();
  const logDates = new Set(S.logs.map(l => l.date));
  for (let i = 1; i <= 7; i++) {
    const d = dateAdd(today, -i);
    if (logDates.has(d)) break;
    if (S.plan.createdAt && d < S.plan.createdAt) break; // プランが存在しなかった日はサボり扱いしない
    const dow = new Date(d + 'T12:00:00').getDay();
    const idx = S.plan.days.findIndex(x => x.weekday === dow);
    if (idx >= 0) return { date: d, idx };
  }
  return null;
}

// 前回のトレ日でやり残した種目 (回復済みの部位のみ・最大2種目)
function findCarryover(excludeIds) {
  if (!S.plan) return [];
  const today = todayStr();
  // 回復判定は今日のログを除いて行う (チェックした瞬間にcarryが消えるのを防ぐ)
  const pastLogs = S.logs.filter(l => l.date !== today);
  const recov = {};
  recoveryStatus(pastLogs, DB.byId).forEach(r => { recov[r.part] = r.state; });
  const lastTrained = [...new Set(pastLogs.map(l => l.date))].filter(d => d < today).sort().reverse()[0];
  if (!lastTrained) return [];
  const dow = new Date(lastTrained + 'T12:00:00').getDay();
  const day = S.plan.days.find(x => x.weekday === dow);
  if (!day) return [];
  const doneToday = S.dayDone[today] || {};
  return day.items.filter(it =>
    DB.byId[it.exId] &&
    !pastLogs.some(l => l.date === lastTrained && l.exId === it.exId) &&
    !excludeIds.has(it.exId) &&
    // チェック済みのcarryは常に表示に残す(解除経路の維持)。未チェックは完全回復した部位のみ
    (doneToday[it.exId] != null || (recov[it.part] !== 'resting' && recov[it.part] !== 'almost'))
  ).slice(0, 2);
}

// 今日実施すべきメニュー (マイメニュー・振替・積み残し込み)
function todayPlanContext() {
  const today = todayStr();
  if (S.myToday && S.myToday.date === today) {
    const menu = S.myMenus.find(m => m.id === S.myToday.id);
    if (menu) {
      const day = { name: menu.name, weekday: new Date().getDay(), items: menu.items, minutes: dayMinutes(menu.items) };
      return { day, idx: -1, swapped: false, carry: [], myMenu: true };
    }
  }
  if (!S.plan) return { day: null, idx: -1, swapped: false, carry: [] };
  let idx = S.plan.days.findIndex(d => d.weekday === new Date().getDay());
  let swapped = false;
  if (S.swap && S.swap.date === today && S.plan.days[S.swap.idx]) { idx = S.swap.idx; swapped = true; }
  const day = idx >= 0 ? S.plan.days[idx] : null;
  const carry = day ? findCarryover(new Set(day.items.map(i => i.exId))) : [];
  return { day, idx, swapped, carry };
}

// C: 休養日のアクティブレスト提案カード(オプトイン)。OFF/未ロード時は空文字
function activeRestCardHtml() {
  if (!S.activeRest || typeof buildRecoveryRoutine !== 'function') return '';
  const goal = S.profile ? S.profile.goal : 'hyp';
  const routine = buildRecoveryRoutine(todayStr(), goal);
  if (!routine.length) return '';
  const today = todayStr();
  const doneMap = S.recoveryDone[today] || {};
  const doneCount = routine.filter(m => doneMap[m.id]).length;
  const rows = routine.map(m => {
    const done = !!doneMap[m.id];
    return `
      <div class="today-ex ${done ? 'done' : ''}" data-rc="${m.id}">
        <input type="checkbox" class="rc-chk" data-rc="${m.id}" ${done ? 'checked' : ''}>
        <div class="info" data-rc-open="${m.id}">
          <div class="nm">${esc(m.name)}</div>
          <div class="meta"><span class="tag low" style="font-size:10px">${esc(RECOVERY_CAT_LABEL[m.cat] || '')}</span> ${esc(m.area)} / ${esc(m.amount)}</div>
        </div>
        <span class="unit" style="font-size:16px">›</span>
      </div>`;
  }).join('');
  return `<div class="card"><h2>🧘 アクティブレスト<span class="sub">${doneCount}/${routine.length} 実施</span></h2>
    <p style="font-size:13px;margin-bottom:8px">休むだけより、低強度で姿勢・柔軟・可動性を整えると回復が進みます。<b>項目をタップでやり方と動画</b>、チェックで実施記録。<b>痛みが出たら中止</b>。</p>
    ${rows}
    <p class="card-note">日替わりで内容が変わります。全部で5〜10分ほど。プラン画面の⚙️オプションでON/OFFできます。</p></div>`;
}

// アクティブレストの実施記録トグル
function toggleRecoveryDone(id, checked) {
  const today = todayStr();
  if (!S.recoveryDone[today]) S.recoveryDone[today] = {};
  if (checked) S.recoveryDone[today][id] = true;
  else delete S.recoveryDone[today][id];
  saveState();
  if (currentView() === 'home') renderHome();
}

// アクティブレスト種目の詳細モーダル(やり方・動画・実施記録)
function openRecoveryModal(id) {
  const m = (typeof RECOVERY_MOVES !== 'undefined') ? RECOVERY_MOVES.find(x => x.id === id) : null;
  if (!m) return;
  const today = todayStr();
  const done = !!(S.recoveryDone[today] && S.recoveryDone[today][id]);
  const bg = openModal(`
    <h2>${esc(m.name)}</h2>
    <p class="modal-sub"><span class="tag low">${esc(RECOVERY_CAT_LABEL[m.cat] || '')}</span> ${esc(m.area)} / 目安 ${esc(m.amount)}</p>
    <div class="field"><label>やり方</label><p style="font-size:13.5px;line-height:1.7">${esc(m.cue)}</p></div>
    <div class="field"><label>ポイント</label><p style="font-size:13px;color:var(--ink-dim)">反動をつけずゆっくり、呼吸を止めない。<b style="color:var(--warn)">痛みが出たら中止</b>。休養日の回復を助ける低強度メニューです。</p></div>
    <a class="btn ghost" style="margin-bottom:10px;text-decoration:none" target="_blank" rel="noopener"
       href="https://www.youtube.com/results?search_query=${encodeURIComponent(m.name + ' やり方')}">🎬 やり方の動画を見る (YouTube)</a>
    <button class="btn" id="rc-done-btn">${done ? '✓ 実施済み(取り消す)' : '実施した'}</button>
    <button class="btn ghost" onclick="closeModal()" style="margin-top:8px">閉じる</button>`);
  $('#rc-done-btn', bg).addEventListener('click', () => { toggleRecoveryDone(id, !done); closeModal(); });
}

let homeDate = null;  // renderHome時点の日付 (日付跨ぎの誤記録防止)
let homeCarry = [];   // renderHome時点の積み残しスナップショット (表示とチェック処理の一致保証)
function renderHome() {
  const root = $('#view-home');
  const today = todayStr();
  homeDate = today;
  const target = S.profile ? S.profile.days : 3;
  const weekStreak = calcWeekStreak(S.logs, target);
  const weekDone = thisWeekDays(S.logs);

  let html = `
    <div class="stat-row">
      <div class="stat-tile"><div class="k">🔥 連続達成</div><div class="v"><em>${weekStreak}</em><small> 週</small></div></div>
      <div class="stat-tile"><div class="k">📅 今週</div><div class="v"><em>${weekDone}</em><small> / ${target}日</small></div></div>
      <div class="stat-tile"><div class="k">📚 総トレ日</div><div class="v"><em>${new Set(S.logs.map(l => l.date)).size}</em><small> 日</small></div></div>
    </div>`;

  const ctx0 = todayPlanContext();
  if (!S.profile && !ctx0.myMenu) {
    html += `<div class="card"><div class="empty"><span class="big-emoji">💪</span>まずはプロフィール設定から。<br>30秒であなた専用メニューを作ります。</div>
      <button class="btn" id="home-setup">はじめる</button></div>`;
  } else if (!S.plan && !ctx0.myMenu) {
    html += `<div class="card"><div class="empty"><span class="big-emoji">📋</span>メニューがまだありません。</div>
      <button class="btn" onclick="location.hash='plan'">メニューを作る</button></div>`;
  } else {
    const ctx = ctx0;
    const doneMap = (S.dayDone[today] || {});

    // 未消化日バナー (振替の提案)。今日すでにトレ済みなら出さない
    const missed = findMissedDay();
    const trainedToday = S.logs.some(l => l.date === today);
    if (missed && !ctx.swapped && !ctx.myMenu && !trainedToday && missed.idx !== ctx.idx && (!S.swapDismiss || S.swapDismiss < missed.date)) {
      const md = S.plan.days[missed.idx];
      html += `<div class="card" style="border-color:var(--warn)">
        <h2>⏰ ${WEEKDAY_NAMES[md.weekday]}曜の「${esc(md.name)}」が未消化</h2>
        <p style="font-size:13px;margin-bottom:10px">サボりは取り戻せます。今日このメニューに振り替えますか?</p>
        <div style="display:flex;gap:8px">
          <button class="btn small" id="swap-do">今日やる(振替)</button>
          <button class="btn small ghost" id="swap-skip">流す</button>
        </div></div>`;
    }

    homeCarry = ctx.carry; // チェック処理と表示のズレを防ぐスナップショット
    const curCtxKey = ctxKeyOf(ctx); // 通常プランとマイメニューでチェック状態を分離
    const exRow = (it, isCarry) => {
      const ex = DB.byId[it.exId];
      if (!ex) return '';
      const de = ddGet(doneMap, it.exId);
      const done = !!(de && de.src === curCtxKey);
      const lastW = S.lastW[it.exId];
      const lastR = S.lastR[it.exId];
      const isBW = ex.equipment === 'bodyweight';
      const unit = ex.isometric ? '秒キープ' : '回';
      const rUnit = ex.isometric ? '秒' : '回';
      const scKey = curCtxKey + '|' + it.exId;
      const cnt = done ? it.sets : ((S.setCount[today] && S.setCount[today][scKey]) || 0);
      const dots = Array.from({ length: it.sets }, (_, i) => `<span class="sd ${i < cnt ? 'on' : ''}" data-i="${i}"></span>`).join('');
      return `
        <div class="today-ex ${done ? 'done' : ''}" data-ex="${it.exId}">
          <input type="checkbox" class="done-chk" data-ex="${it.exId}" ${done ? 'checked' : ''}>
          <div class="info" data-open-ex="${it.exId}" data-rest="${it.rest}">
            <div class="nm">${esc(ex.name)}${it.priority ? '<span style="color:var(--accent)"> ◆</span>' : ''}</div>
            <div class="meta">${isCarry ? '<b style="color:var(--warn)">⏳前回の積み残し</b> / ' : ''}目標 ${esc(it.reps)}${unit} × ${it.sets}セット / 休憩${it.rest}秒</div>
            <div class="setdots" data-ex="${it.exId}">${dots}<span class="sdlabel">${cnt}/${it.sets}セット${done ? ' ✓' : ''}</span></div>
          </div>
          ${isBW ? '<span class="unit">自重</span>' : `<input type="number" class="winp" data-ex="${it.exId}" value="${lastW != null ? lastW : ''}" placeholder="kg" step="0.5"><span class="unit">kg</span>`}
          <input type="number" class="rinp" data-ex="${it.exId}" value="${lastR != null ? lastR : repMid(it.reps)}" placeholder="${rUnit}" min="1" step="1"><span class="unit">${rUnit}</span>
          <button class="ex-tmr" data-tmr-ex="${it.exId}" data-tmr-rest="${it.rest}" title="休憩タイマー ${it.rest}秒">⏱</button>
        </div>`;
    };

    if (ctx.day) {
      const burn = S.profile ? sessionBurn([...ctx.day.items, ...ctx.carry], DB.byId, S.profile.w) : 0;
      html += `<div class="card"><h2>🏋️ 今日は「${esc(ctx.day.name)}」${ctx.swapped ? '<span class="tag high" style="font-size:10px">振替</span>' : ''}${ctx.myMenu ? '<span class="tag low" style="font-size:10px">マイ</span>' : ''}<span class="sub">約${ctx.day.minutes}分 / 約${burn}kcal</span></h2>`;
      ctx.day.items.forEach(it => { html += exRow(it, false); });
      ctx.carry.forEach(it => { html += exRow(it, true); });
      html += `<p class="card-note">チェックすると記録に自動保存。種目名タップでフォーム解説と動画。◆は優先部位。重量は「指定回数がギリギリできる重さ」、わからない日は軽めでOK・次回ちょい足し。${ctx.carry.length ? '⏳は前回やり残した分(回復済みの部位のみ提案)。' : ''}${ctx.swapped ? ' <button class="btn small ghost" id="swap-undo">振替をやめる</button>' : ''}${ctx.myMenu ? ' <button class="btn small ghost" id="mymenu-undo">通常メニューに戻す</button>' : ''}</p></div>`;
    } else {
      const dow = new Date().getDay();
      const nextDays = S.plan.days.map((d, i) => ({ ...d, idx: i, diff: (d.weekday - dow + 7) % 7 || 7 })).sort((a, b) => a.diff - b.diff);
      const nx = nextDays[0];
      html += `<div class="card"><h2>😴 今日は休息日</h2>
        <p style="font-size:14px">筋肉が育つのは今。次は<b style="color:var(--accent)">${WEEKDAY_NAMES[nx.weekday]}曜「${esc(nx.name)}」</b>です。</p>
        <p class="card-note">タンパク質(体重×${SCIENCE.proteinPerKg[S.profile.goal] || 1.8}g)と睡眠を忘れずに。</p>
        <button class="btn ghost" id="rest-start" data-idx="${nx.idx}">💪 待てない?「${esc(nx.name)}」を今日やる</button></div>`;
      html += activeRestCardHtml();
    }

    // 回復マップ
    const recov = recoveryStatus(S.logs, DB.byId);
    const stLabel = { fresh: '未実施', ready: '回復済', almost: 'もう少し', resting: '回復中' };
    html += `<div class="card"><h2>🔋 部位の回復状態</h2><div class="recov-grid">` +
      recov.map(r => `<div class="recov-cell ${r.state}"><div class="nm">${esc(r.name)}</div><div class="st">${r.state === 'resting' || r.state === 'almost' ? `あと${r.remainH}h` : stLabel[r.state]}</div></div>`).join('') +
      `</div><p class="card-note">記録から超回復(48〜72時間)の目安を計算。「回復済」の部位が狙い目。</p></div>`;
  }

  // 今日のヒント (日替わり・未成年にはカフェイン系を出さない)
  const tipList = S.profile && S.profile.age < 18 ? TIPS.filter(t => t.indexOf('カフェイン') < 0) : TIPS;
  const tipIdx = Math.floor(new Date(today + 'T12:00:00').getTime() / 86400000) % tipList.length;
  html += `<div class="card tip-card"><h2>💡 今日の筋知識</h2><p style="font-size:13.5px">${esc(tipList[tipIdx])}</p></div>`;

  root.innerHTML = html;

  const setup = $('#home-setup', root);
  if (setup) setup.addEventListener('click', () => openProfileWizard(true));

  const swapDo = $('#swap-do', root);
  if (swapDo) swapDo.addEventListener('click', () => {
    if (homeDate !== todayStr()) { renderHome(); return; } // 日付跨ぎは再描画のみ
    const missed = findMissedDay();
    if (missed) { S.swap = { date: todayStr(), idx: missed.idx }; saveState(); toast('今日のメニューを振り替えました'); }
    renderHome();
  });
  const swapSkip = $('#swap-skip', root);
  if (swapSkip) swapSkip.addEventListener('click', () => {
    if (homeDate !== todayStr()) { renderHome(); return; }
    const missed = findMissedDay();
    if (missed) { S.swapDismiss = missed.date; saveState(); }
    renderHome();
  });
  const swapUndo = $('#swap-undo', root);
  if (swapUndo) swapUndo.addEventListener('click', () => {
    S.swap = null; saveState(); renderHome();
  });
  const myUndo = $('#mymenu-undo', root);
  if (myUndo) myUndo.addEventListener('click', () => {
    S.myToday = null; saveState(); renderHome();
  });
  const restStart = $('#rest-start', root);
  if (restStart) restStart.addEventListener('click', () => {
    if (homeDate !== todayStr()) { renderHome(); return; }
    S.swap = { date: todayStr(), idx: Number(restStart.dataset.idx) };
    saveState();
    toast('今日のメニューにしました💪');
    renderHome();
  });

  $all('.done-chk', root).forEach(chk => {
    chk.addEventListener('change', () => toggleDone(chk.dataset.ex, chk.checked));
  });
  $all('[data-open-ex]', root).forEach(el => {
    el.addEventListener('click', () => openExerciseModal(el.dataset.openEx, Number(el.dataset.rest) || 0));
  });
  $all('.rc-chk', root).forEach(chk => {
    chk.addEventListener('change', () => toggleRecoveryDone(chk.dataset.rc, chk.checked));
  });
  $all('[data-rc-open]', root).forEach(el => {
    el.addEventListener('click', () => openRecoveryModal(el.dataset.rcOpen));
  });
  $all('.ex-tmr', root).forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const ex = DB.byId[btn.dataset.tmrEx];
      startRestTimer(Number(btn.dataset.tmrRest) || 90, (ex ? ex.name : '') + ' の休憩');
      toast(`⏱ 休憩${Math.round(Number(btn.dataset.tmrRest) || 90)}秒スタート`);
    });
  });
  $all('input.winp', root).forEach(inp => {
    inp.addEventListener('change', () => {
      const w = Number(inp.value);
      if (w > 0) { S.lastW[inp.dataset.ex] = w; saveState(); }
    });
  });
  $all('input.rinp', root).forEach(inp => {
    inp.addEventListener('change', () => {
      const r = Math.round(Number(inp.value));
      if (r > 0) { S.lastR[inp.dataset.ex] = r; saveState(); }
    });
  });
  $all('.setdots .sd', root).forEach(dot => {
    dot.addEventListener('click', e => {
      e.stopPropagation(); // 種目タップ(フォーム解説)を抑止
      const exId = dot.closest('.setdots').dataset.ex;
      const i = Number(dot.dataset.i);
      const ctx = todayPlanContext();
      const key = ctxKeyOf(ctx) + '|' + exId;
      const cur = (S.setCount[today] && S.setCount[today][key]) || 0;
      // 一番上の点を再タップ=1つ戻す、それ以外=その点まで進める
      setExerciseProgress(exId, cur === i + 1 ? i : i + 1);
    });
  });
}

// ホーム: 種目のセット進捗を更新。満了で自動チェック(記録)、以降は休憩タイマーも出す
function setExerciseProgress(exId, newCount) {
  const today = todayStr();
  if (homeDate !== today) { renderHome(); return; }
  const ctx = todayPlanContext();
  const ck = ctxKeyOf(ctx);
  const allItems = ctx.day ? [...ctx.day.items, ...homeCarry] : [];
  const item = allItems.find(i => i.exId === exId);
  if (!item) return;
  const total = item.sets;
  newCount = Math.max(0, Math.min(total, Math.round(newCount)));
  if (!S.setCount[today]) S.setCount[today] = {};
  const key = ck + '|' + exId;
  const prev = S.setCount[today][key] || 0;
  S.setCount[today][key] = newCount;
  const de = ddGet(S.dayDone[today], exId);
  const wasDone = !!(de && de.src === ck);
  // 満了 → 記録(自動チェック)。満了未満へ戻す → 記録解除。どちらも toggleDone が再描画する
  if (newCount >= total && !wasDone) { saveState(); toggleDone(exId, true); return; }
  if (newCount < total && wasDone) { saveState(); toggleDone(exId, false); return; }
  // 途中のセット完了(増加時のみ)は休憩タイマーを出す
  if (newCount > prev && newCount < total) {
    const ex = DB.byId[exId];
    startRestTimer(Number(item.rest) || 90, (ex ? ex.name : '') + ' の休憩');
    toast(`⏱ ${newCount}/${total}セット完了・休憩${Math.round(Number(item.rest) || 90)}秒`);
  }
  saveState();
  renderHome();
}

function toggleDone(exId, checked) {
  const today = todayStr();
  if (homeDate !== today) { renderHome(); return; } // 画面表示中に日付が変わっていたら再描画のみ(誤記録防止)
  if (!S.dayDone[today]) S.dayDone[today] = {};
  const ctx = todayPlanContext();
  const ck = ctxKeyOf(ctx);
  const allItems = ctx.day ? [...ctx.day.items, ...homeCarry] : [];
  const item = allItems.find(i => i.exId === exId);
  const doneInCtx = i => { const e = ddGet(S.dayDone[today], i.exId); return e && e.src === ck; };
  if (checked && item) {
    const winp = $(`input.winp[data-ex="${exId}"]`);
    const w = winp ? Number(winp.value) || 0 : 0;
    if (w > 0) S.lastW[exId] = w;
    const rinp = $(`input.rinp[data-ex="${exId}"]`);
    const r = rinp && Number(rinp.value) > 0 ? Math.round(Number(rinp.value)) : repMid(item.reps); // 実際の回数を優先(未入力なら目標の中央値)
    if (r > 0) S.lastR[exId] = r;
    const logId = newId();
    S.logs.push({
      id: logId, date: today, exId,
      sets: Array.from({ length: item.sets }, () => ({ w, r })),
    });
    S.dayDone[today][exId] = { id: logId, src: ck };
    if (!S.setCount[today]) S.setCount[today] = {};
    S.setCount[today][ck + '|' + exId] = item.sets; // ドット表示を満了に同期
    saveState();
    const remaining = allItems.filter(i => DB.byId[i.exId] && !doneInCtx(i)).length;
    toast(remaining === 0 ? '🎉 今日のメニュー完遂!ナイスワーク!' : `記録しました(残り${remaining}種目)`);
    if (remaining === 0) setTimeout(() => { if (!$('#modal-bg')) openShareModal(today); }, 900); // 完遂したらシェアを提案 (別モーダル表示中は邪魔しない)
  } else {
    const e = ddGet(S.dayDone[today], exId);
    // 現在のコンテキストで作った記録だけを消す (別セッションの記録は触らない)
    if (e && e.src === ck) {
      S.logs = S.logs.filter(l => l.id !== e.id);
      delete S.dayDone[today][exId];
      if (S.setCount[today]) delete S.setCount[today][ck + '|' + exId]; // ドット進捗もクリア
      saveState();
    }
  }
  renderHome();
}

// ===== PLAN =====
// 除外により実トレ日が要求日数より減ったか(A: 説明用)。減っていなければ null。
// 現在の除外×日数から計算した休養日が「実際のプラン日数」と一致する時だけ返す
// (生成後に日数や除外を変えた=staleな時は誤った説明を出さないよう null)。
function planDayReduction() {
  if (!S.plan || !S.profile || S.fillDays) return null;
  const requested = S.profile.days;
  const actual = S.plan.days.length;
  if (actual >= requested) return null;
  const template = (S.profile.goal === 'posture' ? POSTURE_SPLITS : SPLITS)[requested] || [];
  const excluded = S.exclude || {};
  const dropped = template
    .filter(dt => !dt.parts.some(a => !excluded[parsePartSpec(a).part]))
    .map(dt => dt.name);
  // 除外で1日も減らない、または計算上の残日数が実プランと食い違う(=stale)なら説明を出さない
  if (!dropped.length || (requested - dropped.length) !== actual) return null;
  return { requested, actual, dropped };
}

function renderPlan() {
  const root = $('#view-plan');
  let html = '';

  if (!S.profile) {
    html += `<div class="card"><div class="empty"><span class="big-emoji">🧬</span>まずプロフィールを設定すると<br>あなた専用メニューを組めます。</div>
      <button class="btn" id="plan-setup">プロフィール設定</button></div>`;
    root.innerHTML = html;
    $('#plan-setup', root).addEventListener('click', () => openProfileWizard(true));
    return;
  }

  const p = S.profile;
  html += `<div class="card"><h2>👤 プロフィール<span class="sub"><button class="btn small ghost" id="edit-profile">編集</button></span></h2>
    <div class="focus-chips">
      <span class="chip">${p.sex === 'f' ? '女性' : '男性'} ${p.age}歳</span>
      <span class="chip">${p.h}cm / ${p.w}kg</span>
      <span class="chip">${esc(SCIENCE.levels[p.level])}</span>
      <span class="chip">${esc(SCIENCE.envs[p.env].name)}</span>
      <span class="chip">${esc(SCIENCE.goals[p.goal].name)}</span>
      <span class="chip">週${p.days}日 × ${p.minutes}分</span>
    </div></div>`;

  html += `<div class="card"><h2>🎯 狙う部位をタップ</h2>
    <div class="bodymap-wrap">
      <div class="bodymap"><div id="bm-front">${bodymapSvg('front')}</div><div class="bm-label">前面</div></div>
      <div class="bodymap"><div id="bm-back">${bodymapSvg('back')}</div><div class="bm-label">背面</div></div>
    </div>
    <div class="bm-legend">
      <span><span class="dot" style="background:var(--accent)"></span>でかくする</span>
      <span><span class="dot" style="background:var(--accent2)"></span>引き締める</span>
      <span><span class="dot" style="background:#3a414c"></span>やらない</span>
    </div>
    <div class="focus-chips" id="focus-chips"></div>
    <p class="card-note">タップで でかく → 引き締め → <b>やらない</b> → 解除 の順に切替。「やらない」にした部位はメニューから外れ、効率シミュレーターも残りの部位に集中した計算になります。優先部位は種目数+1・セット数+1でどのトレ日にも必ず入ります。※「引き締め」も軽い高回数でなくしっかり効かせるのが最短(絞りは食事タブで)。</p>
  </div>`;

  html += `<div style="display:flex;gap:10px;margin-bottom:14px">
    <button class="btn" id="gen-plan">${S.plan ? 'メニューを作り直す' : 'メニュー生成'}</button>
    ${S.plan ? '<button class="btn ghost" id="shuffle-plan" style="width:auto">🔀</button>' : ''}
  </div>`;

  // オプション(オプトイン): B=指定日数で組む / C=休養日アクティブレスト
  html += `<div class="card"><h2>⚙️ メニューのオプション</h2>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:14px">🔁 除外しても指定日数で組む</div>
        <div class="card-note" style="margin:2px 0 0">「やらない部位」で日が空いても、残りの部位で<b>週${p.days}日を維持</b>(頻度アップ)。OFFなら空いた日は休養日。</div>
      </div>
      <button class="btn small ${S.fillDays ? '' : 'ghost'}" id="opt-fill" style="width:auto;flex:none;min-width:56px">${S.fillDays ? 'ON' : 'OFF'}</button>
    </div>
    <div style="display:flex;align-items:center;gap:10px">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:14px">🧘 休養日にアクティブレスト</div>
        <div class="card-note" style="margin:2px 0 0">休養日のホームに、<b>姿勢改善・柔軟・可動性</b>の軽メニューを提案。超回復を妨げない低強度。どの目標でもOK。</div>
      </div>
      <button class="btn small ${S.activeRest ? '' : 'ghost'}" id="opt-rest" style="width:auto;flex:none;min-width:56px">${S.activeRest ? 'ON' : 'OFF'}</button>
    </div>
  </div>`;

  if (S.plan) {
    // A: 除外で実トレ日が減った時の説明
    const red = planDayReduction();
    if (red) {
      html += `<div class="card" style="border-color:var(--accent2,#4ed9f1)"><h2>ℹ️ 実際のトレは週${red.actual}日</h2>
        <p style="font-size:13.5px;margin-bottom:6px">「やらない部位」の設定により、週${red.requested}日のうち<b>${red.requested - red.actual}日</b>は鍛える部位が無いため休養日にしました${red.dropped.length ? `(${esc(red.dropped.join('・'))})` : ''}。残りの部位は週${red.actual}日でしっかり回せています。</p>
        <p class="card-note">同じ日数で回したい場合は、上の <b>🔁 除外しても指定日数で組む</b> をONに。効率タブの数字はこの実メニュー基準です。</p></div>`;
    }
  }

  if (S.plan) {
    html += `<div class="card"><h2>📋 週間メニュー<span class="sub">${S.plan.createdAt} 生成</span></h2>`;
    S.plan.days.forEach((day, di) => {
      html += `<div class="plan-day"><div class="plan-day-head"><span class="wd">${WEEKDAY_NAMES[day.weekday]}</span>${esc(day.name)}<span class="mins">約${day.minutes}分</span></div>`;
      day.items.forEach((it, ii) => {
        const ex = DB.byId[it.exId];
        if (!ex) return;
        html += `<div class="plan-ex" data-open-ex="${it.exId}" data-rest="${it.rest}">
          <div><div class="nm">${esc(ex.name)}${it.priority ? '<span class="pri">◆優先</span>' : ''}</div>
          <div class="meta">${esc(SCIENCE.partMap[ex.part].name)} / ${EQUIP_NAMES[ex.equipment]}</div></div>
          <div class="setrep">${it.sets}×${esc(it.reps)}${ex.isometric ? '秒' : ''}<small>休${it.rest}秒</small></div>
          <button class="plan-ex-edit" data-di="${di}" data-ii="${ii}" aria-label="編集" style="flex:none;background:none;border:none;color:inherit;opacity:.55;font-size:16px;padding:4px 2px 4px 6px;cursor:pointer">✎</button>
        </div>`;
      });
      html += `<div style="padding:8px 14px"><button class="btn ghost small add-ex" data-di="${di}" style="width:100%">＋ 種目を追加</button></div>`;
      html += `</div>`;
    });
    html += `<p class="card-note">種目タップでフォーム解説、✎でセット/レップ/休憩を編集。＋で種目追加。曜日は目安なのでズレてもOK。</p></div>`;

    // 週間ボリュームと判定
    html += `<div class="card"><h2>📊 部位別 週セット数</h2>`;
    SCIENCE.parts.forEach(pt => {
      if (S.exclude[pt.key]) {
        html += `<div class="vol-row" style="opacity:.45"><span class="nm">${esc(pt.name)}</span>
          <span class="bar"><i style="width:0%"></i></span>
          <span class="val"><span class="tag" style="opacity:.8">やらない</span></span></div>`;
        return;
      }
      const sets = S.plan.weeklySets[pt.key] || 0;
      const verdict = volumeVerdict(pt.key, sets, S.profile.goal);
      const pct = Math.min(100, (sets / pt.mrv) * 100);
      html += `<div class="vol-row"><span class="nm">${esc(pt.name)}</span>
        <span class="bar"><i style="width:${pct}%"></i></span>
        <span class="val">${sets}<span class="tag ${verdict.cls}">${verdict.label}</span></span></div>`;
    });
    const hasLow = SCIENCE.parts.some(pt => !S.exclude[pt.key] && volumeVerdict(pt.key, S.plan.weeklySets[pt.key] || 0, S.profile.goal).cls === 'low');
    html += `<p class="card-note">${S.profile.goal === 'posture'
      ? '姿勢改善は背中・肩・体幹・尻が主役。前面(胸・脚など)は「維持OK」なら十分です。'
      : `筋肥大の最適は部位あたり週10〜20セット。${hasLow ? '<b>「やや不足」は今の時間×日数で入る上限</b>です。1日+15分か週+1日で最適圏に届きます(効率タブで試算可)。' : ''}`}シミュレーターで効率を確認できます。</p></div>`;
  }

  root.innerHTML = html;
  applyFocusToMaps(root);

  $('#edit-profile', root).addEventListener('click', () => openProfileWizard(false));
  $all('.bm-part', root).forEach(g => {
    g.addEventListener('click', () => {
      const part = g.dataset.part;
      // なし → でかく → 引き締め → やらない(除外) → なし
      if (S.exclude[part]) { delete S.exclude[part]; }
      else if (!S.focus[part]) { S.focus[part] = 'grow'; }
      else if (S.focus[part] === 'grow') { S.focus[part] = 'tone'; }
      else { delete S.focus[part]; S.exclude[part] = true; }
      saveState();
      applyFocusToMaps(root);
    });
  });
  const gen = $('#gen-plan', root);
  gen.addEventListener('click', () => {
    gen.disabled = true;
    S.plan = generatePlan(DB, S.profile, S.focus, Math.floor(Math.random() * 1e9));
    S.swap = null; // 旧プランの振替は無効化
    saveState();
    toast('メニューを生成しました!');
    renderPlan();
  });
  const shuffle = $('#shuffle-plan', root);
  if (shuffle) shuffle.addEventListener('click', () => {
    S.plan = generatePlan(DB, S.profile, S.focus, Math.floor(Math.random() * 1e9));
    S.swap = null;
    saveState();
    toast('シャッフルしました');
    renderPlan();
  });
  // B: 指定日数で組む(トグル)。生成に影響するのでプランがあれば作り直す(種目は同seedで極力維持)
  const optFill = $('#opt-fill', root);
  if (optFill) optFill.addEventListener('click', () => {
    S.fillDays = !S.fillDays;
    if (S.plan) {
      S.plan = generatePlan(DB, S.profile, S.focus, S.plan.seed || Math.floor(Math.random() * 1e9));
      S.swap = null;
    }
    saveState();
    toast(S.fillDays ? '指定日数で組みます' : '空いた日は休養日にします');
    renderPlan();
  });
  // C: 休養日アクティブレスト(トグル)。ホーム表示に影響
  const optRest = $('#opt-rest', root);
  if (optRest) optRest.addEventListener('click', () => {
    S.activeRest = !S.activeRest;
    saveState();
    toast(S.activeRest ? '休養日にアクティブレストを出します' : 'アクティブレストをOFFにしました');
    renderPlan();
  });
  $all('.plan-ex-edit', root).forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation(); // 行タップ(フォーム解説)を抑止して編集を開く
    openPlanItemEditor(Number(b.dataset.di), Number(b.dataset.ii));
  }));
  $all('.add-ex', root).forEach(b => b.addEventListener('click', () => openPlanExercisePicker(Number(b.dataset.di), null)));
  $all('[data-open-ex]', root).forEach(el => {
    el.addEventListener('click', () => openExerciseModal(el.dataset.openEx, Number(el.dataset.rest) || 0));
  });
}

// プラン編集: セット数/ボリュームなどの派生値を再計算(sanitizePlanと同じロジック)
function recomputePlanDerived() {
  if (!S.plan) return;
  const ws = {};
  SCIENCE.parts.forEach(pt => { ws[pt.key] = 0; });
  S.plan.days.forEach(d => {
    d.items.forEach(it => { if (ws[it.part] != null) ws[it.part] += it.sets; });
    d.minutes = dayMinutes(d.items);
  });
  S.plan.weeklySets = ws;
}

// プラン: 1種目のセット/レップ/休憩を自由編集(+削除・種目変更)
function openPlanItemEditor(di, ii) {
  const day = S.plan && S.plan.days[di];
  const item = day && day.items[ii];
  if (!item) return;
  const ex = DB.byId[item.exId];
  const bg = openModal(`
    <h2>${esc(ex ? ex.name : '種目')}</h2>
    <p class="modal-sub">セット・レップ・休憩を自由に調整できます。</p>
    <div class="grid2">
      <div class="field"><label>セット数</label><input type="number" id="pe-sets" value="${item.sets}" min="1" max="10" inputmode="numeric"></div>
      <div class="field"><label>${ex && ex.isometric ? 'キープ秒' : 'レップ'}</label><input type="text" id="pe-reps" value="${esc(item.reps)}" maxlength="20" placeholder="例: 8-12"></div>
    </div>
    <div class="field"><label>休憩（秒・15〜600）</label><input type="number" id="pe-rest" value="${item.rest}" min="15" max="600" step="15" inputmode="numeric"></div>
    <div style="display:flex;gap:8px;margin-top:6px">
      <button class="btn ghost small" id="pe-swap" style="flex:1">別の種目に変更</button>
      <button class="btn ghost small" id="pe-del" style="flex:1;color:var(--warn,#f87171)">この種目を削除</button>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="btn ghost" onclick="closeModal()">キャンセル</button>
      <button class="btn" id="pe-save">保存</button>
    </div>`);
  $('#pe-save', bg).addEventListener('click', () => {
    item.sets = Math.max(1, Math.min(10, Math.round(Number($('#pe-sets', bg).value) || item.sets)));
    const reps = ($('#pe-reps', bg).value || '').trim().slice(0, 20);
    if (reps) item.reps = reps;
    item.rest = Math.max(15, Math.min(600, Math.round(Number($('#pe-rest', bg).value) || item.rest)));
    recomputePlanDerived(); saveState(); closeModal(); toast('更新しました'); renderPlan();
  });
  $('#pe-del', bg).addEventListener('click', () => {
    day.items.splice(ii, 1);
    recomputePlanDerived(); saveState(); closeModal(); toast('削除しました'); renderPlan();
  });
  $('#pe-swap', bg).addEventListener('click', () => { closeModal(); openPlanExercisePicker(di, ii); });
}

// プラン: 種目を選ぶ(replaceIi=null なら追加、番号指定なら差し替え)
function openPlanExercisePicker(di, replaceIi) {
  if (!S.plan || !S.plan.days[di]) return;
  const goal = S.profile.goal;
  const partBtns = SCIENCE.parts.map(pt => `<button class="btn ghost small pick-part" data-part="${pt.key}">${esc(pt.name)}</button>`).join('');
  const bg = openModal(`
    <h2>${replaceIi != null ? '種目を変更' : '種目を追加'}</h2>
    <p class="modal-sub">部位を選ぶと種目一覧が出ます。器具が無い種目も選べます（自由設定）。</p>
    <div class="focus-chips" id="pick-parts" style="flex-wrap:wrap;gap:6px">${partBtns}</div>
    <div id="pick-list" style="margin-top:10px;max-height:44vh;overflow:auto"></div>
    <div style="margin-top:12px"><button class="btn ghost" onclick="closeModal()">閉じる</button></div>`);
  const listEl = $('#pick-list', bg);
  const showPart = (part) => {
    const exs = DB.byPart[part] || [];
    listEl.innerHTML = exs.length ? exs.map(e => `<div class="plan-ex pick-ex" data-id="${esc(e.id)}" data-part="${part}" style="cursor:pointer">
        <div><div class="nm">${esc(e.name)}</div><div class="meta">${EQUIP_NAMES[e.equipment]} / ${'★'.repeat(e.level)}${'☆'.repeat(3 - e.level)}</div></div>
        <div class="setrep" style="margin-left:auto">＋</div></div>`).join('') : '<p class="card-note">該当する種目がありません。</p>';
    $all('.pick-ex', listEl).forEach(el => el.addEventListener('click', () => {
      const e = DB.byId[el.dataset.id];
      if (!e) return;
      const base = replaceIi != null ? S.plan.days[di].items[replaceIi] : null;
      const newItem = {
        exId: e.id, part: el.dataset.part,
        sets: base ? base.sets : setsFor(goal, false),
        reps: repsFor(e, goal),
        rest: restFor(e, goal),
        priority: base ? base.priority : false,
      };
      if (replaceIi != null) S.plan.days[di].items[replaceIi] = newItem;
      else S.plan.days[di].items.push(newItem);
      recomputePlanDerived(); saveState(); closeModal();
      toast(replaceIi != null ? '種目を変更しました' : '種目を追加しました');
      renderPlan();
    }));
  };
  $all('.pick-part', bg).forEach(b => b.addEventListener('click', () => {
    $all('.pick-part', bg).forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    showPart(b.dataset.part);
  }));
}

// ===== みんなのメニュー(公開ギャラリー) =====
function openMenuPublishModal(menu) {
  const c = window.__klCloud;
  if (!c || !c.available) { toast('この環境では公開を利用できません'); return; }
  if (!c.myUid()) {
    const bg = openModal(`<h2>公開にはログインが必要です</h2>
      <p class="modal-sub">「みんなのメニュー」に公開するには、Googleログインが必要です(投稿者を識別してスパムを防ぐため)。</p>
      <div style="display:flex;gap:10px;margin-top:14px"><button class="btn ghost" onclick="closeModal()">閉じる</button><button class="btn" id="pub-login">Googleでログイン</button></div>`);
    $('#pub-login', bg).addEventListener('click', () => { closeModal(); c.signIn(); });
    return;
  }
  // プロフィール未設定なら先に設定してもらう(初回のみ)
  if (!S.publicName) { openPublicProfileModal(() => openMenuPublishModal(menu)); return; }
  const icon = S.publicIcon || PUB_ICONS[0];
  const avatar = isValidAvatar(S.publicAvatar) ? S.publicAvatar : '';
  const name = S.publicName;
  const appeal = S.publicAppeal || '';
  // 不正なリンク(インポート等で混入)はルールに弾かれ公開失敗するので空扱いにする
  const link = (S.publicLink && detectPlatform(S.publicLink)) ? S.publicLink : '';
  const platform = link ? detectPlatform(link) : '';
  const avatarHtml = avatar ? `<img src="${avatar}" alt="">` : esc(icon);
  const bg = openModal(`
    <h2>「${esc(menu.name)}」を公開</h2>
    <p class="modal-sub">このプロフィールで「みんなのメニュー」に公開されます。</p>
    <div class="pub-identity">
      <div class="gal-avatar">${avatarHtml}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:800">${esc(name)}${platform ? ` <span class="chip" style="font-size:10px">${platform}</span>` : ''}</div>
        ${appeal ? `<div style="font-size:12px;color:var(--ink-dim)">${esc(appeal)}</div>` : ''}
      </div>
    </div>
    <button class="btn ghost small" id="pub-editprofile" style="width:100%;margin:8px 0 12px">🪪 プロフィール(アイコン・名前)を編集</button>
    <p class="card-note">⚠️ 公開すると誰でも見られます。個人情報や非公開にしたい内容は入れないでください。</p>
    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="btn ghost" onclick="closeModal()">キャンセル</button>
      <button class="btn" id="pub-go">${menu.published ? '更新する' : '公開する'}</button>
    </div>
    ${menu.published && menu.pubId ? '<button class="btn ghost small" id="pub-remove" style="margin-top:10px;width:100%;color:var(--warn,#f87171)">公開を取り消す</button>' : ''}`);
  $('#pub-editprofile', bg).addEventListener('click', () => openPublicProfileModal(() => openMenuPublishModal(menu)));
  $('#pub-go', bg).addEventListener('click', async () => {
    const items = menu.items.map(it => { const ex = DB.byId[it.exId]; return { exId: it.exId, name: ex ? ex.name : '種目', part: it.part, sets: it.sets, reps: it.reps, rest: it.rest }; });
    const btn = $('#pub-go', bg); btn.disabled = true; btn.textContent = '送信中...';
    const res = await c.publishMenu({ pubId: menu.pubId, name: menu.name, items }, link, platform, name, { icon, appeal, avatar });
    if (res.ok) {
      menu.pubId = res.id; menu.pubLink = link; menu.published = true;
      saveState(); closeModal();
      toast(res.avatarDropped ? '🌐 公開しました(画像アイコンは今回反映できず絵文字で表示)' : '🌐 公開しました!');
      renderLog();
    } else {
      toast(res.reason === 'login' ? 'ログインが必要です' : '公開に失敗しました(ルール未設定の可能性)');
      btn.disabled = false; btn.textContent = menu.published ? '更新する' : '公開する';
    }
  });
  const rm = $('#pub-remove', bg);
  if (rm) rm.addEventListener('click', async () => {
    const res = await c.unpublishMenu(menu.pubId);
    if (res.ok) { menu.published = false; delete menu.pubId; saveState(); closeModal(); toast('公開を取り消しました'); renderLog(); }
    else toast('取り消しに失敗しました');
  });
}

// 公開プロフィール編集(アイコン/名前/アピール/リンクを一度設定→公開時に自動使用)
function openPublicProfileModal(afterSave) {
  const c = window.__klCloud;
  const curIcon = S.publicIcon || PUB_ICONS[0];
  const curAvatar = isValidAvatar(S.publicAvatar) ? S.publicAvatar : '';
  const curName = S.publicName || (c && c.status && c.status().user ? c.status().user.name : '') || '';
  const iconGrid = PUB_ICONS.map(ic => `<button type="button" class="icon-pick ${ic === curIcon ? 'on' : ''}" data-ic="${ic}">${ic}</button>`).join('');
  const bg = openModal(`
    <h2>🪪 公開プロフィール</h2>
    <p class="modal-sub">「みんなのメニュー」で表示されるアイコン・名前・アピール。一度設定すれば、公開のたびに自動で使われます。</p>
    <div class="field"><label>アイコン(絵文字 or 画像)</label>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div class="gal-avatar" id="pf-avatar-prev">${curAvatar ? `<img src="${curAvatar}" alt="">` : curIcon}</div>
        <label class="btn ghost small" style="width:auto">📷 画像を使う<input type="file" accept="image/*" id="pf-avatar-file" hidden></label>
        <button type="button" class="btn ghost small" id="pf-avatar-clear" style="width:auto;${curAvatar ? '' : 'display:none'}">絵文字に戻す</button>
      </div>
      <div class="icon-picker" id="pf-icons">${iconGrid}</div>
      <p class="card-note">画像は正方形に切り抜いて小さく保存します。⚠️ 公序良俗に反する画像・他人の写真の無断使用は禁止(通報対象)。</p>
    </div>
    <div class="field"><label>表示名</label>
      <input type="text" id="pf-name" placeholder="例: きんとれ太郎" maxlength="30" value="${esc(curName)}"></div>
    <div class="field"><label>ひとことアピール(任意)<span style="float:right;color:var(--ink-dim);font-size:11px" id="pf-appeal-count">0/80</span></label>
      <textarea id="pf-appeal" rows="2" maxlength="80" placeholder="例: ベンチ100kg目標!週4で頑張ってます💪">${esc(S.publicAppeal || '')}</textarea></div>
    <div class="field"><label>SNSリンク(任意)</label>
      <input type="text" id="pf-link" placeholder="https://www.instagram.com/..." maxlength="300" value="${esc(S.publicLink || '')}"></div>
    <div id="pf-link-note" class="card-note">Instagram / YouTube / TikTok / X / Threads のURLのみ。トレ動画等の宣伝に。</div>
    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="btn ghost" id="pf-cancel">キャンセル</button>
      <button class="btn" id="pf-save">保存</button>
    </div>`);
  // 公開モーダルから開いた場合、キャンセルでも公開フローに戻す
  $('#pf-cancel', bg).addEventListener('click', () => { closeModal(); if (afterSave) afterSave(); });
  let pickedIcon = curIcon, pickedAvatar = curAvatar;
  const prevEl = $('#pf-avatar-prev', bg), clearBtn = $('#pf-avatar-clear', bg), fileInput = $('#pf-avatar-file', bg);
  const refreshPrev = () => {
    if (pickedAvatar) { prevEl.innerHTML = `<img src="${pickedAvatar}" alt="">`; clearBtn.style.display = ''; }
    else { prevEl.textContent = pickedIcon; clearBtn.style.display = 'none'; }
  };
  $all('.icon-pick', bg).forEach(b => b.addEventListener('click', () => {
    $all('.icon-pick', bg).forEach(x => x.classList.remove('on'));
    b.classList.add('on'); pickedIcon = b.dataset.ic; pickedAvatar = ''; refreshPrev();
  }));
  if (fileInput) fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0]; fileInput.value = '';
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) { toast('画像が大きすぎます(12MBまで)'); return; }
    avatarFromFile(f, url => { if (!url) { toast('画像を読み込めませんでした'); return; } pickedAvatar = url; refreshPrev(); });
  });
  if (clearBtn) clearBtn.addEventListener('click', () => { pickedAvatar = ''; refreshPrev(); });
  const appealBox = $('#pf-appeal', bg), appealCount = $('#pf-appeal-count', bg);
  const updCount = () => { if (appealCount) appealCount.textContent = appealBox.value.length + '/80'; };
  if (appealBox) { appealBox.addEventListener('input', updCount); updCount(); }
  const linkInput = $('#pf-link', bg), noteEl = $('#pf-link-note', bg);
  linkInput.addEventListener('input', () => {
    const v = linkInput.value.trim();
    if (!v) { noteEl.textContent = 'Instagram / YouTube / TikTok / X / Threads のURLのみ。'; noteEl.style.color = ''; return; }
    const pf = detectPlatform(v);
    noteEl.textContent = pf ? '✓ ' + pf + ' のリンク' : '✕ Instagram/YouTube/TikTok/X/Threads のURLのみ使えます';
    noteEl.style.color = pf ? 'var(--accent)' : 'var(--warn,#f87171)';
  });
  $('#pf-save', bg).addEventListener('click', async () => {
    const name = ($('#pf-name', bg).value || '').trim().slice(0, 30);
    if (!name) { toast('表示名を入れてください'); return; }
    const link = linkInput.value.trim();
    if (link && !detectPlatform(link)) { toast('SNSリンクはInstagram/YouTube/TikTok/X/Threadsのみ'); return; }
    const appeal = (appealBox ? appealBox.value : '').trim().slice(0, 80);
    S.publicName = name; S.publicIcon = pickedIcon; S.publicAvatar = pickedAvatar || ''; S.publicAppeal = appeal; S.publicLink = link;
    saveState();
    const btn = $('#pf-save', bg); btn.disabled = true; btn.textContent = '保存中...';
    // 既に公開済みのメニューがあれば、その表示も一括更新
    let updRes = { ok: true };
    if (c && c.myUid && c.myUid() && c.updateMyMenusProfile) {
      updRes = await c.updateMyMenusProfile({ displayName: name, icon: pickedIcon, avatar: pickedAvatar || '', appeal, link, platform: link ? detectPlatform(link) : '' });
    }
    closeModal();
    toast(updRes && updRes.ok === false && updRes.updated !== 0
      ? 'プロフィールは保存しました(公開中メニューへの反映は失敗。時間をおいて再保存を)'
      : 'プロフィールを保存しました');
    if (afterSave) afterSave(); else if (currentView() === 'tools') renderTools();
  });
}

function importPublicMenu(pm) {
  if (S.myMenus.length >= 20) { toast('マイメニューは20件までです'); return; }
  let maxN = 0;
  S.customEx.forEach(e => { const n = Number((String(e.id).match(/\d+$/) || [0])[0]); if (n > maxN) maxN = n; });
  const items = (pm.items || []).slice(0, 15).map(it => {
    // 標準DBの種目はそのまま。相手のオリジナル種目(custom-*)はid衝突を避けて必ず新規作成する
    const isCustomId = /^custom-/.test(String(it.exId || ''));
    if (DB.byId[it.exId] && !isCustomId) return { exId: it.exId, part: it.part, sets: it.sets, reps: it.reps, rest: it.rest, priority: false };
    const part = SCIENCE.partMap[it.part] ? it.part : 'abs';
    const id = 'custom-' + (++maxN);
    S.customEx.push({
      id, name: String(it.name || '種目').slice(0, 30), part, equipment: 'bodyweight',
      sub: [SCIENCE.partMap[part].name], level: 1, mets: 4, compound: false,
      form: ['取り込んだ種目: いつものフォームでOK', '効かせたい部位を意識する', '無理のない重量で丁寧に'],
      mistake: '', repHyp: '10-15', repStr: '8-12', repEnd: '15-20', custom: true,
    });
    return { exId: id, part, sets: it.sets, reps: it.reps, rest: it.rest, priority: false };
  }).filter(Boolean);
  if (!items.length) { toast('取り込める種目がありませんでした'); return; }
  rebuildDB(S.customEx);
  const mid = S.myMenus.reduce((a, m) => Math.max(a, m.id), 0) + 1;
  const nm = String(pm.name || 'メニュー') + (pm.displayName ? '（' + String(pm.displayName).slice(0, 8) + '）' : '');
  S.myMenus.push({ id: mid, name: nm.slice(0, 20), items });
  saveState();
  closeModal();
  toast('マイメニューに取り込みました💪');
  renderLog();
}

async function openPublicGalleryModal() {
  const c = window.__klCloud;
  const bg = openModal(`<h2>🌐 みんなのメニュー</h2>
    <p class="modal-sub">みんなが公開したルーティン。気に入ったら取り込めます。</p>
    <div id="gallery-list" style="max-height:58vh;overflow:auto"><p class="card-note">読み込み中...</p></div>
    <div style="margin-top:12px"><button class="btn ghost" onclick="closeModal()">閉じる</button></div>`);
  const listEl = $('#gallery-list', bg);
  if (!c || !c.available) { listEl.innerHTML = '<p class="card-note">この環境では利用できません。</p>'; return; }
  const menus = await c.listPublicMenus(60);
  if (menus === null) { listEl.innerHTML = '<p class="card-note">読み込みに失敗しました。時間をおいて再度お試しください。</p>'; return; }
  if (!menus.length) { listEl.innerHTML = '<p class="card-note">まだ公開メニューがありません。<br>自分のマイメニューの 🌐 から最初の1人になりませんか?</p>'; return; }
  const myUid = c.myUid ? c.myUid() : null;
  listEl.innerHTML = menus.map((pm, i) => {
    const pf = pm.link ? detectPlatform(pm.link) : null;
    const mine = myUid && pm.uid === myUid;
    const exList = (pm.items || []).slice(0, 8).map(it => esc(it.name || (DB.byId[it.exId] && DB.byId[it.exId].name) || '種目')).join('、');
    const icon = (typeof pm.icon === 'string' && pm.icon) ? pm.icon : '💪';
    const appeal = (typeof pm.appeal === 'string' && pm.appeal.trim()) ? pm.appeal.trim() : '';
    // 画像アバターは厳格チェックを通ったものだけ img で表示(XSS防止)。それ以外は絵文字
    const avatarImg = isValidAvatar(pm.avatar) ? `<img src="${pm.avatar}" alt="">` : esc(icon);
    return `<div class="card" style="margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="gal-avatar">${avatarImg}</div>
        <div style="flex:1;min-width:0"><div class="nm" style="font-weight:800">${esc(pm.name)}</div>
        <div class="meta" style="font-size:11.5px;color:var(--ink-dim)">by ${esc(pm.displayName || 'ユーザー')} ・ ${(pm.items || []).length}種目</div></div>
        ${pf && SNS_RE.test(pm.link) ? `<a class="btn small ghost" href="${esc(pm.link)}" target="_blank" rel="noopener nofollow ugc">${pf} ▶</a>` : ''}
      </div>
      ${appeal ? `<p style="margin:8px 0 4px;font-size:13px">${esc(appeal)}</p>` : ''}
      <p class="card-note" style="margin:6px 0">${exList}${(pm.items || []).length > 8 ? ' ほか' : ''}</p>
      <div style="display:flex;gap:8px">
        ${mine ? `<button class="btn ghost small gal-unpub" data-id="${esc(pm.id)}" style="color:var(--warn,#f87171)">公開取消</button>`
          : `<button class="btn small gal-import" data-i="${i}">取り込む</button><button class="btn ghost small gal-report" data-id="${esc(pm.id)}">通報</button>`}
      </div></div>`;
  }).join('');
  $all('.gal-import', listEl).forEach(b => b.addEventListener('click', () => importPublicMenu(menus[Number(b.dataset.i)])));
  $all('.gal-report', listEl).forEach(b => b.addEventListener('click', async () => {
    if (!c.myUid()) { toast('通報にはログインが必要です'); return; }
    if (!confirm('このメニューを通報しますか?')) return;
    const res = await c.reportMenu(b.dataset.id);
    toast(res.ok ? '通報しました。ご協力ありがとうございます' : '通報に失敗しました');
  }));
  $all('.gal-unpub', listEl).forEach(b => b.addEventListener('click', async () => {
    const res = await c.unpublishMenu(b.dataset.id);
    if (res.ok) {
      const m = S.myMenus.find(x => x.pubId === b.dataset.id);
      if (m) { m.published = false; delete m.pubId; saveState(); }
      toast('公開を取り消しました'); closeModal(); renderLog();
    } else toast('取り消しに失敗しました');
  }));
}

// ===== SIM =====
let simState = null;
function renderSim() {
  const root = $('#view-sim');
  if (!S.profile) {
    root.innerHTML = `<div class="card"><div class="empty"><span class="big-emoji">📈</span>プロフィールを設定すると<br>「どれだけやればどれだけ伸びるか」を予測できます。</div>
      <button class="btn" id="sim-setup">プロフィール設定</button></div>`;
    $('#sim-setup', root).addEventListener('click', () => openProfileWizard(true));
    return;
  }
  if (!simState) simState = { minutes: S.profile.minutes, days: S.profile.days, usePlan: !!S.plan };
  const opt = optimalPlan(S.profile);

  root.innerHTML = `
    <div class="card"><h2>🏆 あなたの最適解<span class="sub">全56通りを試算</span></h2>
      <div class="focus-chips">
        <span class="chip grow">コスパ最強: 週${opt.eco.days}日 × ${opt.eco.minutes}分 (効率${Math.round(opt.eco.eff * 100)}%)</span>
        <span class="chip">理論上の最高: 週${opt.best.days}日 × ${opt.best.minutes}分 (${Math.round(opt.best.eff * 100)}%)</span>
      </div>
      <p class="card-note">「コスパ最強」は最高効率の95%以上を最小の週合計時間で出せる設定。これ以上増やしても伸びは数%です。効率%は標準的な部位配分での試算なので、現在のメニュー配分とは数%前後します。</p>
      <button class="btn small ghost" id="opt-apply">この設定をスライダーで試す</button>
    </div>
    <div class="card"><h2>⚗️ 効率シミュレーター</h2>
      <div class="field"><label>1日の時間 <span class="range-val" id="sim-min-val">${simState.minutes}分</span></label>
        <input type="range" id="sim-min" min="15" max="120" step="5" value="${simState.minutes}"></div>
      <div class="field"><label>週の日数 <span class="range-val" id="sim-days-val">${simState.days}日</span></label>
        <input type="range" id="sim-days" min="1" max="7" step="1" value="${simState.days}"></div>
      ${S.plan ? `<label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700">
        <input type="checkbox" id="sim-useplan" ${simState.usePlan ? 'checked' : ''}> 現在のメニューの部位配分を使う</label>` : ''}
    </div>
    <div id="sim-results"></div>`;

  const update = () => {
    $('#sim-min-val', root).textContent = simState.minutes + '分';
    $('#sim-days-val', root).textContent = simState.days + '日';
    renderSimResults($('#sim-results', root));
  };
  $('#sim-min', root).addEventListener('input', e => { simState.minutes = Number(e.target.value); update(); });
  $('#sim-days', root).addEventListener('input', e => { simState.days = Number(e.target.value); update(); });
  $('#opt-apply', root).addEventListener('click', () => {
    simState.minutes = opt.eco.minutes;
    simState.days = opt.eco.days;
    simState.usePlan = false; // カードの試算と同じ標準配分で表示を揃える
    renderSim();
    toast(`週${opt.eco.days}日×${opt.eco.minutes}分で試算中(メニュー配分の適用は一旦OFF)。気に入ったらプロフィール編集で設定を`);
  });
  const up = $('#sim-useplan', root);
  if (up) up.addEventListener('change', e => { simState.usePlan = e.target.checked; update(); });
  update();
}

function renderSimResults(container) {
  const r = simulate(simState.minutes, simState.days, S.profile, simState.usePlan ? S.plan : null);
  const pct = Math.round(r.overallEffect * 100);
  const g = kg => (Math.round(kg * 10) / 10).toFixed(1);
  const trained = r.partResults.filter(x => x.sets > 0);
  const avgSets = trained.length ? trained.reduce((s, x) => s + x.sets, 0) / trained.length : 0;

  let html = `
    <div class="card"><h2>🏆 総合効率スコア</h2>
      <div class="hero-num">${pct}<small>%</small></div>
      <p class="card-note">週${r.totalSets}セット(1回あたり約${r.setsPerDay}セット)。理論上の最大成長ペースに対する到達度です。${S.profile.goal === 'posture' ? '<br>姿勢改善は筋量より「引く筋肉を起こす」のが目的。4〜8週で肩の開き・立ち姿の変化を実感するのが目安です。' : ''}</p>
      <canvas class="chart" id="sim-curve"></canvas>
      <p class="card-note">緑の帯が最適ゾーン(部位あたり週10〜20セット)。曲線が寝てきたら時間を増やすより回復と食事に投資。</p>
    </div>
    <button class="btn" id="sim-to-plan" style="width:100%;margin-bottom:14px">🎯 この設定(週${simState.days}日 × ${simState.minutes}分)でメニューを作る</button>
    ${r.dietMode ? `
    <div class="stat-row">
      <div class="stat-tile"><div class="k">脂肪減少ペース</div><div class="v"><em>−${g(r.monthlyFatLoss)}</em><small>kg/月</small></div></div>
      <div class="stat-tile"><div class="k">消費カロリー</div><div class="v"><em>${r.weeklyBurn}</em><small>kcal/週</small></div></div>
    </div>
    <div class="stat-row">
      <div class="stat-tile"><div class="k">3ヶ月後</div><div class="v"><em>−${g(r.monthlyFatLoss * 3)}</em><small>kg脂肪</small></div></div>
      <div class="stat-tile"><div class="k">半年後</div><div class="v"><em>−${g(r.monthlyFatLoss * 6)}</em><small>kg脂肪</small></div></div>
      <div class="stat-tile"><div class="k">筋肉</div><div class="v"><em>維持↗</em><small>+${g(r.cumGain(6))}kg/半年</small></div></div>
    </div>
    <p class="card-note" style="margin-top:-6px;margin-bottom:14px">食事タブの−400kcal/日前提。減量中は「筋肉を守りながら脂肪だけ落とす」のが正解で、体重ナビの目標に着いたら維持へ切替。</p>
    ` : `
    <div class="stat-row">
      <div class="stat-tile"><div class="k">筋肉増加ペース</div><div class="v"><em>+${g(r.monthlyGain)}</em><small>kg/月</small></div></div>
      <div class="stat-tile"><div class="k">消費カロリー</div><div class="v"><em>${r.weeklyBurn}</em><small>kcal/週</small></div></div>
    </div>
    <div class="stat-row">
      <div class="stat-tile"><div class="k">3ヶ月後</div><div class="v"><em>+${g(r.cumGain(3))}</em><small>kg</small></div></div>
      <div class="stat-tile"><div class="k">半年後</div><div class="v"><em>+${g(r.cumGain(6))}</em><small>kg</small></div></div>
      <div class="stat-tile"><div class="k">1年後</div><div class="v"><em>+${g(r.cumGain(12))}</em><small>kg</small></div></div>
    </div>
    `}
    <div class="card"><h2>🍗 食事の目安</h2>
      <div class="focus-chips">
        <span class="chip">タンパク質 <b style="color:var(--accent)">${r.protein}g/日</b></span>
        <span class="chip">維持カロリー 約${r.tdee}kcal/日</span>
        <span class="chip">${S.profile.goal === 'diet' ? '減量: −300〜500kcal' : S.profile.goal === 'hyp' ? '増量: +200〜300kcal' : '維持でOK'}</span>
      </div>
      <p class="card-note">筋肉の見積もりはタンパク質と睡眠が足りている前提。どちらかが欠けると大きく目減りします。予測値は研究に基づく目安で個人差があります。</p>
    </div>`;

  html += `<div class="card"><h2>🧩 部位別の週セット数</h2>`;
  r.partResults.forEach(x => {
    const pt = SCIENCE.partMap[x.part];
    const barPct = Math.min(100, (x.sets / pt.mrv) * 100);
    html += `<div class="vol-row"><span class="nm">${esc(x.name)}</span>
      <span class="bar"><i style="width:${barPct}%"></i></span>
      <span class="val">${Math.round(x.sets * 10) / 10}<span class="tag ${x.verdict.cls}">${x.verdict.label}</span></span></div>`;
  });
  html += `<p class="card-note">${simState.usePlan
    ? '今のメニューの実測セット数です(プランタブと同じ)。上の時間・日数を変えると、その分だけ増減した見込みを表示します。'
    : '標準的な配分での試算値です。「現在のメニューの部位配分を使う」をONにすると、プランタブと同じ実測値になります。'}</p></div>`;

  const advice = [];
  if (r.plusDay > 0.03) advice.push(`週をもう1日増やすと効率 <b style="color:var(--accent)">+${Math.round(r.plusDay * 100)}%</b>。時間を増やすより効果的。`);
  if (r.plus15 > 0.03) advice.push(`1日を15分伸ばすと効率 <b style="color:var(--accent)">+${Math.round(r.plus15 * 100)}%</b>。`);
  if (r.plusDay <= 0.03 && r.plus15 <= 0.03 && pct >= 60) advice.push('この量ならほぼ頭打ち。<b>これ以上増やすより、重量の漸進・食事・睡眠</b>が伸びしろです。');
  if (r.junk.length) advice.push(`⚠ ${r.junk.map(x => x.name).join('・')}はセット数過多。回復が追いつかず逆効果の恐れ。`);
  if (r.low.length && pct < 60) advice.push(`${r.low.map(x => x.name).join('・')}は週セット数が不足気味。`);
  if (advice.length) {
    html += `<div class="card tip-card"><h2>🧠 コーチの一言</h2>${advice.map(a => `<p style="font-size:13.5px;margin-bottom:6px">${a}</p>`).join('')}</div>`;
  }

  container.innerHTML = html;
  const canvas = $('#sim-curve', container);
  if (canvas) drawEffectCurve(canvas, avgSets);
  // 効率で出した設定をプロフィール(日数・時間)へ反映し、メニューを作り直す
  const toPlan = $('#sim-to-plan', container);
  if (toPlan) toPlan.addEventListener('click', () => {
    S.profile.days = simState.days;
    S.profile.minutes = simState.minutes;
    S.plan = generatePlan(DB, S.profile, S.focus, Math.floor(Math.random() * 1e9));
    S.swap = null; // 旧プランの振替は無効化
    saveState();
    toast(`週${simState.days}日×${simState.minutes}分でメニューを作りました💪`);
    location.hash = 'plan';
  });
}

// ===== LOG =====
let logUiState = { chartEx: null, volPart: '', logDate: null, logEx: null };
function exerciseSelectHtml(id, selected, onlyLogged) {
  const loggedIds = onlyLogged ? new Set(S.logs.map(l => l.exId)) : null;
  let html = `<select id="${id}">`;
  SCIENCE.parts.forEach(pt => {
    const list = (DB.byPart[pt.key] || []).filter(ex => !loggedIds || loggedIds.has(ex.id));
    if (!list.length) return;
    html += `<optgroup label="${esc(pt.name)}">`;
    list.forEach(ex => {
      html += `<option value="${ex.id}" ${ex.id === selected ? 'selected' : ''}>${esc(ex.name)}</option>`;
    });
    html += `</optgroup>`;
  });
  html += `</select>`;
  return html;
}

function renderLog() {
  const root = $('#view-log');
  const hasLogs = S.logs.length > 0;

  let html = `
    <div class="card"><h2>✍️ クイック記録</h2>
      <div class="grid2">
        <div class="field"><label>日付</label><input type="date" id="log-date" value="${logUiState.logDate || todayStr()}"></div>
        <div class="field"><label>種目</label>${exerciseSelectHtml('log-ex', logUiState.logEx)}</div>
      </div>
      <div class="field"><label>セット (重量kg × 回数)</label><div id="set-rows"></div>
        <button class="btn small ghost" id="add-set">+ セット追加</button></div>
      <button class="btn" id="save-log">記録する</button>
    </div>

    <div class="card"><h2>📝 マイメニュー<span class="sub">自分のルーティンを保存</span></h2>
      <div id="mymenu-list">${S.myMenus.length ? S.myMenus.map(m => `
        <div class="log-entry"><div style="flex:1;min-width:0"><div class="nm">${esc(m.name)}${m.published ? '<span class="tag good" style="font-size:9px;margin-left:6px">公開中</span>' : ''}</div>
          <div class="sets">${m.items.length}種目 / 約${dayMinutes(m.items)}分</div></div>
          <button class="btn small ghost" data-mm-share="${m.id}" title="みんなのメニューに公開">🌐</button>
          <button class="btn small" data-mm-run="${m.id}">▶ 今日やる</button>
          <button class="del" data-mm-del="${m.id}">🗑</button></div>`).join('')
        : '<p class="card-note">よくやる自分の組み合わせを保存すると、ホームでワンタップ実行&チェック記録できます。DBにない種目も「オリジナル種目」として追加OK。</p>'}</div>
      <button class="btn ghost" id="mymenu-new">+ 新しいマイメニュー</button>
    </div>

    <div class="card"><h2>🌐 みんなのメニュー<span class="sub">参考にする</span></h2>
      <p class="card-note">他の人が公開したマイメニューを見て参考にできます。自分のメニューを公開すると、InstagramなどのSNSリンクも一緒に載せられます(トレ動画の宣伝に)。</p>
      <button class="btn ghost" id="browse-public">みんなのメニューを見る</button>
    </div>

    <div class="card"><h2>⚖️ 体重記録</h2>
      <div style="display:flex;gap:8px">
        <input type="number" id="bw-input" placeholder="今日の体重 kg" step="0.1" min="20">
        <button class="btn small" id="bw-save" style="white-space:nowrap">保存</button>
      </div>
      ${S.weights.length ? '<canvas class="chart" id="bw-chart" style="margin-top:10px"></canvas>' : ''}
    </div>`;

  if (hasLogs) {
    html += `
      <div class="card"><h2>📈 種目の成長 (推定1RM)</h2>
        <div class="field">${exerciseSelectHtml('chart-ex', logUiState.chartEx, true)}</div>
        <canvas class="chart" id="e1rm-chart"></canvas>
        <p class="card-note">推定1RM = 重量×(1+回数÷30)。重量か回数が増えれば右肩上がりになります。</p>
      </div>
      <div class="card"><h2>📊 週間ボリューム (総セット数)</h2>
        <div class="field"><select id="vol-part"><option value="">全部位</option>${SCIENCE.parts.map(p => `<option value="${p.key}" ${logUiState.volPart === p.key ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        <canvas class="chart" id="vol-chart"></canvas>
      </div>
      <div class="card"><h2>🗓️ トレーニングカレンダー<span class="sub">直近12週</span></h2><div id="cal-heat"></div></div>`;
  }

  html += `<div class="card"><h2>📷 体型フォト<span class="sub">ビフォーアフター</span></h2><div id="photo-card"><p class="card-note">読み込み中...</p></div></div>`;

  html += `<div class="card"><h2>🗂️ 履歴</h2><div id="log-list">${hasLogs ? '' : '<div class="empty"><span class="big-emoji">📭</span>まだ記録がありません。<br>ホームのチェック or 上のフォームから記録できます。</div>'}</div></div>`;

  root.innerHTML = html;

  // セット行
  const setRows = $('#set-rows', root);
  function addSetRow(w, r) {
    const div = document.createElement('div');
    div.className = 'set-row';
    const no = setRows.children.length + 1;
    div.innerHTML = `<span class="no">${no}</span>
      <input type="number" class="sw" placeholder="kg" step="0.5" value="${w != null ? w : ''}">
      <span class="x">kg ×</span>
      <input type="number" class="sr" placeholder="回" value="${r != null ? r : ''}">
      <span class="x">回</span><button type="button" class="rm-set">✕</button>`;
    div.querySelector('.rm-set').addEventListener('click', () => {
      div.remove();
      $all('.set-row .no', setRows).forEach((n, i) => { n.textContent = i + 1; });
    });
    setRows.appendChild(div);
  }
  addSetRow(); addSetRow(); addSetRow();
  $('#add-set', root).addEventListener('click', () => addSetRow());

  const logEx = $('#log-ex', root);
  logEx.addEventListener('change', () => {
    logUiState.logEx = logEx.value;
    const lw = S.lastW[logEx.value];
    if (lw != null) $all('.sw', setRows).forEach(i => { if (!i.value) i.value = lw; });
  });
  $('#log-date', root).addEventListener('change', () => { logUiState.logDate = $('#log-date', root).value; });

  $('#save-log', root).addEventListener('click', () => {
    const btn = $('#save-log', root);
    const date = $('#log-date', root).value || todayStr();
    const exId = logEx.value;
    const sets = $all('.set-row', setRows).map(row => ({
      w: Number($('.sw', row).value) || 0,
      r: Number($('.sr', row).value) || 0,
    })).filter(s => s.r > 0);
    if (!sets.length) { toast('回数を入れてください'); return; }
    btn.disabled = true;
    setTimeout(() => { btn.disabled = false; }, 600);
    S.logs.push({ id: newId(), date, exId, sets });
    const topW = Math.max(...sets.map(s => s.w));
    if (topW > 0) S.lastW[exId] = topW;
    logUiState.logDate = date; // 再描画後も入力日付・種目を維持 (過去日まとめ入力用)
    logUiState.logEx = exId;
    saveState();
    toast('記録しました💪');
    renderLog();
  });

  // マイメニュー
  $('#mymenu-new', root).addEventListener('click', () => openMyMenuModal());
  $all('[data-mm-run]', root).forEach(btn => btn.addEventListener('click', () => {
    S.myToday = { date: todayStr(), id: Number(btn.dataset.mmRun) };
    saveState();
    toast('今日のメニューにセットしました💪');
    location.hash = 'home';
  }));
  $all('[data-mm-del]', root).forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('このマイメニューを削除しますか?(記録は残ります)')) return;
    const id = Number(btn.dataset.mmDel);
    const m = S.myMenus.find(x => x.id === id);
    if (m && m.published && m.pubId && window.__klCloud && window.__klCloud.unpublishMenu) {
      window.__klCloud.unpublishMenu(m.pubId); // 公開中なら公開も取り消す(片付け)
    }
    S.myMenus = S.myMenus.filter(m => m.id !== id);
    if (S.myToday && S.myToday.id === id) S.myToday = null;
    saveState();
    renderLog();
  }));
  $all('[data-mm-share]', root).forEach(btn => btn.addEventListener('click', () => {
    const m = S.myMenus.find(x => x.id === Number(btn.dataset.mmShare));
    if (m) openMenuPublishModal(m);
  }));
  const browseBtn = $('#browse-public', root);
  if (browseBtn) browseBtn.addEventListener('click', openPublicGalleryModal);

  // 体重
  $('#bw-save', root).addEventListener('click', () => {
    const v = Number($('#bw-input', root).value);
    if (!v || v < 20) { toast('体重を入力してください'); return; }
    S.weights = S.weights.filter(w => w.date !== todayStr());
    S.weights.push({ date: todayStr(), kg: v });
    S.weights.sort((a, b) => a.date < b.date ? -1 : 1);
    if (S.profile) { S.profile.w = v; }
    saveState();
    toast('体重を保存しました');
    renderLog();
  });
  const bwc = $('#bw-chart', root);
  if (bwc) drawLineChart(bwc, S.weights.map(w => ({ label: fmtDate(w.date), value: w.kg })), 'kg');

  renderPhotoCard($('#photo-card', root));

  // チャート
  if (hasLogs) {
    const chartEx = $('#chart-ex', root);
    if (!logUiState.chartEx || !S.logs.some(l => l.exId === logUiState.chartEx)) logUiState.chartEx = chartEx.value;
    chartEx.value = logUiState.chartEx;
    const drawE1 = () => {
      let hist = e1rmHistory(S.logs, logUiState.chartEx);
      let unit = 'kg';
      if (!hist.length) {
        // 自重種目(重量0)は最大レップ数(等尺性は秒数)の推移で成長を見る
        const byDate = {};
        S.logs.filter(l => l.exId === logUiState.chartEx).forEach(l => l.sets.forEach(s => {
          if (s.r > 0 && (!byDate[l.date] || s.r > byDate[l.date])) byDate[l.date] = s.r;
        }));
        hist = Object.keys(byDate).sort().map(d => ({ date: d, e1rm: byDate[d] }));
        const cEx = DB.byId[logUiState.chartEx];
        unit = cEx && cEx.isometric ? '秒' : '回';
      }
      const c = $('#e1rm-chart', root);
      if (c) drawLineChart(c, hist.map(h => ({ label: fmtDate(h.date), value: Math.round(h.e1rm * 10) / 10 })), unit);
    };
    chartEx.addEventListener('change', () => { logUiState.chartEx = chartEx.value; drawE1(); });
    drawE1();

    const volSel = $('#vol-part', root);
    const drawVol = () => {
      const c = $('#vol-chart', root);
      if (c) drawBarChart(c, weeklyVolume(S.logs, DB.byId, logUiState.volPart || null).map(w => ({ label: w.label, value: w.sets })));
    };
    volSel.addEventListener('change', () => { logUiState.volPart = volSel.value; drawVol(); });
    drawVol();

    renderCalendarHeat($('#cal-heat', root), S.logs);

    // 履歴リスト
    const byDate = {};
    S.logs.forEach(l => { (byDate[l.date] = byDate[l.date] || []).push(l); });
    const dates = Object.keys(byDate).sort().reverse().slice(0, 30);
    const list = $('#log-list', root);
    list.innerHTML = dates.map(d => `
      <div class="log-day"><div class="log-day-head">${fmtDate(d)}<button class="share-day" data-share="${d}" title="この日の記録をシェア">📸</button></div>
      ${byDate[d].map(l => {
        const ex = DB.byId[l.exId];
        const u = ex && ex.isometric ? '秒' : '回';
        const setsTxt = l.sets.map(s => s.w > 0 ? `${s.w}kg×${s.r}` : `${s.r}${u}`).join(' / ');
        return `<div class="log-entry"><div><div class="nm">${ex ? esc(ex.name) : esc(l.exId)}</div>
          <div class="sets">${esc(setsTxt)}</div></div>
          <button class="del" data-del="${l.id}">🗑</button></div>`;
      }).join('')}</div>`).join('');
    $all('[data-share]', list).forEach(btn => {
      btn.addEventListener('click', () => openShareModal(btn.dataset.share));
    });
    $all('[data-del]', list).forEach(btn => {
      btn.addEventListener('click', () => {
        if (!confirm('この記録を削除しますか?')) return;
        const id = Number(btn.dataset.del);
        S.logs = S.logs.filter(l => l.id !== id);
        Object.keys(S.dayDone).forEach(d => {
          Object.keys(S.dayDone[d]).forEach(ex => { const e = ddGet(S.dayDone[d], ex); if (e && e.id === id) delete S.dayDone[d][ex]; });
        });
        saveState();
        toast('削除しました');
        renderLog();
      });
    });
  }
}

// ===== マイメニュー作成モーダル =====
function openMyMenuModal() {
  const goal = S.profile ? S.profile.goal : 'hyp';
  const exListHtml = () => SCIENCE.parts.map(pt => {
    const list = DB.byPart[pt.key] || [];
    if (!list.length) return '';
    return `<div style="font-size:11px;font-weight:800;color:var(--ink-dim);margin:8px 0 4px">${esc(pt.name)}</div>` +
      list.map(ex => `<label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:3px 0">
        <input type="checkbox" class="mm-ex" value="${ex.id}"> ${esc(ex.name)}${ex.custom ? ' <span class="chip" style="font-size:9px;padding:1px 6px">オリジナル</span>' : ''}</label>`).join('');
  }).join('');

  const bg = openModal(`
    <h2>📝 マイメニュー作成</h2>
    <p class="modal-sub">よくやる組み合わせに名前を付けて保存。セット数・レップは目標(${esc(SCIENCE.goals[goal].name)})の推奨値が入ります。</p>
    <div class="field"><label>メニュー名</label><input type="text" id="mm-name" maxlength="20" placeholder="例: いつもの朝トレ"></div>
    <div class="field"><label>種目を選ぶ</label><div class="mm-exlist" id="mm-exlist">${exListHtml()}</div></div>
    <details class="acc"><summary>+ DBにない種目を追加(オリジナル種目)</summary><div class="acc-body">
      <div class="field"><label>種目名</label><input type="text" id="mm-cx-name" maxlength="30" placeholder="例: チューブローイング"></div>
      <div class="grid2">
        <div class="field"><label>部位</label><select id="mm-cx-part">${SCIENCE.parts.map(p => `<option value="${p.key}">${esc(p.name)}</option>`).join('')}</select></div>
        <div class="field"><label>器具</label><select id="mm-cx-eq"><option value="bodyweight">自重・チューブ等</option><option value="dumbbell">ダンベル</option><option value="barbell">バーベル</option><option value="machine">マシン</option><option value="cable">ケーブル</option></select></div>
      </div>
      <button class="btn small ghost" id="mm-cx-add">追加してリストに入れる</button>
    </div></details>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="btn ghost" onclick="closeModal()">キャンセル</button>
      <button class="btn" id="mm-save">保存</button>
    </div>`);

  $('#mm-cx-add', bg).addEventListener('click', () => {
    const name = ($('#mm-cx-name', bg).value || '').trim();
    if (!name) { toast('種目名を入れてください'); return; }
    const maxN = S.customEx.reduce((m, e) => Math.max(m, Number((e.id.match(/\d+$/) || [0])[0])), 0);
    const ex = {
      id: 'custom-' + (maxN + 1), name: name.slice(0, 30),
      part: $('#mm-cx-part', bg).value, equipment: $('#mm-cx-eq', bg).value,
      sub: [SCIENCE.partMap[$('#mm-cx-part', bg).value].name], level: 1, mets: 4, compound: false,
      form: ['自分の種目: いつものフォームでOK', '効かせたい部位を意識する', '無理のない重量で丁寧に'],
      mistake: '', repHyp: '10-15', repStr: '8-12', repEnd: '15-20', custom: true,
    };
    S.customEx.push(ex);
    saveState();
    rebuildDB(S.customEx);
    const checked = $all('.mm-ex:checked', bg).map(c => c.value);
    $('#mm-exlist', bg).innerHTML = exListHtml();
    checked.concat([ex.id]).forEach(id => { const c = $(`.mm-ex[value="${id}"]`, bg); if (c) c.checked = true; });
    $('#mm-cx-name', bg).value = '';
    toast(`「${ex.name}」を追加しました`);
  });

  $('#mm-save', bg).addEventListener('click', () => {
    const name = ($('#mm-name', bg).value || '').trim();
    const ids = $all('.mm-ex:checked', bg).map(c => c.value);
    if (!name) { toast('メニュー名を入れてください'); return; }
    if (!ids.length) { toast('種目を1つ以上選んでください'); return; }
    if (ids.length > 15) { toast('種目は15個までにしてください'); return; }
    const items = ids.map(id => {
      const ex = DB.byId[id];
      if (!ex) return null; // 選択中にDBが再構築され種目が消えた場合の保険
      return {
        exId: id, part: ex.part,
        sets: setsFor(goal, false),
        reps: repsFor(ex, goal),
        rest: restFor(ex, goal),
        priority: false,
      };
    }).filter(Boolean);
    if (!items.length) { toast('種目が見つかりませんでした。選び直してください'); return; }
    const newId2 = S.myMenus.reduce((m, x) => Math.max(m, x.id), 0) + 1;
    S.myMenus.push({ id: newId2, name: name.slice(0, 20), items });
    saveState();
    closeModal();
    toast(`マイメニュー「${name}」を保存しました`);
    renderLog();
  });
}

// ===== TOOLS =====
let timer = { sec: 0, total: 0, iv: null, endAt: 0, label: '' };
let audioCtx = null;

// 種目の休憩秒数でレストタイマーを開始し、浮遊ウィジェットに表示する
function startRestTimer(seconds, label) {
  stopTimer();
  timer.total = timer.sec = Math.max(1, Math.round(Number(seconds)) || 60);
  timer.label = label || '休憩';
  ensureAudio();
  startTimer();
  updateTimerDisp();
}
// 浮遊タイマーの表示更新 (ツールタブでは大きい表示があるので隠す)
function updateRestFab() {
  const fab = document.getElementById('rest-fab');
  if (!fab) return;
  const show = !!timer.iv && currentView() !== 'tools';
  fab.hidden = !show;
  if (show) {
    const t = document.getElementById('rt-time'); if (t) t.textContent = fmtTimer(timer.sec);
    const l = document.getElementById('rt-label'); if (l) l.textContent = timer.label || '休憩';
  }
}
// iOS Safari対策: AudioContextはユーザー操作(スタート押下)の中で生成・resumeしておく
function ensureAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* 音が出せない環境は無視 */ }
}
function cloudCardHtml() {
  const c = window.__klCloud;
  if (!c) return `<div class="card"><h2>☁️ 端末間同期</h2><p class="card-note">読み込み中...</p></div>`;
  const st = c.status();
  if (st.user) {
    const rm = c.reminderStatus ? c.reminderStatus() : { enabled: false, hour: 19, permission: 'default' };
    const hourOpts = Array.from({ length: 18 }, (_, i) => i + 5) // 5〜22時
      .map(h => `<option value="${h}" ${h === rm.hour ? 'selected' : ''}>${h}:00</option>`).join('');
    const denied = rm.permission === 'denied';
    return `<div class="card"><h2>☁️ 端末間同期<span class="tag good" style="font-size:10px">ON</span></h2>
      <p style="font-size:13.5px">${esc(st.user.name || st.user.email || 'ログイン中')} でログイン中。この端末の記録は自動でクラウドに保存され、同じGoogleアカウントの別端末と同期されます。</p>
      <p class="card-note">${st.syncing ? '同期中...' : (st.lastSync ? '最終同期: ' + st.lastSync : 'まもなく同期します')}</p>
      <button class="btn ghost" id="cloud-signout">ログアウト(同期を止める)</button>
      <p class="card-note">※体型フォトはこの端末内のみに保存され、同期対象外です。</p>
    </div>
    <div class="card"><h2>🔔 トレ通知<span class="tag ${rm.enabled ? 'good' : 'none'}" style="font-size:10px">${rm.enabled ? 'ON' : 'OFF'}</span></h2>
      ${denied ? `<p style="font-size:13px;color:var(--warn)">通知がブロックされています。ブラウザ(またはスマホの設定アプリ)でこのサイトの通知を許可してください。</p>` : ''}
      <p style="font-size:13.5px;margin-bottom:10px">トレの日の設定時刻に「今日は○○の日💪」を通知します。アプリを閉じていても届きます。</p>
      <div class="field"><label>通知する時刻</label><select id="rm-hour" ${denied ? 'disabled' : ''}>${hourOpts}</select></div>
      ${rm.enabled
        ? `<button class="btn ghost" id="rm-off">通知をOFFにする</button>`
        : `<button class="btn" id="rm-on" ${denied ? 'disabled' : ''}>この端末で通知をONにする</button>`}
      <p class="card-note">📱 iPhoneはSafariの共有ボタン→「ホーム画面に追加」でアプリ化してからONにしてください(iOS 16.4以降)。Androidはそのま
まONでOK。</p>
    </div>`;
  }
  return `<div class="card"><h2>☁️ 端末間同期</h2>
    <p style="font-size:13.5px;margin-bottom:10px">Googleでログインすると、記録・メニュー・体重が<b>スマホとPCなど複数の端末で同期</b>されます。機種変更してもデータが引き継がれます。</p>
    <button class="btn" id="cloud-signin">Googleでログイン</button>
    <p class="card-note">ログインしなくても全機能そのまま使えます(データはこの端末に保存)。ログインは任意です。</p>
  </div>`;
}

// 公開プロフィールカード(みんなのメニューで使うアイコン・名前・アピール)
function publicProfileCardHtml() {
  const icon = S.publicIcon || '💪';
  const avatar = isValidAvatar(S.publicAvatar) ? S.publicAvatar : '';
  const set = !!S.publicName;
  const avatarHtml = avatar ? `<img src="${avatar}" alt="">` : esc(icon);
  return `<div class="card"><h2>🪪 公開プロフィール<span class="sub">みんなのメニュー用</span></h2>
    ${set ? `<div class="pub-identity">
      <div class="gal-avatar">${avatarHtml}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:800">${esc(S.publicName)}</div>
        ${S.publicAppeal ? `<div style="font-size:12px;color:var(--ink-dim)">${esc(S.publicAppeal)}</div>` : '<div style="font-size:12px;color:var(--ink-dim)">アピール未設定</div>'}
      </div>
    </div>
    <button class="btn ghost" id="edit-profile" style="margin-top:10px">プロフィールを編集</button>`
    : `<p style="font-size:13.5px;margin-bottom:10px">アイコンと名前を一度設定すれば、メニュー公開のたびに自動で使われます(毎回設定しなくてOK)。</p>
    <button class="btn" id="edit-profile">プロフィールを設定</button>`}
    <p class="card-note">ここで設定した内容は「みんなのメニュー」の公開時に使われます。編集すると公開中のメニューにも反映されます。</p>
  </div>`;
}

function bindCloudCard(root) {
  const editPf = $('#edit-profile', root);
  if (editPf) editPf.addEventListener('click', () => openPublicProfileModal());
  const inBtn = $('#cloud-signin', root);
  if (inBtn) inBtn.addEventListener('click', () => { if (window.__klCloud) window.__klCloud.signIn(); });
  const outBtn = $('#cloud-signout', root);
  if (outBtn) outBtn.addEventListener('click', () => {
    if (confirm('ログアウトします。この端末のデータは残りますが、以後の変更は同期されません。')) {
      if (window.__klCloud) window.__klCloud.signOut();
    }
  });

  const hourSel = $('#rm-hour', root);
  if (hourSel) hourSel.addEventListener('change', () => {
    if (window.__klCloud && window.__klCloud.setReminderHour) window.__klCloud.setReminderHour(Number(hourSel.value));
  });
  const rmOn = $('#rm-on', root);
  if (rmOn) rmOn.addEventListener('click', async () => {
    rmOn.disabled = true; rmOn.textContent = '設定中...';
    const hour = hourSel ? Number(hourSel.value) : 19;
    const res = await window.__klCloud.enableReminders(hour);
    if (res && res.ok) toast('🔔 通知をONにしました。トレの日にお知らせします');
    else if (res && res.reason === 'denied') toast('通知が許可されませんでした');
    else if (res && res.reason === 'token') toast('通知の登録に失敗: ' + (res.message || ''));
    if (currentView() === 'tools') renderTools();
  });
  const rmOff = $('#rm-off', root);
  if (rmOff) rmOff.addEventListener('click', async () => {
    await window.__klCloud.disableReminders();
    toast('通知をOFFにしました');
    if (currentView() === 'tools') renderTools();
  });
}

function renderTools() {
  const root = $('#view-tools');
  const p = S.profile;

  root.innerHTML = `
    ${cloudCardHtml()}
    ${publicProfileCardHtml()}
    <div class="card"><h2>⏱️ 休憩タイマー</h2>
      <div class="timer-display" id="timer-disp">${fmtTimer(timer.sec)}</div>
      <div class="timer-btns">
        <button class="btn ghost" data-t="60">60秒</button>
        <button class="btn ghost" data-t="90">90秒</button>
        <button class="btn ghost" data-t="120">2分</button>
        <button class="btn ghost" data-t="180">3分</button>
      </div>
      <div class="timer-btns">
        <button class="btn" id="timer-toggle">${timer.iv ? '⏸ 停止' : '▶ スタート'}</button>
        <button class="btn ghost" id="timer-reset">リセット</button>
      </div>
      <p class="card-note">終了時に音とバイブでお知らせ。コンパウンド種目は2〜3分、アイソレーションは60〜90秒が目安。</p>
    </div>

    ${itCardHtml()}

    <div class="card"><h2>🏋️ 1RM計算機</h2>
      <div class="grid2">
        <div class="field"><label>重量 kg</label><input type="number" id="rm-w" placeholder="60" step="0.5"></div>
        <div class="field"><label>回数</label><input type="number" id="rm-r" placeholder="8"></div>
      </div>
      <div id="rm-out"></div>
    </div>

    <div class="card"><h2>🍖 タンパク質 & カロリー</h2>
      ${p ? `<div class="tool-result">
        <div>1日のタンパク質目標 <span class="big">${Math.round(p.w * (SCIENCE.proteinPerKg[p.goal] || 1.8))}g</span></div>
        <p class="card-note">体重${p.w}kg × ${SCIENCE.proteinPerKg[p.goal] || 1.8}g(${esc(SCIENCE.goals[p.goal].name)}向け)。鶏むね100g≈23g、卵1個≈6g、プロテイン1杯≈20g。</p>
        <div style="margin-top:8px">維持カロリー <span class="big">${calcTDEE(p)}<small>kcal/日</small></span></div>
        <p class="card-note">${p.goal === 'diet' ? '減量はここから−300〜500kcal。' : p.goal === 'hyp' ? '筋肥大はここから+200〜300kcal。' : 'このカロリーを維持でOK。'}</p>
      </div>` : '<p class="card-note">プロフィール設定で自動計算されます。</p>'}
    </div>

    <div class="card"><h2>💪 FFMI (筋肉量指数)</h2>
      <div class="grid2">
        <div class="field"><label>体脂肪率 %</label><input type="number" id="ffmi-bf" placeholder="18"></div>
        <div class="field"><label>&nbsp;</label><button class="btn small" id="ffmi-calc" style="width:100%">計算</button></div>
      </div>
      <div id="ffmi-out"></div>
    </div>

    <div class="card"><h2>🔋 超回復ガイド</h2>
      <table class="recov-table">${SCIENCE.parts.map(pt => `<tr><td>${esc(pt.name)}</td><td>${pt.recoveryH}時間</td></tr>`).join('')}</table>
      <p class="card-note">同じ部位はこの時間を空けるのが目安。ホーム画面で自動追跡しています。</p>
    </div>

    <div class="card"><h2>📚 筋トレの三原則</h2>
      <details class="acc"><summary>1. 漸進性過負荷 — 少しずつ重く</summary><div class="acc-body">先週の自分を毎回ほんの少し超える(重量+2.5%、または回数+1)。これが成長の唯一のエンジン。記録タブで推定1RMの右肩上がりを確認しよう。</div></details>
      <details class="acc"><summary>2. 栄養 — 体重×2gのタンパク質</summary><div class="acc-body">筋肉の材料が無ければ何も作られない。タンパク質は毎食20g以上×1日3〜5回。増量なら+300kcal、減量でも−500kcalまで。</div></details>
      <details class="acc"><summary>3. 回復 — 筋肉は寝てる間に育つ</summary><div class="acc-body">睡眠不足は筋合成を大きく下げることが繰り返し報告されている。同部位は48〜72時間空ける。2ヶ月に1回は軽い週(ディロード)を入れると停滞を破れる。</div></details>
    </div>

    <div class="card"><h2>💬 フィードバック</h2>
      <p style="font-size:13px;margin-bottom:10px">「ここが使いにくい」「この種目を入れろ」大歓迎。ガチ勢のツッコミほど改善に効きます。</p>
      <div style="display:flex;gap:8px">
        <a class="btn ghost" style="text-decoration:none" target="_blank" rel="noopener" href="https://x.com/intent/post?text=${encodeURIComponent('#筋トレLAB 使ってみた: ')}">𝕏 で感想を送る</a>
        <a class="btn ghost" style="text-decoration:none" target="_blank" rel="noopener" href="https://x.com/hataraku_ai_">開発者X</a>
      </div>
    </div>

    <div class="card"><h2>💾 データ管理</h2>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <button class="btn ghost" id="export-data">エクスポート</button>
        <button class="btn ghost" id="import-data">インポート</button>
      </div>
      <button class="btn danger" id="reset-data">全データ削除</button>
      <p class="card-note">データはこの端末のブラウザ内にのみ保存されています。機種変更前にエクスポートを。</p>
    </div>

    <p class="card-note" style="text-align:center;padding:0 8px 8px">
      筋トレLAB v1.0 — 本アプリの数値は研究に基づく一般的な目安で、医学的助言ではありません。
      持病・怪我・痛みがある場合は医師やトレーナーに相談してください。
    </p>`;

  bindCloudCard(root);

  // タイマー
  $all('[data-t]', root).forEach(b => b.addEventListener('click', () => {
    stopTimer(); // 実行中でもプリセットで即リスタートできるように
    timer.total = timer.sec = Number(b.dataset.t);
    updateTimerDisp();
    startTimer();
  }));
  $('#timer-toggle', root).addEventListener('click', () => { timer.iv ? stopTimer() : startTimer(); });
  $('#timer-reset', root).addEventListener('click', () => { stopTimer(); timer.sec = timer.total || 0; updateTimerDisp(); });

  // インターバルタイマー
  bindITimer(root);

  // 1RM
  const rmCalc = () => {
    const w = Number($('#rm-w', root).value), r = Number($('#rm-r', root).value);
    const out = $('#rm-out', root);
    if (!w || !r) { out.innerHTML = ''; return; }
    const rm = epley1RM(w, r);
    let rows = '';
    [95, 90, 85, 80, 75, 70, 60].forEach(pct => {
      const reps = { 95: '2', 90: '4', 85: '6', 80: '8', 75: '10', 70: '12', 60: '15+' }[pct];
      rows += `<tr><td>${pct}%</td><td>${(Math.round(rm * pct / 5) * 5 / 100).toFixed(1)}kg</td><td>${reps}回</td></tr>`;
    });
    out.innerHTML = `<div class="tool-result">推定1RM <span class="big">${(Math.round(rm * 10) / 10).toFixed(1)}<small>kg</small></span>
      <table class="rm-table"><tr><th>%1RM</th><th>重量</th><th>目安回数</th></tr>${rows}</table></div>`;
  };
  $('#rm-w', root).addEventListener('input', rmCalc);
  $('#rm-r', root).addEventListener('input', rmCalc);

  // FFMI
  $('#ffmi-calc', root).addEventListener('click', () => {
    const out = $('#ffmi-out', root);
    if (!p) { out.innerHTML = '<p class="card-note">プロフィール設定が必要です。</p>'; return; }
    const bf = Number($('#ffmi-bf', root).value);
    if (!bf || bf <= 0 || bf >= 60) { toast('体脂肪率を入力してください'); return; }
    const hM = p.h / 100;
    const ffm = p.w * (1 - bf / 100);
    const ffmi = ffm / (hM * hM) + 6.1 * (1.8 - hM);
    const v = Math.round(ffmi * 10) / 10;
    // 判定基準は性別で別 (女性は除脂肪量の生理的上限が低い)
    const isF = p.sex === 'f';
    const th = isF ? [14, 15.5, 17, 19] : [18, 20, 22, 25];
    const cap = isF ? 21 : 25;
    let judge;
    if (v < th[0]) judge = '伸びしろしかない。ここからが楽しい';
    else if (v < th[1]) judge = '平均的。継続で確実に変わるゾーン';
    else if (v < th[2]) judge = '明らかに鍛えてる体。素晴らしい';
    else if (v < th[3]) judge = 'かなりの上級者。周りにバレるレベル';
    else judge = 'ナチュラルの限界域。すごすぎる';
    out.innerHTML = `<div class="tool-result">FFMI <span class="big">${v}</span><p class="card-note">除脂肪体重${Math.round(ffm * 10) / 10}kg。${judge}(${isF ? '女性' : '男性'}のナチュラル上限目安は${cap})。</p></div>`;
  });

  // データ管理
  $('#export-data', root).addEventListener('click', () => {
    const data = JSON.stringify(S);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kintore-lab-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('バックアップをダウンロードしました');
  });
  $('#import-data', root).addEventListener('click', () => {
    const bg = openModal(`<h2>データインポート</h2><p class="modal-sub">エクスポートしたJSONを貼り付けてください。現在のデータは上書きされます。</p>
      <div class="field"><textarea id="import-text" rows="6" placeholder='{"profile":...}'></textarea></div>
      <div style="display:flex;gap:10px"><button class="btn ghost" onclick="closeModal()">キャンセル</button><button class="btn" id="import-go">インポート</button></div>`);
    $('#import-go', bg).addEventListener('click', () => {
      try {
        const parsed = JSON.parse($('#import-text', bg).value);
        if (!parsed || typeof parsed !== 'object' || !('logs' in parsed)) throw new Error('形式が違います');
        S = sanitizeState(parsed);
        rebuildDB(S.customEx);
        saveState();
        closeModal();
        toast('インポートしました');
        route();
      } catch (e) {
        toast('読み込めませんでした: ' + e.message);
      }
    });
  });
  $('#reset-data', root).addEventListener('click', () => {
    if (!confirm('全データを削除します。本当によろしいですか?')) return;
    if (!confirm('記録・プロフィール・メニュー・体型フォトが全て消えます。元に戻せません。実行しますか?')) return;
    localStorage.removeItem(LS_KEY);
    try {
      if (typeof PhotoDB !== 'undefined') {
        if (PhotoDB._db) { PhotoDB._db.close(); PhotoDB._db = null; }
        indexedDB.deleteDatabase('kintoreLabPhotos');
      }
    } catch (e) { /* 消せない環境は無視 */ }
    S = defaultState();
    rebuildDB(S.customEx);
    simState = null;
    toast('リセットしました');
    location.hash = 'home';
    route();
  });
}

function fmtTimer(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function updateTimerDisp() {
  const d = $('#timer-disp');
  if (d) { d.textContent = fmtTimer(timer.sec); d.classList.toggle('running', !!timer.iv); }
  updateRestFab();
}
function tickTimer() {
  // 実時刻ベースで残りを再計算 (バックグラウンドでintervalが止まっても復帰時に正しい残量になる)
  timer.sec = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
  if (timer.sec <= 0) {
    stopTimer();
    timerAlarm();
  }
  updateTimerDisp();
}
function startTimer() {
  if (timer.iv || timer.sec <= 0) return;
  ensureAudio();
  timer.endAt = Date.now() + timer.sec * 1000;
  timer.iv = setInterval(tickTimer, 500);
  const t = $('#timer-toggle');
  if (t) t.textContent = '⏸ 停止';
  updateTimerDisp();
}
function stopTimer() {
  clearInterval(timer.iv);
  timer.iv = null;
  const t = $('#timer-toggle');
  if (t) t.textContent = '▶ スタート';
  updateTimerDisp();
}
function timerAlarm() {
  try {
    ensureAudio();
    const ac = audioCtx;
    if (!ac) throw new Error('no audio');
    [0, 0.3, 0.6].forEach(t => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.3, ac.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t + 0.25);
      o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.3);
    });
  } catch (e) { /* 音が出せない環境は無視 */ }
  if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
  toast('⏱️ 休憩終了!次のセット!');
}

// ===== インターバルタイマー(自由設定・プリセット保存) =====
const IT_LIMITS = { prep: [0, 60], work: [1, 3600], rest: [0, 3600], reps: [1, 100], sets: [1, 50], setRest: [0, 3600] };
let itCfg = { prep: 5, work: 60, rest: 30, reps: 8, sets: 1, setRest: 60 };
let iTimer = { phases: [], idx: 0, sec: 5, endAt: 0, iv: null, lastBeep: -1 };

// 設定→フェーズ列を組む(準備→[トレ→休憩]×繰り返し→セット間 ×セット数)
function itBuildPhases(c) {
  const ph = [];
  if (c.prep > 0) ph.push({ type: 'prep', label: '準備', sec: c.prep });
  for (let s = 1; s <= c.sets; s++) {
    for (let r = 1; r <= c.reps; r++) {
      ph.push({ type: 'work', label: 'トレーニング', sec: c.work, set: s, rep: r });
      if (c.rest > 0 && r < c.reps) ph.push({ type: 'rest', label: '休憩', sec: c.rest, set: s, rep: r });
    }
    if (c.setRest > 0 && s < c.sets) ph.push({ type: 'setrest', label: 'セット間', sec: c.setRest, set: s });
  }
  return ph;
}
function itTotalSec(c) { return itBuildPhases(c).reduce((a, p) => a + p.sec, 0); }
function itPhaseColor(t) { return t === 'work' ? '#4ade80' : t === 'prep' ? '#fbbf24' : t === 'setrest' ? '#f472b6' : '#60a5fa'; }
function itMetaText() {
  if (!iTimer.phases.length) return `トレ${itCfg.work}秒 / 休憩${itCfg.rest}秒 を ${itCfg.reps}回 × ${itCfg.sets}セット`;
  const cur = iTimer.phases[iTimer.idx];
  if (!cur) return '完了 🎉';
  let m = '';
  if (cur.set) m += `セット ${cur.set}/${itCfg.sets}`;
  if (cur.rep) m += `${m ? ' ・ ' : ''}${cur.rep}/${itCfg.reps}回`;
  return m || cur.label;
}
function itField(label, key, val, unit) {
  return `<div class="field"><label>${label}${unit ? '（' + unit + '）' : ''}</label>
    <input type="number" class="it-in" data-k="${key}" value="${val}" min="${IT_LIMITS[key][0]}" max="${IT_LIMITS[key][1]}" inputmode="numeric"></div>`;
}
function itCardHtml() {
  const c = itCfg;
  const running = !!iTimer.iv;
  const cur = iTimer.phases[iTimer.idx];
  const active = iTimer.phases.length > 0;
  const dispSec = active ? iTimer.sec : (c.prep > 0 ? c.prep : c.work);
  const phaseLabel = active ? (cur ? cur.label : '完了 🎉') : 'スタート待ち';
  const color = active && cur ? itPhaseColor(cur.type) : 'var(--text, #e6e8ea)';
  const chips = (S.timerPresets || []).map((t, i) =>
    `<span class="it-chip" style="display:inline-flex;align-items:center;border:1px solid rgba(255,255,255,.18);border-radius:999px;overflow:hidden">
      <button class="it-load" data-i="${i}" style="background:none;border:none;color:inherit;padding:6px 4px 6px 12px;font-size:13px;cursor:pointer">${esc(t.name)}</button>
      <button class="it-del" data-i="${i}" aria-label="削除" style="background:none;border:none;color:inherit;opacity:.55;padding:6px 10px 6px 4px;font-size:14px;cursor:pointer">×</button>
    </span>`).join('');
  return `<div class="card"><h2>⏱️ インターバルタイマー</h2>
    <p class="card-note" style="margin-top:-4px">HIIT・タバタ・サーキットを自由に設定。準備→トレ→休憩を繰り返し、複数セットも対応。</p>
    <div class="timer-display ${running ? 'running' : ''}" id="it-time" style="color:${color}">${fmtTimer(dispSec)}</div>
    <div id="it-phase" style="text-align:center;font-weight:700;font-size:15px;margin:-6px 0 2px;color:${color}">${phaseLabel}</div>
    <div id="it-meta" class="card-note" style="text-align:center;margin-bottom:10px">${itMetaText()}</div>
    <div class="timer-btns">
      <button class="btn" id="it-toggle">${running ? '⏸ 一時停止' : '▶ スタート'}</button>
      <button class="btn ghost" id="it-reset">リセット</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px">
      ${itField('準備', 'prep', c.prep, '秒')}
      ${itField('トレーニング', 'work', c.work, '秒')}
      ${itField('休憩', 'rest', c.rest, '秒')}
      ${itField('繰り返し回数', 'reps', c.reps, '回')}
      ${itField('セット数', 'sets', c.sets, '')}
      ${itField('セット間の準備', 'setRest', c.setRest, '秒')}
    </div>
    <p class="card-note" id="it-total">合計 約 ${fmtTimer(itTotalSec(c))}（フェーズ切替と残り3秒で音・バイブ）</p>
    <div style="display:flex;gap:8px;margin-top:8px">
      <input type="text" id="it-name" placeholder="メニュー名を付けて保存" maxlength="20"
        style="flex:1;min-width:0;padding:9px 12px;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:rgba(255,255,255,.04);color:inherit;font-size:14px">
      <button class="btn small" id="it-save">保存</button>
    </div>
    ${(S.timerPresets || []).length ? `<div class="it-presets" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">${chips}</div>` : ''}
  </div>`;
}
function itSyncDisp() {
  const cur = iTimer.phases[iTimer.idx];
  const color = iTimer.phases.length && cur ? itPhaseColor(cur.type) : '';
  const t = document.getElementById('it-time');
  if (t) { t.textContent = fmtTimer(iTimer.sec); t.classList.toggle('running', !!iTimer.iv); if (color) t.style.color = color; }
  const ph = document.getElementById('it-phase');
  if (ph) { ph.textContent = iTimer.phases.length ? (cur ? cur.label : '完了 🎉') : 'スタート待ち'; if (color) ph.style.color = color; }
  const mt = document.getElementById('it-meta');
  if (mt) mt.textContent = itMetaText();
  const tg = document.getElementById('it-toggle');
  if (tg) tg.textContent = iTimer.iv ? '⏸ 一時停止' : '▶ スタート';
}
function itLoadPhase(i) {
  iTimer.idx = i;
  const p = iTimer.phases[i];
  iTimer.sec = p ? p.sec : 0;
  iTimer.lastBeep = -1;
}
function itStart() {
  if (iTimer.iv) return;
  ensureAudio();
  if (!iTimer.phases.length || iTimer.idx >= iTimer.phases.length) {
    iTimer.phases = itBuildPhases(itCfg);
    if (!iTimer.phases.length) { toast('設定を確認してください'); return; }
    itLoadPhase(0);
  }
  iTimer.endAt = Date.now() + iTimer.sec * 1000;
  iTimer.iv = setInterval(itTick, 200);
  itSyncDisp();
}
function itPause() {
  clearInterval(iTimer.iv); iTimer.iv = null;
  iTimer.sec = Math.max(0, Math.ceil((iTimer.endAt - Date.now()) / 1000));
  itSyncDisp();
}
function itReset() {
  clearInterval(iTimer.iv); iTimer.iv = null;
  iTimer.phases = []; iTimer.idx = 0; iTimer.lastBeep = -1;
  iTimer.sec = itCfg.prep > 0 ? itCfg.prep : itCfg.work;
  itSyncDisp();
}
function itTick() {
  const remMs = iTimer.endAt - Date.now();
  iTimer.sec = Math.max(0, Math.ceil(remMs / 1000));
  const rem = iTimer.sec;
  if (rem > 0 && rem <= 3 && rem !== iTimer.lastBeep) { iTimer.lastBeep = rem; itBeep(660, 0.12); }
  if (remMs <= 0) itAdvance();
  else itSyncDisp();
}
function itAdvance() {
  const next = iTimer.idx + 1;
  if (next >= iTimer.phases.length) {
    clearInterval(iTimer.iv); iTimer.iv = null;
    iTimer.idx = iTimer.phases.length; iTimer.sec = 0;
    itFinishAlarm();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
    itSyncDisp();
    return;
  }
  itLoadPhase(next);
  iTimer.endAt = Date.now() + iTimer.sec * 1000;
  const p = iTimer.phases[next];
  itBeep(p.type === 'work' ? 880 : 520, 0.18);
  if (navigator.vibrate) navigator.vibrate(p.type === 'work' ? [120, 60, 120] : [200]);
  itSyncDisp();
}
function itBeep(freq, dur) {
  try {
    ensureAudio(); const ac = audioCtx; if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.25, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    o.start(); o.stop(ac.currentTime + dur + 0.02);
  } catch (e) { /* 音が出せない環境は無視 */ }
}
function itFinishAlarm() {
  try {
    ensureAudio(); const ac = audioCtx; if (!ac) throw new Error('no audio');
    [0, 0.22, 0.44, 0.7].forEach((t, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.frequency.value = i < 3 ? 784 : 1046;
      g.gain.setValueAtTime(0.3, ac.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t + 0.2);
      o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.24);
    });
  } catch (e) { /* 無視 */ }
  toast('🎉 メニュー完了!お疲れさま!');
}
function bindITimer(root) {
  $all('.it-in', root).forEach(inp => inp.addEventListener('input', () => {
    const k = inp.dataset.k, lim = IT_LIMITS[k];
    let v = Math.round(Number(inp.value));
    if (!isFinite(v)) return;
    v = Math.max(lim[0], Math.min(lim[1], v));
    itCfg[k] = v;
    const tot = document.getElementById('it-total');
    if (tot) tot.textContent = `合計 約 ${fmtTimer(itTotalSec(itCfg))}（フェーズ切替と残り3秒で音・バイブ）`;
    if (!iTimer.iv && !iTimer.phases.length) { iTimer.sec = itCfg.prep > 0 ? itCfg.prep : itCfg.work; itSyncDisp(); }
  }));
  const tg = $('#it-toggle', root);
  if (tg) tg.addEventListener('click', () => { iTimer.iv ? itPause() : itStart(); });
  const rs = $('#it-reset', root);
  if (rs) rs.addEventListener('click', itReset);
  const sv = $('#it-save', root);
  if (sv) sv.addEventListener('click', () => {
    const nameInp = $('#it-name', root);
    const name = (nameInp ? nameInp.value : '').trim();
    if (!name) { toast('メニュー名を入力してください'); return; }
    S.timerPresets = S.timerPresets || [];
    if (S.timerPresets.length >= 30) { toast('保存は30件までです'); return; }
    S.timerPresets.push({ name: name.slice(0, 20), prep: itCfg.prep, work: itCfg.work, rest: itCfg.rest, reps: itCfg.reps, sets: itCfg.sets, setRest: itCfg.setRest });
    saveState();
    toast('💾 メニューを保存しました');
    renderTools();
  });
  const pc = root.querySelector('.it-presets');
  if (pc) pc.addEventListener('click', (e) => {
    const del = e.target.closest('.it-del'), load = e.target.closest('.it-load');
    if (del) {
      const i = Number(del.dataset.i);
      if (S.timerPresets && S.timerPresets[i]) { S.timerPresets.splice(i, 1); saveState(); renderTools(); }
      return;
    }
    if (load) {
      const i = Number(load.dataset.i), t = S.timerPresets && S.timerPresets[i];
      if (!t) return;
      itCfg = { prep: t.prep, work: t.work, rest: t.rest, reps: t.reps, sets: t.sets, setRest: t.setRest };
      itReset();
      renderTools();
      toast(`「${t.name}」を読み込みました`);
    }
  });
}

// ===== 複数タブ・復帰時の同期 =====
// 別タブの保存を取り込む: 取り込まないと古いメモリ状態の上書き保存で記録が消える
function refreshFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const cur = JSON.stringify(S);
    if (raw === cur) return; // 変化なし
    if (!raw && cur === JSON.stringify(defaultState())) return; // 未保存×初期状態
  } catch (e) { /* 比較失敗時は再読込にフォールバック */ }
  S = loadState();
  rebuildDB(S.customEx);
  if (!$('#modal-bg')) route(); // モーダル(ウィザード等)操作中は描画を壊さない
}
window.addEventListener('storage', e => { if (e.key === LS_KEY) refreshFromStorage(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (timer.iv) tickTimer(); // ロック中に満了したタイマーは復帰直後に鳴らす
  if (iTimer.iv) itTick();    // インターバルタイマーも復帰時に追従
  refreshFromStorage();
});

// ===== 起動 =====
document.addEventListener('DOMContentLoaded', () => {
  route();
  if (!S.profile) openProfileWizard(true);
  // 浮遊レストタイマーのボタン (静的要素なので一度だけ束縛)
  const fabStop = document.getElementById('rt-stop');
  if (fabStop) fabStop.addEventListener('click', () => { stopTimer(); updateRestFab(); });
  const fabAdd = document.getElementById('rt-add');
  if (fabAdd) fabAdd.addEventListener('click', () => { if (timer.iv) { timer.endAt += 30000; tickTimer(); } });
});
