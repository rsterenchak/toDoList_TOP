import { chatWithWorker } from './inject.js';
import {
    loadManifest,
    getRunningAppRepo,
    setChatWorkspaceRepo,
    insertReference,
} from './claudeSheet.js';
import { resolveProjectRepo } from './seedTasksModal.js';
import { getStructureLens, setStructureLens } from './prefs.js';

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

// The build-time UI index for the selected repo, surfaced from its manifest:
//   • regionsIndex — selector → region record { selector, label, file, line,
//     files } — powers "Find in code" (live selector or published row → owner
//     file). Empty until the manifest resolves.
//   • currentSrcRoot — the repo-root-relative source folder, used to build
//     GitHub blob deep links.
//   • currentTreeEl / lensToggleGroup — live references to the rendered tree
//     container and lens segmented control, so "Find in code" can switch to the
//     Code lens and reveal a file without re-entering renderStructureView.
let regionsIndex = new Map();
let currentSrcRoot = null;
let currentTreeEl = null;
let lensToggleGroup = null;

function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

// Load (cached) the selected repo's manifest and refresh the module-scoped UI
// index from it. Returns the manifest result so callers can branch on its
// states. Tolerates a manifest with no `regions` (older deploy) — the index
// just stays empty.
function ensureRegionsLoaded(repo) {
    return loadManifest(repo).then(function (result) {
        currentSrcRoot = (result && result.srcRoot) || null;
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
// named relative to the manifest's `srcRoot`, so the path is prefixed with it.
// Returns '' when the repo or source root is unknown (no link rendered).
function githubBlobUrl(repo, file, line) {
    if (!repo || !file || !currentSrcRoot) return '';
    const root = String(currentSrcRoot).replace(/\/+$/, '');
    const frag = (typeof line === 'number' && line > 0) ? '#L' + line : '';
    return 'https://github.com/' + repo + '/blob/main/' + root + '/' + file + frag;
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
    Promise.resolve(painted).then(function () { flashFileRow(file); });
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
function explainFile(repo, filePath, btn, resultEl) {
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
            const nowOpen = !openFolders.has(dir.path);
            if (nowOpen) openFolders.add(dir.path);
            else openFolders.delete(dir.path);
            head.classList.toggle('expanded', nowOpen);
            head.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
            childWrap.hidden = !nowOpen;
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
// the Structure view itself or the chat surfaces.
const EXCLUDED_IDS = { structureView: 1, desktopChatPane: 1, claudeSheet: 1 };

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
// data-region, or a landmark role. Everything else is walked through.
function isKept(el) {
    return !!(el.id || (el.getAttribute('data-region') || '').trim() || regionRole(el));
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

// Label precedence: data-region > aria-label > prettified id > role > tag.
function regionLabel(el) {
    const dr = (el.getAttribute('data-region') || '').trim();
    if (dr) return dr;
    const al = (el.getAttribute('aria-label') || '').trim();
    if (al) return al;
    if (el.id) return prettify(el.id);
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
function isOnScreen(el) {
    try {
        const cs = window.getComputedStyle(el);
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
function repeatRunLength(children, start) {
    const first = children[start];
    if (isKept(first)) return 0;
    const sig = elSignature(first);
    let n = 1;
    for (let j = start + 1; j < children.length; j++) {
        if (!isKept(children[j]) && elSignature(children[j]) === sig) n++;
        else break;
    }
    return n;
}

// Walk an element's descendants and return the list of region/collapsed nodes
// it contains. Kept elements become region nodes (with their own kept
// descendants nested); non-kept elements are walked through, hoisting their
// kept descendants up to the nearest kept ancestor. Excluded subtrees are
// skipped whole; runs of repeated id-less siblings collapse to one line.
function walk(el) {
    const children = Array.prototype.slice.call(el.children || []);
    const out = [];
    let i = 0;
    while (i < children.length) {
        const child = children[i];
        const runLen = repeatRunLength(children, i);
        if (runLen >= REPEAT_COLLAPSE_MIN) {
            out.push({ type: 'collapsed', count: runLen, tag: child.tagName.toLowerCase() });
            i += runLen;
            continue;
        }
        if (isExcludedEl(child)) { i++; continue; }
        const descendants = walk(child);
        if (isKept(child)) {
            out.push({
                type: 'region',
                label: regionLabel(child),
                selector: regionSelector(child),
                visible: isOnScreen(child),
                children: descendants,
            });
        } else {
            for (let k = 0; k < descendants.length; k++) out.push(descendants[k]);
        }
        i++;
    }
    return out;
}

// Build the UI region tree from the live DOM. Pure read — never mutates the page.
function buildUiTree() {
    if (!document.body) return [];
    return walk(document.body);
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
function appendReferenceCopyActions(actionRow, label, selector, repo) {
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
    copyBtn.textContent = 'Copy selector';
    copyBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        copySelector(selector, copyBtn);
    });
    actionRow.appendChild(copyBtn);
}

// The action panel revealed under a region row: the full selector, a one-line
// note about its on-screen state, a primary "Reference in chat", and a
// secondary "Copy selector".
function buildRegionActions(node) {
    const panel = document.createElement('div');
    panel.className = 'structureRegionActions';
    panel.hidden = true;

    const sel = document.createElement('code');
    sel.className = 'structureRegionSelectorFull';
    sel.textContent = node.selector;
    panel.appendChild(sel);

    const note = document.createElement('div');
    note.className = 'structureRegionNote';
    note.textContent = node.visible ? 'On screen now.' : 'Not currently on screen.';
    panel.appendChild(note);

    const actionRow = document.createElement('div');
    actionRow.className = 'structureRegionActionRow';

    // Reference (which reframes onto the live `selectedRepo`) + Copy selector.
    appendReferenceCopyActions(actionRow, node.label, node.selector, selectedRepo);

    // Find in code: resolve this live selector to its owner file(s) via the
    // build-time index and reveal them inline.
    const findBtn = document.createElement('button');
    findBtn.type = 'button';
    findBtn.className = 'structureFindBtn';
    findBtn.textContent = 'Find in code';
    const findResult = document.createElement('div');
    findResult.className = 'structureFindResult';
    findResult.hidden = true;
    findBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        findInCode(selectedRepo, node.selector, findResult, findBtn);
    });
    actionRow.appendChild(findBtn);

    panel.appendChild(actionRow);
    panel.appendChild(findResult);
    return panel;
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
// regions; tapping the row body toggles its action panel. Off-screen regions
// render dimmed. Depth drives the left indent.
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
    row.setAttribute('aria-expanded', 'false');

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
    childWrap.hidden = true;

    const actions = buildRegionActions(node);

    if (hasChildren) {
        caret.addEventListener('click', function (event) {
            event.stopPropagation();
            const nowOpen = childWrap.hidden;
            childWrap.hidden = !nowOpen;
            row.classList.toggle('expanded', nowOpen);
        });
        node.children.forEach(function (child) {
            if (child.type === 'collapsed') childWrap.appendChild(buildCollapsedRow(child, depth + 1));
            else childWrap.appendChild(buildRegionRow(child, depth + 1));
        });
    }

    const toggleActions = function () {
        const nowOpen = actions.hidden;
        actions.hidden = !nowOpen;
        row.setAttribute('aria-expanded', String(nowOpen));
    };
    row.addEventListener('click', toggleActions);
    row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleActions();
        }
    });

    wrap.appendChild(row);
    wrap.appendChild(actions);
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

// One row of the published UI map: a handle's label + selector, expandable into
// an action panel with "Find in code" and a "View on GitHub" link to its
// primary defining file. Static (no live DOM) — the map comes from `regions`.
// `depth` drives the left indent so rows nest beneath their file-group header.
function buildPublishedRegionRow(repo, region, depth) {
    const indent = typeof depth === 'number' ? depth : 0;
    const wrap = document.createElement('div');
    wrap.className = 'structureRegionWrap';

    const row = document.createElement('div');
    row.className = 'structureRegionRow';
    row.style.setProperty('--structure-depth', String(indent));
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-expanded', 'false');

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

    const actions = document.createElement('div');
    actions.className = 'structureRegionActions';
    actions.hidden = true;

    // The defining file is now the group header, so the per-row note carries
    // only the line within that file.
    const note = document.createElement('div');
    note.className = 'structureRegionNote';
    note.textContent = typeof region.line === 'number' && region.line > 0
        ? 'Line ' + region.line + '.'
        : 'Line not recorded.';
    actions.appendChild(note);

    const actionRow = document.createElement('div');
    actionRow.className = 'structureRegionActionRow';

    // Reference in chat + Copy selector — the same primary/secondary pair the
    // live map's rows offer; valid for a published handle and just as much the
    // tab's primary action. Reference reframes onto the published `repo`.
    appendReferenceCopyActions(actionRow, region.label || region.selector, region.selector, repo);

    const findBtn = document.createElement('button');
    findBtn.type = 'button';
    findBtn.className = 'structureFindBtn';
    findBtn.textContent = 'Find in code';
    const findResult = document.createElement('div');
    findResult.className = 'structureFindResult';
    findResult.hidden = true;
    findBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        findInCode(repo, region.selector, findResult, findBtn);
    });
    actionRow.appendChild(findBtn);

    const gh = buildGithubLink(repo, region.file, region.line);
    if (gh) actionRow.appendChild(gh);

    actions.appendChild(actionRow);
    actions.appendChild(findResult);

    const toggle = function () {
        const nowOpen = actions.hidden;
        actions.hidden = !nowOpen;
        row.setAttribute('aria-expanded', String(nowOpen));
    };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle();
        }
    });

    wrap.appendChild(row);
    wrap.appendChild(actions);
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
        const nowOpen = collapsedPublishedFiles.has(file);
        if (nowOpen) collapsedPublishedFiles.delete(file);
        else collapsedPublishedFiles.add(file);
        head.classList.toggle('expanded', nowOpen);
        head.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
        childWrap.hidden = !nowOpen;
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
    if (repo === getRunningAppRepo()) {
        // Warm the region index so live-region "Find in code" resolves.
        ensureRegionsLoaded(repo);
        const tree = buildUiTree();
        if (!tree.length) {
            appendUiNotice(treeEl, 'No mappable regions found.');
            return;
        }
        tree.forEach(function (node) {
            if (node.type === 'collapsed') treeEl.appendChild(buildCollapsedRow(node, 0));
            else treeEl.appendChild(buildRegionRow(node, 0));
        });
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

// Dispatch the active lens into the shared tree container.
function renderLens(repo, treeEl) {
    if (lens === 'ui') {
        renderUiLens(repo, treeEl);
        return;
    }
    renderTree(repo, treeEl);
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

// A gentle full-view notice (no project selected / project not linked to a repo).
function appendEmptyState(view, text) {
    const empty = document.createElement('div');
    empty.className = 'structureEmptyState';
    empty.textContent = text;
    view.appendChild(empty);
}

// Build the Code/UI segmented control. Switching persists the choice and
// repaints the tree via `onChange`.
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
            if (lens === pair[0]) return;
            lens = pair[0];
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
        appendEmptyState(view, 'Select a project to see its structure.');
        return;
    }

    const repo = resolveProjectRepo(projectName);
    if (!repo) {
        // Selected project carries no linked inject target — point the user at
        // where to link one, the same place the ⚡ inject routing is configured.
        selectedRepo = null;
        currentTreeEl = null;
        appendEmptyState(
            view,
            projectName + ' isn’t linked to a repo — link one in its inject target to map its structure.'
        );
        return;
    }

    lens = getStructureLens();
    // Reset the open-folder set when the resolved repo changes (project switch),
    // since folder paths are repo-scoped and shouldn't carry across repos.
    if (repo !== selectedRepo) {
        openFolders = new Set();
        collapsedPublishedFiles = new Set();
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

    const toggle = buildLensToggle(function () {
        // Code lens re-renders from scratch each switch; reset its open-folder
        // state so a fresh switch starts collapsed.
        if (lens === 'code') openFolders = new Set();
        renderLens(selectedRepo, tree);
    });
    header.appendChild(toggle);
    view.appendChild(header);
    view.appendChild(tree);

    renderLens(selectedRepo, tree);
}
