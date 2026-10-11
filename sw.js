const CACHE_NAME = 'ubica-rick-v8';
const STATIC_ASSETS = ['./', './index.html'];

self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS).catch(function(e) { console.warn(e); });
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.map(function(key) {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  if (event.request.url.includes('firestore.googleapis.com') ||
      event.request.url.includes('identitytoolkit.googleapis.com') ||
      event.request.url.includes('google.com/maps') ||
      event.request.url.includes('tile.openstreetmap.org')) {
    return;
  }

  // Documentos HTML: SIEMPRE Network First
  if (event.request.mode === 'navigate' || event.request.destination === 'document' || event.request.url.endsWith('index.html') || event.request.url.endsWith('/')) {
    event.respondWith(
      fetch(event.request).then(function(networkResponse) {
        if (networkResponse && networkResponse.status === 200) {
          var clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
        }
        return networkResponse;
      }).catch(function() {
        return caches.match(event.request).then(function(cached) { return cached || caches.match('./index.html'); });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function(cached) { return cached || fetch(event.request); })
  );
});
