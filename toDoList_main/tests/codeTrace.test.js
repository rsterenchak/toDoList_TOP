import { vi } from 'vitest';

// codeTrace.js resolves a tapped name in the code viewer against the deploy's
// src-symbols.json. These tests run its pure half over a small fixture index:
// which candidates a name resolves to, how they rank, which tokens on a line are
// made tappable at all, and that a failed index load fails soft.
import {
    loadSymbols,
    getLoadedSymbols,
    resetSymbolsCache,
    resolveName,
    topRanked,
    tokenizeLine,
    isTraceable,
} from '../src/codeTrace.js';

const SYMBOLS = {
    version: 1,
    files: {
        'dispatchDraft.js': {
            defs: [
                { name: 'draftFor', kind: 'function', start: 40, end: 60, parent: null },
            ],
            imports: {
                listLogic: { from: 'listLogic.js', name: 'listLogic' },
                renderPill: { from: 'pill.js', name: 'renderPill' },
            },
        },
        'listLogic.js': {
            defs: [
                { name: 'listLogic', kind: 'iife', start: 1, end: 200, parent: null },
                { name: 'getProjectTargetId', kind: 'function', start: 30, end: 36, parent: 'listLogic' },
                { name: 'helper', kind: 'function', start: 210, end: 212, parent: null },
            ],
            imports: {},
        },
        'pill.js': {
            defs: [
                { name: 'renderPill', kind: 'function', start: 5, end: 20, parent: null },
            ],
            imports: {},
        },
        'modals.js': {
            defs: [
                { name: 'showInjectTargetSubModal', kind: 'function', start: 10, end: 50, parent: null },
                { name: 'close', kind: 'function', start: 12, end: 15, parent: 'showInjectTargetSubModal' },
                { name: 'showOther', kind: 'function', start: 60, end: 90, parent: null },
                { name: 'close', kind: 'function', start: 62, end: 64, parent: 'showOther' },
            ],
            imports: {},
        },
        'a.js': {
            defs: [{ name: 'init', kind: 'function', start: 3, end: 9, parent: null }],
            imports: {},
        },
        'b.js': {
            defs: [{ name: 'init', kind: 'function', start: 7, end: 12, parent: null }],
            imports: {},
        },
    },
};

describe('resolveName', () => {
    it('resolves a qualified import through the IIFE owner', () => {
        const c = resolveName(SYMBOLS, 'dispatchDraft.js', 45, 'getProjectTargetId', 'listLogic');
        expect(c).toHaveLength(1);
        expect(c[0].file).toBe('listLogic.js');
        expect(c[0].def.start).toBe(30);
        expect(c[0].reason).toBe('import');
        expect(topRanked(c)).toHaveLength(1);
    });

    it('resolves nested same-name functions by enclosing scope', () => {
        const first = resolveName(SYMBOLS, 'modals.js', 30, 'close', null);
        expect(topRanked(first)).toHaveLength(1);
        expect(first[0].def.start).toBe(12);
        expect(first[0].reason).toBe('same scope');

        const second = resolveName(SYMBOLS, 'modals.js', 70, 'close', null);
        expect(topRanked(second)).toHaveLength(1);
        expect(second[0].def.start).toBe(62);
    });

    it('resolves an unqualified imported function', () => {
        const c = resolveName(SYMBOLS, 'dispatchDraft.js', 50, 'renderPill', null);
        expect(c).toHaveLength(1);
        expect(c[0].file).toBe('pill.js');
        expect(c[0].def.start).toBe(5);
        expect(c[0].reason).toBe('import');
    });

    it('falls back to a repo-wide match with several equally ranked candidates', () => {
        const c = resolveName(SYMBOLS, 'dispatchDraft.js', 50, 'init', null);
        expect(c.map((x) => x.file)).toEqual(['a.js', 'b.js']);
        expect(topRanked(c)).toHaveLength(2);
    });

    it('returns nothing for an unknown name or a missing index', () => {
        expect(resolveName(SYMBOLS, 'dispatchDraft.js', 50, 'nope', null)).toEqual([]);
        expect(resolveName(null, 'dispatchDraft.js', 50, 'init', null)).toEqual([]);
    });
});

describe('tokenizeLine', () => {
    const known = (name) => isTraceable(SYMBOLS, 'dispatchDraft.js', name);
    const names = (line) => tokenizeLine(line, known).filter((s) => s.name);

    it('wraps known names and carries a qualifier', () => {
        const segs = names('    const id = listLogic.getProjectTargetId(project);');
        expect(segs.map((s) => s.name)).toEqual(['listLogic', 'getProjectTargetId']);
        expect(segs[1].qualifier).toBe('listLogic');
        expect(segs[0].qualifier).toBeNull();
    });

    it('never wraps keywords, comments or strings', () => {
        expect(names('return function () { if (x) return; };')).toEqual([]);
        expect(names('// renderPill is called below')).toEqual([]);
        expect(names("x(); // then renderPill")).toEqual([]);
        expect(names("const s = 'renderPill' + \"init\" + `helper`;")).toEqual([]);
        expect(names('/* renderPill */ foo();')).toEqual([]);
        expect(names(' * renderPill builds the pill')).toEqual([]);
    });

    it('keeps the text intact', () => {
        const line = "  renderPill(listLogic.helper, 'init'); // init";
        expect(tokenizeLine(line, known).map((s) => s.text).join('')).toBe(line);
    });

    it('does not wrap a known name inside a longer identifier', () => {
        expect(names('const renderPillFoo = initial;')).toEqual([]);
    });
});

describe('loadSymbols', () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = realFetch;
        resetSymbolsCache();
    });

    it('fails soft to null on a network error, once per repo', async () => {
        globalThis.fetch = vi.fn(() => Promise.reject(new Error('offline')));
        expect(await loadSymbols('owner/repo')).toBeNull();
        expect(await loadSymbols('owner/repo')).toBeNull();
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(getLoadedSymbols('owner/repo')).toBeNull();
    });

    it('fails soft to null on a non-ok response or a malformed body', async () => {
        globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false }));
        expect(await loadSymbols('owner/a')).toBeNull();
        globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ nope: 1 }) }));
        expect(await loadSymbols('owner/b')).toBeNull();
    });

    it('fetches src-symbols.json from the repo’s Pages site', async () => {
        globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(SYMBOLS) }));
        const got = await loadSymbols('owner/repo');
        expect(got).toBe(SYMBOLS);
        expect(globalThis.fetch.mock.calls[0][0]).toBe('https://owner.github.io/repo/src-symbols.json');
        expect(getLoadedSymbols('owner/repo')).toBe(SYMBOLS);
    });
});
