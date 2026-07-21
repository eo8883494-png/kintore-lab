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

// ===== 状態 =====
const LS_KEY = 'kintoreLab.v1';

function defaultState() {
  return { profile: null, focus: {}, plan: null, logs: [], weights: [], lastW: {}, nextId: 1, dayDone: {}, mealSeed: 0, swap: null, swapDismiss: '', customEx: [], myMenus: [], myToday: null };
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
      out.myMenus.push({ id, name: m.name.slice(0, 20), items });
    });
  }
  if (s.myToday && typeof s.myToday === 'object' && typeof s.myToday.date === 'string' && DATE_RE.test(s.myToday.date)) {
    const mid = Number(s.myToday.id);
    if (out.myMenus.some(m => m.id === mid)) out.myToday = { date: s.myToday.date, id: mid };
  }
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
    menuMap.set(k, nm); menuIdMap.set(k, nm.id);
  });
  const myMenus = [...menuMap.values()];
  let myToday = null;
  if (primary.myToday) {
    const srcMenu = primary.myMenus.find(m => m.id === primary.myToday.id);
    if (srcMenu) { const nid2 = menuIdMap.get(menuContentKey(srcMenu)); if (nid2 != null) myToday = { date: primary.myToday.date, id: nid2 }; }
  }

  // 5) lastW: 統合 (primary 優先)、dayDone は logs から今日分だけ再構築
  const lastW = { ...secondary.lastW, ...primary.lastW };
  const today = todayStr();
  const dayDone = {};
  logs.filter(l => l.date === today).forEach(l => { (dayDone[today] = dayDone[today] || {})[l.exId] = { id: l.id, src: 'plan' }; });

  const out = defaultState();
  Object.assign(out, {
    profile: primary.profile, focus: primary.focus, plan: primary.plan,
    mealSeed: primary.mealSeed, swap: primary.swap, swapDismiss: primary.swapDismiss,
    logs, weights, lastW, customEx: merged, myMenus, myToday, dayDone,
    nextId: nid,
  });
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
    const st = S.focus[g.dataset.part];
    $all('.bm-region', g).forEach(r => {
      r.classList.toggle('grow', st === 'grow');
      r.classList.toggle('tone', st === 'tone');
    });
  });
  const chips = $('#focus-chips', root);
  if (chips) {
    const keys = Object.keys(S.focus);
    chips.innerHTML = keys.length
      ? keys.map(k => `<span class="chip ${S.focus[k]}">${esc(SCIENCE.partMap[k].name)} ${S.focus[k] === 'grow' ? 'でかく' : '引き締め'}</span>`).join('')
      : '<span class="chip">未選択(全体バランスで生成)</span>';
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
function openExerciseModal(exId) {
  const ex = DB.byId[exId];
  if (!ex) return;
  openModal(`
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
    <a class="btn" style="margin-bottom:10px;text-decoration:none" target="_blank" rel="noopener"
       href="https://www.youtube.com/results?search_query=${encodeURIComponent(exSearchName(ex) + ' フォーム やり方')}">🎬 フォーム動画を見る (YouTube)</a>
    <button class="btn ghost" onclick="closeModal()">閉じる</button>`);
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
      const isBW = ex.equipment === 'bodyweight';
      const unit = ex.isometric ? '秒キープ' : '回';
      return `
        <div class="today-ex ${done ? 'done' : ''}" data-ex="${it.exId}">
          <input type="checkbox" class="done-chk" data-ex="${it.exId}" ${done ? 'checked' : ''}>
          <div class="info" data-open-ex="${it.exId}">
            <div class="nm">${esc(ex.name)}${it.priority ? '<span style="color:var(--accent)"> ◆</span>' : ''}</div>
            <div class="meta">${isCarry ? '<b style="color:var(--warn)">⏳前回の積み残し</b> / ' : ''}${it.sets}セット × ${esc(it.reps)}${unit} / 休憩${it.rest}秒</div>
          </div>
          ${isBW ? '<span class="unit">自重</span>' : `<input type="number" class="winp" data-ex="${it.exId}" value="${lastW != null ? lastW : ''}" placeholder="kg" step="0.5"><span class="unit">kg</span>`}
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
    el.addEventListener('click', () => openExerciseModal(el.dataset.openEx));
  });
  $all('input.winp', root).forEach(inp => {
    inp.addEventListener('change', () => {
      const w = Number(inp.value);
      if (w > 0) { S.lastW[inp.dataset.ex] = w; saveState(); }
    });
  });
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
    const logId = newId();
    S.logs.push({
      id: logId, date: today, exId,
      sets: Array.from({ length: item.sets }, () => ({ w, r: repMid(item.reps) })),
    });
    S.dayDone[today][exId] = { id: logId, src: ck };
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
      saveState();
    }
  }
  renderHome();
}

// ===== PLAN =====
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
    </div>
    <div class="focus-chips" id="focus-chips"></div>
    <p class="card-note">タップで 強化 → 引き締め → 解除 の順に切替。選んだ部位は種目数+1・セット数+1で優先され、どのトレ日にも必ず入ります。※「引き締め」も軽い高回数ではなくしっかり効かせるのが最短(絞りは食事タブで)。</p>
  </div>`;

  html += `<div style="display:flex;gap:10px;margin-bottom:14px">
    <button class="btn" id="gen-plan">${S.plan ? 'メニューを作り直す' : 'メニュー生成'}</button>
    ${S.plan ? '<button class="btn ghost" id="shuffle-plan" style="width:auto">🔀</button>' : ''}
  </div>`;

  if (S.plan) {
    html += `<div class="card"><h2>📋 週間メニュー<span class="sub">${S.plan.createdAt} 生成</span></h2>`;
    S.plan.days.forEach(day => {
      html += `<div class="plan-day"><div class="plan-day-head"><span class="wd">${WEEKDAY_NAMES[day.weekday]}</span>${esc(day.name)}<span class="mins">約${day.minutes}分</span></div>`;
      day.items.forEach(it => {
        const ex = DB.byId[it.exId];
        if (!ex) return;
        html += `<div class="plan-ex" data-open-ex="${it.exId}">
          <div><div class="nm">${esc(ex.name)}${it.priority ? '<span class="pri">◆優先</span>' : ''}</div>
          <div class="meta">${esc(SCIENCE.partMap[ex.part].name)} / ${EQUIP_NAMES[ex.equipment]}</div></div>
          <div class="setrep">${it.sets}×${esc(it.reps)}${ex.isometric ? '秒' : ''}<small>休${it.rest}秒</small></div>
        </div>`;
      });
      html += `</div>`;
    });
    html += `<p class="card-note">種目タップでフォーム解説。曜日は目安なのでズレてもOK。</p></div>`;

    // 週間ボリュームと判定
    html += `<div class="card"><h2>📊 部位別 週セット数</h2>`;
    SCIENCE.parts.forEach(pt => {
      const sets = S.plan.weeklySets[pt.key] || 0;
      const verdict = volumeVerdict(pt.key, sets, S.profile.goal);
      const pct = Math.min(100, (sets / pt.mrv) * 100);
      html += `<div class="vol-row"><span class="nm">${esc(pt.name)}</span>
        <span class="bar"><i style="width:${pct}%"></i></span>
        <span class="val">${sets}<span class="tag ${verdict.cls}">${verdict.label}</span></span></div>`;
    });
    const hasLow = SCIENCE.parts.some(pt => volumeVerdict(pt.key, S.plan.weeklySets[pt.key] || 0, S.profile.goal).cls === 'low');
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
      const cur = S.focus[part];
      if (!cur) S.focus[part] = 'grow';
      else if (cur === 'grow') S.focus[part] = 'tone';
      else delete S.focus[part];
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
  $all('[data-open-ex]', root).forEach(el => {
    el.addEventListener('click', () => openExerciseModal(el.dataset.openEx));
  });
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
  html += `</div>`;

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
        <div class="log-entry"><div><div class="nm">${esc(m.name)}</div>
          <div class="sets">${m.items.length}種目 / 約${dayMinutes(m.items)}分</div></div>
          <button class="btn small" data-mm-run="${m.id}" style="margin-left:auto">▶ 今日やる</button>
          <button class="del" data-mm-del="${m.id}">🗑</button></div>`).join('')
        : '<p class="card-note">よくやる自分の組み合わせを保存すると、ホームでワンタップ実行&チェック記録できます。DBにない種目も「オリジナル種目」として追加OK。</p>'}</div>
      <button class="btn ghost" id="mymenu-new">+ 新しいマイメニュー</button>
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
    S.myMenus = S.myMenus.filter(m => m.id !== id);
    if (S.myToday && S.myToday.id === id) S.myToday = null;
    saveState();
    renderLog();
  }));

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
let timer = { sec: 0, total: 0, iv: null, endAt: 0 };
let audioCtx = null;
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
    return `<div class="card"><h2>☁️ 端末間同期<span class="tag good" style="font-size:10px">ON</span></h2>
      <p style="font-size:13.5px">${esc(st.user.name || st.user.email || 'ログイン中')} でログイン中。この端末の記録は自動でクラウドに保存され、同じGoogleアカウントの別端末と同期されます。</p>
      <p class="card-note">${st.syncing ? '同期中...' : (st.lastSync ? '最終同期: ' + st.lastSync : 'まもなく同期します')}</p>
      <button class="btn ghost" id="cloud-signout">ログアウト(同期を止める)</button>
      <p class="card-note">※体型フォトはこの端末内のみに保存され、同期対象外です。</p>
    </div>`;
  }
  return `<div class="card"><h2>☁️ 端末間同期</h2>
    <p style="font-size:13.5px;margin-bottom:10px">Googleでログインすると、記録・メニュー・体重が<b>スマホとPCなど複数の端末で同期</b>されます。機種変更してもデータが引き継がれます。</p>
    <button class="btn" id="cloud-signin">Googleでログイン</button>
    <p class="card-note">ログインしなくても全機能そのまま使えます(データはこの端末に保存)。ログインは任意です。</p>
  </div>`;
}

function bindCloudCard(root) {
  const inBtn = $('#cloud-signin', root);
  if (inBtn) inBtn.addEventListener('click', () => { if (window.__klCloud) window.__klCloud.signIn(); });
  const outBtn = $('#cloud-signout', root);
  if (outBtn) outBtn.addEventListener('click', () => {
    if (confirm('ログアウトします。この端末のデータは残りますが、以後の変更は同期されません。')) {
      if (window.__klCloud) window.__klCloud.signOut();
    }
  });
}

function renderTools() {
  const root = $('#view-tools');
  const p = S.profile;

  root.innerHTML = `
    ${cloudCardHtml()}
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
  refreshFromStorage();
});

// ===== 起動 =====
document.addEventListener('DOMContentLoaded', () => {
  route();
  if (!S.profile) openProfileWizard(true);
});
