// 筋トレLAB — トレーニング科学の定数と計算エンジン
// 根拠: 週あたりセット数と筋肥大の用量反応関係(Schoenfeld 2017等のメタ分析の一般的解釈)、
// Mifflin-St Jeor式、Epley式。数値は「目安」として提示する。

const SCIENCE = {
  // 部位マスタ: recoveryH=超回復目安(時間), optMin/optMax=週セット数の最適レンジ, mrv=これ以上はジャンクボリューム
  parts: [
    { key: 'chest',    name: '胸',       recoveryH: 48, optMin: 10, optMax: 20, mrv: 22 },
    { key: 'back',     name: '背中',     recoveryH: 72, optMin: 10, optMax: 20, mrv: 25 },
    { key: 'shoulder', name: '肩',       recoveryH: 48, optMin: 8,  optMax: 20, mrv: 26 },
    { key: 'arms',     name: '腕',       recoveryH: 48, optMin: 8,  optMax: 18, mrv: 26 },
    { key: 'abs',      name: '腹',       recoveryH: 24, optMin: 6,  optMax: 16, mrv: 25 },
    { key: 'legs',     name: '脚',       recoveryH: 72, optMin: 10, optMax: 20, mrv: 20 },
    { key: 'glutes',   name: '尻',       recoveryH: 48, optMin: 6,  optMax: 16, mrv: 16 },
    { key: 'calves',   name: 'ふくらはぎ', recoveryH: 24, optMin: 6,  optMax: 16, mrv: 20 },
  ],

  // 筋肉増加ペース(kg/月): 最適条件・男性。トレーニング歴で減衰
  gainRate: { 1: 1.0, 2: 0.5, 3: 0.25 },
  femaleFactor: 0.55,

  // タンパク質推奨量 g/体重kg (目標別)
  proteinPerKg: { hyp: 2.0, str: 1.8, diet: 2.2, fit: 1.5, posture: 1.5 },

  // 1セットの実施時間(秒)とインターバル(秒)
  setSeconds: 40,
  restSeconds: {
    hyp:  { comp: 120, iso: 75 },
    str:  { comp: 180, iso: 120 },
    diet: { comp: 75,  iso: 45 },
    fit:  { comp: 90,  iso: 60 },
    posture: { comp: 90, iso: 60 },
  },
  warmupMin: 6,

  goals: {
    hyp:  { name: '筋肥大', desc: 'とにかくでかくする' },
    str:  { name: '筋力アップ', desc: '高重量を挙げる力' },
    diet: { name: '引き締め・減量', desc: '脂肪を落として絞る' },
    fit:  { name: '健康・体力維持', desc: '無理なく続ける' },
    posture: { name: '姿勢改善', desc: '猫背・巻き肩を直す' },
  },
  envs: {
    home_none: { name: '自宅(器具なし)', allow: ['bodyweight'] },
    home_db:   { name: '自宅(ダンベルあり)', allow: ['bodyweight', 'dumbbell'] },
    gym:       { name: 'ジム', allow: ['bodyweight', 'dumbbell', 'barbell', 'machine', 'cable'] },
  },
  levels: { 1: '初心者(〜1年)', 2: '中級者(1〜3年)', 3: '上級者(3年〜)' },
};

SCIENCE.partMap = {};
SCIENCE.parts.forEach(p => { SCIENCE.partMap[p.key] = p; });

// 週セット数 → 効果係数(0〜1)。飽和曲線: 10セットで約73%, 20セットで約93%
function effectFromSets(sets) {
  if (sets <= 0) return 0;
  return 1 - Math.exp(-sets / 7.5);
}

// 姿勢改善ゴールで主役になる部位
SCIENCE.postureParts = ['back', 'shoulder', 'abs', 'glutes'];

// 週セット数の評価ラベル (goal='posture' ではターゲット外の部位を「維持」扱いにする)
function volumeVerdict(part, sets, goal) {
  const p = SCIENCE.partMap[part];
  if (goal === 'posture') {
    if (SCIENCE.postureParts.indexOf(part) < 0) {
      if (sets <= 0) return { label: '休み', cls: 'none' };
      return { label: '維持OK', cls: 'good' };
    }
    // 姿勢目的は筋肥大より少ないボリュームで足りる (質と頻度が主役)
    if (sets <= 0) return { label: '未実施', cls: 'none' };
    if (sets < 6) return { label: 'やや不足', cls: 'low' };
    if (sets <= 18) return { label: '最適', cls: 'good' };
    if (sets <= p.mrv) return { label: '多め(回復注意)', cls: 'high' };
    return { label: 'やり過ぎ(効率低下)', cls: 'junk' };
  }
  if (sets <= 0) return { label: '未実施', cls: 'none' };
  if (sets < p.optMin) return { label: 'やや不足', cls: 'low' };
  if (sets <= p.optMax) return { label: '最適', cls: 'good' };
  if (sets <= p.mrv) return { label: '多め(回復注意)', cls: 'high' };
  return { label: 'やり過ぎ(効率低下)', cls: 'junk' };
}

// 基礎代謝 (Mifflin-St Jeor)
function calcBMR(sex, weightKg, heightCm, age) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'f' ? base - 161 : base + 5;
}

// 総消費カロリー: 活動係数は週トレ日数で近似
function calcTDEE(profile) {
  const bmr = calcBMR(profile.sex, profile.w, profile.h, profile.age);
  const factor = 1.35 + Math.min(profile.days || 0, 7) * 0.05;
  return Math.round(bmr * factor);
}

// 推定1RM (Epley)
function epley1RM(weight, reps) {
  if (reps <= 1) return weight;
  return weight * (1 + reps / 30);
}

// トレーニング消費カロリー: kcal = METs × 体重kg × 時間h × 1.05
function calcBurn(mets, weightKg, minutes) {
  return Math.round(mets * weightKg * (minutes / 60) * 1.05);
}

// 歩数からの活動消費カロリー(概算): 体重kg × 歩数 × 0.0005(70kgで1万歩≈350kcal)
function stepKcal(steps, weightKg) {
  const s = Number(steps), w = Number(weightKg);
  if (!(s > 0) || !(w > 0)) return 0;
  return Math.round(s * w * 0.0005);
}

// セッション消費カロリー: 種目ごとのMETsで実施時間を、休憩はMETs1.8で積算
function sessionBurn(items, exDb, weightKg) {
  let kcal = SCIENCE.warmupMin / 60 * 3.5 * weightKg * 1.05; // ウォームアップ
  (items || []).forEach(it => {
    const ex = exDb[it.exId];
    const mets = ex ? ex.mets : 4;
    const workH = (it.sets * SCIENCE.setSeconds) / 3600;
    const restH = (it.sets * it.rest) / 3600;
    kcal += (mets * workH + 1.8 * restH) * weightKg * 1.05;
  });
  return Math.round(kcal);
}

// 部位ごとの回復状態: logs から最終トレ日時を出し、残り時間を返す
function recoveryStatus(logs, exDb) {
  const lastTrained = {}; // part -> timestamp(ms)
  (logs || []).forEach(l => {
    const ex = exDb[l.exId];
    if (!ex) return;
    const t = new Date(l.date + 'T20:00:00').getTime();
    if (!lastTrained[ex.part] || t > lastTrained[ex.part]) lastTrained[ex.part] = t;
  });
  const now = Date.now();
  return SCIENCE.parts.map(p => {
    const t = lastTrained[p.key];
    if (!t) return { part: p.key, name: p.name, state: 'fresh', remainH: 0 };
    const elapsedH = Math.max(0, (now - t) / 3600000); // 当日の早い時間の記録で負にならないようクランプ
    const remainH = Math.max(0, p.recoveryH - elapsedH);
    return {
      part: p.key, name: p.name,
      state: remainH <= 0 ? 'ready' : (remainH < p.recoveryH / 2 ? 'almost' : 'resting'),
      remainH: Math.ceil(remainH),
    };
  });
}
