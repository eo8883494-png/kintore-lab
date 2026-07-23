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

## トラブル時
エラーの赤字をそのまま報告してください(型名・行番号ごと)。
