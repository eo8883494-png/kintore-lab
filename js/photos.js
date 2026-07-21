// 筋トレLAB — 体型フォト記録 (IndexedDB・端末内保存のみ、どこにも送信しない)

const PhotoDB = {
  _db: null,
  open() {
    return new Promise((res, rej) => {
      if (this._db) return res(this._db);
      const req = indexedDB.open('kintoreLabPhotos', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = () => { this._db = req.result; res(this._db); };
      req.onerror = () => rej(req.error);
    });
  },
  async all() {
    const db = await this.open();
    return new Promise((res, rej) => {
      const r = db.transaction('photos').objectStore('photos').getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
  },
  async add(photo) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const r = db.transaction('photos', 'readwrite').objectStore('photos').add(photo);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async remove(id) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const r = db.transaction('photos', 'readwrite').objectStore('photos').delete(id);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  },
};

// 画像を縮小してdataURL化 (最大辺900px・JPEG)
function downscaleImage(file, maxSize) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.width * scale));
      cv.height = Math.max(1, Math.round(img.height * scale));
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(img.src);
      res(cv.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); rej(new Error('画像を読み込めませんでした')); };
    img.src = URL.createObjectURL(file);
  });
}

// 目標写真までの道のりテキスト (写真のAI分析ではなく、プロフィールの増減ペースから概算)
function journeyText() {
  const p = S.profile;
  if (!p) return '';
  const rate = SCIENCE.gainRate[p.level] * (p.sex === 'f' ? SCIENCE.femaleFactor : 1);
  if (p.goal === 'diet') {
    return '目安: −2〜3kgで顔と腹まわりが変わり始め、−5kg前後で周りに気づかれるレベル。週0.5%減ペースなら2〜3ヶ月で最初の変化を実感できます。';
  }
  const m1 = Math.max(1, Math.round(2 / rate));
  const m2 = Math.max(m1 + 1, Math.round(5 / rate));
  return `目安: 筋肉+2kgで「締まってきた?」(約${m1}ヶ月)、+5kgで見た目が別人化(約${m2}ヶ月〜)。写真は同じ場所・同じ光・同じポーズで撮ると変化がわかりやすい。`;
}

async function renderPhotoCard(container) {
  if (!container) return;
  let photos = [];
  try { photos = await PhotoDB.all(); } catch (e) {
    container.innerHTML = '<p class="card-note">この環境では写真保存を利用できません。</p>';
    return;
  }
  photos.sort((a, b) => (a.date < b.date ? -1 : 1));
  const mine = photos.filter(p => p.type === 'me');
  const goal = photos.filter(p => p.type === 'goal').pop();

  let html = `
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <label class="btn small" style="flex:1">📷 今の体を記録<input type="file" accept="image/*" id="photo-add-me" hidden></label>
      <label class="btn small ghost" style="flex:1">🎯 目標写真を設定<input type="file" accept="image/*" id="photo-add-goal" hidden></label>
    </div>`;

  // ビフォーアフター比較 (最古 vs 最新)
  if (mine.length >= 2) {
    const first = mine[0], last = mine[mine.length - 1];
    html += `<div class="photo-cmp">
      <figure><img src="${first.dataUrl}" alt="before"><figcaption>${fmtDate(first.date)}</figcaption></figure>
      <div class="cmp-arrow">→</div>
      <figure><img src="${last.dataUrl}" alt="after"><figcaption>${fmtDate(last.date)}</figcaption></figure>
    </div>`;
  }
  // 現在 vs 目標
  if (goal && mine.length) {
    const last = mine[mine.length - 1];
    html += `<div class="photo-cmp">
      <figure><img src="${last.dataUrl}" alt="現在"><figcaption>現在 (${fmtDate(last.date)})</figcaption></figure>
      <div class="cmp-arrow">🎯</div>
      <figure><img src="${goal.dataUrl}" alt="目標"><figcaption>目標</figcaption></figure>
    </div>
    <p class="card-note">${esc(journeyText())}</p>`;
  }

  if (!mine.length && !goal) {
    html += `<div class="empty"><span class="big-emoji">📷</span>最初の1枚を撮っておくと、3ヶ月後の自分に感謝されます。<br>写真はこの端末の中にだけ保存されます。</div>`;
  } else {
    html += `<div class="photo-grid">` + photos.map(p => `
      <figure class="photo-thumb" data-photo-id="${p.id}">
        <img src="${p.dataUrl}" alt="">
        <figcaption>${p.type === 'goal' ? '🎯目標' : fmtDate(p.date)}</figcaption>
        <button class="photo-del" data-del-photo="${p.id}">✕</button>
      </figure>`).join('') + `</div>
    <p class="card-note">写真は端末内(このブラウザ)にのみ保存。エクスポートには含まれないので機種変更時は個別に保存を。</p>`;
  }

  container.innerHTML = html;

  const bindAdd = (inputId, type) => {
    const inp = container.querySelector('#' + inputId);
    if (!inp) return;
    inp.addEventListener('change', async () => {
      const file = inp.files && inp.files[0];
      inp.value = ''; // 同じファイルの再選択でもchangeが発火するようにクリア
      if (!file) return;
      try {
        const dataUrl = await downscaleImage(file, 900);
        // 先に追加してから古い目標を消す (追加失敗で既存が消えるのを防ぐ)
        const newId = await PhotoDB.add({ date: todayStr(), type, dataUrl });
        if (type === 'goal') {
          const olds = (await PhotoDB.all()).filter(p => p.type === 'goal' && p.id !== newId);
          for (const o of olds) await PhotoDB.remove(o.id);
        }
        toast(type === 'goal' ? '目標写真を設定しました🎯' : '記録しました📷 続けよう');
        renderPhotoCard(container);
      } catch (e) {
        toast('写真を保存できませんでした');
      }
    });
  };
  bindAdd('photo-add-me', 'me');
  bindAdd('photo-add-goal', 'goal');

  container.querySelectorAll('[data-del-photo]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('この写真を削除しますか?')) return;
      await PhotoDB.remove(Number(btn.dataset.delPhoto));
      toast('削除しました');
      renderPhotoCard(container);
    });
  });
}
