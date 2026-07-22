// 筋トレLAB — 効率シミュレーター
// 「1日◯分 × 週◯日」→ 週セット数 → 効果係数 → 筋肉増加・カロリー・タンパク質の見積もり

// 1セットあたりの平均サイクル(秒): 実施40秒 + 平均インターバル
function avgSetCycleSec(goal) {
  const r = SCIENCE.restSeconds[goal] || SCIENCE.restSeconds.hyp;
  const avgRest = (r.comp + r.iso) / 2;
  return SCIENCE.setSeconds + avgRest;
}

// シミュレーション本体
// minutes: 1日の時間, days: 週日数, profile: プロフィール, plan: 生成済みプランがあれば実測値を使う
function simulate(minutes, days, profile, plan) {
  const goal = profile.goal || 'hyp';
  const cycle = avgSetCycleSec(goal);
  // 「やらない部位」= 効率計算からも除外し、時間は残りの部位へ集中(実行時グローバル状態)
  const excluded = (typeof S !== 'undefined' && S && S.exclude) ? S.exclude : {};

  // 週あたり総セット数
  const setsPerDay = Math.max(0, Math.floor(((minutes - SCIENCE.warmupMin) * 60) / cycle));
  const totalSets = setsPerDay * days;

  // 部位別に配分: プランがあればその比率、なければ分割テンプレートから均等配分
  const perPart = {};
  SCIENCE.parts.forEach(p => { perPart[p.key] = 0; });

  if (plan && plan.weeklySets && Object.values(plan.weeklySets).some(v => v > 0)) {
    const planTotal = Object.values(plan.weeklySets).reduce((a, b) => a + b, 0);
    SCIENCE.parts.forEach(p => {
      perPart[p.key] = Math.round((plan.weeklySets[p.key] / planTotal) * totalSets * 10) / 10;
    });
  } else {
    // ゴールに応じた分割で配分 (姿勢改善は背中・肩・腹・尻に寄せる)
    const table = profile.goal === 'posture' ? POSTURE_SPLITS : SPLITS;
    const template = table[Math.min(Math.max(days, 1), 7)];
    template.forEach(day => {
      const active = day.parts.filter(spec => !excluded[parsePartSpec(spec).part]);
      if (!active.length) return; // 全部除外の日は休養日
      const share = setsPerDay / active.length; // 除外分の時間は残りの部位へ再配分=集中
      active.forEach(spec => {
        const { part } = parsePartSpec(spec);
        perPart[part] += share;
      });
    });
    Object.keys(perPart).forEach(k => { perPart[k] = Math.round(perPart[k] * 10) / 10; });
  }

  // 部位別効果と総合効率
  const partResults = SCIENCE.parts.map(p => {
    const sets = perPart[p.key];
    const capped = Math.min(sets, p.mrv); // MRV超過分は効果に寄与しない
    return {
      part: p.key, name: p.name, sets,
      effect: effectFromSets(capped),
      verdict: volumeVerdict(p.key, sets, profile.goal),
    };
  });
  const trained = partResults.filter(r => r.sets > 0);
  // 分母の下限=対象部位数(最大5)。除外時は下限を下げ、少数部位への集中を正当に評価する
  const numTarget = SCIENCE.parts.filter(p => !excluded[p.key]).length;
  const floor = Math.max(1, Math.min(5, numTarget));
  const overallEffect = trained.length
    ? trained.reduce((s, r) => s + r.effect, 0) / Math.max(trained.length, floor)
    : 0;

  // 筋肉増加見積もり (kg/月)。減量中はカロリー不足で合成が制限される(初心者のリコンプ分のみ)
  const dietMode = profile.goal === 'diet';
  const rate = SCIENCE.gainRate[profile.level || 1] * (profile.sex === 'f' ? SCIENCE.femaleFactor : 1);
  const monthlyGain = rate * overallEffect * (dietMode ? 0.35 : 1);
  // 減量中の脂肪減少ペース (食事−400kcal/日 + トレ消費)
  const monthlyFatLoss = dietMode ? Math.round(((400 * 30.4) + (calcBurn(3.5, profile.w || 65, minutes) * days * 4.35)) / 7700 * 10) / 10 : 0;

  // 3/6/12ヶ月の累積 (月ごとに4%ずつ減衰)
  function cumGain(months) {
    let total = 0;
    for (let m = 0; m < months; m++) total += monthlyGain * Math.pow(0.96, m);
    return total;
  }

  // カロリー: 筋トレの実効強度は休憩込みで平均METs3.5程度
  const weeklyBurn = calcBurn(3.5, profile.w || 65, minutes) * days;
  const tdee = calcTDEE({ ...profile, days });
  const protein = Math.round((profile.w || 65) * (SCIENCE.proteinPerKg[goal] || 1.8));

  // ジャンクボリューム警告
  const junk = partResults.filter(r => r.verdict.cls === 'junk');
  const low = partResults.filter(r => r.verdict.cls === 'low');

  // 限界効用: +15分/日 と +1日/週 の効果
  const plus15 = minutes < 120 ? simpleEffect(minutes + 15, days, goal) - simpleEffect(minutes, days, goal) : 0;
  const plusDay = days < 7 ? simpleEffect(minutes, days + 1, goal) - simpleEffect(minutes, days, goal) : 0;

  return {
    minutes, days, totalSets, setsPerDay, perPart, partResults,
    overallEffect, monthlyGain, cumGain, weeklyBurn, tdee, protein,
    junk, low, plus15, plusDay, dietMode, monthlyFatLoss,
  };
}

// 最適な時間×日数を全探索: 「最高効率」と「最高の95%を最小の週合計時間で達成(コスパ最強)」
function optimalPlan(profile) {
  const candidates = [];
  for (let days = 1; days <= 7; days++) {
    for (let m = 15; m <= 120; m += 15) {
      const eff = simulate(m, days, profile, null).overallEffect;
      candidates.push({ days, minutes: m, eff, weekly: days * m });
    }
  }
  let best = candidates[0];
  candidates.forEach(c => { if (c.eff > best.eff + 1e-9) best = c; });
  const eco = candidates
    .filter(c => c.eff >= best.eff * 0.95)
    .sort((a, b) => (a.weekly - b.weekly) || (b.eff - a.eff))[0] || best;
  return { best, eco };
}

// 総合効果だけをさっと出す補助 (限界効用の計算用)
function simpleEffect(minutes, days, goal) {
  const cycle = avgSetCycleSec(goal);
  const totalSets = Math.max(0, Math.floor(((minutes - SCIENCE.warmupMin) * 60) / cycle)) * days;
  const perMuscle = totalSets / 5; // 主要5部位に均等と仮定
  return effectFromSets(Math.min(perMuscle, 22));
}

// ===== 効果曲線チャート (canvas) =====
// 横軸: 週セット数/部位, 縦軸: 効果% — 現在位置をドットで表示
function drawEffectCurve(canvas, currentSetsPerMuscle) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--ink-dim').trim() || '#9aa3ad';
  const inkFaint = css.getPropertyValue('--line').trim() || '#262b33';
  const accent = css.getPropertyValue('--accent').trim() || '#c8f14e';
  const warn = css.getPropertyValue('--warn').trim() || '#f1b04e';

  const pad = { l: 34, r: 14, t: 14, b: 26 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const maxSets = 28;
  const x = s => pad.l + (s / maxSets) * pw;
  const y = e => pad.t + (1 - e) * ph;

  // 最適レンジ帯 (10-20セット)
  ctx.fillStyle = 'rgba(200, 241, 78, 0.07)';
  ctx.fillRect(x(10), pad.t, x(20) - x(10), ph);

  // グリッド (控えめ)
  ctx.strokeStyle = inkFaint;
  ctx.lineWidth = 1;
  [0.25, 0.5, 0.75, 1].forEach(e => {
    ctx.beginPath(); ctx.moveTo(pad.l, y(e)); ctx.lineTo(W - pad.r, y(e)); ctx.stroke();
  });

  // 軸ラベル (テキストはインク色で)
  ctx.fillStyle = ink;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  [25, 50, 75, 100].forEach(p => ctx.fillText(p + '%', pad.l - 5, y(p / 100) + 3));
  ctx.textAlign = 'center';
  [0, 7, 14, 21, 28].forEach(s => ctx.fillText(String(s), x(s), H - 8));

  // 曲線 (MRV超はやり過ぎゾーンとして色を変える)
  ctx.lineWidth = 2;
  ctx.strokeStyle = accent;
  ctx.beginPath();
  for (let s = 0; s <= 22; s += 0.25) {
    const px = x(s), py = y(effectFromSets(s));
    s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.strokeStyle = warn;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  for (let s = 22; s <= maxSets; s += 0.25) {
    const px = x(s), py = y(effectFromSets(22));
    s === 22 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // 現在位置ドット + 直接ラベル
  if (currentSetsPerMuscle > 0) {
    const s = Math.min(currentSetsPerMuscle, maxSets);
    const eff = effectFromSets(Math.min(s, 22));
    const px = x(s), py = y(eff);
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = css.getPropertyValue('--surface').trim() || '#171a1f';
    ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = css.getPropertyValue('--ink').trim() || '#e8eaed';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = px > W - 90 ? 'right' : 'left';
    ctx.fillText(`いまここ ${Math.round(eff * 100)}%`, px + (px > W - 90 ? -10 : 10), py - 8);
  }
}
