// Plays one guided code tour, a step at a time: the step's place in the code, a
// title, a one-line why and the embedded snippet, with Back / Next and a recap
// at the end.
//
// Below 1024px the player is a full-screen sheet over the app. On desktop the
// host view hands it a host (Understanding's code pane, Structure's detail
// column) and the player BECOMES the code viewer there: each step's file renders
// in the viewer with its span highlighted, and the tour chrome is a banner pinned
// above the code, so tap-to-trace, Explain and the GitHub link keep working under
// it. Closing puts back whatever file the viewer had before. Every move saves the
// step through prefs, so Continue picks up where the user left off; Done on the
// recap marks the tour done. ArrowLeft / ArrowRight step while the player has
// focus, and Escape closes it.

import { getTourProgress, setTourProgress } from './prefs.js';
import {
    renderCodeViewer, clearCodeViewer, setCodeViewerHighlight, setBanner, clearBanner,
    getOpenCodeViewerFile, getOpenCodeViewerRef, onCodeViewerChange,
} from './codeViewer.js';
import { joinSrcRootPath } from './srcPath.js';

let activeClose = null;

function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
}

function saveProgress(repo, tourId, patch) {
    const map = getTourProgress(repo);
    const prev = map[tourId] || { step: 0, done: false };
    map[tourId] = { step: patch.step !== undefined ? patch.step : prev.step, done: patch.done !== undefined ? patch.done : prev.done };
    setTourProgress(repo, map);
}

// The `{ startLine, endLine }` span of a step's highlighted snippet rows,
// falling back to the step's own line.
export function highlightSpan(step) {
    const lines = (step.snippet || []).filter(function (r) { return r && !r.gap && r.hi; })
        .map(function (r) { return r.n; });
    if (!lines.length) return { startLine: step.line, endLine: step.line };
    return { startLine: Math.min.apply(null, lines), endLine: Math.max.apply(null, lines) };
}

// The "what comes next" line for a step, or '' on the last step.
export function nextLabel(step) {
    if (!step || !step.next) return '';
    if (step.next === step.symbol) return 'Next: further down in ' + step.symbol;
    return 'Next it calls ' + step.next;
}

function buildSnippet(rows) {
    const code = el('div', 'tourSnippet');
    code.setAttribute('role', 'group');
    code.setAttribute('aria-label', 'Code');
    (rows || []).forEach(function (r) {
        if (!r) return;
        if (r.gap) {
            const gap = el('div', 'tourSnippetGap', '⋯');
            gap.setAttribute('aria-label', 'lines skipped');
            code.appendChild(gap);
            return;
        }
        const row = el('div', r.hi ? 'tourSnippetRow is-hi' : 'tourSnippetRow');
        row.appendChild(el('span', 'tourSnippetNum', String(r.n)));
        row.appendChild(el('span', 'tourSnippetText', r.t || ''));
        code.appendChild(row);
    });
    return code;
}

// Close the open player, if any.
export function closeTourPlayer() {
    if (activeClose) activeClose();
}

export function isTourPlayerOpen() {
    return !!activeClose;
}

// Open `tour` for `repo` at `startStep` (clamped; `steps.length` is the recap).
// Options:
//   host         — desktop: the code viewer host to play in; omitted → sheet.
//   srcRoot      — viewer mode: the manifest's source folder (or a promise of
//                  it) that a step's manifest-relative `file` is joined to.
//   target       — viewer mode: the inject target files are read from
//                  (defaults to `{ repo }`).
//   areaName(id) — the display name for a step's area chip.
//   onStep(step) — called with each step shown (not the recap).
//   onOpenInCode(step, span) — sheet: "Open in code viewer"; called after the player closes.
//   onClose()    — after the player is gone, however it closed.
//   onDone()     — after Done marks the tour done (before onClose).
export function openTourPlayer(opts) {
    closeTourPlayer();
    const o = opts || {};
    const tour = o.tour;
    const repo = o.repo;
    if (!tour || !Array.isArray(tour.steps) || !tour.steps.length) return null;
    const steps = tour.steps;
    const recap = Array.isArray(tour.recap) ? tour.recap : [];
    const last = recap.length ? steps.length : steps.length - 1;
    let index = Math.min(last, Math.max(0, Math.floor(Number(o.startStep) || 0)));

    const host = o.host || null;
    const viewer = !!host;
    const target = o.target && o.target.repo ? o.target : { repo: repo };
    // The source folder, once known: a string arrives synchronously, a promise
    // (the caller's manifest load) resolves before the first step renders.
    let srcRoot = typeof o.srcRoot === 'string' ? o.srcRoot : null;
    const srcRootReady = srcRoot !== null ? null : Promise.resolve(o.srcRoot).then(function (v) {
        srcRoot = typeof v === 'string' ? v : '';
    }, function () { srcRoot = ''; });

    const root = el('div', viewer ? 'tourPlayer tourPlayerBanner' : 'tourPlayer tourPlayer--sheet');
    root.setAttribute('role', viewer ? 'region' : 'dialog');
    root.setAttribute('aria-label', 'Tour: ' + tour.title);
    root.tabIndex = -1;

    const head = el('div', 'tourPlayerHead');
    const headTop = el('div', 'tourPlayerHeadTop');
    headTop.appendChild(el('span', 'tourPlayerEyebrow', 'TOUR'));
    const count = el('span', 'tourPlayerCount');
    headTop.appendChild(count);
    // The banner keeps to one eyebrow line — `TOUR n / m · title` — so the code
    // beneath it keeps the height.
    if (viewer) headTop.appendChild(el('span', 'tourPlayerTourTitle', tour.title));
    const closeBtn = el('button', 'tourPlayerClose', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close tour');
    headTop.appendChild(closeBtn);
    head.appendChild(headTop);
    if (!viewer) head.appendChild(el('div', 'tourPlayerTourTitle', tour.title));

    const segBar = el('div', 'tourPlayerSegments');
    segBar.setAttribute('role', 'group');
    segBar.setAttribute('aria-label', 'Tour steps');
    const segs = [];
    for (let i = 0; i <= last; i++) {
        const seg = el('button', 'tourPlayerSeg');
        seg.type = 'button';
        seg.dataset.index = String(i);
        seg.setAttribute('aria-label', i < steps.length ? 'Step ' + (i + 1) : 'Recap');
        seg.addEventListener('click', function () { go(i); });
        segBar.appendChild(seg);
        segs.push(seg);
    }
    head.appendChild(segBar);
    root.appendChild(head);

    const body = el('div', 'tourPlayerBody');
    root.appendChild(body);

    const foot = el('div', 'tourPlayerFoot');
    const backBtn = el('button', 'tourPlayerBack', '← Back');
    backBtn.type = 'button';
    const nextBtn = el('button', 'tourPlayerNext');
    nextBtn.type = 'button';
    foot.appendChild(backBtn);
    foot.appendChild(nextBtn);
    root.appendChild(foot);

    // Viewer mode: show `step`'s file with its span highlighted. A step in the
    // file already open only moves the highlight (the trace trail survives);
    // another file — or the reader having wandered off to one — re-renders.
    let wanted = null;
    let shown = false;
    function showInViewer(step) {
        wanted = step;
        if (srcRoot === null) {
            srcRootReady.then(function () {
                if (!closed && wanted === step) showInViewer(step);
            });
            return;
        }
        const filePath = joinSrcRootPath(srcRoot, step.file);
        const span = highlightSpan(step);
        const same = getOpenCodeViewerFile() === filePath;
        if (same && setCodeViewerHighlight(host, span.startLine, span.endLine)) return;
        const opts = {
            target: target,
            filePath: filePath,
            srcRoot: srcRoot,
            startLine: span.startLine,
            endLine: span.endLine,
        };
        if (same) opts.keepTrail = true;
        renderCodeViewer(host, opts);
        setBanner(host, root);
        if (!shown) {
            shown = true;
            if (typeof root.focus === 'function') root.focus({ preventScroll: true });
        }
    }

    function renderBannerStep(step) {
        body.appendChild(el('h3', 'tourPlayerStepTitle', step.title || ''));
        body.appendChild(el('p', 'tourPlayerWhy', step.why || ''));
        showInViewer(step);
    }

    function renderStep(step) {
        if (viewer) { renderBannerStep(step); return; }
        const where = el('div', 'tourPlayerWhere');
        if (step.area) {
            const name = typeof o.areaName === 'function' ? o.areaName(step.area) : null;
            where.appendChild(el('span', 'tourPlayerArea', name || step.area));
        }
        where.appendChild(el('span', 'tourPlayerLoc', step.file + ' › ' + step.symbol + ' · ' + step.line));
        body.appendChild(where);
        body.appendChild(el('h3', 'tourPlayerStepTitle', step.title || ''));
        body.appendChild(el('p', 'tourPlayerWhy', step.why || ''));
        body.appendChild(buildSnippet(step.snippet));
        const nextText = nextLabel(step);
        if (nextText) body.appendChild(el('div', 'tourPlayerNextHint', nextText));
        const open = el('button', 'tourPlayerOpenCode', 'Open in code viewer');
        open.type = 'button';
        open.addEventListener('click', function () {
            const span = highlightSpan(step);
            close();
            if (typeof o.onOpenInCode === 'function') o.onOpenInCode(step, span);
        });
        body.appendChild(open);
    }

    function renderRecap() {
        body.appendChild(el('h3', 'tourPlayerStepTitle', 'Recap'));
        const list = el('div', 'tourPlayerRecap');
        recap.forEach(function (card) {
            const c = el('div', 'tourRecapCard');
            c.appendChild(el('div', 'tourRecapTitle', card && card.title ? card.title : ''));
            if (card && card.body) c.appendChild(el('div', 'tourRecapBody', card.body));
            list.appendChild(c);
        });
        body.appendChild(list);
    }

    function paint() {
        while (body.firstChild) body.removeChild(body.firstChild);
        const onRecap = index >= steps.length;
        count.textContent = onRecap ? 'Recap' : (index + 1) + ' / ' + steps.length;
        segs.forEach(function (seg, i) {
            seg.classList.toggle('is-current', i === index);
            seg.classList.toggle('is-seen', i < index);
            seg.setAttribute('aria-current', i === index ? 'step' : 'false');
        });
        if (onRecap) renderRecap();
        else renderStep(steps[index]);
        body.scrollTop = 0;
        backBtn.disabled = index === 0;
        backBtn.classList.toggle('is-dim', index === 0);
        if (index === last) nextBtn.textContent = 'Done';
        else if (index === steps.length - 1) nextBtn.textContent = 'Recap →';
        else nextBtn.textContent = 'Next →';
        nextBtn.classList.toggle('is-done', index === last);
    }

    function go(i) {
        const target = Math.min(last, Math.max(0, i));
        if (target === index && body.firstChild) return;
        index = target;
        saveProgress(repo, tour.id, { step: index });
        paint();
        if (index < steps.length && typeof o.onStep === 'function') o.onStep(steps[index], index);
    }

    function finish() {
        saveProgress(repo, tour.id, { step: index, done: true });
        if (typeof o.onDone === 'function') o.onDone();
        close();
    }

    // What the viewer showed before the tour, so closing can put it back.
    let hadShell = false;
    let prior = null;
    let unwatch = null;

    let closed = false;
    // `restore` is false when the viewer was closed out from under the tour, so
    // there is nothing to put back.
    function close(restore) {
        if (closed) return;
        closed = true;
        if (activeClose === close) activeClose = null;
        if (viewer) {
            if (typeof unwatch === 'function') unwatch();
            clearBanner(host);
            if (restore !== false) {
                if (prior) renderCodeViewer(host, prior);
                else clearCodeViewer(host);
            }
            // A viewer the tour mounted for itself goes with it.
            if (!hadShell) {
                Array.prototype.forEach.call(
                    host.querySelectorAll(':scope > .codeViewerPane, :scope > .codeViewerEmpty'),
                    function (node) { node.remove(); }
                );
            }
        }
        if (root.parentNode) root.parentNode.removeChild(root);
        if (host) host.classList.remove('is-touring');
        if (typeof o.onClose === 'function') o.onClose();
    }

    backBtn.addEventListener('click', function () { go(index - 1); });
    nextBtn.addEventListener('click', function () {
        if (index === last) finish();
        else go(index + 1);
    });
    closeBtn.addEventListener('click', function () { close(); });
    root.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            if (index < last) go(index + 1);
        } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            go(index - 1);
        }
    });

    if (viewer) {
        const shellPane = host.querySelector(':scope > .codeViewerPane');
        hadShell = !!shellPane;
        prior = shellPane && !shellPane.hidden ? getOpenCodeViewerRef() : null;
        host.classList.add('is-touring');
    } else {
        document.body.appendChild(root);
    }
    activeClose = close;
    saveProgress(repo, tour.id, { step: index });
    paint();
    // Opening on the recap has no step to show; the banner still needs a viewer.
    if (viewer && index >= steps.length) showInViewer(steps[steps.length - 1]);
    if (viewer) {
        // The viewer closed (its ✕) or taken to another host takes the tour with it.
        unwatch = onCodeViewerChange(function () {
            const pane = host.querySelector(':scope > .codeViewerPane');
            if (shown && (!pane || pane.hidden)) close(false);
        });
    }
    if (index < steps.length && typeof o.onStep === 'function') o.onStep(steps[index], index);
    if (typeof root.focus === 'function') root.focus({ preventScroll: true });
    return { root: root, close: close };
}
