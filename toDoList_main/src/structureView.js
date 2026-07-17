import { chatWithWorker } from './inject.js';
import {
    loadManifest,
    getRunningAppRepo,
    setChatWorkspaceRepo,
    insertReference,
} from './claudeSheet.js';
import { resolveProjectRepo } from './seedTasksModal.js';
import { renderRefactorCard } from './refactorCard.js';
import {
    getStructureLens,
    setStructureLens,
    getStructureTreeState,
    setStructureTreeState,
} from './prefs.js';
import {
    SELF_REPO,
    captureSnapshot,
    renderStructureCanvas,
    resetCanvasState,
    revealSelector,
    applyCanvasFilter,
    markGhostRows,
    snapshotMetaFor,
    canLocate,
    locateHandle,
} from './structureCanvas.js';
import { captureRemote } from './structureRemoteCapture.js';

// The STRUCTURE view: a map of the selected project's source and UI. A Code/UI
// toggle swaps between two lenses of that project's linked repo:
//   • Code lens — the repo's published `src-manifest.json` (the same artifact
//     the chat's attach-file picker fetches) rendered as a collapsible
//     folder/file tree, with a per-file "Explain with Sonnet" action.
//   • UI lens — a live, tappable map of the running app's on-screen regions,
//     walked straight from the DOM. Tapping a region exposes its selector plus
//     a "Reference in chat" action that hands the selector to the Claude
//     composer, and a "Copy selector" action. Non-running repos show a "no
//     published UI map yet" notice until build-time maps land in the fast-follow.
//
// The repo is derived from the currently-selected project (the same inject
// target Conceive's tools resolve via `resolveProjectRepo`), not from a picker:
// the header shows a read-only repo label, and switching the selected project
// re-renders the tab against the new project's repo. "Reference in chat" is the
// one place that reframes the chat workspace — it sets the conversation to the
// mapped repo at the moment of reference so the referenced selector lands in a
// chat framed on the right repo; project switches never reframe passively.
//
// Like the other view modules this module reaches the DOM via getElementById /
// createElement at call time and only exports renderStructureView — there is no
// back-edge into main.js. It never touches localStorage directly except via the
// prefs accessors; the manifest loader, workspace setter, and running-app repo
// are reused from claudeSheet.js, and the project→repo resolution from
// seedTasksModal.js, so the surfaces never drift.

// The repo currently shown. Held at module scope so a re-render (view switch,
// manifest refresh) preserves the user's selection. Null until first resolved
// against the live allowlist.
let selectedRepo = null;

// The active lens, 'code' or 'ui'. Hydrated from prefs on each render so the
// tab reopens on the lens you last used.
let lens = 'ui';

// Folder paths the user has expanded in the Code lens, keyed by full
// slash-joined path. Survives re-renders so the tree doesn't collapse on every
// repaint. Folder paths are scoped per repo by their leading segments, so the
// set never collides across repos that happen to share a folder name.
let openFolders = new Set();

// Defining files the user has COLLAPSED in the published UI map's file-grouped
// view, keyed by `region.file`. The published map defaults every file header to
// expanded, so membership here marks the exceptions; surviving re-renders keeps
// a header's fold state stable across repaints. Reset on repo switch alongside
// `openFolders`.
let collapsedPublishedFiles = new Set();

// Region selectors the user has EXPANDED in the live UI map. The live map
// defaults every region to collapsed, so membership marks the exceptions; the
// selector is the stable per-node key the tree already uses. Reset on repo switch
// alongside `openFolders` / `collapsedPublishedFiles`.
let openRegions = new Set();

// Defining files the user has COLLAPSED in the Types lens's file-grouped outline,
// keyed by the type's `file`. Mirrors `collapsedPublishedFiles` (every file header
// defaults to expanded, so membership marks the exceptions) but is a distinct slot
// so its persisted key is `<repo>:types`. Reset on repo switch alongside the others.
let collapsedTypeFiles = new Set();

// Defining `.sql` files the user has COLLAPSED in the SQL lens's file-grouped
// table outline, keyed by the table's `file`. Mirrors `collapsedTypeFiles` (a
// distinct slot so its persisted key is `<repo>:sql`), reset on repo switch
// alongside the others.
let collapsedSqlFiles = new Set();

// The build-time UI index for the selected repo, surfaced from its manifest:
//   • regionsIndex — selector → region record { selector, label, file, line,
//     files } — powers "Find in code" (live selector or published row → owner
//     file). Empty until the manifest resolves.
//   • currentSrcRoot — the repo-root-relative source folder, used to build
//     GitHub blob deep links.
//   • currentTreeEl / lensToggleGroup — live references to the rendered tree
//     container and lens segmented control, so "Find in code" can switch to the
//     Code lens and reveal a file without re-entering renderStructureView.
//   • currentSha — the commit SHA the loaded manifest was generated at, used to
//     key the per-file "Explain with Sonnet" cache so a new commit (new SHA)
//     invalidates stale explanations automatically. Null when the manifest
//     omits a sha (deterministic / served-from-source manifests), in which case
//     explanations are never cached.
let regionsIndex = new Map();
let currentSrcRoot = null;
let currentSha = null;
let currentTreeEl = null;
let lensToggleGroup = null;

// The active repo's manifest-declared second lens and its type outline:
//   • currentLens — which lens fills the toggle's second (non-Code) slot for this
//     repo: 'ui' (web repos, the default for back-compat), 'types' (a manifest
//     that declares `"lens":"types"`, e.g. the C# scanner's class/member outline),
//     or 'sql' (a manifest that declares `"lens":"sql"`, the table/column outline).
//   • currentTypes — the manifest's `types` array (classes/interfaces/structs/
//     enums/records, each with a `members` list) the Types lens renders. Empty
//     for a UI repo or a manifest with no `types`.
// Both are refreshed from the manifest in ensureRegionsLoaded, alongside srcRoot/sha.
//   • currentTables — the manifest's `tables` array (each with a `columns`
//     list of column/constraint rows) the SQL lens renders. Empty for a UI or
//     Types repo or a manifest with no `tables`.
let currentLens = 'ui';
let currentTypes = [];
let currentTables = [];

// Filter box state. The input lives in the view's persistent header region (not
// in the tree container `clear()` empties on each lens render), so it survives a
// lens switch; `filterQuery` is the active query, re-applied to the freshly
// rendered lens after a switch. The filter hides/reveals already-rendered rows
// rather than re-rendering, so inline "Explain with Sonnet" results and the
// user's expand/collapse state survive every keystroke.
let filterQuery = '';
let filterInputEl = null;
let filterCountEl = null;
let filterClearEl = null;
let currentNoMatchEl = null;

// The shared selection toolbar (UI + Types lenses). One handle is selected at a
// time; tapping a row selects it (or deselects when it's already selected), and
// the toolbar reflects that selection and runs Reference / Copy / Find / GitHub
// against it — replacing the per-row action panels that used to repeat under
// every row. The selection is a small descriptor the toolbar can drive for any
// kind: { kind, label, value, copyLabel, repo, file, line, visible }. It's
// ephemeral (not persisted): cleared on repo change and lens change, and
// re-applied to the matching row on a same-repo/same-lens repaint (match by
// `value` + `kind`), falling to idle if that handle no longer exists.
let selectedHandle = null;
// True while the drillable block canvas is mounted (the self-repo live UI lens),
// so a tree-row tap can mirror its selection onto the canvas via revealSelector.
let canvasActive = false;
// The guest-repo capture status/error line (deployed-site capture flow), held so
// the async capture can write progress + failure notices after a repaint.
let captureStatusEl = null;
let actionToolbarEl = null;
let actionToolbarLabelEl = null;
let actionToolbarContextEl = null;
let actionToolbarActionsEl = null;
let actionToolbarResultEl = null;

function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

// Which module-scoped fold set backs the given repo + lens. The UI lens splits by
// sub-mode: the running app's repo renders the live region map (open selectors),
// every other repo renders its published map (collapsed file headers). A repo is
// exclusively one or the other, so the single `<repo>:ui` storage slot never
// holds both representations at once.
function liveUiForRepo(repo) {
    return repo === getRunningAppRepo();
}

// Hydrate the fold set that backs `lens` for `repo` from persisted state, falling
// back to that lens's default expansion when nothing is stored yet (first open).
// Only called at genuine "enter this lens" moments (view render, lens switch) —
// never on the find-in-code repaint, which mutates `openFolders` itself and must
// not have those additions wiped.
function hydrateActiveLensState(repo, lens) {
    const stored = getStructureTreeState(repo, lens);
    const keys = stored || [];
    if (lens === 'code') {
        openFolders = new Set(keys);
    } else if (lens === 'types') {
        collapsedTypeFiles = new Set(keys);
    } else if (lens === 'sql') {
        collapsedSqlFiles = new Set(keys);
    } else if (liveUiForRepo(repo)) {
        openRegions = new Set(keys);
    } else {
        collapsedPublishedFiles = new Set(keys);
    }
}

// Persist the current fold set for `repo` + `lens`. Called from the user-toggle
// click handlers only, so the filter box's temporary auto-expand (which never
// touches these sets) is never written.
function persistActiveLensState(repo, lens) {
    if (!repo || !lens) return;
    let keys;
    if (lens === 'code') keys = Array.from(openFolders);
    else if (lens === 'types') keys = Array.from(collapsedTypeFiles);
    else if (lens === 'sql') keys = Array.from(collapsedSqlFiles);
    else if (liveUiForRepo(repo)) keys = Array.from(openRegions);
    else keys = Array.from(collapsedPublishedFiles);
    setStructureTreeState(repo, lens, keys);
}

// Load (cached) the selected repo's manifest and refresh the module-scoped UI
// index from it. Returns the manifest result so callers can branch on its
// states. Tolerates a manifest with no `regions` (older deploy) — the index
// just stays empty.
function ensureRegionsLoaded(repo) {
    return loadManifest(repo).then(function (result) {
        currentSrcRoot = (result && result.srcRoot) || null;
        currentSha = (result && typeof result.sha === 'string' && result.sha) ? result.sha : null;
        // The second lens is adaptive: a manifest that declares `"lens":"types"`
        // gets the Types outline, `"lens":"sql"` gets the table/column outline;
        // anything else (web repos, pre-field manifests) keeps the UI lens. Any
        // other value coerces to 'ui' so an unknown future lens id can't desync
        // the toggle or the active-lens normalization.
        const declaredLens = result && result.lens;
        currentLens = declaredLens === 'types' ? 'types'
            : declaredLens === 'sql' ? 'sql'
            : 'ui';
        currentTypes = (result && Array.isArray(result.types)) ? result.types : [];
        currentTables = (result && Array.isArray(result.tables)) ? result.tables : [];
        const idx = new Map();
        if (result && Array.isArray(result.regions)) {
            result.regions.forEach(function (r) {
                if (r && typeof r.selector === 'string' && !idx.has(r.selector)) {
                    idx.set(r.selector, r);
                }
            });
        }
        regionsIndex = idx;
        return result;
    });
}

// A GitHub blob deep link for an owner file, at its line when known. Files are
// named relative to the manifest's `srcRoot`, so the path is prefixed with it
// when present. C# manifests emit an empty `srcRoot` with repo-root-relative
// file paths, so the root segment is omitted in that case (never a double
// slash). Returns '' when the repo or file is unknown (no link rendered).
function githubBlobUrl(repo, file, line) {
    if (!repo || !file) return '';
    const root = String(currentSrcRoot || '').replace(/\/+$/, '');
    const frag = (typeof line === 'number' && line > 0) ? '#L' + line : '';
    return 'https://github.com/' + repo + '/blob/main/' + (root ? root + '/' : '') + file + frag;
}

// A quiet "View on GitHub ↗" secondary link, or null when no URL is resolvable.
function buildGithubLink(repo, file, line) {
    const url = githubBlobUrl(repo, file, line);
    if (!url) return null;
    const a = document.createElement('a');
    a.className = 'structureGithubLink';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = 'View on GitHub ↗';
    a.addEventListener('click', function (event) { event.stopPropagation(); });
    return a;
}

// Sync the lens toggle's active/aria-selected state to the module `lens`,
// without going through its click handler (which resets open-folder state).
function applyLensToggleState() {
    if (!lensToggleGroup) return;
    Array.prototype.forEach.call(lensToggleGroup.children, function (b) {
        const sel = b.dataset.lens === lens;
        b.classList.toggle('active', sel);
        b.setAttribute('aria-selected', String(sel));
    });
}

// Expand every ancestor folder of a file so its row is visible once the Code
// lens repaints. No-op for top-level (slash-less) file names.
function expandAncestors(file) {
    const parts = String(file || '').split('/').filter(Boolean);
    let prefix = '';
    for (let i = 0; i < parts.length - 1; i++) {
        prefix = prefix ? prefix + '/' + parts[i] : parts[i];
        openFolders.add(prefix);
    }
}

// Briefly highlight (and scroll to) a freshly-revealed file row in the Code lens.
function flashFileRow(file) {
    if (!currentTreeEl) return;
    let esc = String(file);
    try {
        if (window.CSS && typeof window.CSS.escape === 'function') esc = window.CSS.escape(file);
        else esc = esc.replace(/["\\]/g, '\\$&');
    } catch (e) { /* fall back to the raw value */ }
    const el = currentTreeEl.querySelector('[data-structure-file="' + esc + '"]');
    if (!el) return;
    el.classList.add('structureFileWrap--flash');
    try { if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); } catch (e) { /* jsdom */ }
    setTimeout(function () { el.classList.remove('structureFileWrap--flash'); }, 1600);
}

// "Find in code" tap-through: switch to the Code lens (persisting the choice),
// expand the file's ancestors, repaint the tree, then flash the file row.
function revealFileInCodeLens(file) {
    expandAncestors(file);
    if (lens !== 'code') {
        lens = 'code';
        setStructureLens('code');
        applyLensToggleState();
    }
    const painted = renderLens(selectedRepo, currentTreeEl);
    Promise.resolve(painted).then(function () {
        flashFileRow(file);
        refreshCollapseAllPill();
        // Now on the Code lens, which has no handles — hide the action toolbar.
        refreshActionToolbar();
    });
}

// One owner-file row inside a "Find in code" result list: the file name taps
// through to the Code lens; a quiet GitHub link sits beside it.
function buildOwnerFileRow(repo, owner) {
    const row = document.createElement('div');
    row.className = 'structureOwnerFileRow';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'structureOwnerFileBtn';
    open.textContent = owner.file + (typeof owner.line === 'number' && owner.line > 0 ? ':' + owner.line : '');
    open.setAttribute('aria-label', 'Open ' + owner.file + ' in the Code lens');
    open.addEventListener('click', function (event) {
        event.stopPropagation();
        revealFileInCodeLens(owner.file);
    });
    row.appendChild(open);

    const link = buildGithubLink(repo, owner.file, owner.line);
    if (link) row.appendChild(link);
    return row;
}

// Look the selector up in the build-time index and fill `resultEl` with its
// owner file rows (or a gentle "not in the index" note). Loads the manifest
// lazily so the lookup is robust no matter when the rows were built.
function findInCode(repo, selector, resultEl, btn) {
    btn.disabled = true;
    clear(resultEl);
    resultEl.hidden = false;
    const loading = document.createElement('div');
    loading.className = 'structureFindLoading';
    loading.textContent = 'Looking up…';
    resultEl.appendChild(loading);

    ensureRegionsLoaded(repo).then(function () {
        btn.disabled = false;
        clear(resultEl);
        const region = regionsIndex.get(selector);
        const owners = region && Array.isArray(region.files) ? region.files : [];
        if (!owners.length) {
            const none = document.createElement('div');
            none.className = 'structureFindNone';
            none.textContent = 'Not found in the source index.';
            resultEl.appendChild(none);
            return;
        }
        owners.forEach(function (owner) {
            resultEl.appendChild(buildOwnerFileRow(repo, owner));
        });
    }).catch(function () {
        btn.disabled = false;
        clear(resultEl);
        const none = document.createElement('div');
        none.className = 'structureFindNone';
        none.textContent = 'Couldn’t reach the source index.';
        resultEl.appendChild(none);
    });
}

// The Types-lens counterpart to findInCode. A C# manifest carries no `regions`,
// so type/member rows resolve their "Find in code" against the in-memory
// `currentTypes` index instead: list every place `name` is *defined* — a type
// whose name matches (its `file`/`line`) and every member whose name matches
// (its owning type's `file`, the member's own `line`). The same name defined in
// several classes lists all of them, which the single-line GitHub link can't.
// Synchronous — `currentTypes` is already loaded for the rendering lens.
function findTypeInCode(repo, name, resultEl, btn) {
    clear(resultEl);
    resultEl.hidden = false;

    const owners = [];
    const seen = new Set();
    const addOwner = function (file, line) {
        const key = (file || '') + '#' + (typeof line === 'number' ? line : '');
        if (seen.has(key)) return;
        seen.add(key);
        owners.push({ file: file, line: line });
    };
    currentTypes.forEach(function (type) {
        if (!type) return;
        if (type.name === name) addOwner(type.file, type.line);
        const members = Array.isArray(type.members) ? type.members : [];
        members.forEach(function (member) {
            if (member && member.name === name) addOwner(type.file, member.line);
        });
    });
    owners.sort(function (a, b) {
        const fa = a.file || '';
        const fb = b.file || '';
        if (fa !== fb) return fa < fb ? -1 : 1;
        const la = typeof a.line === 'number' ? a.line : 0;
        const lb = typeof b.line === 'number' ? b.line : 0;
        return la - lb;
    });

    if (!owners.length) {
        const none = document.createElement('div');
        none.className = 'structureFindNone';
        none.textContent = 'Not found in the type index.';
        resultEl.appendChild(none);
        return;
    }
    owners.forEach(function (owner) {
        resultEl.appendChild(buildOwnerFileRow(repo, owner));
    });
}

// ── CODE LENS ───────────────────────────────────────────────────────────────

// Group a flat list of repo-relative paths into a nested folder tree. Each node
// is `{ name, path, dirs: {childName: node}, files: [{name, path}] }`; the
// returned root has no name/path. Empty/blank entries are skipped. Pure — no DOM
// and no module state — so the grouping is unit-testable in isolation.
function buildTree(paths) {
    const root = { dirs: {}, files: [] };
    (Array.isArray(paths) ? paths : []).forEach(function (raw) {
        const parts = String(raw || '').split('/').filter(Boolean);
        if (!parts.length) return;
        let node = root;
        let prefix = '';
        for (let i = 0; i < parts.length - 1; i++) {
            prefix = prefix ? prefix + '/' + parts[i] : parts[i];
            if (!node.dirs[parts[i]]) {
                node.dirs[parts[i]] = { name: parts[i], path: prefix, dirs: {}, files: [] };
            }
            node = node.dirs[parts[i]];
        }
        node.files.push({ name: parts[parts.length - 1], path: raw });
    });
    return root;
}

// Build the one-shot "explain this file" turn and render the reply (or a
// fallback) inline beneath the file row. Runs through the same stateless
// chatWithWorker path Conceive's "Suggest plan" uses, so it never writes into
// the chat transcript. Fast-mode (deep flag omitted) per the task spec.
// "Explain with Sonnet" results are cached per repo + file + manifest SHA so
// re-opening an unchanged file renders instantly and spends no Sonnet call; a
// new commit changes the SHA, so the key naturally misses and the file
// re-explains against current source. Persisted in localStorage under one
// `todoapp_`-prefixed key holding an LRU-ordered map (oldest first, newest
// last), bounded by EXPLAIN_CACHE_CAP so it can't grow unbounded. When the
// manifest carries no sha, caching is skipped entirely — never risk surfacing a
// stale explanation.
const EXPLAIN_CACHE_KEY = 'todoapp_structureExplain';
const EXPLAIN_CACHE_CAP = 50;

function explainCacheKey(repo, filePath, sha) {
    return repo + ':' + filePath + ':' + sha;
}

function readExplainStore() {
    try {
        const raw = localStorage.getItem(EXPLAIN_CACHE_KEY);
        if (!raw) return { order: [], map: {} };
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object') return { order: [], map: {} };
        const order = Array.isArray(data.order)
            ? data.order.filter(function (k) { return typeof k === 'string'; })
            : [];
        const map = (data.map && typeof data.map === 'object') ? data.map : {};
        return { order: order, map: map };
    } catch (e) {
        return { order: [], map: {} };
    }
}

function writeExplainStore(store) {
    try {
        localStorage.setItem(EXPLAIN_CACHE_KEY, JSON.stringify(store));
    } catch (e) { /* quota / unavailable — caching is best-effort */ }
}

// A cached explanation for this repo+file+sha, or null on a miss (or when sha is
// absent, which disables caching). A hit is promoted to most-recently-used so
// the cap evicts genuinely cold entries first.
function readCachedExplanation(repo, filePath, sha) {
    if (!sha) return null;
    const key = explainCacheKey(repo, filePath, sha);
    const store = readExplainStore();
    if (!Object.prototype.hasOwnProperty.call(store.map, key)) return null;
    const text = store.map[key];
    if (typeof text !== 'string' || !text) return null;
    store.order = store.order.filter(function (k) { return k !== key; });
    store.order.push(key);
    writeExplainStore(store);
    return text;
}

// Store a successful explanation, evicting oldest entries past the cap. No-op
// when sha is absent (caching disabled) or the text is empty (only successful
// explanations are cached).
function writeCachedExplanation(repo, filePath, sha, text) {
    if (!sha || typeof text !== 'string' || !text) return;
    const key = explainCacheKey(repo, filePath, sha);
    const store = readExplainStore();
    store.order = store.order.filter(function (k) { return k !== key; });
    store.map[key] = text;
    store.order.push(key);
    while (store.order.length > EXPLAIN_CACHE_CAP) {
        const evict = store.order.shift();
        delete store.map[evict];
    }
    writeExplainStore(store);
}

function explainFile(repo, filePath, btn, resultEl) {
    // Cache hit (repo + file + current manifest SHA): render the stored
    // explanation instantly with no Worker call and no spinner.
    const sha = currentSha;
    const cached = readCachedExplanation(repo, filePath, sha);
    if (cached) {
        clear(resultEl);
        resultEl.hidden = false;
        const out = document.createElement('div');
        out.className = 'structureExplainText';
        out.textContent = cached;
        resultEl.appendChild(out);
        return;
    }

    btn.disabled = true;
    const priorLabel = btn.textContent;
    btn.textContent = 'Explaining…';
    clear(resultEl);
    resultEl.hidden = false;
    const loading = document.createElement('div');
    loading.className = 'structureExplainLoading';
    loading.textContent = 'Asking Sonnet…';
    resultEl.appendChild(loading);

    const prompt =
        'In 2-3 sentences, summarize what the file `' + filePath +
        '` is responsible for. Reply with the summary only — no preamble.';

    chatWithWorker([{ role: 'user', content: prompt }], undefined, [filePath], repo, undefined, false)
        .then(function (res) {
            btn.textContent = priorLabel;
            btn.disabled = false;
            const reply = res && typeof res.reply === 'string' ? res.reply.trim() : '';
            // Cache only a successful (non-empty) explanation; empty/error
            // results are never stored, so a retry re-asks Sonnet.
            if (reply) writeCachedExplanation(repo, filePath, sha, reply);
            clear(resultEl);
            const out = document.createElement('div');
            out.className = reply ? 'structureExplainText' : 'structureExplainError';
            out.textContent = reply || 'Couldn’t read a summary for this file.';
            resultEl.appendChild(out);
        })
        .catch(function (e) {
            btn.textContent = priorLabel;
            btn.disabled = false;
            clear(resultEl);
            const reason = e && e.reason ? e.reason : 'Something went wrong.';
            const out = document.createElement('div');
            out.className = 'structureExplainError';
            out.textContent = 'Couldn’t explain this file: ' + reason;
            resultEl.appendChild(out);
        });
}

// Render a single file row plus its (initially hidden) Explain affordance and
// inline result area. Depth drives the left indent so nested files line up under
// their folder.
function buildFileRow(repo, file, depth) {
    const wrap = document.createElement('div');
    wrap.className = 'structureFileWrap';
    // Tag the wrap so "Find in code" can scroll to / flash this file's row.
    wrap.dataset.structureFile = file.path;

    const row = document.createElement('div');
    row.className = 'structureFileRow';
    row.style.setProperty('--structure-depth', String(depth));

    const icon = document.createElement('span');
    icon.className = 'structureFileIcon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML =
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M6 3 h8 l4 4 v14 H6 Z"/><path d="M14 3 v4 h4"/></svg>';
    row.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'structureFileName';
    name.textContent = file.name;
    row.appendChild(name);

    const explainBtn = document.createElement('button');
    explainBtn.type = 'button';
    explainBtn.className = 'structureExplainBtn';
    explainBtn.textContent = 'Explain with Sonnet';
    explainBtn.setAttribute('aria-label', 'Explain ' + file.path + ' with Sonnet');
    row.appendChild(explainBtn);

    // Quiet escape hatch: open this file on GitHub (no line — it's a whole file).
    const gh = buildGithubLink(repo, file.path, null);
    if (gh) row.appendChild(gh);

    const result = document.createElement('div');
    result.className = 'structureExplainResult';
    result.hidden = true;

    explainBtn.addEventListener('click', function () {
        explainFile(repo, file.path, explainBtn, result);
    });

    wrap.appendChild(row);
    wrap.appendChild(result);
    return wrap;
}

// Recursively render a tree node's folders (alphabetical) then its files
// (alphabetical) into `container`. Folder rows toggle the open-state set and
// their child container's visibility in place; depth drives indentation.
function renderNode(repo, node, container, depth) {
    const dirNames = Object.keys(node.dirs).sort();
    dirNames.forEach(function (dirName) {
        const dir = node.dirs[dirName];
        const expanded = openFolders.has(dir.path);

        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'structureFolderRow';
        head.style.setProperty('--structure-depth', String(depth));
        head.setAttribute('aria-expanded', expanded ? 'true' : 'false');

        const caret = document.createElement('span');
        caret.className = 'structureFolderCaret';
        caret.setAttribute('aria-hidden', 'true');
        caret.textContent = '▸';
        head.appendChild(caret);

        const label = document.createElement('span');
        label.className = 'structureFolderName';
        label.textContent = dirName;
        head.appendChild(label);

        const childWrap = document.createElement('div');
        childWrap.className = 'structureFolderChildren';
        if (!expanded) childWrap.hidden = true;

        head.addEventListener('click', function () {
            // Direction follows the live DOM (not just the set) so a collapse/
            // expand-all bulk fold — which drives the DOM directly — stays in sync.
            const nowOpen = childWrap.hidden;
            if (nowOpen) openFolders.add(dir.path);
            else openFolders.delete(dir.path);
            head.classList.toggle('expanded', nowOpen);
            head.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
            childWrap.hidden = !nowOpen;
            persistActiveLensState(repo, lens);
        });
        if (expanded) head.classList.add('expanded');

        renderNode(repo, dir, childWrap, depth + 1);

        container.appendChild(head);
        container.appendChild(childWrap);
    });

    node.files.slice().sort(function (a, b) {
        return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    }).forEach(function (file) {
        container.appendChild(buildFileRow(repo, file, depth));
    });
}

// Fetch the selected repo's manifest and fill the tree container. Guards against
// a stale selection: if the user switches repos before the fetch resolves, the
// late result is dropped. A repo with no published manifest degrades to a gentle
// notice rather than an error, mirroring the attach picker's fallback.
function renderTree(repo, treeEl) {
    clear(treeEl);
    const loading = document.createElement('div');
    loading.className = 'structureTreeLoading';
    loading.textContent = 'Loading source map…';
    treeEl.appendChild(loading);

    return ensureRegionsLoaded(repo).then(function (result) {
        // The lens or the repo may have changed while the manifest was in
        // flight; drop the stale result rather than painting over the UI lens.
        if (repo !== selectedRepo || lens !== 'code') return;
        clear(treeEl);
        if (!result || !result.ok || !result.files.length) {
            const empty = document.createElement('div');
            empty.className = 'structureNoManifest';
            empty.textContent = 'No manifest published yet for this repo.';
            treeEl.appendChild(empty);
            return;
        }
        const tree = buildTree(result.files);
        renderNode(repo, tree, treeEl, 0);
    });
}

// ── UI LENS ─────────────────────────────────────────────────────────────────

// Element ids whose subtrees the walk skips entirely, so the map can't include
// the Structure view itself. The chat surfaces (#desktopChatPane, #claudeSheet)
// are deliberately NOT excluded: the desktop chat pane becomes a real block
// beside #mainSec, and #claudeSheet becomes a tree row that the canvas
// overlay-classifies into the ghost tray. Only the inspector-from-inside-itself
// case stays excluded.
const EXCLUDED_IDS = { structureView: 1 };

// ARIA landmark roles that mark an element as a keepable region.
const LANDMARK_ROLES = {
    banner: 1, complementary: 1, contentinfo: 1, form: 1, main: 1,
    navigation: 1, region: 1, search: 1, dialog: 1,
};

// Semantic tags that carry an implicit landmark role, mapped to that role name.
const IMPLICIT_LANDMARK_TAGS = {
    NAV: 'navigation', MAIN: 'main', HEADER: 'banner',
    FOOTER: 'contentinfo', ASIDE: 'complementary',
};

// A run of this many or more consecutive id-less, role-less siblings sharing one
// tag+class signature (todo/project rows) collapses to a single "× N rows" line
// rather than listing each.
const REPEAT_COLLAPSE_MIN = 3;

function isExcludedEl(el) {
    return !!(el.id && EXCLUDED_IDS[el.id]);
}

// The landmark role an element carries, explicit or implicit; '' when none.
function regionRole(el) {
    const role = (el.getAttribute('role') || '').trim().toLowerCase();
    if (role && LANDMARK_ROLES[role]) return role;
    const implicit = IMPLICIT_LANDMARK_TAGS[el.tagName];
    if (implicit) return implicit;
    return '';
}

// A region is "kept" (gets its own row in the map) when it carries an id, a
// data-region, or a landmark role. Everything else is walked through. When a
// `knownClasses` set is supplied (a guest repo whose manifest identifies its
// regions by className, e.g. a React app whose only id is its mount point), an
// element is also kept when it carries one of those classes — so a class-based
// guest DOM maps deeply instead of collapsing to its lone id-bearing root. The
// self repo passes no set, so its id/role-keyed walk is unaffected.
function isKept(el, knownClasses) {
    if (el.id || (el.getAttribute('data-region') || '').trim() || regionRole(el)) return true;
    if (knownClasses && knownClasses.size) {
        const classes = (el.getAttribute('class') || '').trim().split(/\s+/);
        for (let i = 0; i < classes.length; i++) {
            if (classes[i] && knownClasses.has(classes[i])) return true;
        }
    }
    return false;
}

// Normalize a guest repo's manifest region selectors into the bare class tokens
// the walk keys on: each single-class selector (`.homeSection`) contributes its
// token (`homeSection`); ids, roles, and compound/non-class selectors are
// ignored defensively (the walk already keys on id/role, and a compound selector
// has no single class to match). Returns null when no class selectors are
// present, so a guest with an id-only manifest keeps the default id/role walk.
function knownClassSet(regions) {
    if (!Array.isArray(regions)) return null;
    const set = new Set();
    regions.forEach(function (r) {
        const sel = (r && typeof r.selector === 'string') ? r.selector.trim() : '';
        const m = /^\.([\w-]+)$/.exec(sel);
        if (m) set.add(m[1]);
    });
    return set.size ? set : null;
}

// The label counterpart to knownClassSet: a class→label map from the manifest's
// region records, keyed by the bare class token (`.navSection` → its `label`,
// e.g. "Nav Section"), so a class-kept guest element takes its published section
// name instead of falling through to its tag. Ids, roles, and compound/non-class
// selectors are ignored (they don't key on a single class), and a region with no
// usable label is skipped. Returns null when no class-labelled region is present,
// so a guest with an id-only manifest (and the self repo) keeps the default
// id/role labeling.
function classLabelMap(regions) {
    if (!Array.isArray(regions)) return null;
    const map = new Map();
    regions.forEach(function (r) {
        const sel = (r && typeof r.selector === 'string') ? r.selector.trim() : '';
        const m = /^\.([\w-]+)$/.exec(sel);
        const label = (r && typeof r.label === 'string') ? r.label.trim() : '';
        if (m && label) map.set(m[1], label);
    });
    return map.size ? map : null;
}

// Turn an id/data-region token into a human label: split camelCase and
// dash/underscore runs, then title-case.
function prettify(token) {
    return String(token || '')
        .replace(/[-_]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

// Label precedence: data-region > aria-label > prettified id > matched-class
// manifest label > prettified first-class token > role > tag. The two class-based
// steps only fire when a `classLabels` map is supplied (a guest repo whose
// manifest identifies its regions by className): a kept element takes its
// published section name when one of its classes matches, else a prettified class
// token, before falling through to role/tag — so a class-kept guest region reads
// "Nav Section" rather than "div". The self repo passes no map, so its
// id/role/tag labeling is byte-for-byte unchanged.
function regionLabel(el, classLabels) {
    const dr = (el.getAttribute('data-region') || '').trim();
    if (dr) return dr;
    const al = (el.getAttribute('aria-label') || '').trim();
    if (al) return al;
    if (el.id) return prettify(el.id);
    if (classLabels && classLabels.size) {
        const classes = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean);
        for (let i = 0; i < classes.length; i++) {
            if (classLabels.has(classes[i])) return classLabels.get(classes[i]);
        }
        if (classes.length) return prettify(classes[0]);
    }
    const role = regionRole(el);
    if (role) return role.charAt(0).toUpperCase() + role.slice(1);
    return el.tagName.toLowerCase();
}

// Selector precedence: #id > [data-region="…"] > tag.firstClass > tag[role] > tag.
function regionSelector(el) {
    if (el.id) return '#' + el.id;
    const dr = (el.getAttribute('data-region') || '').trim();
    if (dr) return '[data-region="' + dr + '"]';
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)[0];
    const tag = el.tagName.toLowerCase();
    if (cls) return tag + '.' + cls;
    const role = (el.getAttribute('role') || '').trim();
    if (role) return tag + '[role="' + role + '"]';
    return tag;
}

// On-screen "now" vs. latent: an element is visible when it isn't display:none /
// visibility:hidden and has layout (an offsetParent or client rects). Surfaces
// hidden only by a parent's data-view attribute still have layout-less presence
// in the DOM and read as dimmed, which is what lets latent views show up.
function isOnScreen(el, doc) {
    // Resolve getComputedStyle against the element's own document view so a guest
    // iframe's regions are measured against the iframe's window, not the host's.
    const view = ((doc || (typeof document !== 'undefined' ? document : null)) || {}).defaultView
        || (typeof window !== 'undefined' ? window : null);
    try {
        const cs = view && view.getComputedStyle ? view.getComputedStyle(el) : null;
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
    } catch (e) { /* defensive — treat as laid out */ }
    if (el.offsetParent !== null) return true;
    if (typeof el.getClientRects === 'function' && el.getClientRects().length) return true;
    return false;
}

// A signature for collapse-detection: same tag + same class string. Uses the
// raw class attribute so SVG elements (object-valued className) don't throw.
function elSignature(el) {
    return el.tagName + '|' + ((el.getAttribute('class') || '').trim());
}

// Length of the run of consecutive collapsible siblings starting at `start`
// that share its signature. A collapsible element is one that wouldn't be kept
// on its own (no id, no data-region, no landmark role).
function repeatRunLength(children, start, knownClasses) {
    const first = children[start];
    if (isKept(first, knownClasses)) return 0;
    const sig = elSignature(first);
    let n = 1;
    for (let j = start + 1; j < children.length; j++) {
        if (!isKept(children[j], knownClasses) && elSignature(children[j]) === sig) n++;
        else break;
    }
    return n;
}

// Walk an element's descendants and return the list of region/collapsed nodes
// it contains. Kept elements become region nodes (with their own kept
// descendants nested); non-kept elements are walked through, hoisting their
// kept descendants up to the nearest kept ancestor. Excluded subtrees are
// skipped whole; runs of repeated id-less siblings collapse to one line.
function walk(el, doc, knownClasses, classLabels) {
    const children = Array.prototype.slice.call(el.children || []);
    const out = [];
    let i = 0;
    while (i < children.length) {
        const child = children[i];
        const runLen = repeatRunLength(children, i, knownClasses);
        if (runLen >= REPEAT_COLLAPSE_MIN) {
            out.push({ type: 'collapsed', count: runLen, tag: child.tagName.toLowerCase() });
            i += runLen;
            continue;
        }
        if (isExcludedEl(child)) { i++; continue; }
        const descendants = walk(child, doc, knownClasses, classLabels);
        if (isKept(child, knownClasses)) {
            out.push({
                type: 'region',
                label: regionLabel(child, classLabels),
                selector: regionSelector(child),
                visible: isOnScreen(child, doc),
                children: descendants,
            });
        } else {
            for (let k = 0; k < descendants.length; k++) out.push(descendants[k]);
        }
        i++;
    }
    return out;
}

// Build the UI region tree from a document's live DOM (the host `document` by
// default, or a guest repo's deployed page loaded into a hidden iframe). Pure
// read — never mutates the page. Exported so the remote-capture flow can walk a
// guest document with the exact same region-discovery rules the self repo uses.
// An optional `knownClasses` set (bare class tokens from a guest repo's manifest)
// makes the walk additionally keep class-identified regions; an optional
// `classLabels` map (class token → manifest region label) lets those class-kept
// regions read their published section name instead of their tag. Both default to
// null so every self-repo call site keeps the id/role-only behavior byte-for-byte.
export function buildUiTree(doc, knownClasses, classLabels) {
    const root = doc || (typeof document !== 'undefined' ? document : null);
    if (!root || !root.body) return [];
    return walk(root.body, root, knownClasses || null, classLabels || null);
}

// Capture the live layout snapshot the Structure tab's block canvas measures its
// block proportions from. Called from main.js's view-switch handling the instant
// the user leaves Tasks View — while the app's regions are still on screen — so
// the canvas has real geometry even though Tasks View is hidden once Structure
// owns the panel. Best-effort: a failure just leaves the prior snapshot in place.
export function captureStructureSnapshot() {
    try {
        captureSnapshot(buildUiTree(), SELF_REPO);
    } catch (e) { /* keep the prior snapshot on any measurement failure */ }
}

// Copy a selector to the clipboard, flashing the button label as feedback.
// Degrades silently when the Clipboard API is unavailable (older/insecure
// contexts) — the selector is still visible in the panel to copy by hand.
function copySelector(selector, btn) {
    const prior = btn.textContent;
    const flash = function () {
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = prior; }, 1200);
    };
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(selector).then(flash, flash);
            return;
        }
    } catch (e) { /* fall through to the no-op flash */ }
    flash();
}

// Append the shared "Reference in chat" (primary) + "Copy selector" (secondary)
// actions to an action row. Both the live and published region rows use this so
// the two paths can't drift. Reference reframes the chat workspace onto `repo`
// (a no-op when it already matches) so the inserted selector lands in a
// conversation framed on the right repo, then hands the selector to the chat
// composer; Copy writes the selector to the clipboard.
function appendReferenceCopyActions(actionRow, label, selector, repo, copyLabel) {
    const refBtn = document.createElement('button');
    refBtn.type = 'button';
    refBtn.className = 'structureReferenceBtn';
    refBtn.textContent = 'Reference in chat';
    refBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        setChatWorkspaceRepo(repo);
        insertReference(label, selector);
    });
    actionRow.appendChild(refBtn);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'structureCopyBtn';
    copyBtn.textContent = copyLabel || 'Copy selector';
    copyBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        copySelector(selector, copyBtn);
    });
    actionRow.appendChild(copyBtn);
}

// ── SELECTION + SHARED ACTION TOOLBAR ────────────────────────────────────────
// Tapping a UI/Types row no longer reveals its own action panel; it selects the
// row, and a single toolbar pinned above the tree acts on that selection.

// Two descriptors name the same handle when their kind and value match — the
// stable identity used to toggle a re-tap off and to re-find the row across a
// repaint.
function sameHandle(a, b) {
    return !!a && !!b && a.kind === b.kind && a.value === b.value;
}

// The one-line context the toolbar shows beneath the selected handle's label.
// While the block canvas is mounted (self-repo live map), a live handle folds in
// the measured dims + viewport visibility the deleted detail bar used to show;
// otherwise a live handle just adds its on/off-screen status, and a
// published/Types handle its line.
function handleContextLine(d) {
    if (d.kind === 'live') {
        if (canvasActive) {
            const meta = snapshotMetaFor(d.value);
            const dims = (meta && meta.width > 0 && meta.height > 0)
                ? meta.width + ' × ' + meta.height
                : '— × —';
            const vis = (meta && meta.visible) ? 'Visible in viewport' : 'Hidden in viewport';
            return d.value + ' · ' + dims + ' · ' + vis;
        }
        return d.value + ' · ' + (d.visible ? 'On screen now.' : 'Not currently on screen.');
    }
    const line = typeof d.line === 'number' && d.line > 0 ? 'Line ' + d.line + '.' : 'Line not recorded.';
    return d.value + ' · ' + line;
}

// Strip the selected style from every row in the tree (used before selecting a
// new row and when clearing the selection).
function clearSelectedRows() {
    const tree = currentTreeEl;
    if (!tree) return;
    Array.prototype.forEach.call(tree.querySelectorAll('.structureRegionRow.is-selected'), function (r) {
        r.classList.remove('is-selected');
        r.setAttribute('aria-pressed', 'false');
    });
}

// Select a handle from its row, or deselect when the same handle is re-tapped.
// The caret keeps its own job (toggling children) — selection only ever reacts
// to a tap on the row body, so expanding/collapsing and selecting stay separate.
function selectHandle(descriptor, rowEl) {
    if (sameHandle(selectedHandle, descriptor)) {
        clearSelection();
        return;
    }
    clearSelectedRows();
    selectedHandle = descriptor;
    if (rowEl) {
        rowEl.classList.add('is-selected');
        rowEl.setAttribute('aria-pressed', 'true');
    }
    renderActionToolbar();
}

// Drop the active selection back to the idle toolbar state.
function clearSelection() {
    clearSelectedRows();
    selectedHandle = null;
    renderActionToolbar();
}

// A canvas block (or its detail-bar Reference) was selected: mirror that handle
// onto the container tree — mark and scroll its row into view — and drive the
// shared action toolbar, seeding the existing "Select a handle to reference it"
// bar. Always selects (never toggles): the canvas owns the toggle in its own
// detail bar, so echoing here must be idempotent and not deselect.
function selectFromCanvas(descriptor) {
    clearSelectedRows();
    selectedHandle = descriptor;
    const tree = currentTreeEl;
    let matched = null;
    if (tree) {
        Array.prototype.forEach.call(tree.querySelectorAll('.structureRegionRow'), function (r) {
            if (matched || !r.dataset) return;
            // A self canvas mirrors onto live rows; a guest canvas's published map
            // has 'published' rows, so match either kind by selector value.
            const kind = r.dataset.handleKind;
            if ((kind === 'live' || kind === 'published') && r.dataset.handleValue === descriptor.value) {
                matched = r;
            }
        });
    }
    if (matched) {
        matched.classList.add('is-selected');
        matched.setAttribute('aria-pressed', 'true');
        try { if (matched.scrollIntoView) matched.scrollIntoView({ block: 'nearest' }); } catch (e) { /* jsdom */ }
    }
    renderActionToolbar();
}

// The canvas detail bar's "View code" action: resolve the handle's selector to
// its owner file through the build-time index and jump to it in the Code lens —
// the same destination the tree's "Find in code" affordance reaches.
function viewCodeFromCanvas(selector) {
    ensureRegionsLoaded(selectedRepo).then(function () {
        const region = regionsIndex.get(selector);
        const owners = region && Array.isArray(region.files) ? region.files : [];
        if (owners.length && owners[0] && owners[0].file) {
            revealFileInCodeLens(owners[0].file);
        }
    });
}

// Build the shared toolbar strip: the selected handle's label + context line,
// the action buttons (Reference / Copy / Find / GitHub), and a result area for
// Find in code. Held module-scoped like the collapse toolbar so a lens repaint
// (which only clears the tree) never wipes it.
function buildActionToolbar() {
    const bar = document.createElement('div');
    bar.className = 'structureActionToolbar';

    const head = document.createElement('div');
    head.className = 'structureActionToolbarHead';

    const label = document.createElement('div');
    label.className = 'structureActionToolbarLabel';
    head.appendChild(label);

    const context = document.createElement('div');
    context.className = 'structureActionToolbarContext';
    head.appendChild(context);

    bar.appendChild(head);

    const actions = document.createElement('div');
    actions.className = 'structureActionToolbarActions';
    bar.appendChild(actions);

    const result = document.createElement('div');
    result.className = 'structureFindResult';
    result.hidden = true;
    bar.appendChild(result);

    actionToolbarEl = bar;
    actionToolbarLabelEl = label;
    actionToolbarContextEl = context;
    actionToolbarActionsEl = actions;
    actionToolbarResultEl = result;
    return bar;
}

// Paint the toolbar for the current selection (or the idle hint when nothing is
// selected). Rebuilds the action buttons from the active descriptor and clears
// any prior Find result, so a selection change never leaks the previous handle's
// owner-file list.
function renderActionToolbar() {
    if (!actionToolbarEl) return;
    clear(actionToolbarActionsEl);
    clear(actionToolbarResultEl);
    actionToolbarResultEl.hidden = true;

    if (!selectedHandle) {
        actionToolbarEl.classList.add('structureActionToolbar--idle');
        actionToolbarLabelEl.textContent = 'Select a handle to reference it';
        actionToolbarContextEl.textContent = '';
        return;
    }

    const d = selectedHandle;
    actionToolbarEl.classList.remove('structureActionToolbar--idle');
    actionToolbarLabelEl.textContent = d.label;
    actionToolbarContextEl.textContent = handleContextLine(d);

    // Reference in chat (primary, reframes onto the handle's repo) + Copy.
    appendReferenceCopyActions(actionToolbarActionsEl, d.label, d.value, d.repo, d.copyLabel);

    // Find in code: live/published handles resolve a selector through the
    // build-time index; Types rows resolve a name through the in-memory types.
    const findBtn = document.createElement('button');
    findBtn.type = 'button';
    findBtn.className = 'structureFindBtn';
    findBtn.textContent = 'Find in code';
    findBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        if (d.kind === 'type') findTypeInCode(d.repo, d.value, actionToolbarResultEl, findBtn);
        else findInCode(d.repo, d.value, actionToolbarResultEl, findBtn);
    });
    actionToolbarActionsEl.appendChild(findBtn);

    // Locate (canvas only): jump to the live element in Tasks View and pulse it.
    // Shown for a live, non-overlay, visible-in-snapshot handle while the block
    // canvas is mounted; disabled with a mono helper note when the handle has no
    // on-screen box in the current live viewport. Ghost/hidden/overlay handles
    // (snapshot visibility false) show no Locate at all.
    // Locate resolves against the live DOM, which only exists for the self repo; a
    // guest (deployed-site) canvas renders from stored geometry, so Locate stays
    // hidden entirely rather than shown-disabled.
    if (canvasActive && d.kind === 'live' && d.repo === SELF_REPO) {
        const meta = snapshotMetaFor(d.value);
        if (meta && meta.visible) {
            const locateBtn = document.createElement('button');
            locateBtn.type = 'button';
            locateBtn.className = 'structureLocateBtn';
            locateBtn.textContent = 'Locate';
            const locatable = canLocate(d.value);
            if (locatable) {
                locateBtn.addEventListener('click', function (event) {
                    event.stopPropagation();
                    locateHandle(d.value);
                });
            } else {
                locateBtn.classList.add('structureLocateBtn--disabled');
                locateBtn.disabled = true;
                locateBtn.setAttribute('aria-disabled', 'true');
            }
            actionToolbarActionsEl.appendChild(locateBtn);
            if (!locatable) {
                const hint = document.createElement('span');
                hint.className = 'structureLocateHint';
                hint.textContent = 'hidden in this viewport';
                actionToolbarActionsEl.appendChild(hint);
            }
        }
    }

    // A View-on-GitHub deep link only for handles that carry a defining file
    // (published + Types); live-map handles resolve via Find in code instead.
    if (d.file) {
        const gh = buildGithubLink(d.repo, d.file, d.line);
        if (gh) actionToolbarActionsEl.appendChild(gh);
    }
}

// Re-apply the active selection to the freshly painted tree: clear stale marks,
// then re-mark the row whose descriptor still matches. If the handle is gone
// (filtered out lens, removed region), fall back to the idle state.
function reapplySelection() {
    clearSelectedRows();
    if (!selectedHandle) return;
    const tree = currentTreeEl;
    if (!tree) return;
    let matched = null;
    Array.prototype.forEach.call(tree.querySelectorAll('.structureRegionRow'), function (r) {
        if (matched || !r.dataset) return;
        if (r.dataset.handleValue === selectedHandle.value && r.dataset.handleKind === selectedHandle.kind) {
            matched = r;
        }
    });
    if (matched) {
        matched.classList.add('is-selected');
        matched.setAttribute('aria-pressed', 'true');
    } else {
        selectedHandle = null;
    }
}

// Sync the toolbar to the live tree after a paint: the Code lens has no handles
// to act on, so hide it there; the UI/Types lenses show it, re-applying the
// selection and repainting its content.
function refreshActionToolbar() {
    if (!actionToolbarEl) return;
    if (lens === 'code') {
        actionToolbarEl.hidden = true;
        return;
    }
    actionToolbarEl.hidden = false;
    reapplySelection();
    renderActionToolbar();
}

// Render a collapsed "× N rows" placeholder for a run of repeated siblings.
function buildCollapsedRow(node, depth) {
    const row = document.createElement('div');
    row.className = 'structureCollapsedRow';
    row.style.setProperty('--structure-depth', String(depth));
    row.textContent = '× ' + node.count + ' ' + node.tag + ' rows';
    return row;
}

// Render a region row: a caret (when it has children) toggles its nested
// regions; tapping the row body selects it, driving the shared action toolbar.
// Off-screen regions render dimmed. Depth drives the left indent.
function buildRegionRow(node, depth) {
    const wrap = document.createElement('div');
    wrap.className = 'structureRegionWrap';

    const hasChildren = node.children && node.children.length;

    const row = document.createElement('div');
    row.className = 'structureRegionRow';
    if (!node.visible) row.classList.add('structureRegionRow--dim');
    row.style.setProperty('--structure-depth', String(depth));
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-pressed', 'false');
    row.dataset.handleKind = 'live';
    row.dataset.handleValue = node.selector;

    const caret = document.createElement('span');
    caret.className = 'structureRegionCaret';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = hasChildren ? '▸' : '';
    if (!hasChildren) caret.classList.add('structureRegionCaret--leaf');
    row.appendChild(caret);

    const label = document.createElement('span');
    label.className = 'structureRegionLabel';
    label.textContent = node.label;
    row.appendChild(label);

    const selHint = document.createElement('span');
    selHint.className = 'structureRegionSelector';
    selHint.textContent = node.selector;
    row.appendChild(selHint);

    const childWrap = document.createElement('div');
    childWrap.className = 'structureRegionChildren';
    // The live map defaults to collapsed; a persisted open selector reopens it.
    const startExpanded = hasChildren && openRegions.has(node.selector);
    childWrap.hidden = !startExpanded;
    if (startExpanded) row.classList.add('expanded');

    if (hasChildren) {
        caret.addEventListener('click', function (event) {
            event.stopPropagation();
            const nowOpen = childWrap.hidden;
            childWrap.hidden = !nowOpen;
            row.classList.toggle('expanded', nowOpen);
            if (nowOpen) openRegions.add(node.selector);
            else openRegions.delete(node.selector);
            persistActiveLensState(selectedRepo, lens);
        });
        node.children.forEach(function (child) {
            if (child.type === 'collapsed') childWrap.appendChild(buildCollapsedRow(child, depth + 1));
            else childWrap.appendChild(buildRegionRow(child, depth + 1));
        });
    }

    const select = function () {
        selectHandle({
            kind: 'live',
            label: node.label,
            value: node.selector,
            copyLabel: 'Copy selector',
            repo: selectedRepo,
            file: null,
            line: null,
            visible: node.visible,
        }, row);
        // Two-way sync: when the block canvas is mounted, tapping a tree row —
        // including one deeper than the current drill level — drills the canvas
        // to the row's parent so its block is visible and highlighted. Skip when
        // the tap deselected (selection cleared) so the canvas doesn't drill on
        // a toggle-off.
        if (canvasActive && selectedHandle && selectedHandle.value === node.selector) {
            revealSelector(node.selector);
        }
    };
    row.addEventListener('click', select);
    row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            select();
        }
    });

    wrap.appendChild(row);
    wrap.appendChild(childWrap);
    return wrap;
}

// A gentle full-width notice row inside the tree (no-map / no-surface states).
function appendUiNotice(treeEl, text) {
    const empty = document.createElement('div');
    empty.className = 'structureNoUiMap';
    empty.textContent = text;
    treeEl.appendChild(empty);
}

// One row of the published UI map: a handle's label + selector. Tapping it
// selects the handle, driving the shared toolbar (Find in code + a "View on
// GitHub" link to its defining file). Static (no live DOM) — the map comes from
// `regions`. `depth` drives the left indent so rows nest beneath their
// file-group header.
function buildPublishedRegionRow(repo, region, depth) {
    const indent = typeof depth === 'number' ? depth : 0;
    const wrap = document.createElement('div');
    wrap.className = 'structureRegionWrap';

    const row = document.createElement('div');
    row.className = 'structureRegionRow';
    row.style.setProperty('--structure-depth', String(indent));
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-pressed', 'false');
    row.dataset.handleKind = 'published';
    row.dataset.handleValue = region.selector;

    const caret = document.createElement('span');
    caret.className = 'structureRegionCaret structureRegionCaret--leaf';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '';
    row.appendChild(caret);

    const label = document.createElement('span');
    label.className = 'structureRegionLabel';
    label.textContent = region.label || region.selector;
    row.appendChild(label);

    const selHint = document.createElement('span');
    selHint.className = 'structureRegionSelector';
    selHint.textContent = region.selector;
    row.appendChild(selHint);

    const select = function () {
        selectHandle({
            kind: 'published',
            label: region.label || region.selector,
            value: region.selector,
            copyLabel: 'Copy selector',
            repo: repo,
            file: region.file,
            line: region.line,
        }, row);
    };
    row.addEventListener('click', select);
    row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            select();
        }
    });

    wrap.appendChild(row);
    return wrap;
}

// Render the published UI map (a non-running repo) from its manifest result.
// State precedence: a repo with no DOM at all → "No UI surface"; a manifest that
// predates the UI index (no `regions` key) → "not built yet"; no fetchable
// manifest → "no manifest"; otherwise the flat handle→file list.
function renderPublishedUiMap(repo, result, treeEl) {
    if (result && result.hasDom === false) {
        appendUiNotice(treeEl, 'No UI surface for this repo.');
        return;
    }
    if (result && result.ok && result.regions === undefined) {
        appendUiNotice(treeEl, 'UI map not built yet — redeploy with the updated build step.');
        return;
    }
    if (!result || !result.ok) {
        appendUiNotice(treeEl, 'No manifest published yet for this repo.');
        return;
    }
    const regions = Array.isArray(result.regions) ? result.regions : [];
    if (!regions.length) {
        appendUiNotice(treeEl, 'No mappable regions found.');
        return;
    }
    const banner = document.createElement('div');
    banner.className = 'structurePublishedBanner';
    banner.textContent = 'Published UI map — as of last deploy.';
    treeEl.appendChild(banner);

    // The published map can't reconstruct DOM containment, but every region
    // carries its defining file — so group the rows under collapsible file
    // headers (reusing the Code lens's folder-row vocabulary) to give the map a
    // foldable structure. Files alphabetical; rows within a file by line.
    const byFile = new Map();
    regions.forEach(function (region) {
        const file = region.file || '(unknown file)';
        if (!byFile.has(file)) byFile.set(file, []);
        byFile.get(file).push(region);
    });

    Array.from(byFile.keys()).sort().forEach(function (file) {
        const fileRegions = byFile.get(file).slice().sort(function (a, b) {
            const la = typeof a.line === 'number' ? a.line : 0;
            const lb = typeof b.line === 'number' ? b.line : 0;
            return la - lb;
        });
        treeEl.appendChild(buildPublishedFileGroup(repo, file, fileRegions));
    });
}

// A collapsible file header for the published UI map: every region defined in
// `file` nests beneath it. Defaults to expanded (so all handles are visible on
// open); the user's fold choice persists across re-renders via
// `collapsedPublishedFiles`. Reuses the Code lens's folder-row styling.
function buildPublishedFileGroup(repo, file, fileRegions) {
    const expanded = !collapsedPublishedFiles.has(file);

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'structureFolderRow';
    head.style.setProperty('--structure-depth', '0');
    head.setAttribute('aria-expanded', expanded ? 'true' : 'false');

    const caret = document.createElement('span');
    caret.className = 'structureFolderCaret';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '▸';
    head.appendChild(caret);

    const label = document.createElement('span');
    label.className = 'structureFolderName';
    label.textContent = file;
    head.appendChild(label);

    const childWrap = document.createElement('div');
    childWrap.className = 'structureFolderChildren';
    if (!expanded) childWrap.hidden = true;

    fileRegions.forEach(function (region) {
        childWrap.appendChild(buildPublishedRegionRow(repo, region, 1));
    });

    head.addEventListener('click', function () {
        // Direction follows the live DOM so a collapse/expand-all bulk fold stays
        // in sync with this header's own chevron.
        const nowOpen = childWrap.hidden;
        if (nowOpen) collapsedPublishedFiles.delete(file);
        else collapsedPublishedFiles.add(file);
        head.classList.toggle('expanded', nowOpen);
        head.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
        childWrap.hidden = !nowOpen;
        persistActiveLensState(repo, lens);
    });
    if (expanded) head.classList.add('expanded');

    const group = document.createElement('div');
    group.className = 'structurePublishedFileGroup';
    group.appendChild(head);
    group.appendChild(childWrap);
    return group;
}

// Render the UI lens into the tree container. The running app maps live (and its
// manifest is loaded in the background so "Find in code" can resolve live
// selectors); any other repo renders its published map from the build-time
// index, with distinct empty states.
function renderUiLens(repo, treeEl) {
    clear(treeEl);
    canvasActive = false;
    if (repo === getRunningAppRepo()) {
        // Warm the region index so live-region "Find in code" resolves.
        ensureRegionsLoaded(repo);
        const tree = buildUiTree();
        if (!tree.length) {
            appendUiNotice(treeEl, 'No mappable regions found.');
            return;
        }
        // The container tree pane: the familiar live-region rows (kept as-is so
        // Reference / Copy / Find-in-code and the shared toolbar all still work).
        tree.forEach(function (node) {
            if (node.type === 'collapsed') treeEl.appendChild(buildCollapsedRow(node, 0));
            else treeEl.appendChild(buildRegionRow(node, 0));
        });
        // The app's own repo also gets the drillable block canvas mounted above
        // the tree, sized from the live layout snapshot; ghost rows go amber.
        if (repo === SELF_REPO) {
            canvasActive = true;
            const pane = renderStructureCanvas(treeEl, {
                repo: repo,
                tree: tree,
                onSelect: selectFromCanvas,
                onReference: selectFromCanvas,
                onViewCode: viewCodeFromCanvas,
                // The deployed-site capture is a manual fallback alongside the live
                // auto-capture: the live map (and its ↻) re-measures the on-screen DOM,
                // which on mobile can catch a mid-transition / zero-size layout, so the
                // chip's Capture/Re-capture button forces a clean deployed measure.
                onRecapture: function () { startGuestCapture(repo, treeEl); },
            });
            markGhostRows(treeEl);
            // The capture affordance now lives in the snapshot chip (via onRecapture),
            // so the tree-top control carries only the status/error line — placed above
            // the canvas, right by the chip, so progress stays visible near the button.
            insertCaptureControlAtTop(treeEl, buildCaptureControl(repo, treeEl, false), pane);
        }
        return;
    }

    const loading = document.createElement('div');
    loading.className = 'structureTreeLoading';
    loading.textContent = 'Loading UI map…';
    treeEl.appendChild(loading);

    return ensureRegionsLoaded(repo).then(function (result) {
        // Drop a stale result if the repo or lens changed mid-flight.
        if (repo !== selectedRepo || lens !== 'ui') return;
        clear(treeEl);
        renderPublishedUiMap(repo, result, treeEl);
    });
}

// One row in the Types lens — a type (kind + name) or one of its members
// (signature). Tapping the row body selects it, driving the shared toolbar
// (Reference in chat + Copy name, Find in code, and a View-on-GitHub deep link
// to the defining file at the row's line). A type row additionally nests its
// members as collapsible children (depth + 1), so the filter's ancestor-reveal
// surfaces a type when one of its members matches. `spec` is
// { label, name, file, line, members? }.
function buildTypeOutlineRow(repo, spec, depth) {
    const wrap = document.createElement('div');
    wrap.className = 'structureRegionWrap';

    const members = Array.isArray(spec.members) ? spec.members : [];
    const hasChildren = members.length > 0;

    const row = document.createElement('div');
    row.className = 'structureRegionRow';
    row.style.setProperty('--structure-depth', String(depth));
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-pressed', 'false');
    row.dataset.handleKind = 'type';
    row.dataset.handleValue = spec.name;

    const caret = document.createElement('span');
    caret.className = 'structureRegionCaret';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = hasChildren ? '▸' : '';
    if (!hasChildren) caret.classList.add('structureRegionCaret--leaf');
    row.appendChild(caret);

    const label = document.createElement('span');
    label.className = 'structureRegionLabel structureTypeLabel';
    label.textContent = spec.label;
    row.appendChild(label);

    // Member children: visible by default so the outline reads fully on open; the
    // caret collapses them (ephemeral — only file-group folds persist).
    const childWrap = document.createElement('div');
    childWrap.className = 'structureRegionChildren';
    childWrap.hidden = !hasChildren;
    if (hasChildren) {
        row.classList.add('expanded');
        caret.addEventListener('click', function (event) {
            event.stopPropagation();
            const nowOpen = childWrap.hidden;
            childWrap.hidden = !nowOpen;
            row.classList.toggle('expanded', nowOpen);
        });
        members.forEach(function (member) {
            childWrap.appendChild(buildTypeOutlineRow(repo, {
                label: member.signature || member.name || '',
                name: member.name || '',
                file: spec.file,
                line: member.line,
            }, depth + 1));
        });
    }

    const select = function () {
        selectHandle({
            kind: 'type',
            label: spec.label,
            value: spec.name,
            copyLabel: 'Copy name',
            repo: repo,
            file: spec.file,
            line: spec.line,
        }, row);
    };
    row.addEventListener('click', select);
    row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            select();
        }
    });

    wrap.appendChild(row);
    wrap.appendChild(childWrap);
    return wrap;
}

// A collapsible file header for the Types lens: every type defined in `file`
// (and its members) nests beneath it. Mirrors buildPublishedFileGroup — defaults
// to expanded, persists the user's fold choice in `collapsedTypeFiles` under the
// `<repo>:types` key, and reuses the Code lens's folder-row styling.
function buildTypeFileGroup(repo, file, fileTypes) {
    const expanded = !collapsedTypeFiles.has(file);

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'structureFolderRow';
    head.style.setProperty('--structure-depth', '0');
    head.setAttribute('aria-expanded', expanded ? 'true' : 'false');

    const caret = document.createElement('span');
    caret.className = 'structureFolderCaret';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '▸';
    head.appendChild(caret);

    const label = document.createElement('span');
    label.className = 'structureFolderName';
    label.textContent = file;
    head.appendChild(label);

    const childWrap = document.createElement('div');
    childWrap.className = 'structureFolderChildren';
    if (!expanded) childWrap.hidden = true;

    fileTypes.forEach(function (type) {
        childWrap.appendChild(buildTypeOutlineRow(repo, {
            label: ((type.kind ? type.kind + ' ' : '') + (type.name || '')).trim(),
            name: type.name || '',
            file: type.file,
            line: type.line,
            members: type.members,
        }, 1));
    });

    head.addEventListener('click', function () {
        // Direction follows the live DOM so a collapse/expand-all bulk fold stays
        // in sync with this header's own chevron.
        const nowOpen = childWrap.hidden;
        if (nowOpen) collapsedTypeFiles.delete(file);
        else collapsedTypeFiles.add(file);
        head.classList.toggle('expanded', nowOpen);
        head.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
        childWrap.hidden = !nowOpen;
        persistActiveLensState(repo, lens);
    });
    if (expanded) head.classList.add('expanded');

    const group = document.createElement('div');
    group.className = 'structurePublishedFileGroup';
    group.appendChild(head);
    group.appendChild(childWrap);
    return group;
}

// Render the Types lens: the manifest's `types` grouped by defining file under
// collapsible headers, each type expanding into its member outline. Files
// alphabetical; types within a file by line. Empty → the structure empty notice.
function renderTypesLens(repo, treeEl) {
    clear(treeEl);
    if (!currentTypes.length) {
        appendUiNotice(treeEl, 'No types found in this repo’s source.');
        return;
    }

    const byFile = new Map();
    currentTypes.forEach(function (type) {
        const file = (type && type.file) || '(unknown file)';
        if (!byFile.has(file)) byFile.set(file, []);
        byFile.get(file).push(type);
    });

    Array.from(byFile.keys()).sort().forEach(function (file) {
        const fileTypes = byFile.get(file).slice().sort(function (a, b) {
            const la = typeof a.line === 'number' ? a.line : 0;
            const lb = typeof b.line === 'number' ? b.line : 0;
            return la - lb;
        });
        treeEl.appendChild(buildTypeFileGroup(repo, file, fileTypes));
    });
}

// ── SQL LENS ──────────────────────────────────────────────────────────────────
// The sql-mode manifest's `tables` outline: `.sql` files → tables → columns and
// table-level constraints. Modeled on the Types lens (file groups + tree rows +
// the shared selection toolbar); only the column-row template is new. Type and
// constraint chips are derived from each row's `signature` at render time — the
// manifest carries no structured fields, so nothing here depends on the
// generator.

// A small hollow table glyph (DOM-built inline SVG, no icon library) shown left
// of a table row's name, mirroring how the UI/Types rows carry their own marks.
function buildSqlTableGlyph() {
    const span = document.createElement('span');
    span.className = 'structureSqlTableGlyph';
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
        'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="3" y="4" width="18" height="16" rx="2"/>' +
        '<path d="M3 9h18"/><path d="M9 9v11"/></svg>';
    return span;
}

// A small pill/chip carrying `text`, styled by `cls` (a modifier over the shared
// `.structureSqlChip` base). Used for column constraint chips (PK / NOT NULL /
// UNIQUE / DEFAULT), the accent FK pill, and constraint-row keyword chips.
function buildSqlChip(text, cls) {
    const chip = document.createElement('span');
    chip.className = 'structureSqlChip' + (cls ? ' ' + cls : '');
    chip.textContent = text;
    return chip;
}

// Split a column `signature` into its type token and remaining constraint source.
// The signature reads `<name> <type> <constraints…>`, so the leading name token
// is dropped (when it matches `name`), the next token is the type, and whatever
// follows is the raw constraint source the chips are parsed from.
function parseColumnSignature(name, signature) {
    const tokens = String(signature || '').trim().split(/\s+/).filter(Boolean);
    let rest = tokens;
    if (tokens.length && name && tokens[0].toLowerCase() === String(name).toLowerCase()) {
        rest = tokens.slice(1);
    }
    const type = rest.length ? rest[0] : '';
    const constraintSrc = rest.slice(1).join(' ');
    return { type: type, constraintSrc: constraintSrc };
}

// Constraint chips parsed from a column's post-type source, in a stable order:
// PK (PRIMARY KEY), NOT NULL, UNIQUE, DEFAULT <val>. Case-insensitive; absent
// keywords are simply omitted.
function columnConstraintChips(constraintSrc) {
    const src = String(constraintSrc || '');
    const upper = src.toUpperCase();
    const chips = [];
    if (upper.indexOf('PRIMARY KEY') !== -1) chips.push('PK');
    if (/\bNOT\s+NULL\b/.test(upper)) chips.push('NOT NULL');
    if (/\bUNIQUE\b/.test(upper)) chips.push('UNIQUE');
    const def = src.match(/\bDEFAULT\s+(\S+)/i);
    if (def) chips.push('DEFAULT ' + def[1]);
    return chips;
}

// The constraint keyword a table-level constraint's `signature` opens with, as
// { keyword, tail }. FOREIGN KEY / PRIMARY KEY are checked before their bare
// KEY-less siblings so the two-word forms win. Returns null when no keyword is
// recognized (the whole signature becomes the tail).
function parseConstraintSignature(signature) {
    const sig = String(signature || '').trim();
    const upper = sig.toUpperCase();
    const keywords = ['FOREIGN KEY', 'PRIMARY KEY', 'UNIQUE', 'CHECK'];
    for (let i = 0; i < keywords.length; i++) {
        const kw = keywords[i];
        const at = upper.indexOf(kw);
        if (at !== -1) {
            return { keyword: kw, tail: sig.slice(at + kw.length).trim() };
        }
    }
    return { keyword: '', tail: sig };
}

// One column row in the SQL lens: the column name, its type token, constraint
// chips, and — when `col.ref` is set — an accent FK pill reading `→ <ref>`.
// Selecting it drives the shared toolbar exactly like a Types row (Copy name /
// Reference / Find / GitHub). Table-level constraint rows (kind:"constraint")
// render as a chip-row instead: a keyword chip, the constraint name, and the
// expression tail.
function buildSqlColumnRow(repo, table, col, depth) {
    const wrap = document.createElement('div');
    wrap.className = 'structureRegionWrap';

    const row = document.createElement('div');
    row.className = 'structureRegionRow';
    row.style.setProperty('--structure-depth', String(depth));
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-pressed', 'false');

    const isConstraint = col && col.kind === 'constraint';
    row.dataset.handleKind = isConstraint ? 'sql-constraint' : 'sql-column';
    row.dataset.handleValue = (col && col.name) || '';

    const caret = document.createElement('span');
    caret.className = 'structureRegionCaret structureRegionCaret--leaf';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '';
    row.appendChild(caret);

    // The label the filter matches on (and the toolbar's Reference label) is the
    // row's name; the type/chips/FK pill sit beside it as non-matching detail.
    const label = document.createElement('span');
    label.className = 'structureRegionLabel structureSqlColName';
    label.textContent = (col && col.name) || '';
    row.appendChild(label);

    if (isConstraint) {
        row.classList.add('structureSqlConstraintRow');
        const parsed = parseConstraintSignature(col && col.signature);
        if (parsed.keyword) {
            row.insertBefore(buildSqlChip(parsed.keyword, 'structureSqlChip--kw'), label);
        }
        if (parsed.tail) {
            const tail = document.createElement('span');
            tail.className = 'structureSqlConstraintTail';
            tail.textContent = parsed.tail;
            row.appendChild(tail);
        }
    } else {
        const parsed = parseColumnSignature(col && col.name, col && col.signature);
        if (parsed.type) {
            const type = document.createElement('span');
            type.className = 'structureSqlColType';
            type.textContent = parsed.type;
            row.appendChild(type);
        }
        columnConstraintChips(parsed.constraintSrc).forEach(function (text) {
            row.appendChild(buildSqlChip(text, 'structureSqlChip--constraint'));
        });
        if (col && col.ref) {
            row.appendChild(buildSqlChip('→ ' + col.ref, 'structureSqlFkPill'));
        }
    }

    const select = function () {
        selectHandle({
            kind: row.dataset.handleKind,
            label: (col && col.name) || '',
            value: (col && col.name) || '',
            copyLabel: 'Copy name',
            repo: repo,
            file: table && table.file,
            line: col && col.line,
        }, row);
    };
    row.addEventListener('click', select);
    row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            select();
        }
    });

    // A leaf row: an empty children wrap keeps the filter/collapse plumbing (which
    // walks `.structureRegionChildren`) uniform with the type/region rows.
    const childWrap = document.createElement('div');
    childWrap.className = 'structureRegionChildren';
    childWrap.hidden = true;

    wrap.appendChild(row);
    wrap.appendChild(childWrap);
    return wrap;
}

// One table row in the SQL lens: a table glyph, the table name, and a muted
// "N cols" count. Its columns/constraints nest as collapsible children (depth+1)
// so the filter's ancestor-reveal surfaces a table when one of its columns
// matches. Selecting the row drives the shared toolbar (Copy name / Reference /
// Find / GitHub) against the table.
function buildSqlTableRow(repo, table) {
    const wrap = document.createElement('div');
    wrap.className = 'structureRegionWrap';

    const columns = Array.isArray(table.columns) ? table.columns : [];
    const hasChildren = columns.length > 0;
    const colCount = columns.filter(function (c) { return !c || c.kind !== 'constraint'; }).length;

    const row = document.createElement('div');
    row.className = 'structureRegionRow structureSqlTableRow';
    row.style.setProperty('--structure-depth', '1');
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-pressed', 'false');
    row.dataset.handleKind = 'sql-table';
    row.dataset.handleValue = table.name || '';

    const caret = document.createElement('span');
    caret.className = 'structureRegionCaret';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = hasChildren ? '▸' : '';
    if (!hasChildren) caret.classList.add('structureRegionCaret--leaf');
    row.appendChild(caret);

    row.appendChild(buildSqlTableGlyph());

    const label = document.createElement('span');
    label.className = 'structureRegionLabel structureSqlTableName';
    label.textContent = table.name || '';
    row.appendChild(label);

    const count = document.createElement('span');
    count.className = 'structureSqlColCount';
    count.textContent = colCount + (colCount === 1 ? ' col' : ' cols');
    row.appendChild(count);

    const childWrap = document.createElement('div');
    childWrap.className = 'structureRegionChildren';
    childWrap.hidden = !hasChildren;
    if (hasChildren) {
        row.classList.add('expanded');
        caret.addEventListener('click', function (event) {
            event.stopPropagation();
            const nowOpen = childWrap.hidden;
            childWrap.hidden = !nowOpen;
            row.classList.toggle('expanded', nowOpen);
        });
        columns.forEach(function (col) {
            childWrap.appendChild(buildSqlColumnRow(repo, table, col, 2));
        });
    }

    const select = function () {
        selectHandle({
            kind: 'sql-table',
            label: table.name || '',
            value: table.name || '',
            copyLabel: 'Copy name',
            repo: repo,
            file: table.file,
            line: table.line,
        }, row);
    };
    row.addEventListener('click', select);
    row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            select();
        }
    });

    wrap.appendChild(row);
    wrap.appendChild(childWrap);
    return wrap;
}

// A collapsible `.sql` file header for the SQL lens: every table defined in
// `file` nests beneath it. Mirrors buildTypeFileGroup — defaults to expanded,
// persists the fold choice in `collapsedSqlFiles` under the `<repo>:sql` key,
// and reuses the Code lens's folder-row styling.
function buildSqlFileGroup(repo, file, fileTables) {
    const expanded = !collapsedSqlFiles.has(file);

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'structureFolderRow';
    head.style.setProperty('--structure-depth', '0');
    head.setAttribute('aria-expanded', expanded ? 'true' : 'false');

    const caret = document.createElement('span');
    caret.className = 'structureFolderCaret';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '▸';
    head.appendChild(caret);

    const label = document.createElement('span');
    label.className = 'structureFolderName';
    label.textContent = file;
    head.appendChild(label);

    const childWrap = document.createElement('div');
    childWrap.className = 'structureFolderChildren';
    if (!expanded) childWrap.hidden = true;

    fileTables.forEach(function (table) {
        childWrap.appendChild(buildSqlTableRow(repo, table));
    });

    head.addEventListener('click', function () {
        const nowOpen = childWrap.hidden;
        if (nowOpen) collapsedSqlFiles.delete(file);
        else collapsedSqlFiles.add(file);
        head.classList.toggle('expanded', nowOpen);
        head.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
        childWrap.hidden = !nowOpen;
        persistActiveLensState(repo, lens);
    });
    if (expanded) head.classList.add('expanded');

    const group = document.createElement('div');
    group.className = 'structurePublishedFileGroup';
    group.appendChild(head);
    group.appendChild(childWrap);
    return group;
}

// Render the SQL lens: the manifest's `tables` grouped by defining `.sql` file
// under collapsible headers, each table expanding into its column/constraint
// outline. Files alphabetical; tables within a file by line. Empty → the
// structure empty notice.
function renderSqlLens(repo, treeEl) {
    clear(treeEl);
    if (!currentTables.length) {
        appendUiNotice(treeEl, 'No tables found in this repo’s schema.');
        return;
    }

    const byFile = new Map();
    currentTables.forEach(function (table) {
        const file = (table && table.file) || '(unknown file)';
        if (!byFile.has(file)) byFile.set(file, []);
        byFile.get(file).push(table);
    });

    Array.from(byFile.keys()).sort().forEach(function (file) {
        const fileTables = byFile.get(file).slice().sort(function (a, b) {
            const la = typeof a.line === 'number' ? a.line : 0;
            const lb = typeof b.line === 'number' ? b.line : 0;
            return la - lb;
        });
        treeEl.appendChild(buildSqlFileGroup(repo, file, fileTables));
    });
}

// Render the toggle's second slot — adaptive between the UI lens and the Types
// lens by the active repo's manifest. The manifest's `lens` isn't known until it
// loads, so this resolves it first, then normalizes the active lens to this
// repo's second-slot identity (the persisted choice is "Code vs second slot", not
// a literal lens id), relabels the toggle segment, and renders the right lens.
function renderSecondLens(repo, treeEl) {
    clear(treeEl);
    const loading = document.createElement('div');
    loading.className = 'structureTreeLoading';
    loading.textContent = 'Loading…';
    treeEl.appendChild(loading);

    return ensureRegionsLoaded(repo).then(function (result) {
        // Drop a stale result if the repo or lens changed mid-flight (e.g. the
        // user switched to Code, or to another project, while this was loading).
        if (repo !== selectedRepo || lens === 'code') return;
        // Adopt this repo's second-slot identity. When it differs from the
        // persisted choice (`ui` ↔ `types`), switch the active lens and re-hydrate
        // its fold set so the correct `<repo>:<lens>` state drives the outline.
        if (lens !== currentLens) {
            lens = currentLens;
            hydrateActiveLensState(repo, lens);
        }
        relabelSecondLensSegment();
        applyLensToggleState();
        updateFilterPlaceholder();
        clear(treeEl);
        if (currentLens === 'types') {
            renderTypesLens(repo, treeEl);
        } else if (currentLens === 'sql') {
            renderSqlLens(repo, treeEl);
        } else {
            renderGuestUiLens(repo, result, treeEl);
        }
    });
}

// A non-self (guest) repo's UI lens: the deployed-site block canvas when a
// capture exists, the "Capture layout from deployed site" trigger otherwise, and
// the published UI map beneath either. The canvas mounts only once the repo has
// stored geometry (renderStructureCanvas returns null until then), so a
// never-captured guest shows just the trigger + published map — exactly as
// before. The trigger never appears on the self repo (which flows through
// renderUiLens) nor on the Types lens (a different branch), and is suppressed for
// a repo whose manifest reports no UI surface at all.
function renderGuestUiLens(repo, result, treeEl) {
    canvasActive = false;
    const canvas = renderStructureCanvas(treeEl, {
        repo: repo,
        onSelect: selectFromCanvas,
        onReference: selectFromCanvas,
        onViewCode: viewCodeFromCanvas,
        onRecapture: function () { startGuestCapture(repo, treeEl); },
    });
    if (canvas) canvasActive = true;

    // A repo the manifest flags as having no browser UI (hasDom:false) can't be
    // captured; every other guest repo gets the trigger (a deployed page may exist
    // even when no manifest is published yet).
    const canCapture = !(result && result.hasDom === false);
    if (canvas || canCapture) {
        // Guest: show the standalone button only when no canvas is mounted yet —
        // once it is, the snapshot chip's Re-capture covers the deployed re-measure.
        // Placed above the canvas via the shared helper so the control's DOM position
        // stays symmetric with the self repo (with no canvas mounted the helper falls
        // back to appending, which keeps the buttoned control at the top as before).
        insertCaptureControlAtTop(treeEl, buildCaptureControl(repo, treeEl, !canvas), canvas);
    }

    renderPublishedUiMap(repo, result, treeEl);
    if (canvas) markGhostRows(treeEl);
}

// The capture status line — and, in the never-captured guest state, a compact
// capture button. Every other state hosts the capture affordance in the snapshot
// chip (via `onRecapture`); but a guest with no capture yet has no canvas, and so
// no chip, so `showButton` renders the same compact chip-style "Capture" button
// here in the tree's top slot to keep the flow reachable. The status/error line is
// always present, module-scoped so the async capture flow can write progress +
// failure notices into it after a repaint.
// Place the capture control at the top of the tree/canvas area. When a canvas pane
// is mounted the control is inserted directly BEFORE it (the pane is treeEl's first
// child), so the status line — and the never-captured guest's compact button — sits
// near the top, right by the snapshot chip, on both the self repo and captured guest
// repos. With no canvas the control is appended, which still lands it at the top
// (nothing precedes it yet). Both render paths share this so placement can't drift.
function insertCaptureControlAtTop(treeEl, control, pane) {
    if (pane) treeEl.insertBefore(control, pane);
    else treeEl.appendChild(control);
}

function buildCaptureControl(repo, treeEl, showButton) {
    const control = document.createElement('div');
    control.className = 'structureCaptureControl';

    if (showButton) {
        // Never-captured guest: no canvas/chip exists yet, so render the same compact
        // chip-style button here. It reads "Capture" (no geometry stored) and matches
        // the chip button's style so the affordance looks identical across states.
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'structureCanvasRecapture';
        btn.textContent = 'Capture';
        btn.setAttribute('aria-label', 'Capture layout from the deployed site');
        btn.title = 'Capture from deployed site';
        btn.addEventListener('click', function () { startGuestCapture(repo, treeEl); });
        control.appendChild(btn);
    }

    const status = document.createElement('div');
    status.className = 'structureCaptureStatus';
    status.hidden = true;
    control.appendChild(status);
    captureStatusEl = status;

    return control;
}

// Write a progress or error line into the active capture status element. `tone` is
// 'progress' or 'error'; an empty text hides the line.
function setCaptureStatus(text, tone) {
    const el = captureStatusEl;
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
    el.classList.toggle('structureCaptureStatus--error', tone === 'error');
}

// Run the deployed-site capture for a guest repo, then repaint the UI lens so the
// fresh canvas mounts. Progress rides the status line; any failure (unreachable
// page / timeout / cross-origin) leaves the prior capture untouched and shows a
// quiet mono notice.
function startGuestCapture(repo, treeEl) {
    setCaptureStatus('Measuring deployed site…', 'progress');
    // Source the guest's meaningful class selectors from its manifest so the
    // walk keeps class-identified regions (a class-based app whose only id is its
    // mount point). ensureRegionsLoaded is cached, so this reuses the manifest the
    // UI lens already loaded. A repo with an id-only (or empty) manifest yields a
    // null set, leaving the id/role walk unchanged.
    return ensureRegionsLoaded(repo).then(function (result) {
        const knownClasses = knownClassSet(result && result.regions);
        // The class→label map lets the walk label class-kept regions with their
        // published section names ("Nav Section") instead of their tags ("div").
        const classLabels = classLabelMap(result && result.regions);
        return captureRemote(repo, {
            onProgress: function (msg) { setCaptureStatus(msg, 'progress'); },
            knownClasses: knownClasses,
            classLabels: classLabels,
        });
    }).then(function (res) {
        // Drop a stale result if the repo or lens changed mid-capture.
        if (repo !== selectedRepo || lens === 'code' || currentLens !== 'ui') return;
        if (res && res.ok) {
            renderLens(selectedRepo, treeEl);
        } else {
            setCaptureStatus('Couldn’t reach a deployed site for this repo.', 'error');
        }
    }).catch(function () {
        if (repo !== selectedRepo) return;
        setCaptureStatus('Couldn’t reach a deployed site for this repo.', 'error');
    });
}

// Dispatch the active lens into the shared tree container. The second slot is
// adaptive: the running app is always the live UI map; any other repo resolves
// its second lens (UI or Types) from the manifest via renderSecondLens.
function renderLens(repo, treeEl) {
    if (lens === 'code') {
        // Return the paint promise so callers that chain on it (filter re-apply,
        // find-in-code flash, the collapse-all pill refresh) run after the tree
        // is actually painted, not on the next microtask.
        return renderTree(repo, treeEl);
    }
    if (repo === getRunningAppRepo()) {
        // The running app is the web app — always the live UI map, never Types.
        currentLens = 'ui';
        relabelSecondLensSegment();
        applyLensToggleState();
        return renderUiLens(repo, treeEl);
    }
    return renderSecondLens(repo, treeEl);
}

// ── FILTER ──────────────────────────────────────────────────────────────────
// One live filter narrows whichever lens is showing: in the Code lens by file
// name/path, in the UI lens by a region's label or selector (and, for the
// published map, its grouping file). It walks the already-rendered DOM and
// toggles a `.structureFilterHidden` class plus an ancestor-reveal so matches
// stay reachable — never a re-render — preserving Explain results and fold state.

function matchesQuery(text, q) {
    return !!q && String(text).toLowerCase().indexOf(q) !== -1;
}

function setFilterHidden(el, hide) {
    el.classList.toggle('structureFilterHidden', hide);
}

// True when neither `el` nor any ancestor up to (not including) `tree` is
// filter-hidden — used to count genuinely visible leaves regardless of which
// level hid them (a leaf can be hidden by its own row or by an ancestor group).
function isFilterVisible(el, tree) {
    let n = el;
    while (n && n !== tree) {
        if (n.classList && n.classList.contains('structureFilterHidden')) return false;
        n = n.parentElement;
    }
    return true;
}

// The container-open head for a child-wrap, so an ancestor-reveal can mark it
// expanded: code/published folder children sit beside their folder-row head; a
// live region's children sit inside the region wrap beside its row.
function headForChildWrap(cw) {
    if (cw.classList.contains('structureFolderChildren')) return cw.previousElementSibling;
    if (cw.classList.contains('structureRegionChildren')) {
        return cw.parentElement.querySelector(':scope > .structureRegionRow');
    }
    return null;
}

// Reveal a container while filtering, stashing its pre-filter hidden state once
// so the original fold state can be restored on clear. Folder heads carry
// aria-expanded; a live region/type row uses only the `expanded` class (its
// aria-pressed drives selection, not child fold, and must not be touched here).
function expandContainer(cw) {
    if (cw.dataset.filterPrev === undefined) cw.dataset.filterPrev = cw.hidden ? '1' : '0';
    cw.hidden = false;
    const head = headForChildWrap(cw);
    if (head) {
        head.classList.add('expanded');
        if (cw.classList.contains('structureFolderChildren') && head.hasAttribute('aria-expanded')) {
            head.setAttribute('aria-expanded', 'true');
        }
    }
}

// Restore a container's pre-filter fold state (mirror of expandContainer).
function restoreContainer(cw) {
    const wasHidden = cw.dataset.filterPrev === '1';
    cw.hidden = wasHidden;
    delete cw.dataset.filterPrev;
    const head = headForChildWrap(cw);
    if (head) {
        head.classList.toggle('expanded', !wasHidden);
        if (cw.classList.contains('structureFolderChildren') && head.hasAttribute('aria-expanded')) {
            head.setAttribute('aria-expanded', wasHidden ? 'false' : 'true');
        }
    }
}

// The pristine text of a label element — its stashed pre-highlight value when a
// highlight is currently applied, otherwise its live text.
function filterOrigText(el) {
    if (!el) return '';
    return el.dataset.filterOrig !== undefined ? el.dataset.filterOrig : el.textContent;
}

// Wrap each case-insensitive occurrence of `q` in `el`'s text with a <mark>,
// stashing the original so it can be restored. With no match, restore any prior
// highlight and leave the text plain.
function highlightIn(el, q) {
    if (!el) return;
    const orig = filterOrigText(el);
    const lower = orig.toLowerCase();
    const idx = q ? lower.indexOf(q) : -1;
    if (idx === -1) {
        if (el.dataset.filterOrig !== undefined) {
            el.textContent = orig;
            delete el.dataset.filterOrig;
        }
        return;
    }
    if (el.dataset.filterOrig === undefined) el.dataset.filterOrig = orig;
    el.textContent = '';
    let pos = 0;
    let i = lower.indexOf(q, pos);
    while (i !== -1) {
        if (i > pos) el.appendChild(document.createTextNode(orig.slice(pos, i)));
        const mark = document.createElement('mark');
        mark.className = 'structureFilterMark';
        mark.textContent = orig.slice(i, i + q.length);
        el.appendChild(mark);
        pos = i + q.length;
        i = lower.indexOf(q, pos);
    }
    if (pos < orig.length) el.appendChild(document.createTextNode(orig.slice(pos)));
}

function clearHighlight(el) {
    if (el && el.dataset.filterOrig !== undefined) {
        el.textContent = el.dataset.filterOrig;
        delete el.dataset.filterOrig;
    }
}

// Drop the filter overlay (hidden classes, highlights, fold stashes) under
// `root` so everything reads as freshly rendered again.
function unhideSubtree(root) {
    Array.prototype.forEach.call(root.querySelectorAll('.structureFilterHidden'), function (el) {
        el.classList.remove('structureFilterHidden');
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-filter-orig]'), function (el) {
        clearHighlight(el);
    });
}

// Filter the direct children of `container`, recursing into nested folders and
// region trees. Returns true when at least one descendant matched, so a parent
// can decide whether to stay visible and reveal itself.
function filterNodes(container, q) {
    let anyVisible = false;
    Array.prototype.forEach.call(container.children, function (el) {
        if (!el.classList) return;
        // Child-wraps are handled together with their head/row, not standalone.
        if (el.classList.contains('structureFolderChildren')) return;
        if (el.classList.contains('structureRegionChildren')) return;

        if (el.classList.contains('structureFolderRow')) {
            // Code-lens folder: head followed by its children wrap.
            const childWrap = el.nextElementSibling;
            const childMatched = childWrap ? filterNodes(childWrap, q) : false;
            setFilterHidden(el, !childMatched);
            if (childWrap) setFilterHidden(childWrap, !childMatched);
            if (childMatched) {
                if (childWrap) expandContainer(childWrap);
                anyVisible = true;
            }
            return;
        }

        if (el.classList.contains('structurePublishedFileGroup')) {
            const head = el.querySelector(':scope > .structureFolderRow');
            const childWrap = el.querySelector(':scope > .structureFolderChildren');
            const nameEl = head ? head.querySelector('.structureFolderName') : null;
            const fileMatch = matchesQuery(filterOrigText(nameEl), q);
            let groupVisible;
            if (fileMatch) {
                // The grouping file matched — surface the whole group's rows.
                if (childWrap) unhideSubtree(childWrap);
                highlightIn(nameEl, q);
                groupVisible = true;
            } else {
                clearHighlight(nameEl);
                groupVisible = childWrap ? filterNodes(childWrap, q) : false;
            }
            setFilterHidden(el, !groupVisible);
            if (groupVisible && childWrap) expandContainer(childWrap);
            if (groupVisible) anyVisible = true;
            return;
        }

        if (el.classList.contains('structureFileWrap')) {
            const m = matchesQuery(el.dataset.structureFile || '', q);
            setFilterHidden(el, !m);
            const nameEl = el.querySelector('.structureFileName');
            if (m) {
                highlightIn(nameEl, q);
                anyVisible = true;
            } else {
                clearHighlight(nameEl);
            }
            return;
        }

        if (el.classList.contains('structureRegionWrap')) {
            if (filterRegion(el, q)) anyVisible = true;
            return;
        }

        if (el.classList.contains('structureCollapsedRow')) {
            // A "× N rows" placeholder carries no searchable handle.
            setFilterHidden(el, true);
            return;
        }
    });
    return anyVisible;
}

// Filter one region wrap (live or published). A region shows when its own
// label/selector matches OR a descendant matches; a descendant match reveals
// the ancestor chain by expanding this wrap's children.
function filterRegion(wrap, q) {
    const row = wrap.querySelector(':scope > .structureRegionRow');
    const labelEl = row ? row.querySelector(':scope > .structureRegionLabel') : null;
    const selEl = row ? row.querySelector(':scope > .structureRegionSelector') : null;
    const text = (filterOrigText(labelEl) + ' ' + filterOrigText(selEl)).toLowerCase();
    const selfMatch = !!q && text.indexOf(q) !== -1;
    const childWrap = wrap.querySelector(':scope > .structureRegionChildren');
    const childMatched = childWrap ? filterNodes(childWrap, q) : false;
    const visible = selfMatch || childMatched;
    setFilterHidden(wrap, !visible);
    if (selfMatch) {
        highlightIn(labelEl, q);
        highlightIn(selEl, q);
    } else {
        clearHighlight(labelEl);
        clearHighlight(selEl);
    }
    if (visible && childMatched && childWrap) expandContainer(childWrap);
    return visible;
}

// Apply (or clear) the live filter against the current tree. Empty query →
// restore the full tree and its prior fold state; otherwise hide non-matches,
// reveal matched ancestors, refresh the "X of Y" count, and show a quiet
// no-match notice in place of the tree when nothing matches.
function applyStructureFilter(rawQuery) {
    filterQuery = rawQuery || '';
    const tree = currentTreeEl;
    if (!tree) return;
    const q = filterQuery.trim().toLowerCase();

    if (currentNoMatchEl && currentNoMatchEl.parentNode) {
        currentNoMatchEl.parentNode.removeChild(currentNoMatchEl);
    }
    currentNoMatchEl = null;

    if (filterClearEl) filterClearEl.hidden = filterQuery.length === 0;

    // The block canvas dims non-matching blocks (rather than removing them) so
    // the layout shape is preserved while filtering the tree below.
    if (canvasActive) applyCanvasFilter(q);

    if (!q) {
        Array.prototype.forEach.call(tree.querySelectorAll('.structureFilterHidden'), function (el) {
            el.classList.remove('structureFilterHidden');
        });
        Array.prototype.forEach.call(tree.querySelectorAll('[data-filter-prev]'), function (cw) {
            restoreContainer(cw);
        });
        Array.prototype.forEach.call(tree.querySelectorAll('[data-filter-orig]'), function (el) {
            clearHighlight(el);
        });
        if (filterCountEl) filterCountEl.textContent = '';
        return;
    }

    filterNodes(tree, q);

    const leafSel = lens === 'code' ? '.structureFileWrap' : '.structureRegionWrap';
    const leaves = tree.querySelectorAll(leafSel);
    let visible = 0;
    Array.prototype.forEach.call(leaves, function (el) {
        if (isFilterVisible(el, tree)) visible++;
    });
    if (filterCountEl) filterCountEl.textContent = visible + ' of ' + leaves.length;

    if (visible === 0) {
        const note = document.createElement('div');
        note.className = 'structureFilterNoMatch';
        note.textContent = 'No matches for “' + filterQuery.trim() + '”.';
        tree.appendChild(note);
        currentNoMatchEl = note;
    }
}

// Placeholder copy tracks the active lens (files vs handles).
function updateFilterPlaceholder() {
    if (!filterInputEl) return;
    let placeholder = 'Filter handles…';
    if (lens === 'code') placeholder = 'Filter files…';
    else if (lens === 'types') placeholder = 'Filter types…';
    else if (lens === 'sql') placeholder = 'Filter tables…';
    filterInputEl.placeholder = placeholder;
}

// Build the filter box: a magnifier glyph, the live input, an "X of Y" count,
// and a clear (×) button that appears only once there's text.
function buildFilterBox() {
    const box = document.createElement('div');
    box.className = 'structureFilterBox';

    const icon = document.createElement('span');
    icon.className = 'structureFilterIcon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML =
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
    box.appendChild(icon);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'structureFilterInput';
    input.setAttribute('aria-label', 'Filter the structure tree');
    box.appendChild(input);

    const count = document.createElement('span');
    count.className = 'structureFilterCount';
    count.setAttribute('aria-live', 'polite');
    box.appendChild(count);

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'structureFilterClear';
    clear.setAttribute('aria-label', 'Clear filter');
    clear.textContent = '×';
    clear.hidden = true;
    box.appendChild(clear);

    input.addEventListener('input', function () {
        applyStructureFilter(input.value);
    });
    clear.addEventListener('click', function () {
        input.value = '';
        applyStructureFilter('');
        input.focus();
    });

    filterInputEl = input;
    filterCountEl = count;
    filterClearEl = clear;
    return box;
}

// ── COLLAPSE / EXPAND ALL ─────────────────────────────────────────────────────
// The toolbar's single pill folds or unfolds every section of the active lens at
// once. A "section" is any collapsible node: a Code-lens folder or a published-
// map / Types file-group header (the .structureFolderRow + .structureFolderChildren
// pair, at any depth) and any live-UI region or Types type row that nests children
// (the .structureRegionRow + .structureRegionChildren pair). The bulk fold is
// UI-only — it drives the DOM and the per-section chevrons directly and never
// writes the persisted fold sets, so it resets on the next render (project switch
// / view re-entry), exactly as the chevrons it keeps in sync do.

let collapseToolbarEl = null;
let collapseAllBtn = null;

// Every collapsible section in `tree`, as { head, childWrap, kind } where kind is
// 'folder' (folder / file-group header) or 'region' (live region / type row). A
// region pair only counts when it actually nests child rows — a leaf region has
// an empty children wrap and no caret to keep in sync.
function structureSections(tree) {
    if (!tree) return [];
    const out = [];
    Array.prototype.forEach.call(tree.querySelectorAll('.structureFolderChildren'), function (cw) {
        const head = cw.previousElementSibling;
        if (head && head.classList && head.classList.contains('structureFolderRow')) {
            out.push({ head: head, childWrap: cw, kind: 'folder' });
        }
    });
    Array.prototype.forEach.call(tree.querySelectorAll('.structureRegionChildren'), function (cw) {
        if (!cw.children.length) return;
        const head = cw.parentElement
            ? cw.parentElement.querySelector(':scope > .structureRegionRow')
            : null;
        if (head) out.push({ head: head, childWrap: cw, kind: 'region' });
    });
    return out;
}

// Expand (expand=true) or collapse (expand=false) one section's DOM in place,
// mirroring its own chevron handler so the two never drift: show/hide the
// children wrap and toggle the head's `expanded` class. Folder heads also carry
// an aria-expanded that tracks their children; a region row's aria-pressed
// drives selection, not child fold, so it's left untouched (matching the filter's
// expandContainer). Any stashed filter fold state is updated too so clearing an
// active filter restores to this choice rather than the pre-bulk one.
function setSectionExpanded(section, expand) {
    section.childWrap.hidden = !expand;
    section.head.classList.toggle('expanded', expand);
    if (section.kind === 'folder' && section.head.hasAttribute('aria-expanded')) {
        section.head.setAttribute('aria-expanded', expand ? 'true' : 'false');
    }
    if (section.childWrap.dataset.filterPrev !== undefined) {
        section.childWrap.dataset.filterPrev = expand ? '0' : '1';
    }
}

// True when at least one filter-visible section is currently collapsed. Drives
// both the pill label and the next bulk action; filter-hidden sections are
// ignored so the pill reflects only the structure the user can actually see.
function anySectionCollapsed(sections, tree) {
    return sections.some(function (s) {
        return isFilterVisible(s.head, tree) && s.childWrap.hidden;
    });
}

// Sync the toolbar pill to the live tree: hide the whole strip when the active
// lens has no collapsible sections (a flat file list, an empty state); otherwise
// show it and label it for the next action ("Expand all" when something is
// collapsed, "Collapse all" when everything's open).
function refreshCollapseAllPill() {
    if (!collapseToolbarEl || !collapseAllBtn) return;
    const tree = currentTreeEl;
    const sections = structureSections(tree);
    if (!sections.length) {
        collapseToolbarEl.hidden = true;
        return;
    }
    collapseToolbarEl.hidden = false;
    const collapsed = anySectionCollapsed(sections, tree);
    collapseAllBtn.textContent = collapsed ? 'Expand all' : 'Collapse all';
    collapseAllBtn.setAttribute(
        'aria-label',
        collapsed ? 'Expand all sections' : 'Collapse all sections'
    );
}

// Bulk-toggle handler: if anything's collapsed, expand everything; otherwise
// collapse everything. Acts only on filter-visible sections, then relabels.
function onCollapseAllToggle() {
    const tree = currentTreeEl;
    const sections = structureSections(tree);
    if (!sections.length) return;
    const expand = anySectionCollapsed(sections, tree);
    sections.forEach(function (s) {
        if (!isFilterVisible(s.head, tree)) return;
        setSectionExpanded(s, expand);
    });
    refreshCollapseAllPill();
}

// Build the thin toolbar strip (below the lens toggle + filter, above the tree)
// holding the single collapse/expand-all pill. Hidden until a paint reveals it
// has sections to act on.
function buildCollapseToolbar() {
    const bar = document.createElement('div');
    bar.className = 'structureToolbar';
    bar.hidden = true;
    collapseToolbarEl = bar;

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'structureCollapseAllPill';
    pill.textContent = 'Collapse all';
    pill.setAttribute('aria-label', 'Collapse all sections');
    pill.addEventListener('click', onCollapseAllToggle);
    bar.appendChild(pill);
    collapseAllBtn = pill;

    return bar;
}

// ── SHELL ───────────────────────────────────────────────────────────────────

// Resolve the currently-selected project's name from the sidebar — the same
// source of truth the Projects and Conceive views use. Returns '' when nothing
// is selected (or the row has no input), which drives the empty state.
function getSelectedProjectName() {
    const selected = document.querySelector('.selectedProject');
    if (!selected) return '';
    const input = selected.querySelector('#projInput');
    return input ? (input.value || '').trim() : '';
}

// An unlinked-repo (link-off) glyph, DOM-built inline like agentView's icons —
// no icon library, no new deps. Shown centered above the message only in the
// no-linked-repo empty state, mirroring the AGENT no-repo view.
const LINK_OFF_GLYPH =
    '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M9 17H7A5 5 0 0 1 7 7h2"/>' +
    '<path d="M15 7h2a5 5 0 0 1 4 8"/>' +
    '<line x1="8" y1="12" x2="12" y2="12"/>' +
    '<line x1="2" y1="2" x2="22" y2="22"/>' +
    '</svg>';

// A gentle full-view notice (no project selected / project not linked to a repo).
// Pass `glyphMarkup` to render a centered glyph above the message; without it the
// block is text-only. The block shares `.agentEmptyState`'s centered column
// layout so the two views read identically.
function appendEmptyState(view, text, glyphMarkup) {
    const empty = document.createElement('div');
    empty.className = 'structureEmptyState';
    if (glyphMarkup) {
        const glyph = document.createElement('span');
        glyph.className = 'structureEmptyGlyph';
        glyph.setAttribute('aria-hidden', 'true');
        glyph.innerHTML = glyphMarkup;
        empty.appendChild(glyph);
        const msg = document.createElement('span');
        msg.textContent = text;
        empty.appendChild(msg);
    } else {
        empty.textContent = text;
    }
    view.appendChild(empty);
}

// Relabel the toggle's second (non-Code) segment to the active repo's adaptive
// lens: `Types` (data-lens `types`) for a repo whose manifest declares it, `UI`
// otherwise. The toggle is built optimistically as UI before the manifest
// resolves, so this runs once `currentLens` is known and on every repo switch.
function relabelSecondLensSegment() {
    if (!lensToggleGroup) return;
    const seg = Array.prototype.find.call(lensToggleGroup.children, function (b) {
        return b.dataset && b.dataset.lens !== 'code';
    });
    if (!seg) return;
    seg.dataset.lens = currentLens === 'types' ? 'types'
        : currentLens === 'sql' ? 'sql'
        : 'ui';
    seg.textContent = currentLens === 'types' ? 'Types'
        : currentLens === 'sql' ? 'SQL'
        : 'UI';
}

// Build the Code / second-slot segmented control. The second slot's identity is
// adaptive (UI or Types — see relabelSecondLensSegment); switching persists the
// choice and repaints the tree via `onChange`. The click handler reads the live
// `data-lens` rather than a captured value so a relabeled segment switches to its
// current identity.
function buildLensToggle(onChange) {
    const group = document.createElement('div');
    group.className = 'structureLensToggle';
    group.setAttribute('role', 'tablist');
    group.setAttribute('aria-label', 'Structure lens');
    lensToggleGroup = group;

    [['ui', 'UI'], ['code', 'Code']].forEach(function (pair) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'structureLensBtn';
        btn.dataset.lens = pair[0];
        btn.textContent = pair[1];
        btn.setAttribute('role', 'tab');
        const on = pair[0] === lens;
        btn.setAttribute('aria-selected', String(on));
        if (on) btn.classList.add('active');
        btn.addEventListener('click', function () {
            const target = btn.dataset.lens;
            if (lens === target) return;
            lens = target;
            setStructureLens(lens);
            applyLensToggleState();
            onChange();
        });
        group.appendChild(btn);
    });
    return group;
}

// Render the STRUCTURE view. Safe to call before component() has built the shell
// (a missing #structureView short-circuits). Resolves the repo from the selected
// project (no picker); with no project selected or a project not linked to a
// repo it paints a guiding empty state. Otherwise it builds the read-only repo
// label, the Code/UI toggle, and the tree container; the active lens fills it.
export function renderStructureView() {
    const view = document.getElementById('structureView');
    if (!view) return;
    clear(view);

    const projectName = getSelectedProjectName();
    if (!projectName) {
        // No project selected — nothing to map. Drop any stale repo state so a
        // late "Find in code" can't act against a tree that's no longer shown.
        selectedRepo = null;
        currentTreeEl = null;
        collapseToolbarEl = null;
        collapseAllBtn = null;
        actionToolbarEl = null;
        selectedHandle = null;
        appendEmptyState(view, 'Select a project to see its structure.');
        return;
    }

    const repo = resolveProjectRepo(projectName);
    if (!repo) {
        // Selected project carries no linked inject target — point the user at
        // where to link one, the same place the ⚡ inject routing is configured.
        selectedRepo = null;
        currentTreeEl = null;
        collapseToolbarEl = null;
        collapseAllBtn = null;
        actionToolbarEl = null;
        selectedHandle = null;
        appendEmptyState(
            view,
            projectName + ' isn’t linked to a repo — link one in its inject target to map its structure.',
            LINK_OFF_GLYPH
        );
        return;
    }

    lens = getStructureLens();
    // Folder paths, published-map file names, and live-map region selectors are
    // all repo-scoped, so a resolved-repo change (project switch) drops the prior
    // repo's fold sets and re-hydrates the active lens from THIS repo's persisted
    // state — falling back to default expansion the first time. The inactive lens
    // re-hydrates when the user toggles into it. A same-repo re-render leaves the
    // live sets intact, so a transient find-in-code reveal isn't wiped.
    if (repo !== selectedRepo) {
        openFolders = new Set();
        collapsedPublishedFiles = new Set();
        openRegions = new Set();
        collapsedTypeFiles = new Set();
        collapsedSqlFiles = new Set();
        hydrateActiveLensState(repo, lens);
        // The selection is repo-scoped — drop it so a stale handle from the prior
        // repo can't survive into the new one's toolbar.
        selectedHandle = null;
        // The block canvas's drill path + selection are repo-scoped too.
        resetCanvasState();
    }
    selectedRepo = repo;

    // Header: a read-only repo label (the repo string with the project name as a
    // quiet hint) plus the Code/UI lens toggle beside it — a label, not a control.
    const header = document.createElement('div');
    header.className = 'structureHeader';

    const labelGroup = document.createElement('div');
    labelGroup.className = 'structurePickerGroup';

    const eyebrow = document.createElement('span');
    eyebrow.className = 'structurePickerLabel';
    eyebrow.textContent = 'Repository';
    labelGroup.appendChild(eyebrow);

    const repoLabel = document.createElement('div');
    repoLabel.className = 'structureRepoLabel';

    const repoName = document.createElement('span');
    repoName.className = 'structureRepoName';
    repoName.textContent = repo;
    repoLabel.appendChild(repoName);

    const projectHint = document.createElement('span');
    projectHint.className = 'structureRepoProjectHint';
    projectHint.textContent = projectName;
    repoLabel.appendChild(projectHint);

    labelGroup.appendChild(repoLabel);
    header.appendChild(labelGroup);

    const tree = document.createElement('div');
    tree.className = 'structureTree';
    // Held module-scoped so "Find in code" can repaint the Code lens into the
    // same container without re-entering renderStructureView.
    currentTreeEl = tree;
    // Any in-tree click that toggles a section (a folder/region chevron) settles
    // synchronously during dispatch; a capture-phase listener schedules a
    // microtask so the collapse/expand-all pill relabels once the DOM has its
    // final fold state, keeping the pill in sync with per-section toggles. Capture
    // fires regardless of a handler's stopPropagation, and the tree element
    // survives lens switches, so one listener covers every repaint.
    tree.addEventListener('click', function () {
        Promise.resolve().then(refreshCollapseAllPill);
    }, true);

    // Reset the filter on a fresh render (project switch / view entry); the box
    // is rebuilt empty and the query state cleared so nothing carries over.
    filterQuery = '';
    currentNoMatchEl = null;

    const toggle = buildLensToggle(function () {
        // Switching lenses clears the selection — a handle belongs to the lens it
        // was selected in, and the Code lens has no toolbar at all.
        selectedHandle = null;
        // Entering a lens restores that lens's persisted fold state for this repo
        // (or its default expansion the first time), independent of the other.
        hydrateActiveLensState(selectedRepo, lens);
        const painted = renderLens(selectedRepo, tree);
        updateFilterPlaceholder();
        // Re-apply the active query to the freshly rendered lens so switching
        // lenses keeps the current filter (requirement: filter follows the lens).
        Promise.resolve(painted).then(function () {
            if (filterInputEl) applyStructureFilter(filterInputEl.value);
            refreshCollapseAllPill();
            refreshActionToolbar();
        });
    });
    header.appendChild(toggle);
    view.appendChild(header);

    // NEXT REFACTOR card: the single cheapest extraction-refactor candidate for
    // this repo, sourced from the Worker's scan route. Mounted here as a
    // persistent sibling of the tree (like the filter box below), so a lens
    // repaint — which only clears `tree` — can't wipe it.
    view.appendChild(renderRefactorCard(repo, projectName));

    // The filter box and the collapse/expand-all pill share one row (a persistent
    // sibling of the tree), so a lens render — which only clears `tree` — never
    // wipes them. The filter box flexes to fill; the pill sits to its right at its
    // natural width, and reclaims the space when the strip hides.
    const controlRow = document.createElement('div');
    controlRow.className = 'structureControlRow';
    const filterBox = buildFilterBox();
    controlRow.appendChild(filterBox);
    updateFilterPlaceholder();

    // Thin toolbar strip carrying the collapse/expand-all pill. It stays hidden
    // until the first paint confirms the lens has sections; when hidden, the
    // filter box expands to the full row width.
    const toolbar = buildCollapseToolbar();
    controlRow.appendChild(toolbar);
    view.appendChild(controlRow);

    // The shared selection toolbar sits directly above the tree (UI/Types lenses
    // only — hidden on the Code lens). A persistent sibling of the tree like the
    // collapse strip, so a lens repaint doesn't wipe it.
    const actionToolbar = buildActionToolbar();
    view.appendChild(actionToolbar);

    view.appendChild(tree);

    Promise.resolve(renderLens(selectedRepo, tree)).then(function () {
        refreshCollapseAllPill();
        refreshActionToolbar();
    });
}
