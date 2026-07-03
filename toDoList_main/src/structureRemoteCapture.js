import { buildUiTree } from './structureView.js';
import { captureSnapshot } from './structureCanvas.js';

// Remote (guest-repo) layout capture. The self repo's Structure canvas measures
// its blocks from a live-DOM walk; a linked web repo has no live DOM in this app,
// only a flat published UI map that can't express containment. But every deployed
// site shares one origin (`https://<owner>.github.io/<name>/`), and same-origin
// iframes allow direct `contentDocument` access — so this module loads a guest
// repo's deployed page into a hidden off-screen iframe, walks it with the SAME
// region-discovery rules the self repo uses (`buildUiTree`), measures every
// region at two viewport widths, and fills that repo's per-repo snapshot buckets
// (via `captureSnapshot`). After capture the existing block canvas mounts for the
// guest with no canvas changes needed.
//
// The flow only ever targets the deployed-Pages origin; a page that can't be
// reached (load error / timeout / a cross-origin `contentDocument` access that
// throws) fails quietly and leaves any prior capture untouched.

// The two breakpoints captured, matching the app's mobile/desktop buckets. The
// iframe is sized to each width so the guest's viewport-dependent CSS responds to
// the iframe's own viewport, not the host window's.
const PASSES = [
    { bucket: 'mobile', w: 390, h: 844 },
    { bucket: 'desktop', w: 1280, h: 800 },
];

// After `load`, wait a double rAF plus this settle delay before walking, so
// deferred layout / late scripts have painted.
const SETTLE_MS = 800;
// Hard ceiling per pass — a page that never fires `load` fails rather than hangs.
const HARD_TIMEOUT_MS = 10000;

function raf(fn) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
    else setTimeout(fn, 16);
}

// The deployed GitHub Pages URL for a repo, or null for malformed input. Follows
// the `https://<owner>.github.io/<name>/` convention every deployed repo here
// uses; anything that isn't a clean `owner/name` pair yields null.
export function pagesUrlFor(repo) {
    if (typeof repo !== 'string') return null;
    const parts = repo.trim().split('/');
    if (parts.length !== 2) return null;
    const owner = parts[0].trim();
    const name = parts[1].trim();
    if (!owner || !name) return null;
    return 'https://' + owner + '.github.io/' + name + '/';
}

// Load `url` into a hidden off-screen iframe sized to w×h, resolving with the
// iframe's `contentDocument` once it has loaded and settled. Rejects on load
// error, timeout, or a cross-origin `contentDocument` access that throws. The
// caller must call the returned `remove()` after it has finished measuring (the
// iframe must stay mounted while rects are read); a failure removes it itself.
function loadIframeDoc(url, w, h) {
    return new Promise(function (resolve, reject) {
        if (typeof document === 'undefined' || !document.body) {
            reject(new Error('no-host'));
            return;
        }
        const iframe = document.createElement('iframe');
        iframe.setAttribute('aria-hidden', 'true');
        iframe.setAttribute('tabindex', '-1');
        // Off-screen + hidden, with an explicit per-pass viewport so the guest's
        // responsive CSS resolves against the iframe's own width.
        iframe.style.position = 'fixed';
        iframe.style.left = '-10000px';
        iframe.style.top = '0';
        iframe.style.visibility = 'hidden';
        iframe.style.width = w + 'px';
        iframe.style.height = h + 'px';

        let settled = false;
        let timer = null;
        const remove = function () {
            if (timer) { clearTimeout(timer); timer = null; }
            if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        };
        const fail = function (reason) {
            if (settled) return;
            settled = true;
            remove();
            reject(new Error(reason || 'load-failed'));
        };

        iframe.addEventListener('error', function () { fail('load-error'); });
        iframe.addEventListener('load', function () {
            // Double rAF + settle delay so late layout paints before we measure.
            raf(function () {
                raf(function () {
                    setTimeout(function () {
                        if (settled) return;
                        let doc = null;
                        // A cross-origin page throws here — treat it as unreachable.
                        try { doc = iframe.contentDocument; } catch (e) { doc = null; }
                        if (!doc || !doc.body) { fail('no-document'); return; }
                        settled = true;
                        if (timer) { clearTimeout(timer); timer = null; }
                        resolve({ doc: doc, remove: remove });
                    }, SETTLE_MS);
                });
            });
        });

        timer = setTimeout(function () { fail('timeout'); }, HARD_TIMEOUT_MS);
        iframe.src = url;
        document.body.appendChild(iframe);
    });
}

// Capture a guest repo's deployed layout into its per-repo buckets. Loads the
// deployed page twice (mobile then desktop), walks each with `buildUiTree`, and
// writes the discovered regions' measured rects + the handle tree via
// `captureSnapshot`. Resolves `{ ok: true, passes }` on success, or
// `{ ok: false, reason }` when the page can't be reached — in which case any
// prior capture is left untouched (the common failure fails on the first pass,
// before anything is written). `opts.onProgress(msg)` receives status text;
// `opts.loadDoc` overrides the iframe loader (used by tests).
export function captureRemote(repo, opts) {
    opts = opts || {};
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
    const loadDoc = typeof opts.loadDoc === 'function' ? opts.loadDoc : loadIframeDoc;

    const url = pagesUrlFor(repo);
    if (!url) return Promise.resolve({ ok: false, reason: 'bad-repo' });

    onProgress('Measuring deployed site…');

    let index = 0;
    let captured = 0;
    const runPass = function () {
        if (index >= PASSES.length) return { ok: true, passes: captured };
        const pass = PASSES[index++];
        return Promise.resolve()
            .then(function () { return loadDoc(url, pass.w, pass.h); })
            .then(function (handle) {
                if (!handle || !handle.doc) {
                    if (handle && typeof handle.remove === 'function') handle.remove();
                    throw new Error('no-document');
                }
                try {
                    const tree = buildUiTree(handle.doc);
                    captureSnapshot(tree, repo, {
                        doc: handle.doc,
                        bucket: pass.bucket,
                        viewport: { w: pass.w, h: pass.h },
                    });
                    captured++;
                } finally {
                    if (typeof handle.remove === 'function') handle.remove();
                }
                return runPass();
            });
    };

    return Promise.resolve()
        .then(runPass)
        .catch(function () { return { ok: false, reason: 'unreachable' }; });
}
