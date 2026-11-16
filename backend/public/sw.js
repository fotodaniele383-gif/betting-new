// STEP90D_SW_NEUTRALIZED - nessun fetch handler, nessuna cache persistente.
// STEP90B_SW_NEUTRALIZED
// STEP90_PREMATCH_GATE_ALIGNMENT
// STEP89_SW_NEUTRALIZED
// STEP81_SW_NEUTRALIZED
const STEP90D_CACHE_VERSION = 'step90d-full-legacy-test-repair';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    } catch (e) {}
    try { await self.clients.claim(); } catch (e) {}
    try { await self.registration.unregister(); } catch (e) {}
  })());
});
