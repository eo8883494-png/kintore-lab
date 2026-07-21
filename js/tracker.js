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
    if (h > 0) roundTopRect(ctx, cx - bw / 2, yy, bw, h, 4);
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
  const rr = Math.min(r, h, w / 2);
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
function renderCalendarHeat(container, logs) {
  const dates = new Set(logs.map(l => l.date));
  const now = todayStr();
  const dow = (new Date().getDay() + 6) % 7;
  const thisMonday = dateAdd(now, -dow);
  let html = '<div class="cal-grid">';
  for (let w = 11; w >= 0; w--) {
    html += '<div class="cal-col">';
    for (let d = 0; d < 7; d++) {
      const date = dateAdd(thisMonday, -7 * w + d);
      const future = date > now;
      const active = dates.has(date);
      html += `<div class="cal-cell${active ? ' on' : ''}${future ? ' future' : ''}" title="${fmtDate(date)}${active ? ' トレ済' : ''}"></div>`;
    }
    html += '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
}
