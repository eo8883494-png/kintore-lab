# C:\dev\kintore-lab — 筋トレLAB(筋トレ設計・記録SPA)

登録不要・端末内完結の無料筋トレ設計/記録アプリ。**2026-07-22に会社事業へ採用(育成フェーズ)** — 現状はMIDINA+オトタイプ2正面を殺さない地ならしのみ。段階トリガー・iOS有料アプリ化構想は C:\dev\ai-company\HANDOFF.md §5「kintore-lab事業化ロードマップ」。
公開: https://eo8883494-png.github.io/kintore-lab/ (GitHub Pages)。会社全体は C:\dev\ai-company\HANDOFF.md。詳細機能は README.md。

## 収益化(育成フェーズ)
- GA4=**G-V0BNHBZ9CW**(ototype/ai-tools/zzZFMと同一origin共有プロパティ・パス /kintore-lab/ で分離集計)。牽引ゲート判定の計測基盤
- アフィリ(未実装)=食事画面のプロテイン/EAA・ツール画面の器具。楽天=提携中/Amazon=申請中。**PR表記必須・1画面1-2リンク・要CLOゲート**(ステマ規制)。牽引ゲート到達で発動
- 将来iOS有料化=Capacitorラップ+HealthKit連携(薄ラッパーのリジェクト回避)。Apple Dev登録$99=ユーザー操作

## 技術
- **素のHTML/CSS/JS(ビルド無し・依存ゼロ・約200KB)**。index.html + css/ + js/
- データは全て localStorage/IndexedDB で端末内保存(サーバー送信なし)
- 種目DB(78種目)・食品DB(51品目)はマルチエージェントワークフローで生成・検証済み

## 鉄則
- **JS/CSSを変更したら index.html の `?v=N` を必ず上げる**(キャッシュバスト)
- **`seed-demo.html` / `share-preview.html` は開発用・.gitignore済み・デプロイ禁止**(seed-demoは実データを上書きする危険あり)
- ローカル確認: `python -m http.server 8137 -d .`
- 変更後はキャッシュバスト+実機で手順依存バグ(戻る/リロード/データ移行)を確認
