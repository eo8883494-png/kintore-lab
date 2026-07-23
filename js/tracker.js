// 筋トレLAB — 記録・チャート・ストリーク

// ===== 日付ユーティリティ =====
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dateAdd(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_NAMES[d.getDay()]})`;
}

// ===== 集計 =====
// 連続日数: 基準日(省略時=今日)または前日から遡って途切れるまで
function calcStreak(logs, base) {
  const baseDate = base || todayStr();
  const dates = new Set(logs.map(l => l.date));
  if (!dates.size) return 0;
  let streak = 0;
  let cur = baseDate;
  if (!dates.has(cur)) cur = dateAdd(cur, -1); // 基準日にまだやってなくても前日までの連続は維持表示
  while (dates.has(cur)) { streak++; cur = dateAdd(cur, -1); }
  return streak;
}

// 連続達成週: 週の目標日数(プランの日数)を満たした週が何週続いているか
// (毎日トレは超回復と矛盾するので「日」でなく「週」で継続を測る)
function calcWeekStreak(logs, targetDays) {
  const target = Math.max(1, targetDays || 1);
  const dates = new Set(logs.map(l => l.date));
  const weekCount = monday => {
    let c = 0;
    for (let i = 0; i < 7; i++) if (dates.has(dateAdd(monday, i))) c++;
    return c;
  };
  const dow = (new Date().getDay() + 6) % 7;
  const thisMonday = dateAdd(todayStr(), -dow);
  let streak = weekCount(thisMonday) >= target ? 1 : 0; // 今週すでに達成していれば含める
  let monday = dateAdd(thisMonday, -7);
  for (let w = 0; w < 520; w++) {
    if (weekCount(monday) >= target) { streak++; monday = dateAdd(monday, -7); }
    else break;
  }
  return streak;
}

// 基準日の週(月曜始まり)のトレ日数
function thisWeekDays(logs, base) {
  const baseDate = base || todayStr();
  const dow = (new Date(baseDate + 'T12:00:00').getDay() + 6) % 7; // 月=0
  const monday = dateAdd(baseDate, -dow);
  const dates = new Set(logs.map(l => l.date));
  let count = 0;
  for (let i = 0; i <= dow; i++) if (dates.has(dateAdd(monday, i))) count++;
  return count;
}

// 種目ごとの推定1RM推移 [{date, e1rm, top}]
function e1rmHistory(logs, exId) {
  const byDate = {};
  logs.filter(l => l.exId === exId).forEach(l => {
    l.sets.forEach(s => {
      if (!s.w || !s.r) return;
      const e = epley1RM(s.w, s.r);
      if (!byDate[l.date] || e > byDate[l.date].e1rm) byDate[l.date] = { date: l.date, e1rm: e, top: s.w };
    });
  });
  return Object.values(byDate).sort((a, b) => a.date < b.date ? -1 : 1);
}

// 直近8週の週間ボリューム(総セット数) [{label, sets}]
function weeklyVolume(logs, exDb, partFilter) {
  const now = todayStr();
  const dow = (new Date().getDay() + 6) % 7;
  const thisMonday = dateAdd(now, -dow);
  const weeks = [];
  for (let w = 7; w >= 0; w--) {
    const start = dateAdd(thisMonday, -7 * w);
    const end = dateAdd(start, 6);
    let sets = 0;
    logs.forEach(l => {
      if (l.date < start || l.date > end) return;
      const ex = exDb[l.exId];
      if (partFilter && (!ex || ex.part !== partFilter)) return;
      sets += l.sets.length;
    });
    const d = new Date(start + 'T12:00:00');
    weeks.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, sets });
  }
  return weeks;
}

// ===== 汎用チャート描画 (単一系列・ダーク前提・控えめグリッド) =====
function chartCtx(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  return {
    ctx, W, H,
    ink: css.getPropertyValue('--ink').trim() || '#e8eaed',
    dim: css.getPropertyValue('--ink-dim').trim() || '#9aa3ad',
    line: css.getPropertyValue('--line').trim() || '#262b33',
    accent: css.getPropertyValue('--accent').trim() || '#c8f14e',
    surface: css.getPropertyValue('--surface').trim() || '#171a1f',
  };
}

// 折れ線 (単一系列): data=[{label, value}]
function drawLineChart(canvas, data, unit) {
  const { ctx, W, H, ink, dim, line, accent, surface } = chartCtx(canvas);
  if (!data.length) return;
  const pad = { l: 40, r: 14, t: 16, b: 24 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const vals = data.map(d => d.value);
  let vMin = Math.min(...vals), vMax = Math.max(...vals);
  if (vMin === vMax) { vMin -= 5; vMax += 5; }
  const range = vMax - vMin;
  vMin -= range * 0.1; vMax += range * 0.1;
  const x = i => pad.l + (data.length === 1 ? pw / 2 : (i / (data.length - 1)) * pw);
  const y = v => pad.t + (1 - (v - vMin) / (vMax - vMin)) * ph;

  ctx.strokeStyle = line; ctx.lineWidth = 1;
  ctx.fillStyle = dim; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
  for (let i = 0; i <= 3; i++) {
    const v = vMin + ((vMax - vMin) * i) / 3;
    ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(W - pad.r, y(v)); ctx.stroke();
    ctx.fillText(Math.round(v) + (unit || ''), pad.l - 5, y(v) + 3);
  }

  ctx.strokeStyle = accent; ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((d, i) => { i === 0 ? ctx.moveTo(x(i), y(d.value)) : ctx.lineTo(x(i), y(d.value)); });
  ctx.stroke();

  // マーカー: 最新点のみ強調 + 直接ラベル
  const li = data.length - 1;
  ctx.fillStyle = accent;
  ctx.beginPath(); ctx.arc(x(li), y(data[li].value), 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = surface; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = ink; ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = li > data.length / 2 ? 'right' : 'left';
  ctx.fillText(`${Math.round(data[li].value * 10) / 10}${unit || ''}`, x(li) + (li > data.length / 2 ? -8 : 8), y(data[li].value) - 8);

  // 横軸ラベル: 端と中央のみ
  ctx.fillStyle = dim; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
  const ticks = data.length <= 4 ? data.map((_, i) => i) : [0, Math.floor(data.length / 2), data.length - 1];
  ticks.forEach(i => ctx.fillText(data[i].label, x(i), H - 8));
}

// 体重トレンド + 予測ライン: 実測点・EWMAトレンド線・目標到達の予測(点線)
function drawWeightChart(canvas, weights, nav) {
  const { ctx, W, H, ink, dim, line, accent, surface } = chartCtx(canvas);
  const DAY = 86400000;
  const pts = (weights || []).map(w => ({ t: new Date(w.date + 'T12:00:00').getTime(), kg: w.kg }))
    .filter(p => isFinite(p.t) && isFinite(p.kg)).sort((a, b) => a.t - b.t);
  if (!pts.length) return;
  const pad = { l: 40, r: 14, t: 16, b: 22 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const last = pts[pts.length - 1];
  const hasTarget = nav && (nav.mode === 'cut' || nav.mode === 'bulk') && isFinite(nav.target) && nav.pace > 0;

  let projEnd = null;
  if (hasTarget) {
    const weeks = Math.min(Math.abs(last.kg - nav.target) / nav.pace, 78); // 上限1.5年
    projEnd = { t: last.t + weeks * 7 * DAY, kg: nav.target };
  }
  const tMin = pts[0].t;
  const tMax = projEnd ? projEnd.t : last.t;
  const tSpan = Math.max(tMax - tMin, DAY);
  const allKg = pts.map(p => p.kg); if (hasTarget) allKg.push(nav.target);
  let vMin = Math.min(...allKg), vMax = Math.max(...allKg);
  if (vMin === vMax) { vMin -= 2; vMax += 2; }
  const vr = vMax - vMin; vMin -= vr * 0.15; vMax += vr * 0.15;
  const x = t => pad.l + ((t - tMin) / tSpan) * pw;
  const y = kg => pad.t + (1 - (kg - vMin) / (vMax - vMin)) * ph;

  ctx.strokeStyle = line; ctx.lineWidth = 1;
  ctx.fillStyle = dim; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
  for (let i = 0; i <= 3; i++) {
    const v = vMin + ((vMax - vMin) * i) / 3;
    ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(W - pad.r, y(v)); ctx.stroke();
    ctx.fillText((Math.round(v * 10) / 10) + 'kg', pad.l - 5, y(v) + 3);
  }

  if (hasTarget) {
    ctx.strokeStyle = accent; ctx.globalAlpha = 0.5; ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, y(nav.target)); ctx.lineTo(W - pad.r, y(nav.target)); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = accent; ctx.font = '9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('目標 ' + nav.target + 'kg', pad.l + 2, y(nav.target) - 3);
  }

  // 実測(細線+点)
  ctx.strokeStyle = dim; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
  ctx.beginPath(); pts.forEach((p, i) => { i ? ctx.lineTo(x(p.t), y(p.kg)) : ctx.moveTo(x(p.t), y(p.kg)); }); ctx.stroke();
  ctx.globalAlpha = 1; ctx.fillStyle = dim;
  pts.forEach(p => { ctx.beginPath(); ctx.arc(x(p.t), y(p.kg), 2, 0, Math.PI * 2); ctx.fill(); });

  // EWMAトレンド線(太・アクセント)
  let tr = pts[0].kg;
  const trend = pts.map(p => (tr = tr + 0.3 * (p.kg - tr)));
  ctx.strokeStyle = accent; ctx.lineWidth = 2.5;
  ctx.beginPath(); pts.forEach((p, i) => { i ? ctx.lineTo(x(p.t), y(trend[i])) : ctx.moveTo(x(p.t), y(trend[i])); }); ctx.stroke();

  // 予測(点線)トレンド最新→目標
  if (projEnd) {
    ctx.strokeStyle = accent; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(x(last.t), y(trend[trend.length - 1])); ctx.lineTo(x(projEnd.t), y(projEnd.kg)); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(x(projEnd.t), y(projEnd.kg), 3, 0, Math.PI * 2); ctx.fill();
  }

  // 最新の実測点 + ラベル
  ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(x(last.t), y(last.kg), 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = surface; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = ink; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'right';
  ctx.fillText((Math.round(last.kg * 10) / 10) + 'kg', x(last.t) - 6, y(last.kg) - 7);

  ctx.fillStyle = dim; ctx.font = '10px sans-serif';
  const md = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };
  ctx.textAlign = 'left'; ctx.fillText(md(tMin), pad.l, H - 6);
  ctx.textAlign = 'right'; ctx.fillText(md(projEnd ? projEnd.t : last.t) + (projEnd ? '頃' : ''), W - pad.r, H - 6);
}

// 棒グラフ (単一系列): data=[{label, value}]
function drawBarChart(canvas, data, unit) {
  const { ctx, W, H, ink, dim, line, accent } = chartCtx(canvas);
  if (!data.length) return;
  const pad = { l: 30, r: 10, t: 16, b: 24 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const vMax = Math.max(...data.map(d => d.value), 1);
  const bw = Math.min(28, (pw / data.length) - 2); // バー間2pxのスペーサー

  ctx.strokeStyle = line; ctx.lineWidth = 1;
  ctx.fillStyle = dim; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
  for (let i = 0; i <= 2; i++) {
    const v = (vMax * i) / 2;
    const yy = pad.t + (1 - v / vMax) * ph;
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(W - pad.r, yy); ctx.stroke();
    ctx.fillText(Math.round(v), pad.l - 5, yy + 3);
  }

  data.forEach((d, i) => {
    const cx = pad.l + (i + 0.5) * (pw / data.length);
    const h = (d.value / vMax) * ph;
    const yy = pad.t + ph - h;
    ctx.fillStyle = accent;
    if (h > 0 && bw > 0) roundTopRect(ctx, cx - bw / 2, yy, bw, h, 4);
    ctx.fillStyle = dim; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(d.label, cx, H - 8);
    if (d.value > 0) {
      ctx.fillStyle = ink; ctx.font = 'bold 10px sans-serif';
      ctx.fillText(String(d.value), cx, yy - 4);
    }
  });
}

// 上端だけ角丸の矩形 (ベースラインは直角のまま)
function roundTopRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, h, w / 2)); // 負の半径(arcTo例外)を防ぐ
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}

// ===== カレンダーヒート (直近12週) =====
let calMonthOffset = 0; // 0=今月, -1=先月 …
function renderCalendarHeat(container, logs) {
  const dates = new Set(logs.map(l => l.date));
  const todayS = todayStr();
  const nowD = new Date(todayS + 'T12:00:00');
  const base = new Date(nowD.getFullYear(), nowD.getMonth() + calMonthOffset, 1);
  const year = base.getFullYear(), month = base.getMonth(); // 0-11
  const pad2 = n => String(n).padStart(2, '0');
  const ymd = d => `${year}-${pad2(month + 1)}-${pad2(d)}`;
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // 月曜始まり
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let trained = 0;
  for (let d = 1; d <= daysInMonth; d++) if (dates.has(ymd(d))) trained++;

  let html = `<div class="cal-head">
    <button class="cal-nav" data-cal="-1" aria-label="前の月">‹</button>
    <span class="cal-title">${year}年${month + 1}月 <small>${trained}日トレ</small></span>
    <button class="cal-nav" data-cal="1" aria-label="次の月" ${calMonthOffset >= 0 ? 'disabled' : ''}>›</button>
  </div>
  <div class="cal-month">`;
  ['月', '火', '水', '木', '金', '土', '日'].forEach(w => { html += `<div class="cal-wd">${w}</div>`; });
  for (let i = 0; i < firstDow; i++) html += '<div class="cal-day empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = ymd(d);
    const cls = (dates.has(ds) ? ' on' : '') + (ds === todayS ? ' today' : '') + (ds > todayS ? ' future' : '');
    html += `<div class="cal-day${cls}">${d}</div>`;
  }
  html += '</div><p class="card-note" style="margin-top:8px">緑の日=トレした日。今日は枠で表示。‹ ›で月を移動できます。</p>';
  container.innerHTML = html;
  container.querySelectorAll('.cal-nav').forEach(b => b.addEventListener('click', () => {
    const delta = Number(b.dataset.cal);
    if (delta > 0 && calMonthOffset >= 0) return; // 未来の月へは行かない
    calMonthOffset += delta;
    renderCalendarHeat(container, logs);
  }));
}
