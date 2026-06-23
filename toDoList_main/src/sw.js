import { precacheAndRoute } from 'workbox-precaching';

precacheAndRoute(self.__WB_MANIFEST || []);

self.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// Take control of any already-open pages the moment this worker activates.
// The "Update available — tap to refresh" cue posts SKIP_WAITING, which
// activates the waiting worker — but without clients.claim() the new worker
// still won't control the open page until the next navigation, so the
// controllerchange listener in index.js never fires and the tap never
// reloads. The page then keeps running the stale bundle while the freshly
// deployed HTML shell points at content-hashed bundles the old cache can't
// supply — the white page the user only escapes with a manual hard refresh.
// Claiming clients here makes activation immediately propagate to the page.
self.addEventListener('activate', function (event) {
    event.waitUntil(self.clients.claim());
});
