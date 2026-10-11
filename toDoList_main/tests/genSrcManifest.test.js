// The build-time UI index produced by scripts/gen-src-manifest.js. `scanRegions`
// is the pure scanner that maps id / data-region handles in the source to the
// file(s) and line(s) that define them — JS definition preferred as the primary
// owner. The CLI write step stays behind a `require.main === module` guard, so
// importing the module here is side-effect-free.
import gen from '../scripts/gen-src-manifest.js';

const { scanRegions } = gen;

function src(name, text, isJs) {
    return { name, isJs: isJs === undefined ? /\.(jsx?|tsx?)$/.test(name) : isJs, text };
}

describe('gen-src-manifest scanRegions', () => {
    it('records id assignments and object-literal ids with prettified labels', () => {
        const regions = scanRegions([
            src('main.js', "el.id = 'taskList';\nconst o = { id: 'addProj' };\nnode.setAttribute('id', 'fooBar');"),
        ]);
        const bySel = Object.fromEntries(regions.map((r) => [r.selector, r]));
        expect(bySel['#taskList']).toBeTruthy();
        expect(bySel['#taskList'].label).toBe('Task List');
        expect(bySel['#taskList'].file).toBe('main.js');
        expect(bySel['#taskList'].line).toBe(1);
        expect(bySel['#addProj']).toBeTruthy();
        expect(bySel['#fooBar'].label).toBe('Foo Bar');
    });

    it('records data-region handles from attribute and setAttribute forms', () => {
        const regions = scanRegions([
            src('a.js', "x.setAttribute('data-region', 'Tasks');"),
            src('b.html', '<div data-region="Sidebar"></div>', false),
        ]);
        const sels = regions.map((r) => r.selector);
        expect(sels).toContain('[data-region="Tasks"]');
        expect(sels).toContain('[data-region="Sidebar"]');
        const tasks = regions.find((r) => r.selector === '[data-region="Tasks"]');
        expect(tasks.label).toBe('Tasks');
    });

    it('prefers the JS definition as the primary owner and lists CSS as a secondary owner', () => {
        const regions = scanRegions([
            src('style.css', '#board { color: red; }\n#board:hover { color: blue; }', false),
            src('app.js', "root.id = 'board';"),
        ]);
        const board = regions.find((r) => r.selector === '#board');
        expect(board).toBeTruthy();
        // Primary owner is the JS file even though CSS was scanned first.
        expect(board.file).toBe('app.js');
        const ownerFiles = board.files.map((f) => f.file);
        expect(ownerFiles).toContain('app.js');
        expect(ownerFiles).toContain('style.css');
        // Deduped: each file appears once even though #board occurs twice in CSS.
        expect(ownerFiles.filter((f) => f === 'style.css').length).toBe(1);
    });

    it('ignores CSS hex colors and id-like fragments that are never defined', () => {
        const regions = scanRegions([
            src('style.css', 'a { color: #fff; background: #abc123; }\n#unknownId { color: red; }', false),
        ]);
        // No JS/HTML defined any of these, so the CSS-only matches are dropped.
        expect(regions.length).toBe(0);
    });

    it('does not match unrelated attributes like data-id', () => {
        const regions = scanRegions([
            src('main.js', 'node.setAttribute("data-id", "xyz");'),
        ]);
        expect(regions.find((r) => r.selector === '#xyz')).toBeFalsy();
    });
});

// The web-mode module graph and code-map areas feeding the Structure tab's Map
// lens. `parseImports` / `extractPurpose` are the pure per-file parsers;
// `buildWebManifest` is exercised against a throwaway src/ on disk so the
// codemap.json presence/absence and drift warnings are tested end to end.
const { parseImports, extractPurpose, buildWebManifest } = gen;

describe('gen-src-manifest parseImports', () => {
    it('resolves static, re-export and dynamic imports to src-relative paths', () => {
        const text = [
            "import { a } from './a.js';",
            'import {',
            '    b,',
            '    c,',
            "} from './lib/b.js';",
            "export { d } from '../d.js';",
            "export * from './e.js';",
            "const m = await import('./f.js');",
        ].join('\n');
        expect(parseImports(text, 'sub/x.js')).toEqual(['d.js', 'sub/a.js', 'sub/e.js', 'sub/f.js', 'sub/lib/b.js']);
    });

    it('ignores package imports, de-duplicates and sorts', () => {
        const text = [
            "import _ from 'lodash';",
            "import { createClient } from '@supabase/supabase-js';",
            "import { z } from './z.js';",
            "import { y } from './y.js';",
            "import { z2 } from './z.js';",
            "const p = import('workbox-routing');",
        ].join('\n');
        expect(parseImports(text, 'main.js')).toEqual(['y.js', 'z.js']);
    });

    it('resolves extensionless specifiers against the known file list and skips commented-out imports', () => {
        const text = "import { a } from './a';\n// import { gone } from './gone.js';\nconst v = import(`./${name}.js`);";
        expect(parseImports(text, 'main.js', ['a.js', 'main.js'])).toEqual(['a.js']);
    });
});

describe('gen-src-manifest extractPurpose', () => {
    it('takes the first sentence of a leading // block', () => {
        expect(extractPurpose('// Light/dark theme module.\n//\n// Dark is the default.\nexport const x = 1;'))
            .toBe('Light/dark theme module.');
    });

    it('takes the first sentence of a leading /* */ block', () => {
        expect(extractPurpose('\n/**\n * Renders the board. Also handles input.\n */\nexport default 1;'))
            .toBe('Renders the board.');
    });

    it('returns null when the file opens with code', () => {
        expect(extractPurpose("import './style.css';\n// Not a header.")).toBeNull();
        expect(extractPurpose('')).toBeNull();
    });

    it('trims the purpose to 140 chars', () => {
        const long = '// ' + 'word '.repeat(60) + 'end.';
        expect(extractPurpose(long).length).toBeLessThanOrEqual(140);
    });
});

describe('gen-src-manifest buildWebManifest modules/areas', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    let root;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-'));
        fs.mkdirSync(path.join(root, 'src'));
        fs.writeFileSync(path.join(root, 'src', 'a.js'), "// Does A.\nimport { b } from './b.js';\nexport const a = b;\n");
        fs.writeFileSync(path.join(root, 'src', 'b.js'), 'export const b = 1;\n');
        fs.writeFileSync(path.join(root, 'src', 'style.css'), '.x { color: red; }\n');
    });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('emits one module per JS file and omits areas when codemap.json is absent', () => {
        const warn = vi.fn();
        const m = buildWebManifest({ srcDir: path.join(root, 'src'), warn });
        expect(m.modules).toEqual([
            { path: 'a.js', lines: 3, imports: ['b.js'], purpose: 'Does A.' },
            { path: 'b.js', lines: 1, imports: [], purpose: null },
        ]);
        expect(Object.prototype.hasOwnProperty.call(m, 'areas')).toBe(false);
        expect(m.files).toEqual(['a.js', 'b.js', 'style.css']);
        expect(m.lens).toBe('ui');
        expect(warn).not.toHaveBeenCalled();
    });

    it('copies codemap areas through and warns about unassigned and missing files', () => {
        const areas = [{ id: 'core', name: 'Core', purpose: 'Core.', pos: [0.5, 0.5], files: ['a.js', 'gone.js'] }];
        fs.writeFileSync(path.join(root, 'codemap.json'), JSON.stringify({ version: 1, areas }));
        const warn = vi.fn();
        const m = buildWebManifest({ srcDir: path.join(root, 'src'), warn });
        expect(m.areas).toEqual(areas);
        const msgs = warn.mock.calls.map((c) => c[0]).join('\n');
        expect(msgs).toMatch(/1 JS file\(s\) in no area — b\.js/);
        expect(msgs).toMatch(/1 area file\(s\) not found — core: gone\.js/);
    });

    it('stays silent when every JS file is assigned to an area', () => {
        const areas = [{ id: 'core', name: 'Core', purpose: 'Core.', pos: [0.5, 0.5], files: ['a.js', 'b.js'] }];
        fs.writeFileSync(path.join(root, 'codemap.json'), JSON.stringify({ version: 1, areas }));
        const warn = vi.fn();
        buildWebManifest({ srcDir: path.join(root, 'src'), warn });
        expect(warn).not.toHaveBeenCalled();
    });
});

// Guards the real src/ so a new module can't ship without a top-of-file purpose
// comment (the Map lens shows it) or without a place in codemap.json.
describe('gen-src-manifest real src/ coverage', () => {
    const path = require('path');

    it('gives every module a purpose and puts every JS file in exactly one area', () => {
        const warn = vi.fn();
        const m = buildWebManifest({ srcDir: path.resolve(__dirname, '..', 'src'), warn });
        expect(m.modules.length).toBeGreaterThan(0);
        expect(m.modules.filter((mod) => !mod.purpose).map((mod) => mod.path)).toEqual([]);
        expect(Array.isArray(m.areas)).toBe(true);
        const counts = {};
        m.areas.forEach((a) => a.files.forEach((f) => { counts[f] = (counts[f] || 0) + 1; }));
        const misplaced = m.modules.map((mod) => mod.path).filter((p) => counts[p] !== 1);
        expect(misplaced).toEqual([]);
    });
});

// The definitions index written to src-symbols.json for tap-to-trace.
// `scanJsDefs` / `parseImportBindings` are the pure per-file scanners;
// `scanCsharpTypes` gains `end` lines for types and members.
const { scanJsDefs, parseImportBindings, buildSymbols, buildWebSymbols, scanCsharpTypes } = gen;

function defsNamed(defs, name) { return defs.filter((d) => d.name === name); }

describe('gen-src-manifest scanJsDefs', () => {
    it('gives nested same-name functions distinct parents and ranges', () => {
        const text = [
            'function outerA() {',        // 1
            '    function close() {',     // 2
            '        return 1;',          // 3
            '    }',                      // 4
            '}',                          // 5
            'export function outerB() {', // 6
            '    const close = () => {',  // 7
            '        if (x) { y(); }',    // 8
            '    };',                     // 9
            '    async function* gen() {}', // 10
            '}',                          // 11
        ].join('\n');
        const defs = scanJsDefs(text);
        expect(defsNamed(defs, 'close')).toEqual([
            { name: 'close', kind: 'function', start: 2, end: 4, parent: 'outerA' },
            { name: 'close', kind: 'function', start: 7, end: 9, parent: 'outerB' },
        ]);
        expect(defsNamed(defs, 'outerA')[0]).toEqual({ name: 'outerA', kind: 'function', start: 1, end: 5, parent: null });
        expect(defsNamed(defs, 'outerB')[0]).toMatchObject({ start: 6, end: 11, parent: null });
        expect(defsNamed(defs, 'gen')[0]).toMatchObject({ kind: 'function', start: 10, end: 10, parent: 'outerB' });
    });

    it('ignores braces inside strings, template literals, comments and regexes', () => {
        const text = [
            'function tricky(a) {',                       // 1
            "    const s = '}' + \"{{\";",                 // 2
            '    const t = `}${ a ? `{` : { k: 1 }.k }}`;', // 3
            '    // } stray close in a comment',           // 4
            '    /* { block',                              // 5
            '       } */',                                 // 6
            '    const re = /[}{]\\/}/g;',                 // 7
            '    return a.split(/}/).length / 2;',         // 8
            '}',                                           // 9
            'function after() {',                          // 10
            '}',                                           // 11
        ].join('\n');
        const defs = scanJsDefs(text);
        expect(defsNamed(defs, 'tricky')[0]).toMatchObject({ start: 1, end: 9, parent: null });
        expect(defsNamed(defs, 'after')[0]).toMatchObject({ start: 10, end: 11, parent: null });
    });

    it('parents defs inside an IIFE to its owner', () => {
        const text = [
            'export const store = (function () {', // 1
            '    let items = [];',                 // 2
            '    function add(x) {',               // 3
            '        items.push(x);',              // 4
            '    }',                               // 5
            '    return { add };',                 // 6
            '})();',                               // 7
        ].join('\n');
        const defs = scanJsDefs(text);
        expect(defsNamed(defs, 'store')[0]).toEqual({ name: 'store', kind: 'iife', start: 1, end: 7, parent: null });
        expect(defsNamed(defs, 'add')[0]).toEqual({ name: 'add', kind: 'function', start: 3, end: 5, parent: 'store' });
    });

    it('records class and object-literal methods and a braceless arrow on its own line', () => {
        const text = [
            'class Board extends Base {',         // 1
            '    constructor(n) {',               // 2
            '        super(n);',                  // 3
            '    }',                              // 4
            '    static async load(id) {',        // 5
            '        return id;',                 // 6
            '    }',                              // 7
            '}',                                  // 8
            'const api = {',                      // 9
            '    open(x) { return x; },',         // 10
            '    shut: function () {',            // 11
            '    },',                             // 12
            '    peek: (a, b) => {',              // 13
            '        return a;',                  // 14
            '    },',                             // 15
            '    tap: async (e) => e,',           // 16
            '    label: flag ? (x) => x : null,', // 17
            '};',                                 // 18
            'const double = (n) => n * 2;',       // 19
        ].join('\n');
        const defs = scanJsDefs(text);
        expect(defsNamed(defs, 'Board')[0]).toEqual({ name: 'Board', kind: 'class', start: 1, end: 8, parent: null });
        expect(defsNamed(defs, 'constructor')[0]).toEqual({ name: 'constructor', kind: 'method', start: 2, end: 4, parent: 'Board' });
        expect(defsNamed(defs, 'load')[0]).toEqual({ name: 'load', kind: 'method', start: 5, end: 7, parent: 'Board' });
        expect(defsNamed(defs, 'open')[0]).toMatchObject({ kind: 'method', start: 10, end: 10 });
        expect(defsNamed(defs, 'shut')[0]).toMatchObject({ kind: 'method', start: 11, end: 12 });
        expect(defsNamed(defs, 'peek')[0]).toMatchObject({ kind: 'method', start: 13, end: 15 });
        expect(defsNamed(defs, 'tap')[0]).toMatchObject({ kind: 'method', start: 16, end: 16 });
        expect(defsNamed(defs, 'flag')).toEqual([]);
        expect(defsNamed(defs, 'double')[0]).toEqual({ name: 'double', kind: 'function', start: 19, end: 19, parent: null });
        // super(n) is a call, not a method.
        expect(defsNamed(defs, 'super')).toEqual([]);
    });

    it('never treats control keywords or calls as method names', () => {
        const text = [
            'function run(list) {',
            '    if (list) { go(); }',
            '    for (const x of list) { go(x); }',
            '    while (list.length) { list.pop(); }',
            '    switch (list[0]) { default: break; }',
            '    try { go(); } catch (e) { warn(e); }',
            '    list.forEach(function (x) { go(x); });',
            '}',
        ].join('\n');
        const names = scanJsDefs(text).map((d) => d.name);
        expect(names).toEqual(['run']);
    });
});

describe('gen-src-manifest parseImportBindings', () => {
    it('maps named, aliased, default and namespace imports and ignores packages', () => {
        const text = [
            "import { a, b as c } from './x.js';",
            "import d from './lib/d';",
            "import * as ns from '../ns.js';",
            "import e, { f } from './x.js';",
            "import _ from 'lodash';",
            "// import { gone } from './gone.js';",
        ].join('\n');
        expect(parseImportBindings(text, 'sub/main.js', ['sub/x.js', 'sub/lib/d.js', 'ns.js'])).toEqual({
            a: { from: 'sub/x.js', name: 'a' },
            c: { from: 'sub/x.js', name: 'b' },
            d: { from: 'sub/lib/d.js', name: 'default' },
            e: { from: 'sub/x.js', name: 'default' },
            f: { from: 'sub/x.js', name: 'f' },
            ns: { from: 'ns.js', name: '*' },
        });
    });

    it('emits sorted file keys and a versioned shape', () => {
        const out = buildSymbols([
            { name: 'b.js', isJs: true, text: "import { a } from './a.js';\nexport function useA() { return a; }\n" },
            { name: 'style.css', isJs: false, text: '.x {}' },
            { name: 'a.js', isJs: true, text: 'export const a = () => 1;\n' },
        ]);
        expect(out.version).toBe(1);
        expect(Object.keys(out.files)).toEqual(['a.js', 'b.js']);
        expect(out.files['b.js']).toEqual({
            defs: [{ name: 'useA', kind: 'function', start: 2, end: 2, parent: null }],
            imports: { a: { from: 'a.js', name: 'a' } },
        });
    });
});

describe('gen-src-manifest scanCsharpTypes end lines', () => {
    it('adds end to a class, a block method and an expression-bodied property', () => {
        const text = [
            'namespace Demo {',                                // 1
            '    public class Player {',                       // 2
            '        public string Name => "{" + _name;',      // 3
            '        public int Score { get; set; }',          // 4
            '        public void Hit(int n) {',                // 5
            '            var s = $"{n} }}";',                  // 6
            '            if (n > 0) { Score -= n; }',          // 7
            '        }',                                       // 8
            '    }',                                           // 9
            '    public record Point(int X, int Y);',          // 10
            '}',                                               // 11
        ].join('\n');
        const types = scanCsharpTypes(text, 'Demo.cs');
        const player = types.find((t) => t.name === 'Player');
        expect(player).toMatchObject({ line: 2, end: 9 });
        const byName = Object.fromEntries(player.members.map((mm) => [mm.name, mm]));
        expect(byName.Name).toMatchObject({ kind: 'property', line: 3, end: 3 });
        expect(byName.Score).toMatchObject({ kind: 'property', line: 4, end: 4 });
        expect(byName.Hit).toMatchObject({ kind: 'method', line: 5, end: 8 });
        expect(types.find((t) => t.name === 'Point')).toMatchObject({ line: 10, end: 10 });
    });
});

// Pins the scanner against the real src/: the IIFE owner and nested same-name
// closures are matched by name and parent, never hard-coded lines.
describe('gen-src-manifest real src/ symbols', () => {
    const fs = require('fs');
    const path = require('path');
    const srcDir = path.resolve(__dirname, '..', 'src');
    const symbols = buildWebSymbols({ srcDir });

    it('resolves listLogic.getProjectTargetId inside the listLogic IIFE', () => {
        const hit = defsNamed(symbols.files['listLogic.js'].defs, 'getProjectTargetId');
        expect(hit.length).toBe(1);
        expect(hit[0].parent).toBe('listLogic');
        const lines = fs.readFileSync(path.join(srcDir, 'listLogic.js'), 'utf8').split('\n');
        expect(lines[hit[0].start - 1]).toMatch(/function getProjectTargetId\(/);
        expect(lines[hit[0].end - 1].trim()).toBe('}');
        expect(hit[0].end).toBeGreaterThan(hit[0].start);
    });

    it('separates the three inject.js close() closures by parent', () => {
        const parents = defsNamed(symbols.files['inject.js'].defs, 'close').map((d) => d.parent).sort();
        expect(parents).toEqual(['showInjectSettingsModal', 'showInjectTargetSubModal', 'showOnboardModal']);
    });
});

// Code tours compiled from codetour.json into src-tours.json. Steps anchor to
// a def (file + symbol, + parent) and ordered match text, never line numbers.
const { compileTours, buildWebTours, writeWebTours } = gen;

describe('gen-src-manifest compileTours', () => {
    const app = [
        'function outer() {',                      // 1
        '    function inner() {',                  // 2
        '        const a = 1;',                    // 3
        '        return a;',                       // 4
        '    }',                                   // 5
        '    return inner;',                       // 6
        '}',                                       // 7
        'function other() {',                      // 8
        '    function inner() {',                  // 9
        '        const a = 2;',                    // 10
        '        const b = 3;',                    // 11
        '        return a + b;',                   // 12
        '    }',                                   // 13
        '}',                                       // 14
    ].join('\n');
    const sources = [src('app.js', app)];
    const symbols = buildSymbols(sources);
    const areas = [{ id: 'core', files: ['app.js'] }];
    const st = (symbol, match, extra) => Object.assign({ file: 'app.js', symbol, match, title: 'T ' + symbol, why: 'W' }, extra);
    const doc = (steps) => ({ version: 1, sections: [{ id: 'tasks', title: 'Tasks' }], tours: [{ id: 't1', section: 'tasks', title: 'Tour', recap: [{ title: 'R', body: 'B' }], steps }] });

    it('resolves by symbol + parent, enriches line/area/next and keeps sections and recap', () => {
        const warn = vi.fn();
        const out = compileTours(doc([
            st('inner', ['const a'], { parent: 'other' }),
            st('outer', ['return inner;']),
            st('inner', ['return a;'], { parent: 'outer' }),
        ]), symbols, sources, areas, warn);
        expect(warn).not.toHaveBeenCalled();
        expect(out.version).toBe(1);
        expect(out.sections).toEqual([{ id: 'tasks', title: 'Tasks' }]);
        const t = out.tours[0];
        expect(t.recap).toEqual([{ title: 'R', body: 'B' }]);
        expect(t.steps.map((s) => s.line)).toEqual([10, 6, 4]);
        expect(t.steps.map((s) => s.parent)).toEqual(['other', null, 'outer']);
        expect(t.steps.map((s) => s.area)).toEqual(['core', 'core', 'core']);
        expect(t.steps.map((s) => s.next)).toEqual(['outer', 'inner', null]);
        expect(t.steps[0]).not.toHaveProperty('match');
    });

    it('finds matches in order, each after the previous one', () => {
        const warn = vi.fn();
        const out = compileTours(doc([
            st('other', ['const b', 'return']),
            st('other', ['const a', 'const b']),
            st('outer', ['function inner', 'return']),
        ]), symbols, sources, areas, warn);
        expect(warn).not.toHaveBeenCalled();
        const hiLines = (s) => s.snippet.filter((r) => r.hi).map((r) => r.n);
        expect(hiLines(out.tours[0].steps[0])).toEqual([11, 12]);
        expect(hiLines(out.tours[0].steps[1])).toEqual([10, 11]);
        // `return` after line 2 is the inner `return a;`, not `return inner;`.
        expect(hiLines(out.tours[0].steps[2])).toEqual([2, 4]);
    });

    it('rejects a non-unique first match, an ambiguous symbol and an out-of-order match', () => {
        const warn = vi.fn();
        const out = compileTours(doc([
            st('other', ['const']),
            st('inner', ['return']),
            st('other', ['const b', 'const a']),
            st('outer', ['return inner;']),
        ]), symbols, sources, areas, warn);
        const msgs = warn.mock.calls.map((c) => c[0]);
        expect(msgs[0]).toMatch(/tour "t1" step 1 \(app\.js › other\): first match "const" is not unique/);
        expect(msgs[1]).toMatch(/step 2 .*ambiguous/);
        expect(msgs[2]).toMatch(/step 3 .*match "const a" not found after "const b"/);
        // Only one step resolved, so the tour itself is dropped too.
        expect(msgs[3]).toMatch(/tour "t1" has 1 resolved step\(s\), needs 3 — tour dropped/);
        expect(out.tours).toEqual([]);
    });

    it('drops failing steps with a warning and re-links next over the survivors', () => {
        const warn = vi.fn();
        const out = compileTours(doc([
            st('outer', ['return inner;']),
            st('missing', ['x']),
            st('other', ['const a']),
            st('inner', ['return a;'], { parent: 'outer' }),
        ]), symbols, sources, areas, warn);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/step 2 \(app\.js › missing\): symbol not found — step dropped/);
        expect(out.tours[0].steps.map((s) => s.next)).toEqual(['other', 'inner', null]);
    });

    it('builds snippets with context, gap rows, trimmed indent and a 12-row cap', () => {
        const body = ['function big() {'];
        for (let i = 2; i <= 40; i++) body.push('        line' + i + ';');
        body.push('}');
        const bigSrc = [src('big.js', body.join('\n'))];
        const bigSyms = buildSymbols(bigSrc);
        const s = (match) => ({ file: 'big.js', symbol: 'big', match, title: 'T', why: 'W' });
        const out = compileTours({ tours: [{ id: 'b', steps: [
            s(['line5;', 'line9;']),               // 2 hidden lines (7–8) → joined
            s(['line5;', 'line11;']),              // 3 hidden lines (7–9) → gap row
            s(['line3;', 'line10;', 'line17;', 'line24;', 'line31;']),
        ] }] }, bigSyms, bigSrc, undefined, vi.fn());
        const [joined, gapped, capped] = out.tours[0].steps;
        expect(joined.snippet.map((r) => r.n)).toEqual([4, 5, 6, 7, 8, 9, 10]);
        expect(joined.snippet[0]).toEqual({ n: 4, t: 'line4;', hi: false });
        expect(joined.snippet[1]).toEqual({ n: 5, t: 'line5;', hi: true });
        expect(gapped.snippet).toEqual([
            { n: 4, t: 'line4;', hi: false }, { n: 5, t: 'line5;', hi: true }, { n: 6, t: 'line6;', hi: false },
            { gap: true },
            { n: 10, t: 'line10;', hi: false }, { n: 11, t: 'line11;', hi: true }, { n: 12, t: 'line12;', hi: false },
        ]);
        // 3 rows + gap per cluster: the cap lands on the 3rd gap row (row 12),
        // and a snippet never ends on a gap, so 11 rows remain.
        expect(capped.snippet.length).toBe(11);
        expect(capped.snippet[capped.snippet.length - 1]).toEqual({ n: 18, t: 'line18;', hi: false });
        expect(capped.snippet.filter((r) => r.gap).length).toBe(2);
        expect(gapped.area).toBeNull();
    });

    it('anchors an @file step to the whole file, ignoring parent', () => {
        const warn = vi.fn();
        const out = compileTours(doc([
            st('@file', ['function outer', 'const b = 3;'], { parent: 'nope' }),
            st('@file', ['return a + b;']),
            st('outer', ['return inner;']),
        ]), symbols, sources, areas, warn);
        expect(warn).not.toHaveBeenCalled();
        const t = out.tours[0];
        const hiLines = (s) => s.snippet.filter((r) => r.hi).map((r) => r.n);
        // Matches cross definition boundaries (outer at 1, other's inner at 11).
        expect(hiLines(t.steps[0])).toEqual([1, 11]);
        expect(t.steps.map((s) => s.line)).toEqual([1, 12, 6]);
        expect(t.steps.map((s) => s.parent)).toEqual([null, null, null]);
        expect(t.steps.map((s) => s.area)).toEqual(['core', 'core', 'core']);
        expect(t.steps[0].symbol).toBe('@file');
    });

    it('rejects an @file first match that is not unique in the file', () => {
        const warn = vi.fn();
        compileTours(doc([
            st('@file', ['function inner']),
            st('outer', ['return inner;']),
            st('other', ['const a']),
        ]), symbols, sources, areas, warn);
        expect(warn.mock.calls[0][0]).toMatch(/step 1 \(app\.js › @file\): first match "function inner" is not unique in app\.js — step dropped/);
    });

    it('labels next with the file name when the following step is @file', () => {
        const nested = [src('lib/app.js', app)];
        const nestedSyms = buildSymbols(nested);
        const s = (symbol, match) => ({ file: 'lib/app.js', symbol, match, title: 'T', why: 'W' });
        const out = compileTours(doc([
            s('outer', ['return inner;']),
            s('@file', ['const b = 3;']),
            s('@file', ['const a = 1;']),
            s('other', ['const a = 2;']),
        ]), nestedSyms, nested, undefined, vi.fn());
        expect(out.tours[0].steps.map((x) => x.next)).toEqual(['app.js', 'app.js', 'other', null]);
    });

    it('trims each cluster by its own common indent and keeps relative nesting', () => {
        const out = compileTours(doc([
            st('outer', ['function inner', 'return inner;']),
            st('outer', ['return inner;']),
            st('other', ['return a + b;']),
        ]), symbols, sources, areas, vi.fn());
        const first = out.tours[0].steps[0].snippet;
        // Lines 1–7 joined; `function outer` has no indent so nothing is cut.
        expect(first.find((r) => r.n === 3).t).toBe('        const a = 1;');
        const last = out.tours[0].steps[2].snippet;
        // Lines 11–13: the closing `}` sits at 4 spaces, so only 4 are cut.
        expect(last.map((r) => r.t)).toEqual(['    const b = 3;', '    return a + b;', '}']);
    });
});

describe('gen-src-manifest writeWebTours', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    let root;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'gst-'));
        fs.mkdirSync(path.join(root, 'src'));
        fs.mkdirSync(path.join(root, 'out'));
        fs.writeFileSync(path.join(root, 'src', 'a.js'), 'function a() {\n    one();\n    two();\n    three();\n}\n');
    });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('writes nothing when codetour.json is absent', () => {
        const opts = { srcDir: path.join(root, 'src'), outDir: path.join(root, 'out'), warn: vi.fn() };
        expect(buildWebTours(opts)).toBeNull();
        expect(writeWebTours(opts)).toBeNull();
        expect(fs.existsSync(path.join(root, 'out', 'src-tours.json'))).toBe(false);
    });

    it('writes a deterministic src-tours.json when codetour.json exists', () => {
        const step = (m) => ({ file: 'a.js', symbol: 'a', match: [m], title: 'T', why: 'W' });
        fs.writeFileSync(path.join(root, 'codetour.json'), JSON.stringify({ version: 1, sections: [], tours: [{ id: 'x', section: 's', title: 'X', recap: [], steps: [step('one'), step('two'), step('three')] }] }));
        const opts = { srcDir: path.join(root, 'src'), outDir: path.join(root, 'out'), warn: vi.fn() };
        writeWebTours(opts);
        const first = fs.readFileSync(path.join(root, 'out', 'src-tours.json'), 'utf8');
        writeWebTours(opts);
        expect(fs.readFileSync(path.join(root, 'out', 'src-tours.json'), 'utf8')).toBe(first);
        const parsed = JSON.parse(first);
        expect(parsed.tours[0].steps.map((s) => s.line)).toEqual([2, 3, 4]);
        expect(first).not.toMatch(/generatedAt|sha/);
        expect(opts.warn).not.toHaveBeenCalled();
    });
});

// Keeps the real tours fresh and short: a change that breaks an anchor must
// update codetour.json in the same PR.
describe('gen-src-manifest real codetour.json', () => {
    const path = require('path');
    const warn = vi.fn();
    const doc = require('../codetour.json');
    const tours = buildWebTours({ srcDir: path.resolve(__dirname, '..', 'src'), warn });

    it('resolves every tour and step with zero warnings', () => {
        expect(warn.mock.calls.map((c) => c[0])).toEqual([]);
        expect(tours.tours.length).toBe(doc.tours.length);
        tours.tours.forEach((t, i) => expect(t.steps.length).toBe(doc.tours[i].steps.length));
    });

    it('keeps titles ≤ 60 chars, whys ≤ 140 and 3–10 steps per tour', () => {
        doc.tours.forEach((t) => {
            expect(t.title.length).toBeLessThanOrEqual(60);
            expect(t.steps.length).toBeGreaterThanOrEqual(3);
            expect(t.steps.length).toBeLessThanOrEqual(10);
            t.steps.forEach((s) => {
                expect(s.title.length).toBeLessThanOrEqual(60);
                expect(s.why.length).toBeLessThanOrEqual(140);
            });
        });
    });

    it('compiles the six Foundations tours first, in order', () => {
        expect(tours.tours.slice(0, 6).map((t) => t.id)).toEqual(['app-starts', 'database-connects', 'first-sign-in', 'data-saved', 'devices-sync', 'app-updates']);
        expect(tours.tours.slice(0, 6).every((t) => t.section === 'foundations')).toBe(true);
        tours.tours.slice(0, 6).forEach((t) => {
            expect(t.recap.length).toBeGreaterThanOrEqual(3);
            expect(t.recap.length).toBeLessThanOrEqual(5);
        });
    });

    it('compiles the Tasks & projects tours in order, each with a 3–5 card recap', () => {
        const tasks = tours.tours.filter((t) => t.section === 'tasks');
        expect(tasks.map((t) => t.id)).toEqual(['add-task', 'edit-task', 'task-status', 'due-date', 'delete-task', 'reorder', 'create-project', 'filter-sort', 'mobile-add']);
        tasks.forEach((t) => {
            expect(t.recap.length).toBeGreaterThanOrEqual(3);
            expect(t.recap.length).toBeLessThanOrEqual(5);
        });
    });

    // The data-saved tour says dataChanged has no listeners. Adding one makes
    // that false, so this fails until the tour text is revisited.
    it('keeps the data-saved tour honest about dataChanged listeners', () => {
        const fs = require('fs');
        const srcDir = path.resolve(__dirname, '..', 'src');
        const hasListener = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js')).some((f) =>
            /addEventListener\(\s*['"`]dataChanged['"`]/.test(fs.readFileSync(path.join(srcDir, f), 'utf8')));
        const saved = doc.tours.find((t) => t.id === 'data-saved');
        expect(/no listener/i.test(saved.steps[2].why)).toBe(!hasListener);
        expect(saved.recap.some((r) => /refresh/i.test(r.body))).toBe(false);
    });

    it('lists the six sections in order and every tour in a known section', () => {
        expect(doc.sections.map((s) => s.id)).toEqual(['foundations', 'tasks', 'pipeline', 'chat', 'structure', 'more']);
        const ids = new Set(doc.sections.map((s) => s.id));
        doc.tours.forEach((t) => expect(ids.has(t.section)).toBe(true));
    });
});
