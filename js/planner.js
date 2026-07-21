// 筋トレLAB — 分割法テンプレートとメニュー自動生成

// 分割テンプレート: parts は優先順。'arms:bi' / 'arms:tri' / 'legs:quad' / 'legs:ham' でサブ部位指定
const SPLITS = {
  1: [
    { name: '全身', parts: ['legs', 'chest', 'back', 'shoulder', 'abs'] },
  ],
  // 週1〜3日は全身法: 各部位を週2〜3回刺激できて、分割法より週セット数を稼げる
  2: [
    { name: '全身A', parts: ['chest', 'back', 'legs:quad', 'shoulder', 'abs'] },
    { name: '全身B', parts: ['legs:ham', 'back', 'chest', 'glutes', 'arms'] },
  ],
  3: [
    { name: '全身A(胸メイン)', parts: ['chest', 'back', 'legs:quad', 'shoulder', 'abs'] },
    { name: '全身B(脚メイン)', parts: ['legs:ham', 'chest', 'back', 'glutes', 'calves'] },
    { name: '全身C(背中メイン)', parts: ['back', 'legs:quad', 'chest', 'arms', 'abs'] },
  ],
  4: [
    { name: '上半身A(胸・肩)', parts: ['chest', 'shoulder', 'arms:tri'] },
    { name: '下半身A(四頭・尻)', parts: ['legs:quad', 'glutes', 'calves', 'abs'] },
    { name: '上半身B(背中・腕)', parts: ['back', 'arms:bi', 'shoulder', 'abs'] },
    { name: '下半身B(ハム・尻)', parts: ['legs:ham', 'glutes', 'legs:quad', 'calves'] },
  ],
  5: [
    { name: '押す日(胸・肩・三頭)', parts: ['chest', 'shoulder', 'arms:tri'] },
    { name: '引く日(背中・二頭)', parts: ['back', 'arms:bi', 'abs'] },
    { name: '脚の日', parts: ['legs:quad', 'legs:ham', 'glutes', 'calves'] },
    { name: '上半身', parts: ['chest', 'back', 'shoulder', 'abs'] },
    { name: '下半身', parts: ['legs:quad', 'legs:ham', 'glutes', 'calves'] },
  ],
  6: [
    { name: '押す日A', parts: ['chest', 'shoulder', 'arms:tri'] },
    { name: '引く日A', parts: ['back', 'arms:bi', 'abs'] },
    { name: '脚の日A', parts: ['legs:quad', 'legs:ham', 'glutes', 'calves'] },
    { name: '押す日B', parts: ['shoulder', 'chest', 'arms:tri', 'abs'] },
    { name: '引く日B', parts: ['back', 'arms:bi', 'arms:fore'] },
    { name: '脚の日B', parts: ['legs:ham', 'legs:quad', 'glutes', 'calves'] },
  ],
  7: [
    { name: '押す日A', parts: ['chest', 'shoulder', 'arms:tri'] },
    { name: '引く日A', parts: ['back', 'arms:bi'] },
    { name: '脚の日A', parts: ['legs:quad', 'glutes', 'calves'] },
    { name: '押す日B', parts: ['shoulder', 'chest', 'arms:tri'] },
    { name: '引く日B', parts: ['back', 'arms:bi', 'arms:fore'] },
    { name: '脚の日B', parts: ['legs:ham', 'glutes', 'calves'] },
    { name: '腹・弱点の日', parts: ['abs', 'glutes', 'calves'] },
  ],
};

// 週日数 → 曜日割り当て (0=日,1=月...)
const WEEKDAY_ASSIGN = {
  1: [6], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5],
  5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6],
};
const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

// シード付き乱数 (再生成でシャッフルしても保存内容が安定するように)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 'arms:bi' → { part:'arms', filter:'二頭' }
function parsePartSpec(spec) {
  const [part, sub] = spec.split(':');
  const filterMap = { bi: '二頭', tri: '三頭', fore: '前腕', quad: '四頭', ham: 'ハムストリング' };
  return { part, filter: sub ? filterMap[sub] : null };
}

// 器具の有無判定: ジムは全部あり。自宅は profile.gear (bar=懸垂バー, bench=ベンチ/椅子) を見る
function hasGear(env, gear, req) {
  if (!req) return true;
  if (env === 'gym') return true;
  const g = gear || {};
  if (req === 'bar') return !!g.bar;
  if (req === 'bench') return g.bench !== false; // 椅子で代用できるのでデフォルトあり
  return false; // anchor(足首固定)等は自宅では不可
}

// 種目プール取得: 環境・レベル・器具でフィルタ
function exercisePool(db, spec, env, level, gear) {
  const { part, filter } = parsePartSpec(spec);
  const allow = SCIENCE.envs[env].allow;
  const partPool = (db.byPart[part] || []).filter(ex =>
    allow.includes(ex.equipment) && hasGear(env, gear, ex.requires));
  let pool = partPool;
  if (filter) {
    const filtered = pool.filter(ex => (ex.sub[0] || '').includes(filter));
    if (filtered.length) pool = filtered;
  }
  let leveled = pool.filter(ex => ex.level <= level);
  if (leveled.length < 2) leveled = pool.filter(ex => ex.level <= level + 1);
  if (!leveled.length) {
    // サブ部位の候補が全てレベル超過なら、無理な上級種目より部位全体からレベル内で選ぶ
    leveled = partPool.filter(ex => ex.level <= level);
    if (!leveled.length) leveled = partPool.filter(ex => ex.level <= level + 1);
    if (!leveled.length) leveled = pool;
  }
  return leveled;
}

function repsFor(ex, goal) {
  if (goal === 'str') return ex.compound ? ex.repStr : ex.repHyp;
  if (goal === 'diet') return ex.repEnd;
  return ex.repHyp; // hyp, fit
}

function setsFor(goal, isPriority) {
  const base = goal === 'str' ? 4 : goal === 'fit' ? 2 : 3;
  return base + (isPriority ? 1 : 0);
}

function restFor(ex, goal) {
  const r = SCIENCE.restSeconds[goal] || SCIENCE.restSeconds.hyp;
  return ex.compound ? r.comp : r.iso;
}

// 1種目の所要時間(分)
function exMinutes(item) {
  return (item.sets * (SCIENCE.setSeconds + item.rest)) / 60;
}

function dayMinutes(items) {
  return Math.round(items.reduce((s, it) => s + exMinutes(it), 0) + SCIENCE.warmupMin);
}

// メニュー生成本体
// profile: {days, minutes, env, level, goal}, focus: {part: 'grow'|'tone'}, seed: number
function generatePlan(db, profile, focus, seed) {
  const days = Math.min(Math.max(profile.days, 1), 7);
  const template = SPLITS[days];
  const weekdays = WEEKDAY_ASSIGN[days];
  const rng = mulberry32(seed);
  const budget = profile.minutes;

  const planDays = template.map((dayT, di) => {
    // 優先部位を先頭に並べ替え
    const specs = [...dayT.parts].sort((a, b) => {
      const pa = focus[parsePartSpec(a).part] ? -1 : 0;
      const pb = focus[parsePartSpec(b).part] ? -1 : 0;
      return pa - pb;
    });

    const items = [];
    const usedIds = new Set();

    // 各部位の種目候補を用意 (コンパウンド優先 + シャッフル)
    const pools = specs.map(spec => {
      const pool = exercisePool(db, spec, profile.env, profile.level, profile.gear)
        .map(ex => ({ ex, r: rng() }))
        .sort((a, b) => (b.ex.compound - a.ex.compound) || (a.r - b.r))
        .map(x => x.ex);
      return { spec, pool, taken: 0 };
    });

    // ラウンドロビンで時間予算まで詰める (優先部位は最大3種目、他は2種目)
    // コンパウンドが予算に収まらない場合は同部位の短いアイソ種目にフォールバックする
    let guard = 0;
    while (guard++ < 100) {
      let added = false;
      for (const p of pools) {
        const { part } = parsePartSpec(p.spec);
        const isPriority = !!focus[part];
        const maxTake = isPriority ? 3 : 2;
        if (p.taken >= maxTake) continue;
        const goal = focus[part] === 'tone' ? 'hyp' : profile.goal; // 引き締めも刺激は筋肥大レンジ(絞りは食事で)
        const cur = items.reduce((s, it) => s + exMinutes(it), 0) + SCIENCE.warmupMin;
        for (const ex of p.pool) {
          if (usedIds.has(ex.id)) continue;
          let rest = restFor(ex, profile.goal);
          if (budget <= 35) rest = Math.min(rest, ex.compound ? 90 : 60); // 短時間設定は休憩を圧縮
          const item = {
            exId: ex.id, part: ex.part,
            sets: setsFor(profile.goal, isPriority),
            reps: repsFor(ex, goal),
            rest,
            priority: isPriority,
          };
          if (cur + exMinutes(item) > budget && items.length >= 3) continue; // この種目は入らない→次の候補
          if (cur + exMinutes(item) > budget * 1.15) continue;
          items.push(item);
          usedIds.add(ex.id);
          p.taken++;
          added = true;
          break;
        }
      }
      if (!added) break;
    }

    // 予算が小さくても最低3種目は保証 (セット数2・休憩60秒に圧縮して追加)
    if (items.length < 3) {
      for (const p of pools) {
        if (items.length >= 3) break;
        const ex = p.pool.find(e => !usedIds.has(e.id));
        if (!ex) continue;
        const { part } = parsePartSpec(p.spec);
        const goal2 = focus[part] === 'tone' ? 'hyp' : profile.goal;
        items.push({ exId: ex.id, part: ex.part, sets: 2, reps: repsFor(ex, goal2), rest: 60, priority: !!focus[part] });
        usedIds.add(ex.id);
        p.taken++;
      }
    }

    return {
      name: dayT.name,
      weekday: weekdays[di],
      items,
      minutes: dayMinutes(items),
    };
  });

  // 優先部位が選ばれている場合: 優先部位が1つも無いトレ日を無くす
  // (狙っている部位に触れない日があると「今日は関係ない日」になってモチベが切れるため)
  const focusParts = Object.keys(focus).filter(k => SCIENCE.partMap[k]);
  if (focusParts.length) {
    planDays.forEach((day, di) => {
      if (day.items.some(it => focus[it.part])) return;
      // 隣接する曜日で同じ部位をやっていない優先部位を選ぶ (回復を確保)
      const adjacent = planDays.filter(d2 => {
        const diff = Math.abs(d2.weekday - day.weekday);
        return diff === 1 || diff === 6;
      });
      const scored = focusParts.map(p => ({ p, adj: adjacent.some(d2 => d2.items.some(it => it.part === p)) }));
      const pickEntry = scored.find(s => !s.adj);
      const light = !pickEntry; // 隣接日と重なる場合は軽い刺激入れに留める(連日高ボリュームを避ける)
      const pick = pickEntry || scored[di % focusParts.length];
      const pool = exercisePool(db, pick.p, profile.env, profile.level, profile.gear);
      const used = new Set(day.items.map(i => i.exId));
      const ex = pool.find(e => !used.has(e.id));
      if (ex) {
        const goal2 = focus[pick.p] === 'tone' ? 'hyp' : profile.goal;
        let rest = restFor(ex, profile.goal);
        if (budget <= 35) rest = Math.min(rest, ex.compound ? 90 : 60);
        const item = {
          exId: ex.id, part: ex.part,
          sets: light ? 2 : setsFor(profile.goal, true),
          reps: repsFor(ex, goal2), rest, priority: true,
        };
        day.items.push(item);
        // 追加で時間予算を大幅に超えるなら圧縮する
        if (dayMinutes(day.items) > budget * 1.15) { item.sets = 2; item.rest = Math.min(item.rest, 60); }
        day.minutes = dayMinutes(day.items);
      }
    });
  }

  // 部位別の週セット数を集計
  const weeklySets = {};
  const tally = () => {
    SCIENCE.parts.forEach(p => { weeklySets[p.key] = 0; });
    planDays.forEach(d => d.items.forEach(it => { weeklySets[it.part] += it.sets; }));
  };
  tally();

  // MRV超過ガード: 週セット数が回復限界を超えた部位はセット数を自動で削る
  SCIENCE.parts.forEach(p => {
    let guard = 0;
    while (weeklySets[p.key] > p.mrv && guard++ < 30) {
      const candidates = planDays.flatMap(d => d.items).filter(it => it.part === p.key && it.sets > 2);
      if (!candidates.length) break;
      candidates.sort((a, b) => b.sets - a.sets);
      candidates[0].sets--;
      tally();
    }
  });
  planDays.forEach(d => { d.minutes = dayMinutes(d.items); });

  return { days: planDays, weeklySets, seed, createdAt: todayStr() }; // ローカル日付 (UTCだと午前9時前の生成で1日ズレる)
}
