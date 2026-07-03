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
// Repo gating: the canvas only renders for `rsterenchak/toDoList_TOP` — the one
// repo whose live DOM is available to measure. Any other repo keeps the UI
// lens's existing tree-only rendering, so this module is never mounted there.

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

// localStorage keys, one per bucket.
const BUCKET_STORAGE = {
    mobile: 'todoapp_structureSnapshot_mobile',
    desktop: 'todoapp_structureSnapshot_desktop',
};

function emptyBucket() {
    return { at: null, viewport: null, handles: new Map() };
}

// The two live buckets. Populated by `captureSnapshot` (live measure) and by
// `hydrateBuckets` (from localStorage on first access).
const buckets = { mobile: emptyBucket(), desktop: emptyBucket() };

// The bucket the toggle has explicitly selected for rendering, or null to track
// the current viewport. Reset on repo switch / canvas reset.
let selectedBucketKey = null;

// Rehydrate-from-storage guard: run once per module lifetime.
let hydrated = false;

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

function bucketHasData(key) {
    const b = buckets[key];
    return !!(b && b.handles && b.handles.size > 0);
}

// The bucket currently rendered: an explicit toggle choice when set, otherwise
// the current viewport's bucket — falling back to whichever bucket has data so a
// device viewing only the other bucket's capture still renders something.
function activeBucketKey() {
    hydrateBuckets();
    if (selectedBucketKey) return selectedBucketKey;
    const vp = currentViewportKey();
    if (bucketHasData(vp)) return vp;
    const other = vp === 'mobile' ? 'desktop' : 'mobile';
    if (bucketHasData(other)) return other;
    return vp;
}

function activeHandles() {
    return buckets[activeBucketKey()].handles;
}

function activeAt() {
    return buckets[activeBucketKey()].at;
}

function activeViewport() {
    return buckets[activeBucketKey()].viewport;
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

// Rehydrate both buckets from localStorage once. Guards JSON.parse and the
// expected shape; a corrupt payload is discarded so a fresh capture repopulates
// it (never render a canvas from a half-parsed bucket).
function hydrateBuckets() {
    if (hydrated) return;
    hydrated = true;
    ['mobile', 'desktop'].forEach(function (key) {
        const raw = readStorage(BUCKET_STORAGE[key]);
        if (!raw) return;
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
        if (!parsed || typeof parsed !== 'object' || !parsed.handles || typeof parsed.handles !== 'object') {
            removeStorage(BUCKET_STORAGE[key]);
            return;
        }
        const handles = new Map();
        Object.keys(parsed.handles).forEach(function (sel) {
            const h = parsed.handles[sel];
            if (h && typeof h === 'object') handles.set(sel, { rect: h.rect || null, visible: !!h.visible });
        });
        buckets[key] = {
            at: parsed.capturedAt ? new Date(parsed.capturedAt) : null,
            viewport: (parsed.viewport && typeof parsed.viewport === 'object') ? parsed.viewport : null,
            handles: handles,
        };
    });
}

// Persist one bucket to localStorage in the documented JSON shape:
// { capturedAt, viewport: { w, h }, handles: { selector: { rect, visible } } }.
function persistBucket(key) {
    const b = buckets[key];
    if (!b) return;
    const handles = {};
    b.handles.forEach(function (v, sel) { handles[sel] = { rect: v.rect, visible: v.visible }; });
    const payload = {
        capturedAt: b.at ? b.at.toISOString() : null,
        viewport: b.viewport || null,
        handles: handles,
    };
    try { writeStorage(BUCKET_STORAGE[key], JSON.stringify(payload)); } catch (e) { /* skip on serialize failure */ }
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
export function captureSnapshot(tree, opts) {
    hydrateBuckets();
    const partial = !!(opts && opts.partial);
    // A capture always writes to the bucket for the current LIVE viewport — never
    // the toggle-selected one — so measuring on a phone can only fill the mobile
    // bucket. A partial re-measure starts from the existing bucket's rects so it
    // never wipes good geometry with zeros for backgrounded handles.
    const key = currentViewportKey();
    const next = partial ? new Map(buckets[key].handles) : new Map();
    const visit = function (nodes) {
        (nodes || []).forEach(function (node) {
            if (!node || node.type !== 'region' || !node.selector) return;
            const measured = measureSelector(node.selector);
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
    buckets[key] = { at: new Date(), viewport: viewportSize(), handles: next };
    lastTree = tree || [];
    persistBucket(key);
    return buckets[key].handles;
}

// Measure one selector, or null when it doesn't resolve. A zero-size element
// still measures (its rect is 0×0) but reads as not-visible below.
function measureSelector(selector) {
    let el = null;
    try { el = document.querySelector(selector); } catch (e) { el = null; }
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
    drillPath = [];
    selectedSelector = null;
    selectedBucketKey = null;
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
export function renderStructureCanvas(host, opts) {
    if (!host || !opts || opts.repo !== SELF_REPO) return null;
    ctx = opts;
    lastTree = opts.tree || [];
    const pane = document.createElement('div');
    pane.className = 'structureCanvasPane';
    paneEl = pane;
    rebuild();
    host.insertBefore(pane, host.firstChild);
    return pane;
}

// Rebuild the pane's contents in place for the current drill path + selection.
function rebuild() {
    if (!paneEl || !ctx) return;
    clear(paneEl);

    const tree = ctx.tree || [];
    // Clamp a stale drill path before rendering off it.
    const drill = resolveDrill(tree, drillPath);
    if (drill.chain.length < drillPath.length) {
        drillPath = drill.chain.map(function (n) { return n.selector; });
    }

    paneEl.appendChild(buildSnapshotChip());
    paneEl.appendChild(buildBreadcrumb(drill.chain));
    paneEl.appendChild(buildCanvas(drill.children, parentBoxFor(drill.chain, drill.children)));
    const tray = buildGhostTray(drill.children);
    if (tray) paneEl.appendChild(tray);
    const hint = buildEmptyBucketHint();
    if (hint) paneEl.appendChild(hint);
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
// out good rects) into the live-viewport bucket and repaints.
function buildSnapshotChip() {
    const chip = document.createElement('div');
    chip.className = 'structureCanvasSnapChip';

    const at = activeAt();
    const label = document.createElement('span');
    label.className = 'structureCanvasSnapLabel';
    label.textContent = at
        ? 'captured ' + formatTime(at) + ' · '
        : 'not captured · ';
    chip.appendChild(label);

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
        captureSnapshot(lastTree, { partial: true });
        selectedBucketKey = currentViewportKey();
        rebuild();
    });
    chip.appendChild(refresh);

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
    const parentPath = findParentPath(ctx.tree || [], selector);
    if (parentPath) drillPath = parentPath;
    selectedSelector = selector;
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
// the same shape structureView's live rows produce.
function describe(node) {
    return {
        kind: 'live',
        label: node.label,
        value: node.selector,
        copyLabel: 'Copy selector',
        repo: SELF_REPO,
        file: null,
        line: null,
        visible: !isGhostSelector(node.selector),
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
    return !!liveVisibleElement(selector);
}

// Run the Locate sequence for a handle: switch to Tasks View, then scroll its
// live element into view and pulse it. No-op when the handle isn't live-visible.
export function locateHandle(selector) {
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
