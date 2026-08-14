// The Structure tab's UI lens, for the app's own repo, drops the flat handle
// tree in favour of a two-part drillable view: a block canvas on top and the
// familiar container tree below, both scoped to the same drill level. This
// module owns everything above the tree — the snapshot cache the block
// proportions are measured from, the drill path, the breadcrumb, and the block
// canvas itself. A selection's measured dims, its visibility, and the Locate
// action live in `structureView.js`'s shared action toolbar (fed by the
// `snapshotMetaFor` / `canLocate` / `locateHandle` helpers here), not a separate
// detail bar. `structureView.js` renders the container tree (reusing its existing
// region-row styling) and calls into here, passing the handle tree it already
// walked from the DOM plus a select callback so the two panes stay in sync
// without this module reaching back into the view or the data model.
//
// The pane has a second rendering of the same region model: a LIVE view that
// swaps the block canvas for the repo's deployed page in a same-origin iframe
// with the tappable region overlay drawn over it. The `Live` chip in the snapshot
// chip row toggles between the two; see the LIVE VIEW MODE section below.
//
// Repo gating: the self repo (`rsterenchak/toDoList_TOP`) always renders — it's the
// one repo whose live DOM is available to measure. A linked repo renders too, but
// only once it has captured geometry stored (buckets + a handle tree); until then
// it keeps the UI lens's existing tree-only rendering. Snapshots are keyed per repo
// so one repo's capture never bleeds into another's.

// The UI lens also offers a LIVE rendering of the same region model — the repo's
// deployed page in a visible same-origin iframe with the region overlay painted
// over it — so `pagesUrlFor` (the deployed-Pages URL convention) and `buildUiTree`
// (the region-discovery walk) are reused here rather than re-derived. Both are
// only ever called at render time, so the import cycles they close with those
// modules resolve through hoisted function declarations.
import { pagesUrlFor } from './structureRemoteCapture.js';
import { buildUiTree } from './structureView.js';

// The one repo whose own DOM this canvas can measure and drill.
export const SELF_REPO = 'rsterenchak/toDoList_TOP';

// The "Locate" action switches back to Tasks View. The switch itself
// (main.js's `applyActiveView`) is registered here at bootstrap rather than
// imported, so this leaf module never has to import the heavy main.js entry (which
// would form a load-bearing cycle and pull main's bootstrap into tests). Unset
// until main.js registers it; locate then just skips the view switch.
let locateTabSwitch = null;
export function setLocateTabSwitch(fn) {
    locateTabSwitch = typeof fn === 'function' ? fn : null;
}

// Overlay / fixed-position handles that sit outside the container flow: they are
// never canvas blocks and always read as ghosts (tree-only) when measured.
const OVERLAY_IDS = {
    bottomSheet: 1,
    sidebarOverlay: 1,
    claudeSheet: 1,
    claudeSheetBackdrop: 1,
    companion: 1,
    projectPickerDropdown: 1,
};

// How many level-1 children a parent block previews as faint mini-outlines.
const MINI_PREVIEW_CAP = 8;

// Long-press duration (ms) and the movement slop (px) that cancels it.
const LONGPRESS_MS = 450;
const LONGPRESS_SLOP = 8;

// ── SNAPSHOT CACHE (per-viewport buckets) ──────────────────────────────────────
// The layout the block canvas measures from is captured per breakpoint into two
// buckets — `mobile` (viewport < 1024px) and `desktop` (≥ 1024px), matching the
// app's `isMobile()` convention — so a phone can still render (and view via the
// toggle) a desktop layout captured earlier on a desktop, and vice-versa. Each
// bucket holds `selector → { rect: {x, y, width, height}, visible }` plus the
// capture timestamp and the viewport size it was captured at. Buckets persist to
// localStorage under the `todoapp_` prefix, so a fresh page load rehydrates any
// previously-captured view even before the first live capture.

// Below this width a viewport is the `mobile` bucket; at or above it, `desktop`.
const MOBILE_MAX = 1024;

// Snapshots are keyed by repo: each repo owns a { mobile, desktop } pair of buckets
// persisted under `todoapp_structureSnapshot_<encodeURIComponent(repo)>_<bucket>`,
// plus a sibling `todoapp_structureTree_<encodeURIComponent(repo)>` holding the
// handle tree a guest canvas renders from (the self repo rebuilds its tree from the
// live DOM every render, so it never reads the stored tree). This lets a linked
// repo that has captured geometry mount the same block canvas.
const SNAPSHOT_KEY_PREFIX = 'todoapp_structureSnapshot_';
const TREE_KEY_PREFIX = 'todoapp_structureTree_';

// The legacy single-pair keys (pre per-repo). Migrated once into the self repo's
// entry on first hydrate, then removed.
const LEGACY_BUCKET_STORAGE = {
    mobile: 'todoapp_structureSnapshot_mobile',
    desktop: 'todoapp_structureSnapshot_desktop',
};

function bucketStorageKey(repo, bucket) {
    return SNAPSHOT_KEY_PREFIX + encodeURIComponent(repo) + '_' + bucket;
}
function treeStorageKey(repo) {
    return TREE_KEY_PREFIX + encodeURIComponent(repo);
}

function emptyBucket() {
    return { at: null, viewport: null, handles: new Map() };
}
function emptyRepoEntry() {
    return { mobile: emptyBucket(), desktop: emptyBucket() };
}

// Per-repo snapshot store: repo → { mobile, desktop }. Populated lazily by
// `hydrateRepo` (from localStorage) and by `captureSnapshot` (live measure).
const store = new Map();
// Repos whose localStorage has been read into `store` (hydrate once per repo).
const hydratedRepos = new Set();
// The repo the canvas is currently rendering; every active* read resolves against
// this repo's entry. Set by `renderStructureCanvas`, defaults to the self repo so a
// bare `captureSnapshot` (self-only caller) lands in the self entry.
let activeRepo = SELF_REPO;

// The bucket the toggle has explicitly selected for rendering, or null to track
// the current viewport. Reset on repo switch / canvas reset.
let selectedBucketKey = null;

// One-time migration guard: run before the first hydrate of any repo.
let legacyMigrated = false;

// The bucket key for the current live viewport.
function currentViewportKey() {
    const w = (typeof window !== 'undefined' && window.innerWidth) || MOBILE_MAX;
    return w < MOBILE_MAX ? 'mobile' : 'desktop';
}

function viewportSize() {
    const w = (typeof window !== 'undefined' && window.innerWidth) || MOBILE_MAX;
    const h = (typeof window !== 'undefined' && window.innerHeight) || 768;
    return { w: w, h: h };
}

// Whether the given bucket of the ACTIVE repo holds captured handles.
function bucketHasData(key) {
    const b = repoEntry(activeRepo)[key];
    return !!(b && b.handles && b.handles.size > 0);
}

// Whether a repo (either bucket) has captured geometry — drives the guest mount guard.
function repoHasAnyData(repo) {
    const entry = repoEntry(repo);
    return !!((entry.mobile.handles && entry.mobile.handles.size > 0)
        || (entry.desktop.handles && entry.desktop.handles.size > 0));
}

// The bucket currently rendered: an explicit toggle choice when set, otherwise
// the current viewport's bucket — falling back to whichever bucket has data so a
// device viewing only the other bucket's capture still renders something.
function activeBucketKey() {
    hydrateRepo(activeRepo);
    if (selectedBucketKey) return selectedBucketKey;
    const vp = currentViewportKey();
    if (bucketHasData(vp)) return vp;
    const other = vp === 'mobile' ? 'desktop' : 'mobile';
    if (bucketHasData(other)) return other;
    return vp;
}

function activeHandles() {
    return repoEntry(activeRepo)[activeBucketKey()].handles;
}

function activeAt() {
    return repoEntry(activeRepo)[activeBucketKey()].at;
}

function activeViewport() {
    return repoEntry(activeRepo)[activeBucketKey()].viewport;
}

// Storage access, guarded — localStorage can be absent or throw (private mode,
// quota). A failure just means this run behaves as ephemeral.
function readStorage(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
}
function writeStorage(key, val) {
    try { window.localStorage.setItem(key, val); } catch (e) { /* unavailable / quota */ }
}
function removeStorage(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* unavailable */ }
}

// Return the active in-memory entry for a repo, hydrating it from localStorage on
// first access.
function repoEntry(repo) {
    return hydrateRepo(repo || activeRepo);
}

// Move the two legacy single-pair keys into the self repo's per-repo keys once,
// then remove them (read legacy → write new → remove legacy) so existing captures
// survive the switch to per-repo storage. Never overwrites an already-migrated new
// key. Runs once per module lifetime, before the first hydrate.
function migrateLegacyKeys() {
    if (legacyMigrated) return;
    legacyMigrated = true;
    ['mobile', 'desktop'].forEach(function (bucket) {
        const raw = readStorage(LEGACY_BUCKET_STORAGE[bucket]);
        if (raw == null) return;
        const newKey = bucketStorageKey(SELF_REPO, bucket);
        if (readStorage(newKey) == null) writeStorage(newKey, raw);
        removeStorage(LEGACY_BUCKET_STORAGE[bucket]);
    });
}

// Rehydrate one repo's buckets from localStorage, once per repo. Guards JSON.parse
// and the expected shape; a corrupt payload is discarded so a fresh capture
// repopulates it (never render a canvas from a half-parsed bucket).
function hydrateRepo(repo) {
    migrateLegacyKeys();
    if (hydratedRepos.has(repo)) return store.get(repo);
    hydratedRepos.add(repo);
    const entry = emptyRepoEntry();
    ['mobile', 'desktop'].forEach(function (key) {
        const raw = readStorage(bucketStorageKey(repo, key));
        if (!raw) return;
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
        if (!parsed || typeof parsed !== 'object' || !parsed.handles || typeof parsed.handles !== 'object') {
            removeStorage(bucketStorageKey(repo, key));
            return;
        }
        const handles = new Map();
        Object.keys(parsed.handles).forEach(function (sel) {
            const h = parsed.handles[sel];
            if (h && typeof h === 'object') handles.set(sel, { rect: h.rect || null, visible: !!h.visible });
        });
        entry[key] = {
            at: parsed.capturedAt ? new Date(parsed.capturedAt) : null,
            viewport: (parsed.viewport && typeof parsed.viewport === 'object') ? parsed.viewport : null,
            handles: handles,
        };
    });
    store.set(repo, entry);
    return entry;
}

// Persist one repo bucket to localStorage in the documented JSON shape:
// { capturedAt, viewport: { w, h }, handles: { selector: { rect, visible } } }.
function persistBucket(repo, key) {
    const b = repoEntry(repo)[key];
    if (!b) return;
    const handles = {};
    b.handles.forEach(function (v, sel) { handles[sel] = { rect: v.rect, visible: v.visible }; });
    const payload = {
        capturedAt: b.at ? b.at.toISOString() : null,
        viewport: b.viewport || null,
        handles: handles,
    };
    try { writeStorage(bucketStorageKey(repo, key), JSON.stringify(payload)); } catch (e) { /* skip on serialize failure */ }
}

// Persist / load a repo's handle tree — the structure a guest canvas renders from.
// The self repo rebuilds its tree from the live DOM every render, so it never reads
// this back; it's stored so a linked repo's canvas has a tree to walk.
function persistTree(repo, tree) {
    try { writeStorage(treeStorageKey(repo), JSON.stringify(tree || [])); } catch (e) { /* skip on serialize failure */ }
}
function loadTree(repo) {
    const raw = readStorage(treeStorageKey(repo));
    if (!raw) return null;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { return null; }
    return Array.isArray(parsed) ? parsed : null;
}
// The handle tree of the most recent render / capture, so the ↻ chip can
// re-measure without the view re-walking the DOM.
let lastTree = [];

// Region nodes only — collapsed "× N rows" placeholders aren't containers.
function regionChildren(node) {
    const kids = (node && node.children) || [];
    return kids.filter(function (c) { return c && c.type === 'region'; });
}

// Walk a handle tree, resolving each region node's selector to a live element
// and recording its bounding rect + on-screen flag. `partial` keeps a prior
// measurement for any handle that doesn't currently resolve or is off-screen
// (used by the ↻ re-measure, which may run while Tasks View is backgrounded and
// its elements are display:none) so a refresh never wipes good rects with zeros.
// `opts` may also carry `doc` — the document to resolve selectors in, so a
// remote (guest) capture measures the deployed page loaded in a hidden iframe
// rather than the host `document` — and `bucket` / `viewport`, which force the
// target bucket and recorded viewport (a remote capture sizes its iframe to a
// breakpoint the host window is unrelated to, so it can't infer the bucket from
// `window.innerWidth`). All three default to the live self-repo behavior.
export function captureSnapshot(tree, repo, opts) {
    const targetRepo = repo || activeRepo;
    const entry = hydrateRepo(targetRepo);
    const partial = !!(opts && opts.partial);
    const doc = (opts && opts.doc) || null;
    // A capture writes to the bucket for the current LIVE viewport — never the
    // toggle-selected one — so measuring on a phone can only fill the mobile
    // bucket. A remote capture overrides this with an explicit `bucket` (it sized
    // its iframe to that breakpoint). A partial re-measure starts from the existing
    // bucket's rects so it never wipes good geometry with zeros for backgrounded
    // handles.
    const key = (opts && (opts.bucket === 'mobile' || opts.bucket === 'desktop'))
        ? opts.bucket
        : currentViewportKey();
    const viewport = (opts && opts.viewport) || viewportSize();
    const next = partial ? new Map(entry[key].handles) : new Map();
    const visit = function (nodes) {
        (nodes || []).forEach(function (node) {
            if (!node || node.type !== 'region' || !node.selector) return;
            const measured = measureSelector(node.selector, doc);
            if (measured) {
                next.set(node.selector, measured);
            } else if (!partial) {
                // Full capture records unresolved handles as ghosts (no rect);
                // partial capture leaves any prior entry untouched.
                next.set(node.selector, { rect: null, visible: false });
            }
            visit(regionChildren(node));
        });
    };
    visit(tree);
    // Commit-time guard against a degenerate full capture. On the mobile
    // Tasks→Structure view switch (`captureStructureSnapshot` in structureView.js)
    // the app's regions are measured the instant the user leaves Tasks View, but on
    // mobile their layout container is already collapsed/not-yet-laid-out at that
    // instant — so the root (`#outerContainer`) measures real but every descendant
    // region comes back 0×0 and classifies as a ghost, leaving the drilled canvas
    // empty. The `partial` path protects prior rects from being overwritten with
    // zeros, but a first full capture has no prior rects to keep, so the zeros would
    // commit and become the canvas. Reject a full capture whose root measured
    // non-zero but where no kept (non-root, non-overlay) region measured a real rect:
    // leave any prior bucket untouched and don't create one from the garbage.
    if (!partial) {
        const rootSelectors = new Set(
            (tree || [])
                .filter(function (n) { return n && n.type === 'region' && n.selector; })
                .map(function (n) { return n.selector; })
        );
        const isReal = function (snap) {
            return !!(snap && snap.rect && snap.rect.width > 0 && snap.rect.height > 0);
        };
        let rootReal = false;
        let keptCount = 0;
        let keptReal = 0;
        next.forEach(function (snap, selector) {
            if (rootSelectors.has(selector)) {
                if (isReal(snap)) rootReal = true;
                return;
            }
            if (isOverlaySelector(selector)) return;
            keptCount++;
            if (isReal(snap)) keptReal++;
        });
        // Conservative: only trip when the root measured but essentially nothing
        // inside did (at least one kept region present, none with a real rect), so a
        // legitimately sparse layout with even one real child still commits.
        if (rootReal && keptCount > 0 && keptReal === 0) {
            return entry[key].handles;
        }
    }
    entry[key] = { at: new Date(), viewport: viewport, handles: next };
    lastTree = tree || [];
    persistBucket(targetRepo, key);
    // Store the tree too, so a guest repo canvas has a structure to render from.
    persistTree(targetRepo, tree || []);
    return entry[key].handles;
}

// Measure one selector, or null when it doesn't resolve. Resolves against `doc`
// when given (a remote iframe's document), else the host `document`. A zero-size
// element still measures (its rect is 0×0) but reads as not-visible below.
function measureSelector(selector, doc) {
    const root = doc || (typeof document !== 'undefined' ? document : null);
    if (!root) return null;
    let el = null;
    try { el = root.querySelector(selector); } catch (e) { el = null; }
    if (!el) return null;
    let rect = { x: 0, y: 0, width: 0, height: 0 };
    try {
        const r = el.getBoundingClientRect();
        rect = { x: r.left || 0, y: r.top || 0, width: r.width || 0, height: r.height || 0 };
    } catch (e) { /* jsdom / detached — keep zeros */ }
    const visible = rect.width > 0 && rect.height > 0;
    return { rect: rect, visible: visible };
}

// Snapshot metadata for tests / callers: capture time and how many handles it
// covers.
export function getSnapshotInfo() {
    return { at: activeAt(), size: activeHandles().size };
}

// A handle is a ghost — never a canvas block — when it's an overlay id, or its
// snapshot entry is missing / off-screen / zero-size.
export function isGhostSelector(selector) {
    if (isOverlaySelector(selector)) return true;
    const snap = activeHandles().get(selector);
    if (!snap || !snap.visible || !snap.rect) return true;
    return !(snap.rect.width > 0 && snap.rect.height > 0);
}

function isOverlaySelector(selector) {
    if (typeof selector !== 'string' || selector.charAt(0) !== '#') return false;
    return !!OVERLAY_IDS[selector.slice(1)];
}

// ── DRILL + SELECTION STATE ───────────────────────────────────────────────────

// Selectors from the top level down to the current container ([] = top level).
let drillPath = [];
// The selector of the currently-selected handle, or null.
let selectedSelector = null;

// Live render context (host element + tree + callbacks), so drill / breadcrumb /
// refresh can rebuild the pane in place without the view re-rendering.
let ctx = null;
let paneEl = null;

// Reset drill + selection (a repo switch drops the prior repo's state).
export function resetCanvasState() {
    exitLiveView();
    liveError = '';
    drillPath = [];
    selectedSelector = null;
    selectedBucketKey = null;
    activeRepo = SELF_REPO;
}

// ── LIVE VIEW MODE ────────────────────────────────────────────────────────────
// A second rendering of the SAME region model the block canvas draws: instead of
// abstracted proportions, the repo's deployed page is loaded into a visible
// same-origin iframe and the tappable region overlay is painted on top of it. The
// `Live` chip in the snapshot chip row swaps the pane between the two, and two
// floating pills decide whether taps select regions (inspect) or reach the guest
// page (interact). Selection routes through the same `onSelect` callback a block
// tap uses, so the shared action toolbar's Reference / Copy selector work
// identically in both renderings.
//
// The mode is SESSION-ONLY — never written to prefs — and every Structure open
// starts on the canvas, so no iframe ever loads without an explicit tap. Every
// exit path (the chip, a lens switch, a repo switch, leaving the tab) runs the
// full teardown below, so a guest page's timers and service worker can't idle in
// a hidden iframe. A same-repo, same-lens REPAINT is not an exit: it suspends the
// mode (teardown without the flag reset) so the rebuilt pane remounts the frame.

// Hard ceiling on the live page's first load: a page that never fires `load`
// reverts to canvas mode rather than leaving an empty frame on screen.
const LIVE_LOAD_TIMEOUT_MS = 10000;
// The unreachable copy, matching the deployed-capture flow's own status line.
const LIVE_UNREACHABLE = 'Couldn’t reach a deployed site for this repo.';
// The guest's VIRTUAL viewport width. A phone host measures ~360 CSS px, which is
// narrower than the guest page's own natural mobile viewport, so laying the guest
// out at the wrapper's width clips fixed-width clusters at the right edge. The
// frame is instead held at this width — the same 390 the deployed capture flow's
// mobile pass uses — and the whole thing is scaled down to fit. Hosts at or above
// 390 (the desktop detail column) never scale.
const LIVE_VIRTUAL_W = 390;

// Whether the pane is currently rendering the live view.
let liveMode = false;
// false = inspect (the default: taps select regions), true = interact (taps reach
// the guest page and the overlay is hidden).
let liveInteract = false;
// Set when the guest document can't be reached (a page that isn't truly
// same-origin throws on `contentDocument`): inspect is disabled and the view
// falls back to interact-only.
let liveInspectBlocked = false;
// Failure copy shown in CANVAS mode after a live load couldn't be reached.
let liveError = '';
// Live DOM handles held for teardown.
let liveFrame = null;
let liveLayer = null;
// The scaler wrapping BOTH the frame and the overlay — what carries the
// scale-to-fit transform on narrow hosts.
let liveScaler = null;
let liveWin = null;
let liveScrollHandler = null;
let liveResizeHandler = null;
let liveLoadTimer = null;

// The deployed URL the live iframe loads, cache-busted so a fresh deploy is what
// mounts rather than a cached revision. Null when the repo has no Pages URL.
function liveUrl(repo) {
    const base = pagesUrlFor(repo);
    return base ? base + '?v=' + Date.now() : null;
}

// A repo's bare name for the live label (`owner/name` → `name`).
function shortRepoName(repo) {
    const parts = String(repo || '').split('/');
    return parts[parts.length - 1] || String(repo || '');
}

// Drop every live-view resource: the guest scroll listener, the host resize
// listener, the pending load timer, and the iframe itself. Idempotent, so a
// rebuild can call it unconditionally before emptying the pane.
function teardownLive() {
    if (liveLoadTimer) { clearTimeout(liveLoadTimer); liveLoadTimer = null; }
    if (liveWin && liveScrollHandler) {
        try { liveWin.removeEventListener('scroll', liveScrollHandler); } catch (e) { /* already gone */ }
    }
    if (liveResizeHandler && typeof window !== 'undefined') {
        window.removeEventListener('resize', liveResizeHandler);
    }
    if (liveFrame && liveFrame.parentNode) liveFrame.parentNode.removeChild(liveFrame);
    if (liveScaler && liveScaler.parentNode) liveScaler.parentNode.removeChild(liveScaler);
    liveFrame = null;
    liveLayer = null;
    liveScaler = null;
    liveWin = null;
    liveScrollHandler = null;
    liveResizeHandler = null;
}

// Drop the live view's DOM and resources WITHOUT leaving live mode: the iframe,
// its listeners, and the pending load timer go, but `liveMode` / `liveInteract` /
// `liveInspectBlocked` survive, so the next `rebuild()` re-enters the live branch
// and remounts the frame. This is what a repaint of the SAME repo's UI lens uses —
// most often a late async continuation (the published-map fetch resolving after
// the user tapped Live) that re-mounts the pane and would otherwise silently drop
// the user back to the block canvas seconds after they entered live view.
export function suspendLiveView() {
    teardownLive();
}

// Leave live mode entirely — full teardown plus a reset of the per-session mode
// flags. Does NOT repaint: every caller either rebuilds the pane itself (the chip)
// or is about to throw the whole host away (a lens/repo switch, leaving the tab).
export function exitLiveView() {
    teardownLive();
    liveMode = false;
    liveInteract = false;
    liveInspectBlocked = false;
}

// The repo whose live view is currently mounted, or null in canvas mode. Lets the
// view layer tell a same-repo repaint (suspend) from a real exit (lens switch,
// repo switch, leaving the tab) without reaching into the mode flags.
export function liveViewRepo() {
    return liveMode ? activeRepo : null;
}

// The live page couldn't be reached (load error, or no load within the ceiling):
// surface the capture flow's own copy and drop back to the block canvas.
function failLive() {
    liveError = LIVE_UNREACHABLE;
    exitLiveView();
    rebuild();
}

// The live view's failure line, rendered in canvas mode after a failed load.
// Reuses the deployed-capture status classes so copy and tone match that flow.
function buildLiveErrorLine() {
    if (!liveError) return null;
    const line = document.createElement('div');
    line.className = 'structureCaptureStatus structureCaptureStatus--error';
    line.textContent = liveError;
    return line;
}

// The `Live` chip: swaps the pane between the block canvas and the deployed page.
// Present for BOTH repos whenever the active repo resolves to a deployed Pages URL
// (the self repo shows its own deployed build, which is allowed). Null otherwise,
// so a repo with no Pages convention simply never offers the mode.
function buildLiveChip() {
    if (!pagesUrlFor(activeRepo)) return null;
    const btn = document.createElement('button');
    btn.type = 'button';
    // Its own class, not the Capture button's: the two share a look (one CSS rule
    // lists both) but are distinct affordances, so neither can be found by the
    // other's selector.
    btn.className = 'structureCanvasLiveChip';
    if (liveMode) btn.classList.add('is-live');
    btn.textContent = 'Live';
    btn.title = liveMode ? 'Back to the block canvas' : 'Show the deployed page';
    btn.setAttribute('aria-pressed', liveMode ? 'true' : 'false');
    btn.setAttribute('aria-label', liveMode
        ? 'Show the block canvas'
        : 'Show the live deployed page');
    btn.addEventListener('click', function (event) {
        event.stopPropagation();
        if (liveMode) {
            exitLiveView();
        } else {
            teardownLive();
            liveMode = true;
            liveInteract = false;
            liveInspectBlocked = false;
            liveError = '';
        }
        rebuild();
    });
    return btn;
}

// The live viewport: the deployed page in a same-origin iframe, the region overlay
// over it, the inspect / interact pills floating top-right inside the wrapper, and
// a muted notice line for the interact-only fallback. The wrapper's own sizing is
// CSS's job — it fills the host width, takes a viewport-proportional height
// inline, and absorbs the detail column at desktop widths — with the guest page
// scrolling INSIDE the iframe. Inside it, the frame and the overlay share a
// SCALER element, which is what `applyLiveScale` shrinks on narrow hosts.
function buildLiveViewport() {
    const wrap = document.createElement('div');
    wrap.className = 'structureLiveViewport';

    // The frame and the overlay live together in here so a scale on narrow hosts
    // moves both at once: region rects and the scroll-sync translate stay in
    // guest-document units with no per-rect math.
    const scaler = document.createElement('div');
    scaler.className = 'structureLiveScaler';
    liveScaler = scaler;

    const frame = document.createElement('iframe');
    frame.className = 'structureLiveFrame';
    frame.setAttribute('title', 'Deployed page for ' + activeRepo);
    liveFrame = frame;

    const overlay = document.createElement('div');
    overlay.className = 'structureLiveOverlay';
    const layer = document.createElement('div');
    layer.className = 'structureLiveOverlayLayer';
    overlay.appendChild(layer);
    liveLayer = layer;

    const notice = document.createElement('div');
    notice.className = 'structureLiveNotice';
    notice.hidden = true;

    scaler.appendChild(frame);
    scaler.appendChild(overlay);
    wrap.appendChild(scaler);
    wrap.appendChild(notice);
    wrap.appendChild(buildLivePills(notice));
    applyLiveInteraction(wrap);

    frame.addEventListener('load', function () {
        // A stale frame's late load (the pane rebuilt under it) must not repaint.
        if (liveFrame !== frame) return;
        if (liveLoadTimer) { clearTimeout(liveLoadTimer); liveLoadTimer = null; }
        attachLiveScroll();
        applyLiveScale();
        paintLiveOverlay(notice);
    });
    frame.addEventListener('error', function () {
        if (liveFrame === frame) failLive();
    });
    liveLoadTimer = setTimeout(function () {
        liveLoadTimer = null;
        if (liveFrame === frame) failLive();
    }, LIVE_LOAD_TIMEOUT_MS);

    // The overlay's boxes are measured against the guest's own layout, so a host
    // resize (which re-widths the iframe and reflows the guest) needs a re-walk —
    // preceded by a fresh scale, so a rotation or breakpoint re-home re-fits the
    // virtual viewport before the walk measures the guest at its new width.
    liveResizeHandler = function () { applyLiveScale(); paintLiveOverlay(notice); };
    if (typeof window !== 'undefined') window.addEventListener('resize', liveResizeHandler);

    const url = liveUrl(activeRepo);
    if (url) {
        frame.src = url;
    } else {
        // No deployed URL to load. Fail on the next tick rather than re-entering
        // the rebuild that is still assembling this pane.
        if (liveLoadTimer) clearTimeout(liveLoadTimer);
        liveLoadTimer = setTimeout(function () {
            liveLoadTimer = null;
            if (liveFrame === frame) failLive();
        }, 0);
    }
    return wrap;
}

// The live viewport wrapper the frame currently sits in, or null. The frame's own
// parent is the SCALER, so anything reaching for the wrapper (the interact class,
// the pills) must go up past it rather than take `liveFrame.parentNode`.
function liveWrapEl() {
    if (!liveFrame || typeof liveFrame.closest !== 'function') return null;
    return liveFrame.closest('.structureLiveViewport');
}

// Fit the guest's virtual viewport into the host wrapper. `k` is the wrapper's
// measured width over `LIVE_VIRTUAL_W`; the scaler is sized to the virtual
// viewport (390 × wrapperHeight / k) and scaled by `k` from its top-left, so its
// painted size is exactly the wrapper's box and nothing clips. `k` is never above
// 1 — a wrapper at or beyond 390 keeps the untransformed full-width layout — and
// an unmeasurable wrapper (width or height 0, e.g. a pane still detached from the
// document) is left untransformed too rather than collapsed to nothing.
function applyLiveScale() {
    if (!liveScaler) return;
    const wrap = liveWrapEl();
    const w = (wrap && wrap.clientWidth) || 0;
    const h = (wrap && wrap.clientHeight) || 0;
    if (!(w > 0 && h > 0 && w < LIVE_VIRTUAL_W)) {
        // Back to full width (a rotation to a wide host clears a prior scale).
        liveScaler.style.width = '';
        liveScaler.style.height = '';
        liveScaler.style.transform = '';
        return;
    }
    const k = w / LIVE_VIRTUAL_W;
    liveScaler.style.width = LIVE_VIRTUAL_W + 'px';
    liveScaler.style.height = (h / k) + 'px';
    liveScaler.style.transform = 'scale(' + k + ')';
}

// The two floating icon pills, absolutely positioned top-right INSIDE the wrapper
// — over the glass, so they stay reachable while the guest page scrolls beneath
// them. Inspect is active by default.
function buildLivePills(notice) {
    const pills = document.createElement('div');
    pills.className = 'structureLivePills';
    [
        { mode: 'inspect', glyph: '⌖', label: 'Inspect regions' },
        { mode: 'interact', glyph: '☞', label: 'Interact with the page' },
    ].forEach(function (spec) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'structureLivePill';
        btn.dataset.liveMode = spec.mode;
        btn.textContent = spec.glyph;
        btn.title = spec.label;
        btn.setAttribute('aria-label', spec.label);
        btn.addEventListener('click', function (event) {
            event.stopPropagation();
            const wantInteract = spec.mode === 'interact';
            if (!wantInteract && liveInspectBlocked) return;
            liveInteract = wantInteract;
            applyLiveInteraction(pills.parentNode);
            // Flipping back to inspect re-walks the guest, so the overlay matches
            // whatever the page became while it was being interacted with.
            if (!wantInteract) paintLiveOverlay(notice);
        });
        pills.appendChild(btn);
    });
    return pills;
}

// Apply the current inspect / interact choice: inspect leaves the overlay painted
// and hit-testable so taps select regions; interact hides it (and with it its
// pointer-events) so the guest page is fully usable.
function applyLiveInteraction(wrap) {
    if (!wrap) return;
    wrap.classList.toggle('is-interact', liveInteract);
    const overlay = wrap.querySelector('.structureLiveOverlay');
    if (overlay) overlay.hidden = liveInteract;
    Array.prototype.forEach.call(wrap.querySelectorAll('.structureLivePill'), function (pill) {
        const isInteract = pill.dataset.liveMode === 'interact';
        const on = isInteract === liveInteract;
        pill.classList.toggle('is-active', on);
        pill.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (isInteract) return;
        pill.disabled = liveInspectBlocked;
        pill.classList.toggle('is-disabled', liveInspectBlocked);
    });
}

// Set (or clear) the muted notice line inside the viewport.
function setLiveNotice(el, text) {
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
}

// Re-walk the guest document with the SAME region-discovery rules the canvas uses
// (`buildUiTree`) and repaint the overlay's outline boxes. Runs on iframe load, on
// every flip back to inspect, and on host resize. A `contentDocument` that throws
// or comes back empty means the page isn't reachable for inspection, so the view
// falls back to interact-only with a muted line rather than a dead inspect mode.
function paintLiveOverlay(notice) {
    if (!liveLayer || !liveFrame) return;
    let doc = null;
    try { doc = liveFrame.contentDocument; } catch (e) { doc = null; }
    if (!doc || !doc.body) {
        liveInspectBlocked = true;
        liveInteract = true;
        clear(liveLayer);
        applyLiveInteraction(liveWrapEl());
        setLiveNotice(notice, 'Can’t inspect this page — showing it interactively.');
        return;
    }
    liveInspectBlocked = false;
    setLiveNotice(notice, '');
    applyLiveInteraction(liveWrapEl());
    clear(liveLayer);
    let win = null;
    try { win = liveFrame.contentWindow; } catch (e) { win = null; }
    paintLiveRegions(buildUiTree(doc), doc, win);
    syncLiveScroll();
}

// One outline box per region the walk kept, in the canvas's outline vocabulary.
// Parents are visited before their children, so a nested region paints last and
// wins the tap — the innermost region under the finger is what gets selected.
function paintLiveRegions(nodes, doc, win) {
    const scrollX = (win && win.scrollX) || 0;
    const scrollY = (win && win.scrollY) || 0;
    const visit = function (list) {
        (list || []).forEach(function (node) {
            if (!node || node.type !== 'region' || !node.selector) return;
            const box = liveRectFor(node.selector, doc, scrollX, scrollY);
            if (box) liveLayer.appendChild(buildLiveRegionBox(node, box));
            visit(regionChildren(node));
        });
    };
    visit(nodes);
}

// A region's rect in guest-DOCUMENT coordinates (its viewport rect plus the
// guest's own scroll offset), or null when it has no on-screen box to outline.
function liveRectFor(selector, doc, scrollX, scrollY) {
    let el = null;
    try { el = doc.querySelector(selector); } catch (e) { el = null; }
    if (!el) return null;
    let r = null;
    try { r = el.getBoundingClientRect(); } catch (e) { return null; }
    if (!r || !(r.width > 0 && r.height > 0)) return null;
    return {
        x: (r.left || 0) + scrollX,
        y: (r.top || 0) + scrollY,
        width: r.width,
        height: r.height,
    };
}

function buildLiveRegionBox(node, box) {
    const el = document.createElement('div');
    el.className = 'structureLiveRegion';
    el.dataset.selector = node.selector;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', node.label + ' ' + node.selector);
    el.style.left = box.x + 'px';
    el.style.top = box.y + 'px';
    el.style.width = box.width + 'px';
    el.style.height = box.height + 'px';
    if (selectedSelector === node.selector) el.classList.add('is-selected');

    const label = document.createElement('span');
    label.className = 'structureLiveRegionLabel';
    label.textContent = node.label;
    el.appendChild(label);

    el.addEventListener('click', function (event) {
        event.stopPropagation();
        selectLiveRegion(node);
    });
    el.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectLiveRegion(node);
        }
    });
    return el;
}

// A live-overlay tap selects exactly as a canvas block tap does: mark the
// selection, re-mark the outlines, and mirror it onto the tree row + shared action
// toolbar through the view's onSelect callback. The descriptor is forced visible —
// only regions with a real on-screen box are outlined at all, so the snapshot
// bucket's ghost verdict (which may predate this render) doesn't apply.
function selectLiveRegion(node) {
    selectedSelector = node.selector;
    paintLiveSelection();
    if (ctx && typeof ctx.onSelect === 'function') ctx.onSelect(describe(node, true));
}

// Re-mark the overlay's outline boxes for the current selection. A selection
// change never moves geometry, so this never re-walks the guest.
function paintLiveSelection() {
    if (!liveLayer) return;
    Array.prototype.forEach.call(liveLayer.querySelectorAll('.structureLiveRegion'), function (el) {
        el.classList.toggle('is-selected', el.dataset.selector === selectedSelector);
    });
}

// Track the guest's internal scrolling. The overlay's boxes live in guest-document
// coordinates, so translating the layer by −scrollX/−scrollY keeps every outline
// pinned to its element as the page scrolls inside the iframe (same-origin, so the
// guest window's scroll events are readable).
function attachLiveScroll() {
    if (liveWin && liveScrollHandler) {
        try { liveWin.removeEventListener('scroll', liveScrollHandler); } catch (e) { /* already gone */ }
    }
    liveWin = null;
    liveScrollHandler = null;
    let win = null;
    try { win = liveFrame && liveFrame.contentWindow; } catch (e) { win = null; }
    if (!win || typeof win.addEventListener !== 'function') return;
    liveWin = win;
    liveScrollHandler = function () { syncLiveScroll(); };
    try { win.addEventListener('scroll', liveScrollHandler, { passive: true }); } catch (e) { liveScrollHandler = null; }
}

function syncLiveScroll() {
    if (!liveLayer) return;
    let x = 0;
    let y = 0;
    try {
        if (liveWin) { x = liveWin.scrollX || 0; y = liveWin.scrollY || 0; }
    } catch (e) { x = 0; y = 0; }
    liveLayer.style.transform = 'translate(' + (-x) + 'px, ' + (-y) + 'px)';
}

// The amber reload chip below the viewport: tears the iframe down and remounts it
// on a fresh cache-busting `?v=`, so a just-deployed change can be pulled in
// without leaving live mode.
function buildLiveReload() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'structureLiveReload';
    btn.textContent = 'reload';
    btn.title = 'Reload the deployed page';
    btn.setAttribute('aria-label', 'Reload the deployed page');
    btn.addEventListener('click', function (event) {
        event.stopPropagation();
        rebuild();
    });
    return btn;
}

// Resolve the current drill container from a tree + path, clamping a stale path
// (a handle that no longer exists) to its valid prefix. Returns the chain of
// drilled nodes and the direct region children to render as blocks.
function resolveDrill(tree, path) {
    const chain = [];
    let level = (tree || []).filter(function (n) { return n && n.type === 'region'; });
    for (let i = 0; i < path.length; i++) {
        const found = level.find(function (n) { return n.selector === path[i]; });
        if (!found) break;
        chain.push(found);
        level = regionChildren(found);
    }
    return { chain: chain, children: level };
}

// ── PASS-THROUGH (display:contents) HOISTING ──────────────────────────────────
// A `display:contents` container generates NO box of its own — its children
// render as if parented to ITS parent — so its captured rect is 0×0 while its
// region children keep real rects (they're geometrically parented to the
// boxless node's ancestor). Treating such a node as a normal ghost strands its
// children a level below an empty canvas. Instead detect the pass-through
// signature (boxless node + at least one region descendant with a real box) and
// make the node transparent: hoist its region children up to its level so the
// boxed descendants render where they visually belong, and the boxless node
// itself is neither drawn as a block nor listed in the ghost tray. A boxless
// node whose region descendants are ALSO boxless is genuinely hidden, not
// pass-through — it stays a ghost.

// Whether a selector has a real (non-zero) measured box in the active bucket.
function hasRealBox(selector) {
    const r = rectFor(selector);
    return !!(r && r.width > 0 && r.height > 0);
}

// Whether any region descendant of a node has a real box (recursing through
// nested boxless wrappers, so a chain of display:contents nodes still resolves).
function hasRealRegionDescendant(node) {
    return regionChildren(node).some(function (kid) {
        return hasRealBox(kid.selector) || hasRealRegionDescendant(kid);
    });
}

// A pass-through container: a boxless node (own rect 0×0 / missing) that has
// region children AND a real-boxed region descendant. Overlays and leaves never
// qualify.
function isPassthrough(node) {
    if (!node || node.type !== 'region' || !node.selector) return false;
    if (isOverlaySelector(node.selector)) return false;
    if (hasRealBox(node.selector)) return false;      // has its own box → normal
    if (!regionChildren(node).length) return false;   // leaf → nothing to hoist
    return hasRealRegionDescendant(node);
}

// Replace each pass-through node in a level's children with its own (recursively
// hoisted) region children, so a display:contents wrapper is transparent to the
// canvas. Non-pass-through nodes pass through unchanged.
function hoistPassthrough(children) {
    const out = [];
    (children || []).forEach(function (node) {
        if (isPassthrough(node)) {
            hoistPassthrough(regionChildren(node)).forEach(function (c) { out.push(c); });
        } else {
            out.push(node);
        }
    });
    return out;
}

// Find a node anywhere in the tree by selector, plus the drill path (list of
// selectors) that reaches its PARENT — used to drill the canvas so the node's
// own block is visible when a tree row is tapped.
function findParentPath(tree, selector) {
    let result = null;
    const walk = function (nodes, path) {
        (nodes || []).forEach(function (node) {
            if (result || !node || node.type !== 'region') return;
            if (node.selector === selector) { result = path.slice(); return; }
            walk(regionChildren(node), path.concat(node.selector));
        });
    };
    walk((tree || []).filter(function (n) { return n && n.type === 'region'; }), []);
    return result;
}

// ── RENDER ────────────────────────────────────────────────────────────────────

function clear(el) {
    while (el && el.firstChild) el.removeChild(el.firstChild);
}

// Mount the canvas pane at the top of `host` (the tree container). `opts` carries
// the handle tree and the sync callback:
//   • onSelect(descriptor) — a block selection, so the view can mirror it onto the
//     tree row + shared action toolbar.
// (`onReference` / `onViewCode` may also be passed for backward compatibility; the
// canvas no longer invokes them now that the detail bar's duplicate actions are
// gone — the toolbar's own Reference / Find in code cover them.)
//   • onRecapture() — the deployed-site capture trigger, rendered as the compact
//     "Capture" / "Re-capture" button in the snapshot chip for BOTH repos (a guest
//     has no live DOM, so this is its only capture; the self repo shows it beside
//     the live ↻ so a clean deployed measure is always reachable). Re-runs the
//     deployed-site iframe capture.
export function renderStructureCanvas(host, opts) {
    // Live mode is session-only: a repo switch (resetCanvasState) and leaving the
    // Structure tab (exitStructureLiveView) both run the full exit, so every
    // Structure open starts on the block canvas and no iframe loads without an
    // explicit tap. A re-mount for the SAME repo, though, is just this pane being
    // repainted — usually by a late async continuation — so it only suspends the
    // mode and lets rebuild() remount the frame, rather than reverting to canvas
    // under the user seconds after they tapped Live.
    if (liveMode && opts && opts.repo === activeRepo) suspendLiveView();
    else exitLiveView();
    if (!host || !opts || !opts.repo) return null;
    const repo = opts.repo;
    const isSelf = repo === SELF_REPO;
    // Self always mounts (it measures the live DOM); a guest mounts only when it has
    // captured geometry to render from — otherwise the UI lens keeps its tree-only
    // rendering, exactly as before.
    if (!isSelf && !repoHasAnyData(repo)) return null;
    activeRepo = repo;
    // The self repo rebuilds its tree from the live DOM each render; a guest has no
    // live DOM to walk, so it renders from the tree stored alongside its buckets
    // (falling back to any tree the caller passed).
    const tree = isSelf
        ? (opts.tree || [])
        : ((opts.tree && opts.tree.length) ? opts.tree : (loadTree(repo) || []));
    ctx = Object.assign({}, opts, { tree: tree });
    lastTree = tree;
    const pane = document.createElement('div');
    pane.className = 'structureCanvasPane';
    paneEl = pane;
    rebuild();
    host.insertBefore(pane, host.firstChild);
    // rebuild() ran while the pane was still detached, so a live view carried
    // through this render (a same-repo repaint) measures its wrapper only now.
    if (liveMode) applyLiveScale();
    return pane;
}

// Rebuild the pane's contents in place for the current drill path + selection.
function rebuild() {
    if (!paneEl || !ctx) return;
    // Every rebuild throws away the DOM the live iframe lives in, so drop its
    // listeners and unmount the frame before the pane is emptied. This is also
    // what makes the reload chip a plain rebuild: teardown then a fresh mount.
    teardownLive();
    clear(paneEl);

    // Live mode renders the same chip row over the deployed page + region overlay
    // instead of the breadcrumb / block canvas / ghost tray.
    if (liveMode) {
        paneEl.appendChild(buildSnapshotChip());
        paneEl.appendChild(buildLiveViewport());
        paneEl.appendChild(buildLiveReload());
        // The wrapper only has a measurable box once it is in the document, so the
        // scale-to-fit runs after the append (and again on load and on resize).
        applyLiveScale();
        return;
    }

    const tree = ctx.tree || [];
    // Clamp a stale drill path before rendering off it.
    const drill = resolveDrill(tree, drillPath);
    if (drill.chain.length < drillPath.length) {
        drillPath = drill.chain.map(function (n) { return n.selector; });
    }

    // Make display:contents wrappers transparent: a boxless pass-through child is
    // replaced by its real-boxed region children, hoisted to this level, so the
    // canvas draws the effective descendants instead of an empty level (and the
    // boxless node stays out of the ghost tray). A truly hidden boxless node keeps
    // its children boxless, so it isn't hoisted and remains a ghost.
    const effectiveChildren = hoistPassthrough(drill.children);

    // The self repo normalizes each level's blocks against their immediate drilled
    // parent (its nested box layout makes that geometrically correct). A guest's
    // deployed page uses absolute/negative layout where a child isn't contained by
    // its DOM parent, so every guest level normalizes against the ROOT captured box
    // instead — the coordinate space every stored rect already lives in.
    const parentBox = (activeRepo === SELF_REPO)
        ? parentBoxFor(drill.chain, effectiveChildren)
        : rootBoxFor(tree);

    paneEl.appendChild(buildSnapshotChip());
    paneEl.appendChild(buildBreadcrumb(drill.chain));
    paneEl.appendChild(buildCanvas(effectiveChildren, parentBox));
    const tray = buildGhostTray(effectiveChildren);
    if (tray) paneEl.appendChild(tray);
    const hint = buildEmptyBucketHint();
    if (hint) paneEl.appendChild(hint);
    // A live load that couldn't be reached reverted to this canvas — say why.
    const liveFailure = buildLiveErrorLine();
    if (liveFailure) paneEl.appendChild(liveFailure);
}

// The ghost tray, docked below the canvas: every ghost child at the current drill
// level (overlays, and anything with no on-screen box in the active bucket) gets a
// labeled chip so hidden containers are seen and selectable instead of silently
// filtered out. Returns null when the level has no ghost children, so no empty
// strip renders. Chips route tap/drill through the same handlers blocks use, so
// toolbar mirroring and two-way sync come for free.
function buildGhostTray(children) {
    const ghosts = (children || []).filter(function (n) {
        return n && n.type === 'region' && isGhostSelector(n.selector);
    });
    if (!ghosts.length) return null;

    const tray = document.createElement('div');
    tray.className = 'structureCanvasGhostTray';

    const caption = document.createElement('div');
    caption.className = 'structureCanvasGhostCaption';
    caption.textContent = 'Not in this layout';
    tray.appendChild(caption);

    const row = document.createElement('div');
    row.className = 'structureCanvasGhostRow';
    ghosts.forEach(function (node) {
        row.appendChild(buildGhostChip(node));
    });
    tray.appendChild(row);
    return tray;
}

// One ghost chip: the handle name + faint `#id`, an `is-selected` treatment that
// matches blocks, and — when the ghost nests region children — the same `»` drill
// chip a block gets. Tapping the chip selects the handle through the same
// `selectFromCanvas` path a block tap uses (mirroring onto the tree row + shared
// toolbar); the drill chip descends via `drillInto` (parent-box fallback handles a
// rect-less ghost).
function buildGhostChip(node) {
    const chip = document.createElement('div');
    chip.className = 'structureCanvasGhostChip';
    chip.dataset.selector = node.selector;
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    if (selectedSelector === node.selector) chip.classList.add('is-selected');

    const name = document.createElement('span');
    name.className = 'structureCanvasGhostName';
    name.textContent = node.label;
    chip.appendChild(name);

    const id = document.createElement('span');
    id.className = 'structureCanvasGhostId';
    id.textContent = node.selector;
    chip.appendChild(id);

    if (regionChildren(node).length) {
        const drill = document.createElement('button');
        drill.type = 'button';
        drill.className = 'structureCanvasDrillChip';
        drill.setAttribute('aria-label', 'Drill into ' + node.label);
        drill.title = 'Drill in';
        drill.textContent = '»';
        drill.addEventListener('click', function (event) {
            event.stopPropagation();
            drillInto(node.selector);
        });
        chip.appendChild(drill);
    }

    chip.addEventListener('click', function () { selectFromCanvas(node); });
    chip.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectFromCanvas(node);
        }
    });
    return chip;
}

// Helper text below the canvas naming any bucket that has never been captured,
// pointing the user at the device that would fill it. Null when both buckets
// hold a capture.
function buildEmptyBucketHint() {
    const missing = [];
    if (!bucketHasData('mobile')) missing.push('mobile');
    if (!bucketHasData('desktop')) missing.push('desktop');
    if (!missing.length) return null;
    const hint = document.createElement('div');
    hint.className = 'structureCanvasViewHint';
    hint.dataset.missing = missing.join(',');
    // Name the first missing bucket; both-missing is the pristine first-run state.
    hint.textContent = missing[0] === 'desktop'
        ? 'Open the app on desktop once to capture this view.'
        : 'Open the app on mobile once to capture this view.';
    return hint;
}

// The `captured <time> · ↻` chip plus the Mobile/Desktop bucket toggle. The
// timestamp reflects the SELECTED bucket's capture, not the live viewport. ↻
// re-measures the live DOM (partial, so a backgrounded Tasks View doesn't zero
// out good rects) into the live-viewport bucket and repaints. Beside it sits the
// single deployed-site capture control: one compact "Capture" / "Re-capture"
// button, present for BOTH repos whenever `ctx.onRecapture` is wired, labelled
// from whether the active bucket already holds geometry. The self repo therefore
// shows both the live ↻ (re-measures the on-screen DOM) and the deployed
// Capture/Re-capture button; a guest shows just the latter (it has no live DOM).
//
// The `Live` chip rides along at the end of the row whenever the active repo
// resolves to a deployed Pages URL. In live mode the row narrows to just the label
// (now naming the repo being shown) and that chip: the ↻, the Capture/Re-capture
// button, and the Mobile/Desktop bucket toggle all act on captured geometry, which
// a real pane-width render makes inert, so all three drop out.
function buildSnapshotChip() {
    const chip = document.createElement('div');
    chip.className = 'structureCanvasSnapChip';

    const label = document.createElement('span');
    label.className = 'structureCanvasSnapLabel';
    if (liveMode) {
        // Hard-truncated in CSS so a long repo name can't push the chip's own
        // controls off the row.
        label.classList.add('structureCanvasSnapLabel--live');
        label.textContent = 'live · ' + shortRepoName(activeRepo);
        chip.appendChild(label);
        const liveChip = buildLiveChip();
        if (liveChip) chip.appendChild(liveChip);
        return chip;
    }

    const at = activeAt();
    label.textContent = at
        ? 'captured ' + formatTime(at) + ' · '
        : 'not captured · ';
    chip.appendChild(label);

    // The ↻ re-measure reads the live DOM, so it only makes sense for the self repo;
    // a guest canvas renders from stored geometry and has no live DOM to re-measure.
    if (activeRepo === SELF_REPO) {
        const refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.className = 'structureCanvasSnapRefresh';
        refresh.setAttribute('aria-label', 'Re-measure the layout snapshot');
        refresh.title = 'Re-measure now';
        refresh.textContent = '↻';
        refresh.addEventListener('click', function (event) {
            event.stopPropagation();
            // Re-measure fills the live-viewport bucket; select it so the fresh
            // capture is what's shown even if the toggle was on the other bucket.
            captureSnapshot(lastTree, activeRepo, { partial: true });
            selectedBucketKey = currentViewportKey();
            rebuild();
        });
        chip.appendChild(refresh);
    }

    // The deployed-site capture control: one compact button, in the chip, for both
    // repos. Its label reflects state — "Capture" until the active bucket holds
    // geometry, then "Re-capture" — while its placement and style stay identical, so
    // the affordance sits in the same spot regardless of state or repo. Tapping it
    // runs the same deployed-site capture flow via `ctx.onRecapture`.
    if (ctx && typeof ctx.onRecapture === 'function') {
        const hasData = bucketHasData(activeBucketKey());
        const recapture = document.createElement('button');
        recapture.type = 'button';
        recapture.className = 'structureCanvasRecapture';
        recapture.setAttribute('aria-label', hasData
            ? 'Re-capture layout from the deployed site'
            : 'Capture layout from the deployed site');
        recapture.title = hasData ? 'Re-capture from deployed site' : 'Capture from deployed site';
        recapture.textContent = hasData ? 'Re-capture' : 'Capture';
        recapture.addEventListener('click', function (event) {
            event.stopPropagation();
            ctx.onRecapture();
        });
        chip.appendChild(recapture);
    }

    const liveChip = buildLiveChip();
    if (liveChip) chip.appendChild(liveChip);

    chip.appendChild(buildViewToggle());
    return chip;
}

// The Mobile/Desktop segmented toggle. Each segment selects that bucket for
// rendering; a bucket with no capture is disabled (you can't view a view that
// was never measured on the matching device). Defaults to the current viewport.
function buildViewToggle() {
    const toggle = document.createElement('div');
    toggle.className = 'structureCanvasViewToggle';
    toggle.setAttribute('role', 'group');
    toggle.setAttribute('aria-label', 'Snapshot viewport');

    const active = activeBucketKey();
    [['mobile', 'Mobile'], ['desktop', 'Desktop']].forEach(function (pair) {
        const key = pair[0];
        const seg = document.createElement('button');
        seg.type = 'button';
        seg.className = 'structureCanvasViewSeg';
        seg.dataset.bucket = key;
        seg.textContent = pair[1];
        const has = bucketHasData(key);
        const isActive = active === key;
        if (isActive) seg.classList.add('is-active');
        seg.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        if (!has) {
            seg.classList.add('is-disabled');
            seg.disabled = true;
            seg.setAttribute('aria-disabled', 'true');
        }
        seg.addEventListener('click', function (event) {
            event.stopPropagation();
            if (!bucketHasData(key)) return;
            selectedBucketKey = key;
            rebuild();
        });
        toggle.appendChild(seg);
    });
    return toggle;
}

function formatTime(date) {
    try {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return date.toTimeString().slice(0, 5);
    }
}

// The breadcrumb row: an "App" root crumb then one crumb per drilled node,
// separated by `›`, with the current leaf accented. Each crumb navigates up to
// its level.
function buildBreadcrumb(chain) {
    const bar = document.createElement('div');
    bar.className = 'structureCanvasBreadcrumb';

    const crumbs = [{ label: 'App', depth: 0 }].concat(
        chain.map(function (node, i) { return { label: node.label, depth: i + 1 }; })
    );

    crumbs.forEach(function (crumb, i) {
        if (i > 0) {
            const sep = document.createElement('span');
            sep.className = 'structureCanvasCrumbSep';
            sep.setAttribute('aria-hidden', 'true');
            sep.textContent = '›';
            bar.appendChild(sep);
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'structureCanvasCrumb';
        if (i === crumbs.length - 1) btn.classList.add('structureCanvasCrumb--current');
        btn.textContent = crumb.label;
        btn.addEventListener('click', function (event) {
            event.stopPropagation();
            drillPath = drillPath.slice(0, crumb.depth);
            rebuild();
        });
        bar.appendChild(btn);
    });
    return bar;
}

// ── LAYOUT NORMALIZATION ──────────────────────────────────────────────────────
// Blocks are positioned true-to-layout: each child's snapshot rect is normalized
// to its parent box (the drilled container's rect, or the viewport at root) into
// `left/top/width/height` percentages, so size AND position match the captured
// layout rather than a flow guess.

// The snapshot rect for a selector in the active bucket, or null.
function rectFor(selector) {
    const snap = activeHandles().get(selector);
    return (snap && snap.rect) ? snap.rect : null;
}

// Positive rect area (0 when unmeasured), for paint ordering.
function rectArea(selector) {
    const r = rectFor(selector);
    return r ? Math.max(r.width, 0) * Math.max(r.height, 0) : 0;
}

// The viewport box for the active bucket as a rect, or null when uncaptured.
function viewportBox() {
    const vp = activeViewport();
    if (vp && vp.w > 0 && vp.h > 0) return { x: 0, y: 0, width: vp.w, height: vp.h };
    return null;
}

// The bounding union of a set of children's measured rects, or null when none
// measure. Used as a fallback parent box when a drilled node's own rect is gone.
function unionBox(children) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    (children || []).forEach(function (n) {
        const r = rectFor(n.selector);
        if (!r || !(r.width > 0 && r.height > 0)) return;
        if (r.x < minX) minX = r.x;
        if (r.y < minY) minY = r.y;
        if (r.x + r.width > maxX) maxX = r.x + r.width;
        if (r.y + r.height > maxY) maxY = r.y + r.height;
    });
    if (minX === Infinity) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// The root captured box a GUEST canvas normalizes every drill level against.
// A deployed page uses absolute positioning and negative margins, so a DOM child
// is NOT geometrically contained by its DOM parent — parent-relative
// normalization would clamp overflowing children into misaligned full-width
// bands, and the deeper the drill the worse the drift. But every stored rect is
// already in the root (`#app`) coordinate space, so a root-relative crop is what
// actually matches the page. The root box is the union of the top-level blocks'
// rects (the captured `#app` rect when the tree has a single mount-point root),
// falling back to the captured viewport. The self repo never uses this — its
// clean nested box layout makes parent-relative normalization correct.
function rootBoxFor(tree) {
    const top = resolveDrill(tree || [], []).children;
    return unionBox(top) || viewportBox() || { x: 0, y: 0, width: 1, height: 1 };
}

// The parent box a level's children are normalized against: the drilled
// container's own rect from the active bucket, falling back to the union of the
// children's rects, then the viewport. At the root (empty chain) it is the
// viewport box, with the same union fallback if the viewport is uncaptured.
function parentBoxFor(chain, children) {
    if (chain && chain.length) {
        const tail = chain[chain.length - 1];
        const r = rectFor(tail.selector);
        if (r && r.width > 0 && r.height > 0) return r;
        return unionBox(children) || viewportBox() || { x: 0, y: 0, width: 1, height: 1 };
    }
    return viewportBox() || unionBox(children) || { x: 0, y: 0, width: 1, height: 1 };
}

function clampPct(v) {
    if (!(v > 0)) return 0;
    if (v > 100) return 100;
    return v;
}

// Normalize a child rect to percentage left/top/width/height of a parent box,
// clamped to the 0–100 range (the canvas clips anything past the edge).
function normalizeRect(r, p) {
    return {
        left: clampPct(((r.x - p.x) / p.width) * 100),
        top: clampPct(((r.y - p.y) / p.height) * 100),
        width: clampPct((r.width / p.width) * 100),
        height: clampPct((r.height / p.height) * 100),
    };
}

// Below this percentage on BOTH axes a block is "tiny": its head text is hidden
// (the shared toolbar names it on tap) and it gets a small hit-area floor.
const TINY_PCT = 12;

// The block canvas: the current container's direct, non-ghost children absolutely
// positioned at their true relative rects within the parent box. An empty level
// (no measurable children) shows a gentle hint.
function buildCanvas(children, parentBox) {
    const canvas = document.createElement('div');
    canvas.className = 'structureCanvasBlocks';

    // Fit the canvas to the parent box's aspect ratio: at root this is the
    // selected snapshot's viewport shape; drilled levels take the drilled
    // container's true shape. The RENDERED height is capped in CSS so drilling
    // into a tall container (a scrollable body measures at its full content
    // height, which can be several screens tall) can't blow the canvas past a
    // viewable size: the `.structureCanvasBlocks` rule sets
    // `height: min(calc(100cqw * var(--structure-canvas-ratio)), 60vh, 680px)`
    // (the pane is an inline-size container, so `100cqw` is the pane width). We
    // feed it the parent box's true height/width ratio here. With `aspect-ratio`
    // still set to the TRUE box and `width: auto`, the width then derives from the
    // definite (possibly capped) height, so a capped level scales down without
    // distorting and stays horizontally centered. Wide/short levels never reach
    // the cap and render full-width exactly as before (height resolves to
    // `100cqw * ratio`, width back to `100cqw`). The ratio is a CSS custom
    // property rather than a full inline `min()` because the latter isn't
    // round-trippable through every DOM style engine.
    const p = parentBox || viewportBox() || { x: 0, y: 0, width: 1, height: 1 };
    if (p.width > 0 && p.height > 0) {
        canvas.style.aspectRatio = p.width + ' / ' + p.height;
        canvas.style.setProperty('--structure-canvas-ratio', String(p.height / p.width));
    }

    const blocks = children.filter(function (n) { return !isGhostSelector(n.selector); });
    if (!blocks.length) {
        const empty = document.createElement('div');
        empty.className = 'structureCanvasEmpty';
        empty.textContent = activeAt()
            ? 'No measurable blocks at this level.'
            : 'No layout captured yet — tap ↻ or return from Tasks View.';
        canvas.appendChild(empty);
        return canvas;
    }

    // Paint largest-first so small overlays (FAB, chips) sit on top of the big
    // containers they float over and stay tappable.
    const ordered = blocks.slice().sort(function (a, b) {
        return rectArea(b.selector) - rectArea(a.selector);
    });
    ordered.forEach(function (node) {
        canvas.appendChild(buildBlock(node, p));
    });
    return canvas;
}

// One block: elevated card absolutely positioned and sized from its snapshot rect
// normalized to `parentBox`, with the handle name + faint `#id`, mini-outlines of
// its level-1 children, and a `»` drill chip when it nests containers. Tap
// selects; the chip or a long-press drills.
function buildBlock(node, parentBox) {
    const block = document.createElement('div');
    block.className = 'structureCanvasBlock';
    block.dataset.selector = node.selector;
    block.setAttribute('role', 'button');
    block.setAttribute('tabindex', '0');
    if (selectedSelector === node.selector) block.classList.add('is-selected');

    const rect = rectFor(node.selector);
    if (rect && parentBox && parentBox.width > 0 && parentBox.height > 0) {
        const pos = normalizeRect(rect, parentBox);
        block.style.left = pos.left + '%';
        block.style.top = pos.top + '%';
        block.style.width = pos.width + '%';
        block.style.height = pos.height + '%';
        if (pos.width < TINY_PCT && pos.height < TINY_PCT) {
            block.classList.add('structureCanvasBlock--tiny');
        }
    }

    const head = document.createElement('div');
    head.className = 'structureCanvasBlockHead';

    const name = document.createElement('span');
    name.className = 'structureCanvasBlockName';
    name.textContent = node.label;
    head.appendChild(name);

    const id = document.createElement('span');
    id.className = 'structureCanvasBlockId';
    id.textContent = node.selector;
    head.appendChild(id);

    block.appendChild(head);

    const kids = regionChildren(node);
    if (kids.length) {
        block.appendChild(buildMiniPreview(kids, rect));

        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'structureCanvasDrillChip';
        chip.setAttribute('aria-label', 'Drill into ' + node.label);
        chip.title = 'Drill in';
        chip.textContent = '»';
        chip.addEventListener('click', function (event) {
            event.stopPropagation();
            drillInto(node.selector);
        });
        block.appendChild(chip);
    }

    wireBlockInteraction(block, node);
    return block;
}

// A faint, non-interactive peek of a block's level-1 children as mini-outlines,
// each absolutely positioned within the preview layer at its true relative rect
// (normalized against the parent block's own rect), matching the real layout.
function buildMiniPreview(kids, blockRect) {
    const preview = document.createElement('div');
    preview.className = 'structureCanvasMiniPreview';
    preview.setAttribute('aria-hidden', 'true');
    kids.slice(0, MINI_PREVIEW_CAP).forEach(function (kid) {
        const mini = document.createElement('div');
        mini.className = 'structureCanvasMini';
        const r = rectFor(kid.selector);
        if (r && blockRect && blockRect.width > 0 && blockRect.height > 0) {
            const pos = normalizeRect(r, blockRect);
            mini.style.left = pos.left + '%';
            mini.style.top = pos.top + '%';
            mini.style.width = pos.width + '%';
            mini.style.height = pos.height + '%';
        }
        preview.appendChild(mini);
    });
    return preview;
}

// Tap selects; a ~450ms long-press (cancelled by movement) drills. Keyboard:
// Enter/Space select.
function wireBlockInteraction(block, node) {
    let timer = null;
    let startX = 0;
    let startY = 0;
    let longFired = false;
    const canDrill = regionChildren(node).length > 0;

    const cancel = function () {
        if (timer) { clearTimeout(timer); timer = null; }
    };

    block.addEventListener('pointerdown', function (event) {
        longFired = false;
        startX = event.clientX || 0;
        startY = event.clientY || 0;
        if (!canDrill) return;
        cancel();
        timer = setTimeout(function () {
            timer = null;
            longFired = true;
            drillInto(node.selector);
        }, LONGPRESS_MS);
    });
    block.addEventListener('pointermove', function (event) {
        if (!timer) return;
        const dx = Math.abs((event.clientX || 0) - startX);
        const dy = Math.abs((event.clientY || 0) - startY);
        if (dx > LONGPRESS_SLOP || dy > LONGPRESS_SLOP) cancel();
    });
    block.addEventListener('pointerup', cancel);
    block.addEventListener('pointercancel', cancel);

    block.addEventListener('click', function () {
        // A long-press already acted — don't also select on the trailing click.
        if (longFired) { longFired = false; return; }
        selectFromCanvas(node);
    });
    block.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectFromCanvas(node);
        }
    });
}

function drillInto(selector) {
    drillPath = drillPath.concat(selector);
    selectedSelector = selector;
    rebuild();
    notifySelect(selector);
}

// Select a node from the canvas: mark it, repaint the pane, and mirror the
// selection onto the tree + shared toolbar via the view's onSelect callback.
function selectFromCanvas(node) {
    selectedSelector = node.selector;
    rebuild();
    notifySelect(node.selector);
}

function notifySelect(selector) {
    const node = nodeBySelector(lastTree, selector);
    if (node && ctx && typeof ctx.onSelect === 'function') {
        ctx.onSelect(describe(node));
    }
}

// Drill + select a handle chosen from the container tree (two-way sync): drill so
// its block is on-screen, then select it. No onSelect callback — the tree side
// initiated this, so echoing back would loop.
export function revealSelector(selector) {
    if (!ctx) return;
    selectedSelector = selector;
    // Live mode has no drill levels and its geometry comes from the guest page, so
    // mirroring a tree selection is just a re-mark — never a rebuild, which would
    // reload the iframe on every tree-row tap.
    if (liveMode) {
        paintLiveSelection();
        return;
    }
    const parentPath = findParentPath(ctx.tree || [], selector);
    if (parentPath) drillPath = parentPath;
    rebuild();
}

function nodeBySelector(tree, selector) {
    let found = null;
    const walk = function (nodes) {
        (nodes || []).forEach(function (node) {
            if (found || !node || node.type !== 'region') return;
            if (node.selector === selector) { found = node; return; }
            walk(regionChildren(node));
        });
    };
    walk((tree || []).filter(function (n) { return n && n.type === 'region'; }));
    return found;
}

// A selection descriptor the view can drive its toolbar / reference flow with —
// the same shape structureView's live rows produce. `visibleOverride` is set by
// the live view, whose outlines are painted only for regions with a real
// on-screen box in the deployed page (so the snapshot bucket's ghost verdict,
// which may predate that render, doesn't decide the flag).
function describe(node, visibleOverride) {
    return {
        kind: 'live',
        label: node.label,
        value: node.selector,
        copyLabel: 'Copy selector',
        // The active repo, not a hardcoded self — a guest canvas selection must
        // reframe Reference onto that guest repo, not the self repo.
        repo: activeRepo,
        file: null,
        line: null,
        visible: (visibleOverride === undefined) ? !isGhostSelector(node.selector) : !!visibleOverride,
    };
}

// Resolve a handle selector to its element in the CURRENT LIVE DOM — not the
// snapshot — returning it only when it has an on-screen box (width & height > 0,
// the same visibility test `measureSelector` uses). Null when the selector
// doesn't resolve or the element is hidden in the live viewport (e.g. `#sideBar`
// on mobile). Drives the Locate button's enabled/disabled gate.
function liveVisibleElement(selector) {
    let el = null;
    try { el = document.querySelector(selector); } catch (e) { el = null; }
    if (!el) return null;
    let visible = false;
    try {
        const r = el.getBoundingClientRect();
        visible = (r.width || 0) > 0 && (r.height || 0) > 0;
    } catch (e) { visible = false; }
    return visible ? el : null;
}

// Flash a live element with the purple locate pulse. Clears any existing pulse
// first so repeated locates never stack, and removes the class on animationend
// so nothing persists after the animation (and a re-locate re-triggers cleanly).
function pulseElement(el) {
    Array.prototype.forEach.call(document.querySelectorAll('.locate-pulse'), function (n) {
        n.classList.remove('locate-pulse');
    });
    el.classList.add('locate-pulse');
    const done = function () {
        el.classList.remove('locate-pulse');
        el.removeEventListener('animationend', done);
    };
    el.addEventListener('animationend', done);
}

// The Locate sequence: switch to Tasks View, then (once the view has settled)
// scroll the live element into view and pulse it so the user can see which real
// element the selected block maps to. No-op if the handle isn't live-visible.
function locateSelector(selector) {
    const el = liveVisibleElement(selector);
    if (!el) return;
    if (locateTabSwitch) { try { locateTabSwitch(); } catch (e) { /* wiring absent in tests */ } }
    const run = function () {
        try { if (el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* jsdom */ }
        pulseElement(el);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else run();
}

// ── TOOLBAR HELPERS ───────────────────────────────────────────────────────────
// The canvas no longer owns a selection detail bar; the shared action toolbar in
// structureView surfaces a selection's measured dims, its visibility, and a
// Locate action instead. These helpers hand that toolbar the canvas-only data.

// The measured metadata for a selector in the ACTIVE bucket: rounded snapshot
// dimensions and whether it reads as visible (not a ghost/overlay). Null when the
// selector was never captured, so the toolbar can render `— × —` for it.
export function snapshotMetaFor(selector) {
    const snap = activeHandles().get(selector);
    if (!snap) return null;
    const r = snap.rect;
    return {
        width: (r && r.width > 0) ? Math.round(r.width) : 0,
        height: (r && r.height > 0) ? Math.round(r.height) : 0,
        visible: !isGhostSelector(selector),
    };
}

// Whether a handle can be located: it has an on-screen box in the CURRENT live
// viewport (the same test the detail bar's Locate gate used). Drives the toolbar
// Locate button's enabled/disabled state.
export function canLocate(selector) {
    // Locate resolves against the live DOM, which only exists for the self repo; a
    // guest canvas renders from stored geometry, so the toolbar Locate is gated off.
    if (activeRepo !== SELF_REPO) return false;
    return !!liveVisibleElement(selector);
}

// Run the Locate sequence for a handle: switch to Tasks View, then scroll its
// live element into view and pulse it. No-op when the handle isn't live-visible,
// and for any guest repo (no live DOM to locate against).
export function locateHandle(selector) {
    if (activeRepo !== SELF_REPO) return;
    locateSelector(selector);
}

// ── FILTER + GHOST MARKING (called by the view) ───────────────────────────────

// Dim canvas blocks whose handle doesn't match the active filter query (matching
// the view's "dim, don't remove" so layout shape is preserved). An empty query
// clears all dimming.
export function applyCanvasFilter(rawQuery) {
    if (!paneEl) return;
    const q = String(rawQuery || '').trim().toLowerCase();
    const blocks = paneEl.querySelectorAll('.structureCanvasBlock');
    Array.prototype.forEach.call(blocks, function (block) {
        const selector = block.dataset.selector || '';
        const node = nodeBySelector(lastTree, selector);
        const label = node ? node.label : '';
        const hay = (label + ' ' + selector).toLowerCase();
        const match = !q || hay.indexOf(q) !== -1;
        block.classList.toggle('structureCanvasBlock--dim', !match);
    });
}

// Mark the container tree's ghost rows (overlays + unmeasurable handles) so the
// view can style them amber. Operates on the already-rendered tree rows.
export function markGhostRows(treeEl) {
    if (!treeEl) return;
    const rows = treeEl.querySelectorAll('.structureRegionRow');
    Array.prototype.forEach.call(rows, function (row) {
        if (!row.dataset || row.dataset.handleKind !== 'live') return;
        const selector = row.dataset.handleValue || '';
        row.classList.toggle('structureRegionRow--ghost', isGhostSelector(selector));
    });
}
