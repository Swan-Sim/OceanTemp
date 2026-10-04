// [ADD] otemp 앱(PWA) 서비스 워커 - 일부러 단순하게:
//  - 화면 이동(페이지 열기)만 가로채서, 인터넷이 끊겼을 때 "오프라인" 안내 화면을 보여줘요.
//  - 데이터(API)·스크립트는 가로채지 않아요 → 사이트를 고치면 앱도 바로 최신으로(옛 화면이 남는 문제 없음).
const CACHE = 'otemp-v1';
const OFFLINE = '/offline.html';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll([OFFLINE, '/icons/icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
