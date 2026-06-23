import { precacheAndRoute, cleanupOutdatedCaches, matchPrecache } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

// Drop precache entries from superseded worker generations so an old
// generation's index.html can't linger and be served for a navigation.
cleanupOutdatedCaches();

// Serve the HTML document network-first.
//
// output.clean deletes the previous content-hashed bundle from dist/ on every
// build, so once a new build is live the old bundle is gone from the network.
// If navigations are served cache-first (the default precache route), a stale
// index.html can leak — from this worker's own precache during the activate/
// claim seam, or from GitHub Pages' ~10-minute HTTP cache — and point at a
// bundle hash that no longer exists anywhere, so the <script> 404s and nothing
// boots: the post-deploy white page. Going network-first means the shell and
// the hashed bundle it references always come from the same (latest)
// generation whenever the device is online.
//
// Registered BEFORE precacheAndRoute so this navigation route wins over the
// cache-first precache route. Content-hashed assets stay precached/cache-first
// — safe, because their URLs change per build, so a cache hit is always the
// right generation.
const htmlHandler = new NetworkFirst({
    cacheName: 'html-shell',
    networkTimeoutSeconds: 4,
});

registerRoute(new NavigationRoute(async (options) => {
    try {
        return await htmlHandler.handle(options);
    } catch (err) {
        // Offline with nothing in the html-shell runtime cache yet (e.g. first
        // launch was offline, or the network timed out on a cold cache). Fall
        // back to the precached shell so the app still boots after the first
        // online visit; re-throw only if even that is unavailable.
        const precached = await matchPrecache('index.html');
        if (precached) return precached;
        throw err;
    }
}));

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
