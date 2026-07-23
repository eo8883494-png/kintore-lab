# iOSネイティブ拡張(Live Activity + ホームウィジェット)組み込み手順

このフォルダのSwiftを Xcode に追加すると、
- **⏱️ Live Activity**: 休憩/インターバルタイマーの残り時間が**ロック画面とDynamic Island**に出る
- **🏠 ホームウィジェット**: ホーム画面に「今日のメニュー+進捗ドット」

JS側(app.js)の配線は済んでいる(`KLNative`プラグイン・未組み込みでも安全にno-op)。

## 手順(Xcode・約10分)

### 1. ウィジェット拡張ターゲットを作る
1. Xcode: **File → New → Target...** → **Widget Extension** を選択 → Next
2. Product Name: **KintoreWidget**
3. **「Include Live Activity」にチェック**(あれば)・「Include Configuration App Intent」は**外す**
4. Finish → 「Activate scheme?」は **Activate**

### 2. テンプレートを本実装に差し替え
1. 生成された `KintoreWidget` フォルダ内のテンプレート`.swift`(`KintoreWidgetBundle.swift`・`KintoreWidget.swift`・`KintoreWidgetLiveActivity.swift`等)を**すべて削除**(Move to Trash)
2. Finderでこのリポジトリの `native/ios/Widget/` の3ファイルを Xcode の **KintoreWidget** グループへドラッグ
   - ✅ Copy items if needed / ✅ Target: **KintoreWidget のみ**
3. `native/ios/Shared/KLTimerAttributes.swift` をドラッグ
   - ✅ Target: **App と KintoreWidget の両方にチェック**(重要)
4. `native/ios/App/` の `KLNativePlugin.swift` と `KLNativePlugin.m` を **App/App** グループへドラッグ
   - ✅ Target: **App のみ**。`.m`追加時に「Create Bridging Header?」と聞かれたら **Create** でOK

### 3. 設定3つ
1. **App ターゲット → Info** タブ → 右クリック Add Row → **`NSSupportsLiveActivities`** = **YES**(Boolean)
   (一覧では「Supports Live Activities」と表示される)
2. **App と KintoreWidget の両ターゲット → Signing & Capabilities → + Capability → App Groups**
   → 「+」で **`group.com.hatarakuai.kintorelab`** を追加(両方同じIDに)
   ※無料Personal Teamで弾かれた場合: ウィジェットのデータ共有だけが効かなくなる(Live Activityは動く)。その時は報告を
3. **KintoreWidget ターゲット → General → Minimum Deployments = iOS 16.1**

### 4. ビルド
- Scheme を **App** に戻して ▶ Run
- 署名エラーが出たら KintoreWidget ターゲットにも同じ Team を設定

## 確認方法
- **Live Activity**: アプリで休憩タイマー開始 → ロックする → ロック画面にカウントダウンが出る
- **ウィジェット**: ホーム画面長押し → 「+」→ 筋トレLAB → 「今日のメニュー」を追加 → アプリでホームを開くと内容が反映される

---

# ⌚ Apple Watch アプリの組み込み手順

Watchで「今日のメニュー表示 → タップでセット完了(iPhoneに記録) → 手首で休憩タイマー(振動)」ができる。

### 1. Watchターゲットを作る
1. **File → New → Target...** → 上部タブ **watchOS** → **App** → Next
2. Product Name: **KintoreWatch** / Interface: SwiftUI
3. **「Watch App for Existing iOS App」系の選択肢/チェックがあれば選ぶ**(親アプリ=App)。無ければそのままFinish
   ※ダイアログの内容がここの説明と違ったらスクショで報告
4. Finish → Activate

### 2. テンプレートを本実装に差し替え
1. 生成された `KintoreWatch` フォルダのテンプレ`.swift`(`KintoreWatchApp.swift`・`ContentView.swift`)を削除
2. このリポジトリの `native/watchos/KintoreWatch/` の3ファイル(KintoreWatchApp / ContentView / WatchSession)を **KintoreWatch** グループへドラッグ
   - ✅ Copy items if needed / ✅ Target: **KintoreWatch のみ**
3. iPhone側ブリッジ: `native/ios/App/` の **KLWatchPlugin.swift** と **KLWatchPlugin.m** を **App/App** グループへドラッグ
   - ✅ Target: **App のみ**

### 3. ビルド・確認
- Scheme **App** で ▶ Run(Watchが未ペアでもビルドは通る。Watch実機/シミュレータに入れるにはScheme KintoreWatchでWatch宛てにRun)
- iPhoneで筋トレLABのホームを開く → Watchの筋トレLABを開く → メニューが同期される
- Watchで種目をタップ → iPhone側にセット進捗/記録が反映・Watchに休憩カウントダウン+振動

### 制限(MVP)
- Watch画面を閉じると休憩タイマーは止まる(手首を上げている間動く)。本格的なバックグラウンド動作はv1.1で
- 同期はiPhoneアプリがホームを描画したタイミング(リアルタイム双方向はv1.1)

## トラブル時
エラーの赤字をそのまま報告してください(型名・行番号ごと)。
