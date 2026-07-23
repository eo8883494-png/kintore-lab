// 筋トレLAB — 食事プラン: PFC目標計算と実食品での献立自動生成

// FOODDB_RAW (data-foods.js) を平坦化
const FOODS = [];
if (typeof FOODDB_RAW !== 'undefined') {
  Object.keys(FOODDB_RAW).forEach(cat => {
    (FOODDB_RAW[cat] || []).forEach(f => FOODS.push({ ...f, cat }));
  });
}

// 名前の一部かidで食品を引く (テンプレート解決用)
function findFood(key) {
  return FOODS.find(f => f.id === key) || FOODS.find(f => f.name.indexOf(key) >= 0) || null;
}

// 食事ログ用
const FOOD_BY_ID = {};
FOODS.forEach(f => { FOOD_BY_ID[f.id] = f; });
const FOOD_CAT_LABEL = { protein: 'タンパク質', carb: '主食・炭水化物', fatveg: '脂質・野菜・果物', snack: '間食・コンビニ' };
function foodLogTotals(date) {
  const list = (typeof S !== 'undefined' && S.foodLog && S.foodLog[date]) || [];
  return list.reduce((a, it) => {
    const f = FOOD_BY_ID[it.id]; if (!f) return a;
    return { kcal: a.kcal + f.kcal * it.qty, p: a.p + f.p * it.qty, f: a.f + f.f * it.qty, c: a.c + f.c * it.qty };
  }, { kcal: 0, p: 0, f: 0, c: 0 });
}
// 水分目標(杯・250ml換算・体重×33ml/kg)
function waterTarget(profile) {
  return Math.max(6, Math.min(12, Math.round(((profile && profile.w) || 65) * 0.033 / 0.25)));
}
// 体組成の推定: 記録した体重変化を脂肪/筋肉に按分(トレ歴で係数を変える)
function bodyCompEstimate(profile, weights) {
  const pts = (weights || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  if (pts.length < 2) return null;
  const first = pts[0], last = pts[pts.length - 1];
  const change = Math.round((last.kg - first.kg) * 10) / 10;
  if (Math.abs(change) < 0.4) return null;
  const days = Math.round((new Date(last.date + 'T12:00:00') - new Date(first.date + 'T12:00:00')) / 86400000);
  const lvl = profile.level || 1;
  let fat, muscle;
  if (change < 0) {
    const fatFrac = lvl === 1 ? 0.95 : lvl === 2 ? 0.88 : 0.82;
    fat = Math.round(change * fatFrac * 10) / 10;
    muscle = Math.round((change - fat) * 10) / 10;
  } else {
    const muscleFrac = lvl === 1 ? 0.55 : lvl === 2 ? 0.4 : 0.28;
    muscle = Math.round(change * muscleFrac * 10) / 10;
    fat = Math.round((change - muscle) * 10) / 10;
  }
  return { days, change, fat, muscle, cut: change < 0 };
}

// ===== 目標計算 =====
// 体重ナビと献立が必ず同じ方針になるよう、閾値は共有定数で持つ
const RECOMP_BMI = 20.5;               // これ以下は減量させない(リコンプへ)
const BULK_KEEP_BMI = { m: 23.5, f: 21.5 }; // これ以上は増量を勧めない
const BULK_TARGET_BMI = { m: 24, f: 22 };
const KCAL_FLOOR = { m: 1500, f: 1200 };

function mealTargets(profile) {
  const tdee = calcTDEE(profile);
  const hM = profile.h / 100;
  const bmi = profile.w / (hM * hM);
  let adjust = { hyp: 250, str: 200, diet: -400, fit: 0 }[profile.goal] || 0;
  let mode = 'normal';
  if (profile.goal === 'diet' && profile.age < 18) {
    adjust = 0; mode = 'teen'; // 成長期のカロリー制限はさせない
  } else if (profile.goal === 'diet' && bmi <= RECOMP_BMI) {
    adjust = 0; mode = 'recomp'; // 低体重の減量は止める: 維持カロリーで引き締め
  } else if ((profile.goal === 'hyp' || profile.goal === 'str') && bmi >= BULK_KEEP_BMI[profile.sex === 'f' ? 'f' : 'm']) {
    adjust = 0; mode = 'maintain'; // 体重は足りている: 維持カロリーで重量を伸ばす
  }
  const kcal = Math.max(KCAL_FLOOR[profile.sex === 'f' ? 'f' : 'm'], Math.round(tdee + adjust));
  const p = Math.round(profile.w * (SCIENCE.proteinPerKg[profile.goal] || 1.8));
  const fatRatio = profile.goal === 'diet' ? 0.22 : 0.25;
  const f = Math.round((kcal * fatRatio) / 9);
  const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));
  return { kcal, p, f, c, tdee, adjust, mode, bmi };
}

// ===== 献立テンプレート (キーは食品名の部分一致) =====
const MEAL_TEMPLATES = {
  breakfast: [
    { name: '和定食スタイル', items: [['白米ご飯', 1.5], ['卵', 2], ['納豆', 1], ['味噌汁', 1]] },
    { name: 'オートミールボウル', items: [['オートミール', 1], ['ホエイプロテイン', 1], ['バナナ', 1], ['ギリシャヨーグルト', 1]] },
    { name: 'トースト＆卵', items: [['食パン', 2], ['卵', 2], ['無調整豆乳', 1], ['キウイ', 1]] },
  ],
  lunch: [
    { name: '鶏むね弁当', items: [['白米ご飯', 2], ['鶏むね', 1.5], ['ブロッコリー', 1], ['ミニトマト', 1]] },
    { name: 'そば＋チキン', items: [['そば', 1], ['サラダチキン', 1], ['ゆで卵', 1]] },
    { name: 'パスタランチ', items: [['パスタ', 1], ['ツナ水煮', 1.5], ['ブロッコリー', 1], ['オリーブオイル', 0.5]] },
  ],
  dinner: [
    { name: '鮭定食', items: [['白米ご飯', 1.5], ['鮭', 1.5], ['木綿豆腐', 1], ['ほうれん草', 1]] },
    { name: '赤身肉定食', items: [['白米ご飯', 1.5], ['牛もも', 1.2], ['キャベツ', 1], ['ぶなしめじ', 1]] },
    { name: 'サバ缶定食', items: [['白米ご飯', 1.5], ['サバ水煮', 1], ['ブロッコリー', 1], ['味噌汁', 1]] },
    { name: '豚ヒレ定食', items: [['白米ご飯', 1.5], ['豚ヒレ', 1.2], ['キャベツ', 1], ['味噌汁', 1]] },
  ],
  snack: [
    { name: 'プロテイン補給', items: [['ホエイプロテイン', 1], ['バナナ', 1], ['アーモンド', 1]] },
    { name: 'コンビニ補給', items: [['ザバス', 1], ['ゆで卵', 1], ['あたりめ', 1]] },
    { name: 'ヨーグルト＆ナッツ', items: [['オイコス', 1], ['アーモンド', 1], ['干し芋', 0.5]] },
  ],
};
const MEAL_META = [
  { key: 'breakfast', name: '朝食', icon: '🌅', share: 0.25 },
  { key: 'lunch', name: '昼食', icon: '🍱', share: 0.30 },
  { key: 'dinner', name: '夕食', icon: '🌙', share: 0.30 },
  { key: 'snack', name: '間食', icon: '🥜', share: 0.15 },
];

function foodTotals(items) {
  return items.reduce((a, it) => ({
    kcal: a.kcal + it.food.kcal * it.qty,
    p: a.p + it.food.p * it.qty,
    f: a.f + it.food.f * it.qty,
    c: a.c + it.food.c * it.qty,
  }), { kcal: 0, p: 0, f: 0, c: 0 });
}

function roundToStep(qty, step) {
  return Math.max(step, Math.round(qty / step) * step);
}

// 1食分をスケール: タンパク源でPを合わせ、炭水化物源でkcalを合わせる
function scaleMeal(template, kcalTarget, pTarget) {
  let items = template.items
    .map(([key, qty]) => {
      const food = findFood(key);
      return food ? { food, qty } : null;
    })
    .filter(Boolean);
  if (!items.length) return { name: template.name, items: [], totals: { kcal: 0, p: 0, f: 0, c: 0 } };

  // 縮小方向では丸めで元の量を超えない (0.5袋→1袋のような逆流を防ぐ)
  const applyFactor = (it, factor) => {
    const scaled = roundToStep(it.qty * factor, it.food.step);
    it.qty = factor < 1 ? Math.min(it.qty, scaled) : scaled;
  };
  // 1) タンパク質を目標へ
  const pItems = items.filter(it => it.food.role === 'protein');
  const curP = foodTotals(items).p;
  if (pItems.length && curP > 0) {
    const factor = Math.min(2.5, Math.max(0.5, pTarget / curP));
    pItems.forEach(it => applyFactor(it, factor));
  }
  // 2) 残りカロリーを炭水化物源で調整
  const cItems = items.filter(it => it.food.role === 'carb');
  const nonCarbKcal = foodTotals(items.filter(it => it.food.role !== 'carb')).kcal;
  const carbKcalTarget = Math.max(0, kcalTarget - nonCarbKcal);
  const curCarbKcal = foodTotals(cItems).kcal;
  if (cItems.length && curCarbKcal > 0) {
    const factor = Math.min(3, Math.max(0.4, carbKcalTarget / curCarbKcal));
    cItems.forEach(it => applyFactor(it, factor));
  }
  items.forEach(it => { it.qty = Math.min(it.qty, it.food.step * 12); });
  return { name: template.name, items, totals: foodTotals(items) };
}

// 1日分の献立を生成 (dayIndex+seedで日替わりローテーション)
function generateMealPlan(profile, seed) {
  let t = mealTargets(profile);
  // 手動PFC目標が設定されていれば上書き(カロリーはP/F/Cから導出)
  const mt = (typeof S !== 'undefined' && S && S.mealTargets && S.mealTargets.custom) ? S.mealTargets : null;
  if (mt) t = { ...t, p: mt.p, f: mt.f, c: mt.c, kcal: mt.p * 4 + mt.f * 9 + mt.c * 4, mode: 'custom' };
  const dayIndex = Math.floor(new Date(todayStr() + 'T12:00:00').getTime() / 86400000);
  const meals = MEAL_META.map((m, mi) => {
    const variants = MEAL_TEMPLATES[m.key];
    const tpl = variants[(dayIndex + (seed || 0) + mi) % variants.length];
    const scaled = scaleMeal(tpl, t.kcal * m.share, t.p * m.share);
    return { ...m, ...scaled };
  });
  const totals = meals.reduce((a, m) => ({
    kcal: a.kcal + m.totals.kcal, p: a.p + m.totals.p, f: a.f + m.totals.f, c: a.c + m.totals.c,
  }), { kcal: 0, p: 0, f: 0, c: 0 });
  return { targets: t, meals, totals };
}

// 量の表示: "100g"系はグラム換算、"1個(60g)"「10粒(10g)」系は個数換算、その他はグラム目安
function qtyLabel(food, qty) {
  const mGram = food.per.match(/^(\d+)\s*(g|ml)$/);
  if (mGram) {
    return `${Math.round(Number(mGram[1]) * qty)}${mGram[2]}`;
  }
  const mCount = food.per.match(/^(\d+)([^((\d\/]+)/);
  if (mCount) {
    const count = Math.round(Number(mCount[1]) * qty * 10) / 10;
    return `${count}${mCount[2].trim()}`;
  }
  return `約${Math.round(food.grams * qty)}g`;
}

// ===== 体重ナビ: 「あと何kg増減すべきか」と実績ペース判定 =====
function weightNav(profile, weights) {
  const hM = profile.h / 100;
  // モード/BMI判定は最新の体重記録を優先(profile.wが同期でstaleでも実体重に追従)
  const w = (weights && weights.length) ? weights[weights.length - 1].kg : profile.w;
  const bmi = w / (hM * hM);
  const nav = { bmi: Math.round(bmi * 10) / 10, mode: 'keep', diff: 0, pace: 0, weeks: 0, msg: '', trend: null, advice: '' };

  const sexKey = profile.sex === 'f' ? 'f' : 'm';
  if (profile.age < 18) {
    nav.msg = '成長期は体重を減らすより、食べて動いて体を作る時期。体重は身長の伸びと一緒に自然に整っていきます。';
  } else if (profile.goal === 'diet') {
    const target = Math.max(22 * hM * hM, w * 0.9); // BMI22 か −10% の高い方 (一度に欲張らない)
    if (bmi <= RECOMP_BMI) {
      nav.msg = '体重はすでに十分軽め。これ以上減らすより、体重維持のまま筋トレで引き締める(リコンプ)のがおすすめ。献立も維持カロリーに切り替えています。';
    } else if (w - target < 1) {
      nav.msg = 'ほぼ適正体重。ここからは体重計より見た目と写真を指標にしよう。';
    } else {
      nav.mode = 'cut';
      nav.diff = Math.round((w - target) * 10) / 10;
      nav.pace = Math.max(0.2, Math.round(w * 0.005 * 10) / 10); // 週0.5% (筋肉を守れる上限ペース)
      nav.weeks = Math.ceil(nav.diff / nav.pace);
      nav.target = Math.round(target * 10) / 10;
    }
  } else if (profile.goal === 'hyp' || profile.goal === 'str') {
    const target = BULK_TARGET_BMI[sexKey] * hM * hM;
    if (bmi < BULK_KEEP_BMI[sexKey]) {
      nav.mode = 'bulk';
      nav.diff = Math.round((target - w) * 10) / 10;
      nav.pace = Math.max(0.1, Math.round(w * 0.0025 * 100) / 100); // 週0.25% (脂肪を乗せすぎない)
      nav.weeks = Math.ceil(nav.diff / nav.pace);
      nav.target = Math.round(target * 10) / 10;
    } else {
      nav.msg = '体重は足りている。急いで増やすより今の体重±1kgをキープして重量を伸ばすのが、脂肪を付けない近道。献立も維持カロリーにしています。';
    }
  } else {
    nav.msg = '現状維持でOK。「同じ体重のまま引き締まっていくか」を鏡と写真でチェックしよう。';
  }

  // 実績トレンド: 直近28日の体重記録 → 週あたり変化 (5日以上の間隔がないと日内変動が増幅されるので判定しない)
  const recent = (weights || []).filter(x => x.date >= dateAdd(todayStr(), -28));
  if (recent.length >= 2) {
    const first = recent[0], last = recent[recent.length - 1];
    const days = (new Date(last.date + 'T12:00:00') - new Date(first.date + 'T12:00:00')) / 86400000;
    if (days >= 5) nav.trend = Math.round(((last.kg - first.kg) / days) * 7 * 100) / 100;
  }

  // 実績ペースへの助言 + 自動調整のkcal増減(suggestKcal: マイナス=減らす)
  nav.suggestKcal = 0; nav.stalled = false;
  if (nav.mode === 'cut') {
    if (nav.trend == null) nav.advice = '体重を5日以上あけて2回以上記録すると、ペースが合っているか自動判定します。';
    else if (nav.trend > -nav.pace * 0.4) { nav.advice = `今のペースは${nav.trend >= 0 ? '横ばい〜増加' : '緩やか'}(${nav.trend}kg/週)。1日あと150kcal(ご飯100g分)減らすと目標ペースに乗ります。`; nav.suggestKcal = -150; nav.stalled = nav.trend >= -0.05; }
    else if (nav.trend < -nav.pace * 1.8) { nav.advice = `減りが速すぎ(${nav.trend}kg/週)。筋肉まで落ちるリスクがあるので1日+150kcal戻しましょう。`; nav.suggestKcal = 150; }
    else nav.advice = `いいペース(${nav.trend}kg/週)。このまま続ければ計算通りに到達します。`;
  } else if (nav.mode === 'bulk') {
    if (nav.trend == null) nav.advice = '体重を5日以上あけて2回以上記録すると、増量ペースが合っているか自動判定します。';
    else if (nav.trend < nav.pace * 0.4) { nav.advice = `増え方が足りない(${nav.trend}kg/週)。1日+200kcal(ご飯120g or プロテイン+バナナ)追加を。`; nav.suggestKcal = 200; nav.stalled = nav.trend <= 0.05; }
    else if (nav.trend > nav.pace * 2) { nav.advice = `増えすぎ(${nav.trend}kg/週)。脂肪が主に増えるゾーンなので1日−150kcal調整を。`; nav.suggestKcal = -150; }
    else nav.advice = `理想的な増量ペース(${nav.trend}kg/週)。筋肉主体で増えています。`;
  }
  // 女性の黄体期/月経期は見かけの体重増(水分)で誤停滞するので、カロリー調整の提案を保留する
  if (profile.sex === 'f' && typeof cyclePhase === 'function' && typeof S !== 'undefined' && S.cycle && nav.suggestKcal) {
    const cp = cyclePhase(S.cycle, todayStr());
    if (cp && (cp.phase === 'luteal' || cp.phase === 'menstruation')) { nav.cycleHold = cp.label; nav.suggestKcal = 0; nav.stalled = false; }
  }
  // 直近で調整済み&その後に新しい体重記録が無ければ再提案しない(連打で下限まで下げ続けるのを防ぐ)
  if (nav.suggestKcal && typeof S !== 'undefined' && S.lastCalAdjust && weights && weights.length) {
    if (weights[weights.length - 1].date <= S.lastCalAdjust) { nav.adjustHold = true; nav.suggestKcal = 0; }
  }
  return nav;
}

// ===== 食事タブ描画 =====
function renderMeals() {
  const root = $('#view-meals');
  if (!S.profile) {
    root.innerHTML = `<div class="card"><div class="empty"><span class="big-emoji">🍚</span>プロフィールを設定すると<br>目標に合わせた食事メニューを組めます。</div>
      <button class="btn" id="meals-setup">プロフィール設定</button></div>`;
    $('#meals-setup', root).addEventListener('click', () => openProfileWizard(true));
    return;
  }
  if (!FOODS.length) {
    root.innerHTML = `<div class="card"><div class="empty">食品データの読み込みに失敗しました。再読み込みしてください。</div></div>`;
    return;
  }

  const plan = generateMealPlan(S.profile, S.mealSeed || 0);
  const t = plan.targets;
  const goalName = SCIENCE.goals[S.profile.goal].name;
  const g = n => Math.round(n);

  const isCustom = t.mode === 'custom';
  let html = `
    <div class="card"><h2>🎯 今日の栄養目標<span class="sub">${isCustom ? '<span class="tag good" style="font-size:10px">手動設定</span>' : esc(goalName) + '向け'}</span></h2>
      <div class="hero-num">${t.kcal}<small> kcal/日</small></div>
      <div class="focus-chips" style="margin-top:8px">
        <span class="chip grow">タンパク質 ${t.p}g</span>
        <span class="chip">脂質 ${t.f}g</span>
        <span class="chip">炭水化物 ${t.c}g</span>
      </div>
      <p class="card-note">${
        isCustom ? `自分で設定した目標です（P/F/Cからカロリーを算出）。献立はこの目標に合わせて生成されます。`
        : t.mode === 'teen' ? `成長期はカロリーを削る減量をしません。維持カロリー(約${t.tdee}kcal)+タンパク質+運動で体を作るのが一番安全で確実です。`
        : t.mode === 'recomp' ? `体重が軽めなのでカロリーは維持(約${t.tdee}kcal)のまま。筋トレ+タンパク質で引き締めるリコンプ設計です。`
        : t.mode === 'maintain' ? `体重は足りているのでカロリーは維持(約${t.tdee}kcal)。このまま重量を伸ばすフェーズです。`
        : t.kcal !== t.tdee + t.adjust ? `健康のため下限${t.kcal}kcal/日に調整しています(維持カロリー約${t.tdee}kcal)。`
        : `維持カロリー約${t.tdee}kcalに${t.adjust >= 0 ? '+' + t.adjust : t.adjust}kcal(${esc(goalName)})。`}${isCustom ? '' : '体重や目標を変えると自動で更新されます。'}</p>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button class="btn ghost small" id="meals-custom" style="flex:1">🎯 目標を自分で設定</button>
        ${isCustom ? `<button class="btn ghost small" id="meals-auto" style="flex:1">自動に戻す</button>` : ''}
      </div>
    </div>
    <button class="btn ghost" id="meals-shuffle" style="margin-bottom:14px">🔀 別のパターンにする</button>`;

  // 🍽️ 食べたものを記録(実測 vs 目標)
  const flDate = todayStr();
  const flTot = foodLogTotals(flDate);
  const flList = (S.foodLog && S.foodLog[flDate]) || [];
  const flBar = (label, val, tgt) => {
    const pct = tgt > 0 ? Math.min(100, (val / tgt) * 100) : 0;
    return `<div class="vol-row"><span class="nm">${label}</span><span class="bar"><i style="width:${pct}%"></i></span><span class="val">${Math.round(val)}<small style="color:var(--ink-dim)"> /${Math.round(tgt)}</small></span></div>`;
  };
  const flItems = flList.length ? flList.map((it, i) => {
    const f = FOOD_BY_ID[it.id]; if (!f) return '';
    return `<div class="meal-item"><div class="mi-info"><div class="nm">${esc(f.name)} <b class="amt">×${it.qty}</b></div><div class="meta">${esc(f.per)}</div></div>
      <div class="mi-macros">${g(f.kcal * it.qty)}kcal<small>P${Math.round(f.p * it.qty * 10) / 10}g</small></div>
      <button class="del fl-del" data-i="${i}" style="margin-left:6px">🗑</button></div>`;
  }).join('') : '<p class="card-note">下から食べたものを追加すると、目標との差(残りカロリー・P)が一目で分かります。</p>';
  const flOpts = Object.keys(FOOD_CAT_LABEL).map(cat => {
    const items = FOODS.filter(f => f.cat === cat);
    if (!items.length) return '';
    return `<optgroup label="${FOOD_CAT_LABEL[cat]}">${items.map(f => `<option value="${esc(f.id)}">${esc(f.name)}（${esc(f.per)}・${g(f.kcal)}kcal）</option>`).join('')}</optgroup>`;
  }).join('');
  html += `<div class="card"><h2>🍽️ 食べたものを記録<span class="sub">今日の実測 vs 目標</span></h2>
    ${flBar('kcal', flTot.kcal, t.kcal)}
    ${flBar('P', flTot.p, t.p)}
    ${flBar('F', flTot.f, t.f)}
    ${flBar('C', flTot.c, t.c)}
    <div id="fl-items" style="margin-top:8px">${flItems}</div>
    <div style="display:flex;gap:6px;margin-top:10px">
      <select id="fl-food" style="flex:1;min-width:0">${flOpts}</select>
      <input type="number" id="fl-qty" value="1" min="0.5" step="0.5" style="width:52px;text-align:right">
      <button class="btn small" id="fl-add">追加</button>
    </div>
    <p class="card-note">数量は「1食あたりの単位(表示中)」の個数。例: ご飯100gを1.5なら150g。</p>
  </div>`;

  // 💧 水分トラッキング
  const wTgt = waterTarget(S.profile);
  const wCur = (S.water && S.water[flDate]) || 0;
  const cups = Array.from({ length: wTgt }, (_, i) => `<span class="wcup ${i < wCur ? 'on' : ''}">${i < wCur ? '💧' : '·'}</span>`).join('');
  html += `<div class="card"><h2>💧 水分<span class="sub">${wCur}/${wTgt}杯(1杯250ml)</span></h2>
    <div class="wcups">${cups}</div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn small ghost" id="water-minus" style="flex:1">−1杯</button>
      <button class="btn small" id="water-plus" style="flex:2">＋1杯 飲んだ💧</button>
    </div>
    <p class="card-note">目安 約${Math.round(wTgt * 0.25 * 10) / 10}L/日(体重×33ml)。減量中は満腹感、増量中は消化を助けます。トレ中もこまめに。</p></div>`;

  // 体重ナビ
  const nav = weightNav(S.profile, S.weights);
  html += `<div class="card"><h2>⚖️ 体重ナビ<span class="sub">現在${S.profile.w}kg / BMI ${nav.bmi}</span></h2>`;
  if (nav.mode === 'cut') {
    const eta = fmtDate(dateAdd(todayStr(), nav.weeks * 7));
    html += `<div class="hero-num">−${nav.diff}<small> kg が目安</small></div>
      <p class="card-note">週${nav.pace}kgペース(筋肉を守れる上限)で約${nav.weeks}週間、<b style="color:var(--accent)">${eta}頃</b>に到達見込み。上の献立(−400kcal)がほぼこのペースに相当します。</p>`;
  } else if (nav.mode === 'bulk') {
    const eta = fmtDate(dateAdd(todayStr(), nav.weeks * 7));
    html += `<div class="hero-num">+${nav.diff}<small> kg 増やせる</small></div>
      <p class="card-note">週${nav.pace}kgペース(脂肪を乗せすぎない上限)で約${nav.weeks}週間、<b style="color:var(--accent)">${eta}頃</b>が目安。上の献立(+250kcal)がほぼこのペースに相当します。</p>`;
  } else {
    html += `<p style="font-size:13.5px">${esc(nav.msg)}</p>`;
  }
  if (nav.advice) html += `<p class="card-note">📈 ${esc(nav.advice)}</p>`;
  if (nav.cycleHold) html += `<p class="card-note">🌙 今は<b>${esc(nav.cycleHold)}</b>で体重が水分で増減しやすい時期。停滞かどうかの判定・カロリー調整は一旦保留しています(周期が一巡すると正しく判定できます)。</p>`;
  if (nav.suggestKcal) {
    const dir = nav.suggestKcal < 0 ? '下げる' : '上げる';
    const abs = Math.abs(nav.suggestKcal);
    html += `<div style="margin-top:8px;padding:10px;border:1px solid var(--accent);border-radius:10px">
      <p style="font-size:12.5px;margin-bottom:8px">${nav.stalled ? '⚠️ <b>停滞ぎみ</b>です(代謝が慣れたサイン)。' : ''}目標カロリーを<b>${abs}kcal ${dir}</b>と、実績ペースが目標に合います。</p>
      <button class="btn small" id="meals-autoadjust">目標カロリーを ${abs}kcal ${dir}(自動調整)</button>
    </div>`;
  }
  html += `</div>`;

  // 🧬 体組成の推定(体重変化の脂肪/筋肉の内訳)
  const bc = bodyCompEstimate(S.profile, S.weights);
  if (bc) {
    const sign = v => (v >= 0 ? '+' : '') + v;
    html += `<div class="card"><h2>🧬 体組成の推定<span class="sub">この${bc.days}日</span></h2>
      <p style="font-size:13.5px">体重 <b>${sign(bc.change)}kg</b> の内訳(推定)</p>
      <div class="bc-breakdown">
        <span class="chip" style="border-color:var(--warn);color:var(--warn)">脂肪 ${sign(bc.fat)}kg</span>
        <span class="chip grow">筋肉 ${sign(bc.muscle)}kg</span>
      </div>
      <p class="card-note">${bc.cut ? '筋トレ+タンパク質を続けていれば、落ちた体重の大半は脂肪で筋肉はほぼ守れます。' : 'トレ歴が浅いほど増えた体重に筋肉が占める割合が高くなります。'}トレ歴(${SCIENCE.levels ? '' : ''}レベル)から按分した目安で、実測ではありません。体重を継続記録するほど精度が上がります。</p></div>`;
  }

  plan.meals.forEach(m => {
    html += `<div class="card"><h2>${m.icon} ${esc(m.name)}<span class="sub">${g(m.totals.kcal)}kcal / P${g(m.totals.p)}g</span></h2>`;
    if (!m.items.length) {
      html += `<p class="card-note">この食事のデータが見つかりませんでした。</p>`;
    } else {
      m.items.forEach(it => {
        html += `<div class="meal-item">
          <div class="mi-info"><div class="nm">${esc(it.food.name)} <b class="amt">${esc(qtyLabel(it.food, it.qty))}</b></div>
          ${it.food.note ? `<div class="meta">${esc(it.food.note)}</div>` : ''}</div>
          <div class="mi-macros">${g(it.food.kcal * it.qty)}kcal<small>P${(Math.round(it.food.p * it.qty * 10) / 10)}g</small></div>
        </div>`;
      });
    }
    html += `</div>`;
  });

  // 合計 vs 目標
  const dp = g(plan.totals.p) - t.p;
  const dk = g(plan.totals.kcal) - t.kcal;
  html += `<div class="card"><h2>📊 この献立の合計</h2>
    <div class="focus-chips">
      <span class="chip ${Math.abs(dk) <= t.kcal * 0.08 ? 'grow' : ''}">${g(plan.totals.kcal)}kcal (目標${t.kcal})</span>
      <span class="chip ${dp >= -5 ? 'grow' : ''}">P ${g(plan.totals.p)}g (目標${t.p})</span>
      <span class="chip">F ${g(plan.totals.f)}g</span>
      <span class="chip">C ${g(plan.totals.c)}g</span>
    </div>
    <p class="card-note">±8%以内なら合格。量の微調整はご飯・麺(炭水化物)で行うのが基本。タンパク質は削らない。</p>
    ${dp < -5 ? `<p class="card-note">タンパク質があと約${-dp}g不足。<b style="color:var(--accent)">ホエイプロテイン${Math.ceil(-dp / 22)}杯</b>を追加すれば届きます(体格が大きいほど食事だけで満たすのは大変なので普通のことです)。</p>` : ''}
  </div>`;

  // コンビニ早見
  const conbini = FOODS.filter(f => f.conbini && f.role === 'protein').sort((a, b) => b.p - a.p);
  html += `<div class="card"><h2>🏪 コンビニで買うならこれ</h2>`;
  conbini.slice(0, 6).forEach(f => {
    html += `<div class="meal-item"><div class="mi-info"><div class="nm">${esc(f.name)} <b class="amt">${esc(f.per)}</b></div>
      ${f.note ? `<div class="meta">${esc(f.note)}</div>` : ''}</div>
      <div class="mi-macros">${g(f.kcal)}kcal<small>P${f.p}g</small></div></div>`;
  });
  html += `</div>`;

  // 高タンパク早見表
  const ranked = FOODS.filter(f => f.p >= 5).sort((a, b) => (b.p / Math.max(b.kcal, 1)) - (a.p / Math.max(a.kcal, 1)));
  html += `<details class="acc"><summary>🥇 タンパク質効率ランキング (P ÷ カロリー)</summary><div class="acc-body">
    <table class="rm-table"><tr><th>食品</th><th>量</th><th>P</th><th>kcal</th></tr>
    ${ranked.slice(0, 12).map(f => `<tr><td style="text-align:left">${esc(f.name)}</td><td>${esc(f.per)}</td><td>${f.p}g</td><td>${g(f.kcal)}</td></tr>`).join('')}
    </table></div></details>
  <p class="card-note" style="margin-bottom:14px">栄養値は日本食品標準成分表ベースの目安です。細かい誤差より「毎日続けること」が結果を作ります。</p>`;

  root.innerHTML = html;

  $('#meals-shuffle', root).addEventListener('click', () => {
    S.mealSeed = ((S.mealSeed || 0) + 1) % 1000000;
    saveState();
    toast('献立を変えました');
    renderMeals();
  });
  const customBtn = $('#meals-custom', root);
  if (customBtn) customBtn.addEventListener('click', () => openMealTargetEditor(t));
  const autoBtn = $('#meals-auto', root);
  if (autoBtn) autoBtn.addEventListener('click', () => {
    S.mealTargets = null; saveState(); toast('自動計算に戻しました'); renderMeals();
  });
  const adjBtn = $('#meals-autoadjust', root);
  if (adjBtn) adjBtn.addEventListener('click', () => {
    const newKcal = Math.max(1000, t.kcal + nav.suggestKcal); // 過度な低カロリーは避ける
    const p = t.p; // タンパク質は維持
    const fatRatio = S.profile.goal === 'diet' ? 0.22 : 0.25;
    const f = Math.round((newKcal * fatRatio) / 9);
    const c = Math.max(0, Math.round((newKcal - p * 4 - f * 9) / 4));
    S.mealTargets = { custom: true, p, f, c };
    // 直近の体重記録日を記録=次の新しい体重記録が来るまで再提案しない
    if (S.weights && S.weights.length) S.lastCalAdjust = S.weights[S.weights.length - 1].date;
    saveState();
    toast(`目標を約${Math.abs(nav.suggestKcal)}kcal${nav.suggestKcal < 0 ? '下げ' : '上げ'}ました`);
    renderMeals();
  });
  // 食事ログ 追加/削除
  const flAdd = $('#fl-add', root);
  if (flAdd) flAdd.addEventListener('click', () => {
    const id = $('#fl-food', root).value;
    const qty = Math.max(0.5, Math.round((Number($('#fl-qty', root).value) || 1) * 2) / 2);
    if (!id || !FOOD_BY_ID[id]) return;
    const dt = todayStr();
    if (!S.foodLog[dt]) S.foodLog[dt] = [];
    if (S.foodLog[dt].length >= 60) { toast('記録は1日60件までです'); return; }
    S.foodLog[dt].push({ id, qty });
    saveState(); renderMeals();
  });
  $all('.fl-del', root).forEach(b => b.addEventListener('click', () => {
    const dt = todayStr(), i = Number(b.dataset.i);
    if (S.foodLog[dt]) { S.foodLog[dt].splice(i, 1); if (!S.foodLog[dt].length) delete S.foodLog[dt]; saveState(); renderMeals(); }
  }));
  const wPlus = $('#water-plus', root), wMinus = $('#water-minus', root);
  const setWater = (delta) => {
    const dt = todayStr();
    const cur = (S.water[dt] || 0) + delta;
    if (cur <= 0) delete S.water[dt]; else S.water[dt] = Math.min(30, cur);
    saveState(); renderMeals();
  };
  if (wPlus) wPlus.addEventListener('click', () => setWater(1));
  if (wMinus) wMinus.addEventListener('click', () => setWater(-1));
}

// 食事: PFC目標を自分で設定(カロリーはP/F/Cから導出)
function openMealTargetEditor(cur) {
  const bg = openModal(`
    <h2>栄養目標を自分で設定</h2>
    <p class="modal-sub">P/F/C（グラム）を入力。カロリーは自動計算されます。</p>
    <div class="grid2">
      <div class="field"><label>タンパク質 P（g）</label><input type="number" id="mt-p" value="${cur.p}" min="20" max="400" inputmode="numeric"></div>
      <div class="field"><label>脂質 F（g）</label><input type="number" id="mt-f" value="${cur.f}" min="10" max="300" inputmode="numeric"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>炭水化物 C（g）</label><input type="number" id="mt-c" value="${cur.c}" min="0" max="1000" inputmode="numeric"></div>
      <div class="field"><label>カロリー（自動）</label><input type="text" id="mt-kcal" value="${cur.kcal} kcal" readonly style="opacity:.7"></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="btn ghost" onclick="closeModal()">キャンセル</button>
      <button class="btn" id="mt-save">保存</button>
    </div>`);
  const upd = () => {
    const p = Number($('#mt-p', bg).value) || 0, f = Number($('#mt-f', bg).value) || 0, c = Number($('#mt-c', bg).value) || 0;
    $('#mt-kcal', bg).value = (p * 4 + f * 9 + c * 4) + ' kcal';
  };
  ['mt-p', 'mt-f', 'mt-c'].forEach(id => $('#' + id, bg).addEventListener('input', upd));
  $('#mt-save', bg).addEventListener('click', () => {
    const p = Math.max(20, Math.min(400, Math.round(Number($('#mt-p', bg).value) || cur.p)));
    const f = Math.max(10, Math.min(300, Math.round(Number($('#mt-f', bg).value) || cur.f)));
    const c = Math.max(0, Math.min(1000, Math.round(Number($('#mt-c', bg).value) || cur.c)));
    S.mealTargets = { custom: true, p, f, c };
    saveState(); closeModal(); toast('目標を設定しました'); renderMeals();
  });
}
