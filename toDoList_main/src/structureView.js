import { chatWithWorker } from './inject.js';
import { loadManifest, getAttachRepos, getActiveChatRepo } from './claudeSheet.js';

// The STRUCTURE view: a cross-repo map of a project's source. This first cut is
// the Code lens — a repo picker selects which allowlisted repo to view, and that
// repo's published `src-manifest.json` (the same artifact the chat's attach-file
// picker fetches) renders as a collapsible folder/file tree. Tapping a file
// reveals an "Explain with Sonnet" action that runs a one-shot Fast-mode chat
// turn with that file attached and shows the returned summary inline.
//
// Like the other view modules this module reaches the DOM via getElementById /
// createElement at call time and only exports renderStructureView — there is no
// back-edge into main.js. It never touches localStorage; the repo allowlist and
// manifest loader are reused from claudeSheet.js so the two never drift.

// The repo currently shown in the tree. Held at module scope so a re-render
// (view switch, manifest refresh) preserves the user's selection. Null until
// first resolved against the live allowlist.
let selectedRepo = null;

// Folder paths the user has expanded, keyed by full slash-joined path. Survives
// re-renders so the tree doesn't collapse on every repaint. Folder paths are
// scoped per repo by their leading segments, so the set never collides across
// repos that happen to share a folder name.
let openFolders = new Set();

function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

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

    return loadManifest(repo).then(function (result) {
        if (repo !== selectedRepo) return;
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

// Resolve which repo the picker should show: keep the current selection if it's
// still in the allowlist, otherwise default to the active chat workspace repo
// (if allowed), otherwise the first allowed repo.
function resolveSelectedRepo(repos) {
    if (selectedRepo && repos.indexOf(selectedRepo) !== -1) return selectedRepo;
    const active = getActiveChatRepo();
    if (active && repos.indexOf(active) !== -1) return active;
    return repos[0] || null;
}

// Render the STRUCTURE view. Safe to call before component() has built the shell
// (a missing #structureView short-circuits). Builds the repo picker and the tree
// container synchronously; the tree itself fills in once the manifest resolves.
export function renderStructureView() {
    const view = document.getElementById('structureView');
    if (!view) return;
    clear(view);

    const repos = getAttachRepos();
    if (!repos.length) {
        const empty = document.createElement('div');
        empty.className = 'structureEmptyState';
        empty.textContent = 'No repositories available.';
        view.appendChild(empty);
        return;
    }
    selectedRepo = resolveSelectedRepo(repos);

    // Header: a labeled repo picker. The <select> font-size stays ≥16px in CSS
    // to avoid iOS Safari auto-zoom on focus.
    const header = document.createElement('div');
    header.className = 'structureHeader';

    const pickerLabel = document.createElement('label');
    pickerLabel.className = 'structurePickerLabel';
    pickerLabel.textContent = 'Repository';
    pickerLabel.setAttribute('for', 'structureRepoPicker');
    header.appendChild(pickerLabel);

    const picker = document.createElement('select');
    picker.id = 'structureRepoPicker';
    picker.className = 'structureRepoPicker';
    repos.forEach(function (repo) {
        const opt = document.createElement('option');
        opt.value = repo;
        opt.textContent = repo;
        if (repo === selectedRepo) opt.selected = true;
        picker.appendChild(opt);
    });
    header.appendChild(picker);
    view.appendChild(header);

    const tree = document.createElement('div');
    tree.className = 'structureTree';
    view.appendChild(tree);

    picker.addEventListener('change', function () {
        if (picker.value === selectedRepo) return;
        selectedRepo = picker.value;
        // Open-folder state is path-scoped per repo, so switching repos starts
        // the new tree collapsed rather than inheriting another repo's open set.
        openFolders = new Set();
        renderTree(selectedRepo, tree);
    });

    renderTree(selectedRepo, tree);
}
