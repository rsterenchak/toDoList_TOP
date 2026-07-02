// The Structure tab's UI lens, for the app's own repo, drops the flat handle
// tree in favour of a two-part drillable view: a block canvas on top and the
// familiar container tree below, both scoped to the same drill level. This
// module owns everything above the tree — the snapshot cache the block
// proportions are measured from, the drill path, the breadcrumb, the block
// canvas itself, and the selection detail bar. `structureView.js` renders the
// container tree (reusing its existing region-row styling) and calls into here,
// passing the handle tree it already walked from the DOM plus a few callbacks
// (select / reference / view-code) so the two panes stay in sync without this
// module reaching back into the view or the data model.
//
// Repo gating: the canvas only renders for `rsterenchak/toDoList_TOP` — the one
// repo whose live DOM is available to measure. Any other repo keeps the UI
// lens's existing tree-only rendering, so this module is never mounted there.

// The one repo whose own DOM this canvas can measure and drill.
export const SELF_REPO = 'rsterenchak/toDoList_TOP';

// Overlay / fixed-position handles that sit outside the container flow: they are
// never canvas blocks and always read as ghosts (tree-only) when measured.
const OVERLAY_IDS = {
    bottomSheet: 1,
    sidebarOverlay: 1,
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
// the handle tree and the sync callbacks:
//   • onSelect(descriptor)    — a block/detail selection, so the view can mirror
//     it onto the tree row + shared action toolbar.
//   • onReference(descriptor) — the detail bar's Reference action (seeds the
//     existing "Select a handle to reference it" bar).
//   • onViewCode(selector)    — the detail bar's View code action (jumps to the
//     Code lens for that handle).
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
    paneEl.appendChild(buildCanvas(drill.children));
    const hint = buildEmptyBucketHint();
    if (hint) paneEl.appendChild(hint);
    paneEl.appendChild(buildDetailBar());
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

// The block canvas: the current container's direct, non-ghost children laid out
// as proportionally-sized slabs in the container's inferred flow direction. An
// empty level (no measurable children) shows a gentle hint.
function buildCanvas(children) {
    const canvas = document.createElement('div');
    canvas.className = 'structureCanvasBlocks';

    // Fit the canvas to the SELECTED snapshot's aspect ratio, so a desktop
    // bucket viewed on a phone draws as a wide, short rectangle rather than
    // being stretched to the mobile canvas shape.
    const vp = activeViewport();
    if (vp && vp.w > 0 && vp.h > 0) {
        canvas.style.aspectRatio = vp.w + ' / ' + vp.h;
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

    canvas.classList.add(inferFlow(blocks) === 'column'
        ? 'structureCanvasBlocks--col'
        : 'structureCanvasBlocks--row');

    blocks.forEach(function (node) {
        canvas.appendChild(buildBlock(node));
    });
    return canvas;
}

// Row vs column: compare the spread of block centers. Wider horizontal spread →
// a row; wider vertical spread → a column. Defaults to row with no rects.
function inferFlow(blocks) {
    const cx = [];
    const cy = [];
    blocks.forEach(function (n) {
        const snap = activeHandles().get(n.selector);
        if (!snap || !snap.rect) return;
        cx.push(snap.rect.x + snap.rect.width / 2);
        cy.push(snap.rect.y + snap.rect.height / 2);
    });
    if (cx.length < 2) return 'row';
    return spread(cx) >= spread(cy) ? 'row' : 'column';
}

function spread(vals) {
    let min = Infinity;
    let max = -Infinity;
    vals.forEach(function (v) { if (v < min) min = v; if (v > max) max = v; });
    return max - min;
}

// One slab block: elevated card with the handle name + faint `#id`, a proportional
// flex-grow from its snapshot size, mini-outlines of its level-1 children, and a
// `»` drill chip when it nests containers. Tap selects; the chip or a long-press
// drills.
function buildBlock(node) {
    const block = document.createElement('div');
    block.className = 'structureCanvasBlock';
    block.dataset.selector = node.selector;
    block.setAttribute('role', 'button');
    block.setAttribute('tabindex', '0');
    if (selectedSelector === node.selector) block.classList.add('is-selected');

    const snap = activeHandles().get(node.selector);
    const grow = snap && snap.rect ? Math.max(snap.rect.width, 1) : 1;
    block.style.flexGrow = String(grow);
    block.style.flexBasis = '0';

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
        block.appendChild(buildMiniPreview(kids));

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
// proportionally sized like the real blocks.
function buildMiniPreview(kids) {
    const preview = document.createElement('div');
    preview.className = 'structureCanvasMiniPreview';
    preview.setAttribute('aria-hidden', 'true');
    kids.slice(0, MINI_PREVIEW_CAP).forEach(function (kid) {
        const mini = document.createElement('div');
        mini.className = 'structureCanvasMini';
        const snap = activeHandles().get(kid.selector);
        const grow = snap && snap.rect ? Math.max(snap.rect.width, 1) : 1;
        mini.style.flexGrow = String(grow);
        mini.style.flexBasis = '0';
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

// Select a node from the canvas: mark it, refresh the detail bar, and mirror the
// selection onto the tree via the view's onSelect callback.
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

// The selection detail bar: name, `#id`, snapshot dimensions (or `— × —`), a
// visible/hidden pill, and the View code + Reference actions.
function buildDetailBar() {
    const bar = document.createElement('div');
    bar.className = 'structureCanvasDetail';

    if (!selectedSelector) {
        bar.classList.add('structureCanvasDetail--idle');
        const hint = document.createElement('div');
        hint.className = 'structureCanvasDetailHint';
        hint.textContent = 'Select a block to inspect it.';
        bar.appendChild(hint);
        return bar;
    }

    const node = nodeBySelector(lastTree, selectedSelector);
    const label = node ? node.label : selectedSelector;
    const snap = activeHandles().get(selectedSelector);
    const ghost = isGhostSelector(selectedSelector);

    const head = document.createElement('div');
    head.className = 'structureCanvasDetailHead';

    const name = document.createElement('span');
    name.className = 'structureCanvasDetailName';
    name.textContent = label;
    head.appendChild(name);

    const id = document.createElement('span');
    id.className = 'structureCanvasDetailId';
    id.textContent = selectedSelector;
    head.appendChild(id);

    bar.appendChild(head);

    const meta = document.createElement('div');
    meta.className = 'structureCanvasDetailMeta';

    const dims = document.createElement('span');
    dims.className = 'structureCanvasDetailDims';
    dims.textContent = (snap && snap.rect && snap.rect.width > 0 && snap.rect.height > 0)
        ? Math.round(snap.rect.width) + ' × ' + Math.round(snap.rect.height)
        : '— × —';
    meta.appendChild(dims);

    const badge = document.createElement('span');
    badge.className = 'structureCanvasDetailBadge ' + (ghost
        ? 'structureCanvasDetailBadge--hidden'
        : 'structureCanvasDetailBadge--visible');
    badge.textContent = ghost ? 'Hidden in viewport' : 'Visible in viewport';
    meta.appendChild(badge);

    bar.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'structureCanvasDetailActions';

    const viewCode = document.createElement('button');
    viewCode.type = 'button';
    viewCode.className = 'structureCanvasDetailViewCode';
    viewCode.textContent = 'View code';
    viewCode.addEventListener('click', function (event) {
        event.stopPropagation();
        if (ctx && typeof ctx.onViewCode === 'function') ctx.onViewCode(selectedSelector);
    });
    actions.appendChild(viewCode);

    const reference = document.createElement('button');
    reference.type = 'button';
    reference.className = 'structureCanvasDetailReference';
    reference.textContent = 'Reference';
    reference.addEventListener('click', function (event) {
        event.stopPropagation();
        if (node && ctx && typeof ctx.onReference === 'function') ctx.onReference(describe(node));
    });
    actions.appendChild(reference);

    bar.appendChild(actions);
    return bar;
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
