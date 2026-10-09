/**
 * Nextdo PWA Service Worker
 * Provides offline caching, App Shell fallback, and Web Push notifications.
 */

const CACHE_NAME = 'nextdo-pwa-v1';

// Essential assets to cache immediately upon install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip cross-origin or non-GET requests
  if (request.method !== 'GET') return;

  // Skip API sync and WebSocket endpoints (let PowerSync & Cloudflare handle directly)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/sync/') || url.protocol === 'ws:' || url.protocol === 'wss:') {
    return;
  }

  // Navigation requests: Network-first, fallback to cached App Shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          return caches.match('/index.html') || caches.match('/');
        })
    );
    return;
  }

  // Static assets: Stale-While-Revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

// Web Push notification handler (supports iOS 16.4+ Web Push in standalone PWA)
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: 'Nextdo 任务提醒', body: event.data.text() };
    }
  }

  const title = data.title || 'Nextdo 任务提醒';
  const options = {
    body: data.body || '你有待处理的下一步行动',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: data.url || '/',
    tag: data.tag || 'nextdo-reminder',
    renotify: true
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click event handler: Focus existing window or open new
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
