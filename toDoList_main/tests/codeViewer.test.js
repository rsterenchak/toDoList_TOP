import { describe, it, expect, beforeEach, vi } from 'vitest';

// Tests for the Structure tab's detail-column code viewer (codeViewer.js).
//
// The module is a pure reader over the Worker's `read` route: it fetches a
// repo-relative path through readRepoFile, splits it into lines, and paints a
// WINDOW of them into whatever host element the caller hands it. The windowing
// is the load-bearing part — the files this viewer is pointed at are the largest
// ones in the repo (the refactor scan picks the largest over-budget file), so a
// whole-file render would stall on almost every real jump.
//
// inject.js is mocked so each read can be scripted (content, failure, or a
// deferred promise for the stale-read case) without a Worker.

const { state } = vi.hoisted(() => ({
    state: {
        // repo-relative path → { content, sha } | { ok: false, reason }
        files: {},
        calls: [],
        // When set, reads resolve only once the test calls state.release().
        defer: false,
        pending: [],
    },
}));

vi.mock('../src/inject.js', () => ({
    readRepoFile: vi.fn(function (target, filePath) {
        state.calls.push({ repo: target && target.repo, filePath });
        const canned = state.files[filePath];
        const result = canned && canned.ok === false
            ? canned
            : { ok: true, content: (canned && canned.content) || '', sha: (canned && canned.sha) || 'sha-1' };
        if (!state.defer) return Promise.resolve(result);
        return new Promise(function (resolve) { state.pending.push(function () { resolve(result); }); });
    }),
}));

import {
    renderCodeViewer,
    clearCodeViewer,
    getOpenCodeViewerFile,
    onCodeViewerChange,
    resetCodeViewer,
} from '../src/codeViewer.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) { for (let i = 0; i < n; i++) await tick(); }

const TARGET = { repo: 'rsterenchak/toDoList_TOP' };

// A file of `n` lines whose text names its own line number, so a rendered window
// can be checked against the numbers in the gutter.
function fileOf(n) {
    const out = [];
    for (let i = 1; i <= n; i++) out.push('line ' + i);
    return out.join('\n');
}

function host() {
    return document.getElementById('col');
}

function lineNumbers() {
    return Array.from(document.querySelectorAll('.codeViewerLine'))
        .map((el) => Number(el.dataset.line));
}

function refs() {
    return {
        pane: document.querySelector('.codeViewerPane'),
        empty: document.querySelector('.codeViewerEmpty'),
        path: document.querySelector('.codeViewerPath'),
        meta: document.querySelector('.codeViewerMeta'),
        gh: document.querySelector('.codeViewerGithub'),
        close: document.querySelector('.codeViewerClose'),
        banner: document.querySelector('.codeViewerBanner'),
        bannerText: document.querySelector('.codeViewerBannerText'),
        bannerDismiss: document.querySelector('.codeViewerBannerDismiss'),
        status: document.querySelector('.codeViewerStatus'),
        moreUp: document.querySelector('.codeViewerMore--up'),
        moreDown: document.querySelector('.codeViewerMore--down'),
    };
}

beforeEach(() => {
    document.body.innerHTML = '<div id="col"></div>';
    state.files = {};
    state.calls = [];
    state.defer = false;
    state.pending = [];
    resetCodeViewer();
});

describe('renderCodeViewer — cold open', () => {
    beforeEach(() => {
        state.files['toDoList_main/src/style.css'] = { content: fileOf(1000) };
    });

    it('reads the file through the Worker and renders the first 300 lines', async () => {
        renderCodeViewer(host(), { target: TARGET, filePath: 'toDoList_main/src/style.css' });
        await flush();

        expect(state.calls).toEqual([
            { repo: 'rsterenchak/toDoList_TOP', filePath: 'toDoList_main/src/style.css' },
        ]);
        const nums = lineNumbers();
        expect(nums.length).toBe(300);
        expect(nums[0]).toBe(1);
        expect(nums[299]).toBe(300);
    });

    it('paints each line as text beside its gutter number', async () => {
        renderCodeViewer(host(), { target: TARGET, filePath: 'toDoList_main/src/style.css' });
        await flush();

        const first = document.querySelector('.codeViewerLine');
        expect(first.querySelector('.codeViewerGutter').textContent).toBe('1');
        expect(first.querySelector('.codeViewerCode').textContent).toBe('line 1');
    });

    it('heads the pane with the path, the file’s TOTAL line count, and a GitHub link', async () => {
        renderCodeViewer(host(), { target: TARGET, filePath: 'toDoList_main/src/style.css' });
        await flush();

        const r = refs();
        expect(r.path.textContent).toBe('toDoList_main/src/style.css');
        // 1000, not the 300 rendered — the count describes the file, not the window.
        expect(r.meta.textContent).toBe('1000 lines');
        expect(r.gh.getAttribute('href'))
            .toBe('https://github.com/rsterenchak/toDoList_TOP/blob/main/toDoList_main/src/style.css');
    });

    it('shows the pane and hides the empty state, and reports the open file', async () => {
        renderCodeViewer(host(), { target: TARGET, filePath: 'toDoList_main/src/style.css' });
        await flush();

        const r = refs();
        expect(r.pane.hidden).toBe(false);
        expect(r.empty.hidden).toBe(true);
        expect(getOpenCodeViewerFile()).toBe('toDoList_main/src/style.css');
    });

    it('renders nothing for a file that can’t be addressed', () => {
        expect(renderCodeViewer(host(), { target: TARGET, filePath: '' })).toBeNull();
        expect(renderCodeViewer(host(), { target: {}, filePath: 'a.js' })).toBeNull();
        expect(renderCodeViewer(null, { target: TARGET, filePath: 'a.js' })).toBeNull();
        expect(state.calls).toEqual([]);
    });

    it('drops the trailing empty element a file-final newline produces', async () => {
        state.files['a.js'] = { content: 'one\ntwo\n' };
        renderCodeViewer(host(), { target: TARGET, filePath: 'a.js' });
        await flush();
        expect(lineNumbers()).toEqual([1, 2]);
        expect(refs().meta.textContent).toBe('2 lines');
    });
});

describe('renderCodeViewer — windowing and chunk loading', () => {
    it('offers "Load 200 more" only in directions that still have unrendered lines', async () => {
        state.files['big.js'] = { content: fileOf(1000) };
        renderCodeViewer(host(), { target: TARGET, filePath: 'big.js' });
        await flush();

        const r = refs();
        // Cold open sits at the top of the file: nothing above, 700 lines below.
        expect(r.moreUp.hidden).toBe(true);
        expect(r.moreDown.hidden).toBe(false);
    });

    it('appends the next 200 lines to the EXISTING DOM rather than re-rendering', async () => {
        state.files['big.js'] = { content: fileOf(1000) };
        renderCodeViewer(host(), { target: TARGET, filePath: 'big.js' });
        await flush();
        const firstNode = document.querySelector('.codeViewerLine');

        refs().moreDown.click();

        const nums = lineNumbers();
        expect(nums.length).toBe(500);
        expect(nums[499]).toBe(500);
        // Same element object — the already-read lines were not rebuilt, so the
        // reading position survives the load.
        expect(document.querySelector('.codeViewerLine')).toBe(firstNode);
    });

    it('hides the down control once the last line is rendered', async () => {
        state.files['small.js'] = { content: fileOf(360) };
        renderCodeViewer(host(), { target: TARGET, filePath: 'small.js' });
        await flush();
        expect(refs().moreDown.hidden).toBe(false);

        refs().moreDown.click();

        expect(lineNumbers().length).toBe(360);
        expect(refs().moreDown.hidden).toBe(true);
    });

    it('never offers either control for a file that fits in the cold window', async () => {
        state.files['tiny.js'] = { content: fileOf(12) };
        renderCodeViewer(host(), { target: TARGET, filePath: 'tiny.js' });
        await flush();

        const r = refs();
        expect(lineNumbers().length).toBe(12);
        expect(r.moreUp.hidden).toBe(true);
        expect(r.moreDown.hidden).toBe(true);
    });

    it('prepends the previous 200 lines when loading upward from a jump window', async () => {
        state.files['big.js'] = { content: fileOf(3000) };
        renderCodeViewer(host(), {
            target: TARGET, filePath: 'big.js', startLine: 1000, endLine: 1100,
        });
        await flush();
        const startedAt = lineNumbers()[0];
        expect(startedAt).toBe(940);

        refs().moreUp.click();

        const nums = lineNumbers();
        expect(nums[0]).toBe(740);
        // The window's tail is untouched — only the head grew.
        expect(nums[nums.length - 1]).toBe(1239);
        expect(nums.length).toBe(500);
    });
});

describe('renderCodeViewer — jump to a span', () => {
    beforeEach(() => {
        state.files['big.js'] = { content: fileOf(3000) };
    });

    it('renders from 60 lines before the span to 60 after, widened to at least 300', async () => {
        renderCodeViewer(host(), {
            target: TARGET, filePath: 'big.js', startLine: 1000, endLine: 1100,
        });
        await flush();

        const nums = lineNumbers();
        // 940..1160 is 221 lines, so the window widens downward to 300.
        expect(nums[0]).toBe(940);
        expect(nums[nums.length - 1]).toBe(1239);
        expect(nums.length).toBe(300);
    });

    it('widens upward instead when the span sits at the end of the file', async () => {
        renderCodeViewer(host(), {
            target: TARGET, filePath: 'big.js', startLine: 2990, endLine: 2995,
        });
        await flush();

        const nums = lineNumbers();
        expect(nums[nums.length - 1]).toBe(3000);
        expect(nums.length).toBe(300);
        expect(nums[0]).toBe(2701);
    });

    it('highlights exactly the span’s lines', async () => {
        renderCodeViewer(host(), {
            target: TARGET, filePath: 'big.js', startLine: 1000, endLine: 1002,
        });
        await flush();

        const hits = Array.from(document.querySelectorAll('.codeViewerLine--hit'))
            .map((el) => Number(el.dataset.line));
        expect(hits).toEqual([1000, 1001, 1002]);
    });

    it('keeps the gutter identical on highlighted and unhighlighted lines', async () => {
        renderCodeViewer(host(), {
            target: TARGET, filePath: 'big.js', startLine: 1000, endLine: 1002,
        });
        await flush();

        const hitGutter = document.querySelector('.codeViewerLine--hit .codeViewerGutter');
        const plainGutter = document.querySelector('.codeViewerLine:not(.codeViewerLine--hit) .codeViewerGutter');
        // The highlight lives on the LINE row, never on the gutter — that's what
        // keeps the numbers from shifting as the span scrolls past.
        expect(hitGutter.className).toBe(plainGutter.className);
    });

    it('shows the banner naming the candidate, and points the GitHub link at the span', async () => {
        renderCodeViewer(host(), {
            target: TARGET,
            filePath: 'big.js',
            startLine: 1000,
            endLine: 1002,
            banner: 'Refactor candidate: buildFileRow',
        });
        await flush();

        const r = refs();
        expect(r.banner.hidden).toBe(false);
        expect(r.bannerText.textContent).toBe('Refactor candidate: buildFileRow');
        expect(r.gh.getAttribute('href'))
            .toBe('https://github.com/rsterenchak/toDoList_TOP/blob/main/big.js#L1000-L1002');
    });

    it('dismissing the banner clears the highlight and leaves the file open', async () => {
        renderCodeViewer(host(), {
            target: TARGET,
            filePath: 'big.js',
            startLine: 1000,
            endLine: 1002,
            banner: 'Refactor candidate: buildFileRow',
        });
        await flush();

        refs().bannerDismiss.click();

        const r = refs();
        expect(r.banner.hidden).toBe(true);
        expect(document.querySelectorAll('.codeViewerLine--hit').length).toBe(0);
        // The file itself stays open, at the same window.
        expect(getOpenCodeViewerFile()).toBe('big.js');
        expect(lineNumbers().length).toBe(300);
        expect(r.pane.hidden).toBe(false);
    });

    it('shows no banner when a jump carries no candidate text', async () => {
        renderCodeViewer(host(), {
            target: TARGET, filePath: 'big.js', startLine: 1000, endLine: 1002,
        });
        await flush();
        expect(refs().banner.hidden).toBe(true);
    });

    it('ignores a malformed span and opens cold', async () => {
        renderCodeViewer(host(), {
            target: TARGET, filePath: 'big.js', startLine: null, endLine: 1002, banner: 'x',
        });
        await flush();

        expect(lineNumbers()[0]).toBe(1);
        expect(document.querySelectorAll('.codeViewerLine--hit').length).toBe(0);
        expect(refs().banner.hidden).toBe(true);
    });
});

describe('clearCodeViewer', () => {
    it('returns the column to its empty state', async () => {
        state.files['a.js'] = { content: fileOf(10) };
        renderCodeViewer(host(), { target: TARGET, filePath: 'a.js' });
        await flush();

        clearCodeViewer(host());

        const r = refs();
        expect(r.pane.hidden).toBe(true);
        expect(r.empty.hidden).toBe(false);
        expect(document.querySelectorAll('.codeViewerLine').length).toBe(0);
        expect(getOpenCodeViewerFile()).toBeNull();
    });

    it('is how the close control behaves', async () => {
        state.files['a.js'] = { content: fileOf(10) };
        renderCodeViewer(host(), { target: TARGET, filePath: 'a.js' });
        await flush();

        refs().close.click();

        expect(refs().pane.hidden).toBe(true);
        expect(refs().empty.hidden).toBe(false);
        expect(getOpenCodeViewerFile()).toBeNull();
    });

    it('mounts the empty state on a column that has never held a viewer', () => {
        clearCodeViewer(host());
        expect(refs().empty.hidden).toBe(false);
        expect(refs().pane.hidden).toBe(true);
    });
});

describe('renderCodeViewer — caching and stale reads', () => {
    it('re-opening the same file serves from the module cache', async () => {
        state.files['a.js'] = { content: fileOf(400) };
        renderCodeViewer(host(), { target: TARGET, filePath: 'a.js' });
        await flush();
        clearCodeViewer(host());
        renderCodeViewer(host(), { target: TARGET, filePath: 'a.js', startLine: 350, endLine: 360 });
        await flush();

        expect(state.calls.length).toBe(1);
        expect(lineNumbers()).toContain(350);
    });

    it('re-reads a same-named file in a different repo', async () => {
        state.files['a.js'] = { content: fileOf(10) };
        renderCodeViewer(host(), { target: TARGET, filePath: 'a.js' });
        await flush();
        renderCodeViewer(host(), { target: { repo: 'rsterenchak/matchingGame-test' }, filePath: 'a.js' });
        await flush();

        expect(state.calls.length).toBe(2);
    });

    it('drops a read that resolves after a newer file was opened', async () => {
        state.files['slow.js'] = { content: fileOf(50) };
        state.files['fast.js'] = { content: fileOf(20) };
        state.defer = true;

        renderCodeViewer(host(), { target: TARGET, filePath: 'slow.js' });
        renderCodeViewer(host(), { target: TARGET, filePath: 'fast.js' });
        // Resolve the SECOND read first, then let the superseded one land.
        state.pending[1]();
        await flush();
        state.pending[0]();
        await flush();

        expect(refs().path.textContent).toBe('fast.js');
        expect(lineNumbers().length).toBe(20);
        expect(getOpenCodeViewerFile()).toBe('fast.js');
    });

    it('drops a read that resolves after the column was closed', async () => {
        state.files['slow.js'] = { content: fileOf(50) };
        state.defer = true;

        renderCodeViewer(host(), { target: TARGET, filePath: 'slow.js' });
        clearCodeViewer(host());
        state.pending[0]();
        await flush();

        expect(document.querySelectorAll('.codeViewerLine').length).toBe(0);
        expect(refs().pane.hidden).toBe(true);
    });
});

describe('renderCodeViewer — failure and safety', () => {
    it('says the read failed and renders no source', async () => {
        state.files['gone.js'] = { ok: false, reason: 'Not found' };
        renderCodeViewer(host(), { target: TARGET, filePath: 'gone.js' });
        await flush();

        const r = refs();
        expect(r.status.hidden).toBe(false);
        expect(r.status.textContent).toContain('Not found');
        expect(document.querySelectorAll('.codeViewerLine').length).toBe(0);
    });

    it('builds every line with textContent, so markup in the source stays text', async () => {
        state.files['x.html'] = { content: '<script>alert(1)</script>\n<img src=x onerror=y>' };
        renderCodeViewer(host(), { target: TARGET, filePath: 'x.html' });
        await flush();

        const codes = Array.from(document.querySelectorAll('.codeViewerCode'));
        expect(codes[0].textContent).toBe('<script>alert(1)</script>');
        expect(codes[1].textContent).toBe('<img src=x onerror=y>');
        // Nothing from the source was parsed into elements.
        expect(codes[0].children.length).toBe(0);
        expect(document.querySelector('.codeViewerBody script')).toBeNull();
        expect(document.querySelector('.codeViewerBody img')).toBeNull();
    });
});

describe('onCodeViewerChange', () => {
    it('fires on open and on close, and stops after unsubscribe', async () => {
        state.files['a.js'] = { content: fileOf(5) };
        const seen = [];
        const off = onCodeViewerChange(() => seen.push(getOpenCodeViewerFile()));

        renderCodeViewer(host(), { target: TARGET, filePath: 'a.js' });
        await flush();
        clearCodeViewer(host());
        expect(seen).toEqual(['a.js', null]);

        off();
        renderCodeViewer(host(), { target: TARGET, filePath: 'a.js' });
        await flush();
        expect(seen).toEqual(['a.js', null]);
    });
});
