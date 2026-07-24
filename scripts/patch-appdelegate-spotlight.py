#!/usr/bin/env python3
"""筋トレLAB — AppDelegate.swift に Spotlight 復帰処理を差し込む(Mac専用・冪等)

Spotlight検索結果をタップした時、どの種目が選ばれたかを UserDefaults の
保留アクションに書いて、JS側(consumeNativeAction)が種目モーダルを開く。
Capacitor が生成する AppDelegate は ios/ 配下=git管理外のため、手編集の代わりに
このスクリプトで安全に(何度実行しても二重に入らない形で)差し込む。

使い方: python3 scripts/patch-appdelegate-spotlight.py
"""
import os
import sys

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'ios', 'App', 'App', 'AppDelegate.swift')
PATH = os.path.normpath(PATH)

SNIPPET = '''        if userActivity.activityType == CSSearchableItemActionType,
           let id = userActivity.userInfo?[CSSearchableItemActivityIdentifier] as? String,
           id.hasPrefix("ex:") {
            UserDefaults.standard.set("{\\"action\\":\\"openExercise\\",\\"exId\\":\\"\\(id.dropFirst(3))\\"}", forKey: "kl.pendingAction")
        }
'''


def main():
    if not os.path.exists(PATH):
        sys.exit(f'見つかりません: {PATH}\n先に npx cap add ios / sync を実行してください')

    src = open(PATH, encoding='utf-8').read()

    if 'CSSearchableItemActionType' in src:
        print('既に適用済みです(変更なし)')
        return

    # import CoreSpotlight を追加
    if 'import CoreSpotlight' not in src:
        if 'import Capacitor' in src:
            src = src.replace('import Capacitor', 'import Capacitor\nimport CoreSpotlight', 1)
        else:
            src = src.replace('import UIKit', 'import UIKit\nimport CoreSpotlight', 1)

    # continue userActivity メソッド内の return 直前に差し込む
    i = src.find('continue userActivity')
    if i < 0:
        sys.exit('continue userActivity メソッドが見つかりません。手動で追加してください(README参照)')
    r = src.find('return', i)
    if r < 0:
        sys.exit('return が見つかりません。手動で追加してください(README参照)')
    line_start = src.rfind('\n', 0, r) + 1

    src = src[:line_start] + SNIPPET + src[line_start:]

    open(PATH, 'w', encoding='utf-8').write(src)
    print('適用しました → ' + PATH)
    print('Xcode で ▶ Run し直してください')


if __name__ == '__main__':
    main()
