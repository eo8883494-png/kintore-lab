/* 筋トレLAB — FCM バックグラウンド通知用サービスワーカー
   アプリを閉じている/裏に回している間のプッシュを受けて通知を表示する。
   送信側は webpush.notification を使うので通常はブラウザが自動表示するが、
   data メッセージのフォールバックとして onBackgroundMessage も用意する。 */
importScripts('https://www.gstatic.com/firebasejs/12.15.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyB6cNjUGULa4Nkikb8z66eCWwYCTZTQ_T4",
  authDomain: "kintore-lab.firebaseapp.com",
  databaseURL: "https://kintore-lab-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "kintore-lab",
  storageBucket: "kintore-lab.firebasestorage.app",
  messagingSenderId: "1082300556359",
  appId: "1:1082300556359:web:53c260a798259ca8dabd62"
});

const messaging = firebase.messaging();

// data-only メッセージが来た場合の表示 (パスはSW位置からの相対=local/本番どちらでも正しく解決)
messaging.onBackgroundMessage(function (payload) {
  const d = (payload && payload.data) || {};
  self.registration.showNotification(d.title || '筋トレLAB', {
    body: d.body || '今日のトレーニングの時間です💪',
    icon: './assets/icons/icon-192.png',
    badge: './assets/icons/icon-192.png',
    tag: 'kl-reminder',
    data: { url: './' },
  });
});

// 通知タップ → アプリを開く/前面化
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (const c of list) {
        if (c.url.indexOf('/kintore-lab') >= 0 && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
