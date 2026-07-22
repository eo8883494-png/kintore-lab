#!/usr/bin/env bash
# 筋トレLAB — Mac 一発セットアップ(登録前フェーズ / すべて無料)
# これ1本で: Homebrew → Node → CocoaPods → npm依存 → www/生成 → iOSプロジェクト生成 → Xを開く
#
# 前提(手作業はこの2つだけ):
#   1) Mac App Store から Xcode を入れる(git/clang含む・数GB)
#   2) git clone https://github.com/eo8883494-png/kintore-lab.git
#      cd kintore-lab && bash scripts/mac-setup.sh
#
# 何度実行しても安全(導入済みはスキップ)。$99/$25 の登録は不要。
set -euo pipefail

say()  { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }
warn() { printf "\n\033[1;33m⚠ %s\033[0m\n" "$*"; }

# リポジトリ直下で実行しているか確認
if [ ! -f capacitor.config.json ] || [ ! -f package.json ]; then
  warn "リポジトリ直下で実行してください:  cd kintore-lab && bash scripts/mac-setup.sh"
  exit 1
fi

# 0) Xcode / Command Line Tools ------------------------------------------------
if ! xcode-select -p >/dev/null 2>&1; then
  warn "Xcode / Command Line Tools が見つかりません。GUIのインストールダイアログを開きます。"
  xcode-select --install || true
  echo "インストールが終わったら、もう一度このスクリプトを実行してください。"
  exit 1
fi
ok "Xcode command line tools OK ($(xcode-select -p))"

# 1) Homebrew -----------------------------------------------------------------
if ! command -v brew >/dev/null 2>&1; then
  say "Homebrew を導入(パスワードを聞かれたら入力)"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
# PATH 反映(Apple Silicon / Intel 両対応)
if   [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ];    then eval "$(/usr/local/bin/brew shellenv)"; fi
ok "Homebrew OK ($(brew --version | head -1))"

# 2) Node + CocoaPods ---------------------------------------------------------
say "Node と CocoaPods を導入"
brew list node       >/dev/null 2>&1 || brew install node
brew list cocoapods  >/dev/null 2>&1 || brew install cocoapods
ok "node $(node -v) / npm $(npm -v) / pod $(pod --version)"

# 3) npm 依存(core/ios/cli は package.json 済。android と RevenueCat を追加)----
say "依存パッケージを導入"
npm install
npm i @capacitor/android @revenuecat/purchases-capacitor@latest
ok "依存 OK"

# 4) www/ 生成(ホワイトリストで静的アセットのみコピー)------------------------
say "www/ を生成"
npm run build:www
ok "www/ 生成 OK"

# 5) ネイティブプロジェクト生成(既にあればスキップ)---------------------------
if [ ! -d ios ]; then say "iOS プロジェクトを生成"; npx cap add ios; else ok "ios/ は既存"; fi
if [ ! -d android ]; then
  say "Android プロジェクトを生成"
  npx cap add android || warn "Android生成をスキップ(Android Studio導入後に 'npx cap add android' で追加可)"
else ok "android/ は既存"; fi

# 6) 同期して Xcode を開く -----------------------------------------------------
say "同期して Xcode を開きます"
npx cap sync ios
npx cap open ios

cat <<'NEXT'

============================================================
✅ セットアップ完了。あとは Xcode の GUI で:

  1) 左ペインの "App" → タブ "Signing & Capabilities"
  2) Team = あなたの Apple ID を選択
       無い場合: "Add an Account…" → 普段のApple IDでサインイン(無料でOK)
  3) 画面上部の実行先を選ぶ:
       ・"iPhone 15 (シミュレータ)" など … アカウント不要ですぐ動く
       ・自分の実機iPhone … USB接続 → 選択(無料Apple IDなら7日間有効・再ビルドで更新)
  4) ▶ (Run) を押す

★ $99 / $25 の登録はここまで一切不要。実機で完成品を触って詰められます。
   Web を修正したら:  npm run ios:open   (build:www + sync + open を一括)
============================================================
NEXT
