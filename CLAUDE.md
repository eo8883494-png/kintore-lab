# C:\dev\kintore-lab — 筋トレLAB(筋トレ設計・記録SPA)

登録不要・端末内完結の無料筋トレ設計/記録アプリ。個人プロジェクト寄り(会社の収益ラインには未組込)。
公開: https://eo8883494-png.github.io/kintore-lab/ (GitHub Pages)。会社全体は C:\dev\ai-company\HANDOFF.md。詳細機能は README.md。

## 技術
- **素のHTML/CSS/JS(ビルド無し・依存ゼロ・約200KB)**。index.html + css/ + js/
- データは全て localStorage/IndexedDB で端末内保存(サーバー送信なし)
- 種目DB(78種目)・食品DB(51品目)はマルチエージェントワークフローで生成・検証済み

## 鉄則
- **JS/CSSを変更したら index.html の `?v=N` を必ず上げる**(キャッシュバスト)
- **`seed-demo.html` / `share-preview.html` は開発用・.gitignore済み・デプロイ禁止**(seed-demoは実データを上書きする危険あり)
- ローカル確認: `python -m http.server 8137 -d .`
- 変更後はキャッシュバスト+実機で手順依存バグ(戻る/リロード/データ移行)を確認
