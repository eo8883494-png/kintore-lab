// 筋トレLAB — シェア画像生成と共有 (#筋トレLAB)

const SHARE_TAG = '#筋トレLAB';
const SHARE_LINKS = {
  x: 'https://x.com/search?q=%23%E7%AD%8B%E3%83%88%E3%83%ACLAB&f=live',
  tiktok: 'https://www.tiktok.com/tag/%E7%AD%8B%E3%83%88%E3%83%AClab',
};

// 指定日のトレ内容を集計
function shareStats(date) {
  const logs = S.logs.filter(l => l.date === date);
  let volume = 0;
  const lines = [];
  const prs = [];
  logs.forEach(l => {
    const ex = DB.byId[l.exId];
    const name = ex ? ex.name : l.exId;
    let top = 0, topR = 0;
    l.sets.forEach(s => { volume += (s.w || 0) * s.r; if ((s.w || 0) >= top) { top = s.w || 0; topR = s.r; } });
    lines.push({ name, sets: l.sets.length, top, topR });
    // 自己ベスト判定: 過去(この日より前)の最高e1RMを超えたか
    if (top > 0) {
      const todayBest = Math.max(...l.sets.filter(s => s.w > 0 && s.r > 0).map(s => epley1RM(s.w, s.r)), 0);
      const prevBest = Math.max(...S.logs
        .filter(x => x.exId === l.exId && x.date < date)
        .flatMap(x => x.sets.filter(s => s.w > 0 && s.r > 0).map(s => epley1RM(s.w, s.r))), 0);
      if (todayBest > 0 && todayBest > prevBest && prevBest > 0) prs.push({ name, e1rm: Math.round(todayBest * 10) / 10 });
    }
  });
  return {
    date, lines, volume: Math.round(volume),
    streak: calcWeekStreak(S.logs, S.profile ? S.profile.days : 3),
    weekDays: thisWeekDays(S.logs, date),
    prs, isToday: date === todayStr(),
  };
}

// シェア画像 (1080×1350) を canvas で描画して dataURL を返す
function drawShareCard(stats) {
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const ACCENT = '#c8f14e', BG = '#0e1013', SURFACE = '#171a1f', INK = '#e8eaed', DIM = '#9aa3ad';
  const jp = '"Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", sans-serif';

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  // 上下のアクセントバー
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, W, 14);
  ctx.fillRect(0, H - 14, W, 14);

  // ロゴ
  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  ctx.font = `900 64px ${jp}`;
  ctx.fillText('筋トレ', 70, 130);
  ctx.fillStyle = ACCENT;
  ctx.fillText('LAB', 70 + ctx.measureText('筋トレ').width, 130);
  ctx.fillStyle = DIM;
  ctx.font = `700 36px ${jp}`;
  ctx.textAlign = 'right';
  ctx.fillText(fmtDate(stats.date), W - 70, 126);

  // 見出し
  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  ctx.font = `900 56px ${jp}`;
  ctx.fillText(stats.isToday ? '今日の筋トレ、完了。' : 'この日の筋トレ、完了。', 70, 240);

  // 種目リスト (統計タイル・フッターと衝突しない数まで)
  let y = 320;
  const maxItems = stats.prs.length ? 5 : 6;
  const list = stats.lines.slice(0, maxItems);
  list.forEach(l => {
    ctx.fillStyle = SURFACE;
    roundRectPath(ctx, 70, y, W - 140, 92, 18);
    ctx.fill();
    ctx.fillStyle = ACCENT;
    ctx.fillRect(70, y, 10, 92);
    const rightTxt = l.top > 0 ? `${l.top}kg × ${l.sets}セット` : `${l.sets}セット`;
    ctx.font = `700 36px ${jp}`;
    const rightW = ctx.measureText(rightTxt).width;
    ctx.fillStyle = INK;
    ctx.font = `800 40px ${jp}`;
    const nameMax = W - 100 - rightW - 30 - 110; // 右側テキストと重ならない幅
    let nm = l.name;
    while (ctx.measureText(nm).width > nameMax && nm.length > 4) nm = nm.slice(0, -2) + '…';
    ctx.fillText(nm, 110, y + 58);
    ctx.fillStyle = DIM;
    ctx.font = `700 36px ${jp}`;
    ctx.textAlign = 'right';
    ctx.fillText(rightTxt, W - 100, y + 58);
    ctx.textAlign = 'left';
    y += 108;
  });
  if (stats.lines.length > maxItems) {
    ctx.fillStyle = DIM;
    ctx.font = `700 34px ${jp}`;
    ctx.fillText(`ほか${stats.lines.length - maxItems}種目`, 90, y + 40);
    y += 70;
  }

  // PR (幅に収まるまでフォントを縮める)
  if (stats.prs.length) {
    const pr = stats.prs[0];
    const txt = `🏆 ${pr.name} 推定1RM ${pr.e1rm}kg 自己ベスト!`;
    ctx.fillStyle = ACCENT;
    let fs = 44;
    ctx.font = `900 ${fs}px ${jp}`;
    while (ctx.measureText(txt).width > W - 140 && fs > 28) {
      fs -= 2;
      ctx.font = `900 ${fs}px ${jp}`;
    }
    ctx.fillText(txt, 70, y + 60);
    y += 100;
  }

  // 統計 3タイル (過去日のカードには現在基準のストリークを載せない)
  const tiles = stats.isToday ? [
    { k: '総ボリューム', v: stats.volume > 0 ? `${stats.volume}kg` : `${stats.lines.length}種目` },
    { k: '連続達成', v: `${stats.streak}週` },
    { k: '今週', v: `${stats.weekDays}日目` },
  ] : [
    { k: '総ボリューム', v: stats.volume > 0 ? `${stats.volume}kg` : '自重' },
    { k: '種目数', v: `${stats.lines.length}種目` },
    { k: 'この週', v: `${stats.weekDays}日目` },
  ];
  const ty = 1060; // 固定位置 (リスト側で衝突しない数に制限済み)
  tiles.forEach((t, i) => {
    const tx = 70 + i * ((W - 140 - 40) / 3 + 20);
    const tw = (W - 140 - 40) / 3;
    ctx.fillStyle = SURFACE;
    roundRectPath(ctx, tx, ty, tw, 150, 20);
    ctx.fill();
    ctx.fillStyle = DIM;
    ctx.font = `700 30px ${jp}`;
    ctx.fillText(t.k, tx + 28, ty + 52);
    ctx.fillStyle = ACCENT;
    ctx.font = `900 54px ${jp}`;
    ctx.fillText(t.v, tx + 28, ty + 118);
  });

  // フッター
  ctx.fillStyle = INK;
  ctx.font = `900 46px ${jp}`;
  ctx.textAlign = 'center';
  ctx.fillText(`${SHARE_TAG} で一緒に強くなろう`, W / 2, H - 70);
  ctx.textAlign = 'left';
  return cv;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shareCaption(stats) {
  const parts = [stats.isToday ? `今日の筋トレ完了💪` : `${fmtDate(stats.date)}の筋トレ記録💪`];
  if (stats.volume > 0) parts.push(`総ボリューム${stats.volume}kg`);
  parts.push(`${stats.lines.length}種目`);
  if (stats.isToday && stats.streak > 1) parts.push(`連続${stats.streak}週達成`);
  if (stats.prs.length) parts.push(`🏆${stats.prs[0].name}自己ベスト!`);
  return parts.join(' / ') + `\n${SHARE_TAG}`;
}

// シェアモーダル
function openShareModal(date) {
  const stats = shareStats(date || todayStr());
  if (!stats.lines.length) { toast('この日の記録がありません'); return; }
  const cv = drawShareCard(stats);
  const dataUrl = cv.toDataURL('image/png');
  const caption = shareCaption(stats);
  const capShareReady = !!(typeof isNativeApp === 'function' && isNativeApp() && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share && window.Capacitor.Plugins.Filesystem);
  const canNativeShare = capShareReady || !!(navigator.canShare && navigator.share);

  const bg = openModal(`
    <h2>📸 記録をシェア</h2>
    <p class="modal-sub">画像を保存してX・TikTok・Instagramに投稿。トレ動画と一緒に ${esc(SHARE_TAG)} を付ければ、みんなの記録とつながります。</p>
    <img src="${dataUrl}" alt="シェア画像" style="width:100%;border-radius:14px;border:1px solid var(--line);margin-bottom:12px">
    <div class="field"><label>キャプション(タップでコピー)</label>
      <textarea id="share-caption" rows="3" readonly style="font-size:13px">${esc(caption)}</textarea></div>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      ${canNativeShare ? '<button class="btn" id="share-native">共有する</button>' : ''}
      <button class="btn ${canNativeShare ? 'ghost' : ''}" id="share-download">画像を保存</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:4px">
      <a class="btn ghost" style="text-decoration:none" target="_blank" rel="noopener" href="${SHARE_LINKS.x}">𝕏 みんなの記録</a>
      <a class="btn ghost" style="text-decoration:none" target="_blank" rel="noopener" href="${SHARE_LINKS.tiktok}">TikTokで見る</a>
    </div>
    <button class="btn ghost" onclick="closeModal()" style="margin-top:6px">閉じる</button>`);

  $('#share-caption', bg).addEventListener('click', e => {
    e.target.select();
    try { navigator.clipboard.writeText(caption); toast('キャプションをコピーしました'); } catch (err) { /* 手動コピーにフォールバック */ }
  });
  $('#share-download', bg).addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `kintore-lab-${stats.date}.png`;
    a.click();
    toast('画像を保存しました');
  });
  const nat = $('#share-native', bg);
  if (nat) nat.addEventListener('click', async () => {
    // ネイティブ: 共有シート(@capacitor/share)で画像+キャプションをLINE/Instagram等へ直接
    const CapP = window.Capacitor && window.Capacitor.Plugins;
    const isNat = typeof isNativeApp === 'function' && isNativeApp();
    if (isNat && CapP && CapP.Share && CapP.Filesystem) {
      try {
        const base64 = dataUrl.split(',')[1];
        const wr = await CapP.Filesystem.writeFile({ path: `kintore-lab-${stats.date}.png`, data: base64, directory: 'CACHE' });
        await CapP.Share.share({ text: caption, files: [wr.uri] });
        return;
      } catch (e) { /* キャンセルや未対応はWeb Shareへフォールバック */ }
    }
    cv.toBlob(blob => {
      const file = new File([blob], `kintore-lab-${stats.date}.png`, { type: 'image/png' });
      const payload = { files: [file], text: caption };
      if (navigator.canShare && navigator.canShare(payload)) {
        navigator.share(payload).catch(() => { /* ユーザーキャンセルは無視 */ });
      } else {
        navigator.share({ text: caption }).catch(() => {});
      }
    });
  });
}
