// 筋トレLAB — アクティブレスト(休養日の姿勢改善・柔軟・可動性)コンテンツ
// 休養日に「何もしない」より、超回復を妨げない低強度の動きで姿勢・柔軟・可動域を整える。
// cat: mobility(可動性) / stretch(柔軟) / posture(姿勢改善) / core(体幹・軽い活性)
// すべて自重・低強度。痛みが出たら中止(フォーム解説と同じ安全方針)。

const RECOVERY_MOVES = [
  // ── 可動性 (mobility) ──
  { id: 'rc-catcow', name: 'キャット&カウ', cat: 'mobility', area: '背骨', amount: '10回ゆっくり',
    cue: '四つ這いで、息を吐きながら背中を丸め、吸いながら反らす。反動をつけず背骨を1つずつ動かす意識。' },
  { id: 'rc-tspine', name: '胸椎回旋(四つ這い)', cat: 'mobility', area: '背中(胸椎)', amount: '左右各8回',
    cue: '四つ這いで片手を後頭部に添え、肘を天井へ開いて胸を捻る→戻す。腰でなく胸から捻る。' },
  { id: 'rc-hip9090', name: '90/90 股関節スイッチ', cat: 'mobility', area: '股関節', amount: '左右各8回',
    cue: '座って両膝を90度に。上体を立てたまま両膝を左右へパタパタ倒す。反動でなく股関節から。' },
  { id: 'rc-ankle', name: '足首モビリティ(膝倒し)', cat: 'mobility', area: '足首', amount: '左右各10回',
    cue: '片足を前に踏み出し、かかとを床につけたまま膝をつま先より前へ。ふくらはぎの伸びを感じる範囲で。' },
  { id: 'rc-shouldercar', name: '肩まわし(大きく)', cat: 'mobility', area: '肩', amount: '前後各10回',
    cue: '肩を大きくゆっくり回す。可動域の端まで丁寧に。すくめず、肩甲骨から動かす。' },

  // ── 柔軟 (stretch) ──
  { id: 'rc-hamstring', name: 'ハムストリングストレッチ', cat: 'stretch', area: 'もも裏', amount: '左右各30秒キープ',
    cue: '座って片脚を伸ばし、背すじを保ったまま股関節から前傾。膝裏〜もも裏が伸びる位置で呼吸を続ける。丸めない。' },
  { id: 'rc-hipflexor', name: '腸腰筋(股関節前)ストレッチ', cat: 'stretch', area: '股関節前・もも前', amount: '左右各30秒キープ',
    cue: '片膝立ちで骨盤を軽く後傾させ、後ろ脚の付け根を前へ。腰を反らさず、お尻を締めて伸ばす。' },
  { id: 'rc-glute', name: 'お尻(梨状筋)ストレッチ', cat: 'stretch', area: 'お尻', amount: '左右各30秒キープ',
    cue: '仰向けで足首を反対の膝に乗せ「4の字」に。下の太ももを両手で引き寄せる。お尻の奥が伸びればOK。' },
  { id: 'rc-calf', name: 'ふくらはぎストレッチ(壁)', cat: 'stretch', area: 'ふくらはぎ', amount: '左右各30秒キープ',
    cue: '壁を押し、後ろ脚の膝を伸ばしかかとを床に。つま先はまっすぐ前。じんわり伸ばす。' },
  { id: 'rc-child', name: '子供のポーズ', cat: 'stretch', area: '背中・広背筋', amount: '45秒キープ',
    cue: '正座からお尻をかかとへ、手を前に伸ばして背中を丸め脱力。呼吸で背中の広がりを感じる。' },
  { id: 'rc-neck', name: '首・僧帽筋ストレッチ', cat: 'stretch', area: '首・肩', amount: '左右各20秒キープ',
    cue: '頭を横に倒し、同じ側の手で軽く支える。反対の肩は下げたまま。強く引っ張らない。' },

  // ── 姿勢改善 (posture) ──
  { id: 'rc-wallangel', name: '壁エンジェル', cat: 'posture', area: '肩甲骨・背中上部', amount: '10回',
    cue: '壁に背・後頭部・お尻をつけ、腕をW→Yへ上下。腰を反らさず、手の甲を壁につけたまま動かせる範囲で。' },
  { id: 'rc-chintuck', name: 'チンタック(顎引き)', cat: 'posture', area: '首(前傾姿勢改善)', amount: '10回×3秒キープ',
    cue: '顎を軽く引いて後頭部を後ろへ(二重顎を作る)。うなずかず水平に平行移動。スマホ首対策。' },
  { id: 'rc-doorwaypec', name: 'ドアウェイ胸ストレッチ', cat: 'posture', area: '胸(巻き肩改善)', amount: '左右各30秒キープ',
    cue: 'ドア枠に前腕を当て、一歩踏み出して胸の前を開く。反らさず胸だけ伸ばす。巻き肩・猫背に。' },
  { id: 'rc-prone-y', name: 'うつ伏せYレイズ', cat: 'posture', area: '背中下部・肩甲骨', amount: '12回(軽く)',
    cue: 'うつ伏せで親指を上に、腕をYの字に軽く持ち上げる。肩をすくめず肩甲骨を下げて寄せる。重り不要。' },

  // ── 体幹・軽い活性 (core) ──
  { id: 'rc-deadbug', name: 'デッドバグ', cat: 'core', area: '体幹', amount: '左右各8回',
    cue: '仰向けで両手両膝を天井へ。腰を床に押しつけたまま対角の手足をゆっくり伸ばす→戻す。腰が反ったら可動を小さく。' },
  { id: 'rc-birddog', name: 'バードドッグ', cat: 'core', area: '体幹・背中', amount: '左右各8回',
    cue: '四つ這いで対角の手足を水平に伸ばし1〜2秒キープ。骨盤を水平に保ち、ぐらつかない範囲で。' },
  { id: 'rc-glutebridge', name: 'グルートブリッジ', cat: 'core', area: 'お尻・体幹', amount: '12回',
    cue: '仰向け膝立てで、お尻を締めて持ち上げ、肩〜膝を一直線に。腰で反らずお尻で上げる。休養日の活性に最適。' },
  { id: 'rc-plank', name: 'プランク(軽め)', cat: 'core', area: '体幹', amount: '20〜30秒キープ',
    cue: '肘とつま先で体を一直線に。お尻を上げすぎず落とさず。呼吸を止めない。きつければ膝つきで。' },
];

// 休養日の1回分ルーティン(日替わりで巡回・目標が姿勢改善なら姿勢多め)
function buildRecoveryRoutine(dateStr, goal) {
  const t = new Date((dateStr || '2026-01-01') + 'T12:00:00').getTime();
  const dayIdx = isFinite(t) ? Math.floor(t / 86400000) : 0;
  const byCat = c => RECOVERY_MOVES.filter(m => m.cat === c);
  const pick = (arr, n, off) => arr.length
    ? Array.from({ length: Math.min(n, arr.length) }, (_, i) => arr[((off % arr.length) + i) % arr.length])
    : [];
  const posture = goal === 'posture';
  const routine = [
    ...pick(byCat('mobility'), 1, dayIdx),
    ...pick(byCat('posture'), posture ? 2 : 1, dayIdx),
    ...pick(byCat('stretch'), 2, dayIdx + 1),
    ...pick(byCat('core'), 1, dayIdx),
  ];
  // 重複除去(念のため)
  const seen = new Set();
  return routine.filter(m => m && !seen.has(m.id) && seen.add(m.id));
}

const RECOVERY_CAT_LABEL = { mobility: '可動性', stretch: '柔軟', posture: '姿勢', core: '体幹' };
