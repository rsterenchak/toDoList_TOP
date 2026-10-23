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

    it('normalizes string recap items, drops invalid ones and keeps valid cards, warning per fix', () => {
        const warn = vi.fn();
        const d = doc([
            st('outer', ['return inner;']),
            st('other', ['const a']),
            st('inner', ['return a;'], { parent: 'outer' }),
        ]);
        d.tours[0].recap = ['Plain string', 42, { body: 'no title' }, { title: '', body: 'x' }, null, { title: 'Kept', body: 'Body' }];
        const out = compileTours(d, symbols, sources, areas, warn);
        expect(out.tours[0].recap).toEqual([{ title: 'Plain string', body: '' }, { title: 'Kept', body: 'Body' }]);
        const msgs = warn.mock.calls.map((c) => c[0]);
        expect(msgs).toHaveLength(5);
        expect(msgs[0]).toMatch(/tour "t1" recap item 1 is a string — normalized to \{ title, body: "" \}/);
        msgs.slice(1).forEach((m, i) => expect(m).toMatch(new RegExp('tour "t1" recap item ' + (i + 2) + ' .*— item dropped')));
    });

    it('passes a valid recap through unchanged without warnings', () => {
        const warn = vi.fn();
        const out = compileTours(doc([
            st('outer', ['return inner;']),
            st('other', ['const a']),
            st('inner', ['return a;'], { parent: 'outer' }),
        ]), symbols, sources, areas, warn);
        expect(warn).not.toHaveBeenCalled();
        expect(out.tours[0].recap).toEqual([{ title: 'R', body: 'B' }]);
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

    it('compiles every recap with zero recap warnings', () => {
        expect(warn.mock.calls.map((c) => c[0]).filter((m) => /recap/.test(m))).toEqual([]);
        tours.tours.forEach((t, i) => expect(t.recap.length).toBe((doc.tours[i].recap || []).length));
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

    it('compiles the Pipeline tours in order, each with a 3–5 card recap', () => {
        const pipeline = tours.tours.filter((t) => t.section === 'pipeline');
        expect(pipeline.map((t) => t.id)).toEqual(['inject-entry', 'ship-run', 'follow-run', 'agent-board', 'mockups', 'generate-tasks', 'coverage', 'todo-md-viewer']);
        pipeline.forEach((t) => {
            expect(t.recap.length).toBeGreaterThanOrEqual(3);
            expect(t.recap.length).toBeLessThanOrEqual(5);
        });
    });

    it('compiles the Chat, Structure and Settings tours in order, each with a 3–5 card recap', () => {
        const order = {
            chat: ['chat-send', 'chat-context', 'chat-model'],
            structure: ['structure-open', 'code-map', 'code-viewer', 'ui-lens'],
            more: ['app-lock', 'export-import', 'onboarding', 'focus', 'ghost'],
        };
        Object.keys(order).forEach((section) => {
            const list = tours.tours.filter((t) => t.section === section);
            expect(list.map((t) => t.id)).toEqual(order[section]);
            list.forEach((t) => {
                expect(t.recap.length).toBeGreaterThanOrEqual(3);
                expect(t.recap.length).toBeLessThanOrEqual(5);
            });
        });
    });

    it('completes the 35-tour catalog with no empty section', () => {
        expect(tours.tours.length).toBe(35);
        doc.sections.forEach((s) => expect(tours.tours.some((t) => t.section === s.id)).toBe(true));
    });

    // Tours only see src/, so a step that talks about the Worker or a workflow
    // must sit on the call that leaves the app.
    it('anchors every Worker or workflow step on the call that leaves the app', () => {
        const exits = ['postToWorker', 'chatWithWorker', 'dispatchRun', 'dispatchTriage', 'readTodoMdFromWorker', 'readAssignmentFromWorker', 'generateMockupsFromWorker'];
        const pipeline = doc.tours.filter((t) => t.section === 'pipeline');
        pipeline.forEach((t) => t.steps.forEach((s) => {
            if (/worker|workflow|github actions|claude-run/i.test(s.why)) expect(exits).toContain(s.symbol);
        }));
    });

    it('lists the six sections in order and every tour in a known section', () => {
        expect(doc.sections.map((s) => s.id)).toEqual(['foundations', 'tasks', 'pipeline', 'chat', 'structure', 'more']);
        const ids = new Set(doc.sections.map((s) => s.id));
        doc.tours.forEach((t) => expect(ids.has(t.section)).toBe(true));
    });
});

const { compileBook, buildWebBook, writeWebBook } = gen;

describe('gen-src-manifest compileBook', () => {
    const sources = [
        src('a.js', 'function shared() {\n    return 1;\n}\nfunction onlyA() {\n    return 2;\n}\n'),
        src('b.js', 'function shared() {\n    return 3;\n}\nfunction outer() {\n    function inner() {}\n    return inner;\n}\n'),
        src('c.js', 'function shared() {\n    return 4;\n}\n'),
    ];
    const symbols = buildSymbols(sources);
    const tours = { tours: [{ id: 't1', title: 'Tour one', steps: [{}, {}, {}] }] };
    const areas = [{ id: 'core', files: ['a.js', 'b.js', 'c.js'] }];
    const chapter = (extra) => Object.assign({ id: 'c1', title: 'One', area: 'core', files: ['a.js'], tours: ['t1'], body: ['Plain.'] }, extra);
    const book = (chapters) => ({ version: 1, title: 'Book', chapters });
    const refs = (ch) => ch.paragraphs.flat().filter((s) => s.ref).map((s) => s.ref);

    it('compiles chapters with index, resolved tours, minutes and no warnings', () => {
        const warn = vi.fn();
        const out = compileBook(book([chapter(), chapter({ id: 'c2', title: 'Two', tours: [] })]), symbols, tours, areas, warn);
        expect(warn).not.toHaveBeenCalled();
        expect(out.version).toBe(1);
        expect(out.title).toBe('Book');
        expect(out.chapters.map((c) => c.index)).toEqual([1, 2]);
        expect(out.chapters[0]).toMatchObject({ id: 'c1', area: 'core', files: ['a.js'], tours: [{ id: 't1', title: 'Tour one', steps: 3 }], ahead: null, minutes: 1, stale: false, warnings: [] });
        expect(out.chapters[0].paragraphs).toEqual([[{ t: 'Plain.' }]]);
    });

    it('resolves names in the chapter files first, then the whole index, and keeps unknown spans as text', () => {
        const warn = vi.fn();
        const out = compileBook(book([chapter({ body: ['Call `shared` then `inner` and `nothingHere` in `b.js`.'] })]), symbols, tours, areas, warn);
        expect(warn).not.toHaveBeenCalled();
        const p = out.chapters[0].paragraphs[0];
        expect(p).toEqual([
            { t: 'Call ' },
            { ref: { label: 'shared', file: 'a.js', symbol: 'shared', parent: null, line: 1, end: 3 } },
            { t: ' then ' },
            { ref: { label: 'inner', file: 'b.js', symbol: 'inner', parent: 'outer', line: 5, end: 5 } },
            { t: ' and `nothingHere` in ' },
            { ref: { label: 'b.js', file: 'b.js', symbol: null, parent: null, line: 1, end: null } },
            { t: '.' },
        ]);
    });

    it('pins a file with `file.js:name` and a parent with `Parent.name`', () => {
        const warn = vi.fn();
        const out = compileBook(book([chapter({ body: ['`c.js:shared` and `outer.inner`.'] })]), symbols, tours, areas, warn);
        expect(warn).not.toHaveBeenCalled();
        expect(refs(out.chapters[0]).map((r) => [r.label, r.file, r.line])).toEqual([['c.js:shared', 'c.js', 1], ['outer.inner', 'b.js', 5]]);
    });

    it('flags an ambiguous name and a missing pinned file as stale and keeps them as text', () => {
        const warn = vi.fn();
        const out = compileBook(book([chapter({ files: [], body: ['`shared` and `gone.js:shared` and `gone.js`.'] })]), symbols, tours, areas, warn);
        const ch = out.chapters[0];
        expect(refs(ch)).toEqual([]);
        expect(ch.paragraphs[0]).toEqual([{ t: '`shared` and `gone.js:shared` and `gone.js`.' }]);
        expect(ch.stale).toBe(true);
        expect(ch.warnings).toHaveLength(3);
        expect(ch.warnings[0]).toMatch(/ambiguous \(3 defs\)/);
        expect(ch.warnings[1]).toMatch(/pinned file "gone\.js"/);
        expect(warn).toHaveBeenCalledTimes(3);
    });

    it('flags a missing file, tour or area and drops them', () => {
        const warn = vi.fn();
        const out = compileBook(book([chapter({ files: ['a.js', 'nope.js'], tours: ['t1', 'nope'], area: 'nope' })]), symbols, tours, areas, warn);
        const ch = out.chapters[0];
        expect(ch.files).toEqual(['a.js']);
        expect(ch.tours.map((t) => t.id)).toEqual(['t1']);
        expect(ch.area).toBeNull();
        expect(ch.stale).toBe(true);
        expect(ch.warnings).toHaveLength(3);
    });

    it('resolves ahead to the target title and drops an unknown one with a warning', () => {
        const warn = vi.fn();
        const out = compileBook(book([
            chapter({ ahead: { chapter: 'c2', note: 'Later.' } }),
            chapter({ id: 'c2', title: 'Two', ahead: { chapter: 'missing', note: 'x' } }),
        ]), symbols, tours, areas, warn);
        expect(out.chapters[0].ahead).toEqual({ chapter: 'c2', title: 'Two', note: 'Later.' });
        expect(out.chapters[0].stale).toBe(false);
        expect(out.chapters[1].ahead).toBeNull();
        expect(out.chapters[1].stale).toBe(true);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('drops a chapter with no paragraphs, and any ahead link to it', () => {
        const warn = vi.fn();
        const out = compileBook(book([
            chapter({ ahead: { chapter: 'empty', note: 'x' } }),
            chapter({ id: 'empty', body: [] }),
        ]), symbols, tours, areas, warn);
        expect(out.chapters.map((c) => c.id)).toEqual(['c1']);
        expect(out.chapters[0].ahead).toBeNull();
        expect(out.chapters[0].stale).toBe(true);
        expect(warn).toHaveBeenCalledTimes(2);
    });

    it('counts minutes at 200 words a minute, minimum 1', () => {
        const words = (n) => Array(n).fill('word').join(' ');
        const out = compileBook(book([chapter({ body: [words(300), words(300)] })]), symbols, tours, areas, vi.fn());
        expect(out.chapters[0].minutes).toBe(3);
    });

    it('is deterministic: same input, byte-identical output', () => {
        const doc = book([chapter({ body: ['`shared` and `outer.inner`.'], ahead: { chapter: 'c1', note: 'x' } })]);
        const a = JSON.stringify(compileBook(doc, symbols, tours, areas, vi.fn()));
        const b = JSON.stringify(compileBook(doc, symbols, tours, areas, vi.fn()));
        expect(a).toBe(b);
        expect(a).not.toMatch(/"generatedAt"|"sha"/);
    });
});

// The map chapter: the code map's areas, each area's front-door files by
// fan-in and each file's most-used names, compiled from `kind: "map"` + `roles`
// into `sections` beside flat chip · text paragraphs.
const { rankMapSymbols } = gen;

describe('gen-src-manifest rankMapSymbols and the map chapter', () => {
    const imp = (names, from) => 'import { ' + names.join(', ') + " } from './" + from + "';\n";
    const sources = [
        src('listLogic.js', '// The data model.\nexport const listLogic = (function () { return {}; })();\nexport function nextDueDate() {}\nexport function _hiddenHelperFn() {}\n'),
        src('undoToast.js', '// The undo toast.\n' + imp(['listLogic'], 'listLogic.js') + 'export function showUndoToast() {}\nexport function hideUndoToast() {}\n'),
        src('toDoRow.js', '// Task rows.\n' + imp(['listLogic', 'nextDueDate', '_hiddenHelperFn'], 'listLogic.js') + imp(['showUndoToast', 'hideUndoToast'], 'undoToast.js')
            + 'export function addAllToDo_DOM() {}\nfunction localHelperName() {}\n'),
        src('main.js', imp(['listLogic', 'nextDueDate'], 'listLogic.js') + imp(['addAllToDo_DOM'], 'toDoRow.js') + '// localHelperName\n'),
    ];
    const symbols = buildSymbols(sources);
    const AREAS = [
        { id: 'tasks', name: 'Tasks', purpose: 'The core list.', files: ['undoToast.js', 'listLogic.js', 'toDoRow.js'] },
        { id: 'shell', name: 'Shell', purpose: 'The app frame.', files: ['main.js'] },
        { id: 'empty', name: 'Empty', purpose: 'Nothing indexed.', files: ['gone.js'] },
    ];
    const CHAPTERS = [{ id: 'map', kind: 'map' }, { id: 'boot', area: 'shell' }, { id: 'list', area: 'tasks' }];
    const tree = (sections) => sections.map((s) => [s.area.id, s.files.map((f) => [f.file, f.symbols.map((r) => r.key)])]);
    const mapDoc = (roles, extra) => ({ version: 1, title: 'B', chapters: [
        Object.assign({ id: 'map', kind: 'map', title: 'Names', area: null, files: [], tours: [], roles }, extra),
        { id: 'boot', title: 'Boot', area: 'shell', files: ['main.js'], tours: [], body: ['See `listLogic`.'] },
        { id: 'list', title: 'List', area: 'tasks', files: ['toDoRow.js'], tours: [], body: ['See `addAllToDo_DOM`.'] },
    ] });
    const ROLES = {
        listLogic: 'The data model.',
        nextDueDate: 'The next due date.',
        addAllToDo_DOM: 'Renders every row.',
        showUndoToast: 'Shows the toast.',
        hideUndoToast: 'Hides the toast.',
    };

    it('orders areas by chapter reference then codemap order, dropping areas with no indexed file', () => {
        const sections = rankMapSymbols(symbols, sources, { areas: AREAS, chapters: CHAPTERS });
        expect(sections.map((s) => s.area)).toEqual([
            { id: 'shell', name: 'Shell', purpose: 'The app frame.' },
            { id: 'tasks', name: 'Tasks', purpose: 'The core list.' },
        ]);
        const codemapOrder = rankMapSymbols(symbols, sources, { areas: AREAS, chapters: [] });
        expect(codemapOrder.map((s) => s.area.id)).toEqual(['tasks', 'shell']);
    });

    it('picks front-door files by fan-in, then fan-out, with the module purpose', () => {
        const tasks = rankMapSymbols(symbols, sources, { areas: AREAS, chapters: CHAPTERS })[1];
        expect(tasks.files.map((f) => [f.file, f.fanIn, f.fanOut, f.purpose])).toEqual([
            ['listLogic.js', 3, 0, 'The data model.'],
            ['toDoRow.js', 1, 2, 'Task rows.'],
            ['undoToast.js', 1, 1, 'The undo toast.'],
        ]);
        const two = rankMapSymbols(symbols, sources, { areas: AREAS, chapters: CHAPTERS, filesPerArea: 1 })[1];
        expect(two.files.map((f) => f.file)).toEqual(['listLogic.js']);
    });

    it('ranks imported top-level names by whole-word use, excluding _ names and respecting symbolsPerFile', () => {
        const sections = rankMapSymbols(symbols, sources, { areas: AREAS, chapters: CHAPTERS });
        expect(tree(sections)).toEqual([
            ['shell', [['main.js', []]]],
            ['tasks', [
                ['listLogic.js', ['listLogic', 'nextDueDate']],
                ['toDoRow.js', ['addAllToDo_DOM']],
                ['undoToast.js', ['hideUndoToast', 'showUndoToast']],
            ]],
        ]);
        const top = sections[1].files[0].symbols[0];
        expect(top).toMatchObject({ key: 'listLogic', name: 'listLogic', parent: null, file: 'listLogic.js', refs: 3 });
        expect(top.def).toMatchObject({ start: 2, end: 2 });
        const one = rankMapSymbols(symbols, sources, { areas: AREAS, chapters: CHAPTERS, symbolsPerFile: 1 });
        expect(one[1].files[0].symbols.map((r) => r.key)).toEqual(['listLogic']);
    });

    it('breaks equal-reference ties by longer name, then name, and keys a name ranked in two files by file', () => {
        const tie = [src('x.js', 'export function zeta() {}\nexport function alpha() {}\nexport function longerName() {}\n'), src('y.js', imp(['zeta', 'alpha', 'longerName'], 'x.js'))];
        const sections = rankMapSymbols(buildSymbols(tie), tie, { areas: [{ id: 'a', name: 'A', files: ['x.js'] }] });
        expect(tree(sections)).toEqual([['a', [['x.js', ['longerName', 'alpha', 'zeta']]]]]);
        const dup = [src('p.js', 'export function go() {}\n'), src('q.js', 'export function go() {}\n'), src('r.js', imp(['go as goP'], 'p.js') + imp(['go as goQ'], 'q.js'))];
        const both = rankMapSymbols(buildSymbols(dup), dup, { areas: [{ id: 'a', name: 'A', files: ['p.js', 'q.js'] }] });
        expect(tree(both)).toEqual([['a', [['p.js', ['p.js:go']], ['q.js', ['q.js:go']]]]]);
    });

    it('groups by top-level folder below the common directory when there is no codemap', () => {
        const nested = [
            src('src/core/store.js', '// The store.\nexport function saveEverything() {}\n'),
            src('src/ui/view.js', imp(['saveEverything'], '../core/store.js') + 'export function paintView() {}\n'),
            src('src/ui/deep/panel.js', imp(['paintView'], '../view.js')),
        ];
        const sections = rankMapSymbols(buildSymbols(nested), nested);
        expect(sections.map((s) => s.area)).toEqual([
            { id: 'src/core', name: 'src/core', purpose: null },
            { id: 'src/ui', name: 'src/ui', purpose: null },
        ]);
        expect(tree(sections)[1]).toEqual(['src/ui', [['src/ui/view.js', ['paintView']], ['src/ui/deep/panel.js', []]]]);
    });

    it('ranks csharp files by whole-word use of their primary type, with the comment above it as purpose', () => {
        const cs = [
            { name: 'Services/TaskStore.cs', text: 'namespace Demo {\n    /// <summary>\n    /// Stores tasks on disk.\n    /// </summary>\n    [Serializable]\n    public class TaskStore {\n        public void Save() {\n        }\n    }\n}\n' },
            { name: 'Views/MainForm.cs', text: '// The main window.\npublic class MainForm {\n    void Go() { var s = new TaskStore(); s.Save(); }\n}\n' },
            { name: 'Views/Other.cs', text: 'public class Other {\n    TaskStore store; // MainForm only\n}\n' },
        ];
        const sections = rankMapSymbols(buildCsharpSymbols({ sources: cs }), cs);
        expect(sections.map((s) => s.files.map((f) => [f.file, f.fanIn, f.fanOut, f.purpose]))).toEqual([
            [['Services/TaskStore.cs', 2, 0, 'Stores tasks on disk.']],
            [['Views/MainForm.cs', 1, 1, 'The main window.'], ['Views/Other.cs', 0, 2, null]],
        ]);
        expect(tree(sections)).toEqual([
            ['Services', [['Services/TaskStore.cs', ['TaskStore']]]],
            ['Views', [['Views/MainForm.cs', ['MainForm']], ['Views/Other.cs', []]]],
        ]);
    });

    it('compiles a map chapter into sections plus flat file and symbol paragraphs', () => {
        const warn = vi.fn();
        const out = compileBook(mapDoc(ROLES), symbols, null, AREAS, warn, sources);
        expect(warn).not.toHaveBeenCalled();
        const [map, prose] = out.chapters;
        expect(map).toMatchObject({ id: 'map', index: 1, kind: 'map', stale: false, minutes: 1, warnings: [] });
        expect(prose.kind).toBe('prose');
        expect(prose.sections).toBeUndefined();
        const fileRef = (f) => ({ label: f, file: f, symbol: null, parent: null, line: 1, end: null });
        const listLogicRef = { label: 'listLogic', file: 'listLogic.js', symbol: 'listLogic', parent: null, line: 2, end: 2 };
        expect(map.sections[0]).toEqual({ area: { id: 'shell', name: 'Shell', purpose: 'The app frame.' }, files: [{ ref: fileRef('main.js'), purpose: null, symbols: [] }] });
        expect(map.sections[1].files[0]).toEqual({
            ref: fileRef('listLogic.js'),
            purpose: 'The data model.',
            symbols: [
                { ref: listLogicRef, role: 'The data model.' },
                { ref: { label: 'nextDueDate', file: 'listLogic.js', symbol: 'nextDueDate', parent: null, line: 3, end: 3 }, role: 'The next due date.' },
            ],
        });
        expect(map.paragraphs.slice(0, 3)).toEqual([
            [{ ref: fileRef('main.js') }],
            [{ ref: fileRef('listLogic.js') }, { t: ' — The data model.' }],
            [{ ref: listLogicRef }, { t: ' — The data model.' }],
        ]);
        expect(map.paragraphs).toHaveLength(9);
    });

    it('gives a file with no purpose line its role keyed by path', () => {
        const map = compileBook(mapDoc(Object.assign({ 'main.js': 'Boots the app.' }, ROLES)), symbols, null, AREAS, vi.fn(), sources).chapters[0];
        expect(map.sections[0].files[0].purpose).toBe('Boots the app.');
        expect(map.paragraphs[0][1]).toEqual({ t: ' — Boots the app.' });
        expect(map.stale).toBe(false);
    });

    it('warns and goes stale for a missing role, a role outside the ranked set, or a map that is not first', () => {
        const warn = vi.fn();
        const roles = Object.assign({}, ROLES, { localHelperName: 'Never ranked.' });
        delete roles.nextDueDate;
        const map = compileBook(mapDoc(roles), symbols, null, AREAS, warn, sources).chapters[0];
        expect(map.stale).toBe(true);
        expect(map.warnings).toEqual(['map symbol "nextDueDate" has no role', 'map role "localHelperName" is not in the ranked set — dropped']);
        expect(map.sections[1].files[0].symbols.map((s) => s.ref.symbol)).toEqual(['listLogic']);
        expect(map.paragraphs).toHaveLength(8);
        expect(warn.mock.calls.every((c) => /^Warning: codebook\.json: chapter "map": /.test(c[0]))).toBe(true);

        const doc = mapDoc(ROLES);
        doc.chapters.reverse();
        const late = compileBook(doc, symbols, null, AREAS, vi.fn(), sources).chapters[2];
        expect(late.warnings).toEqual(['the map chapter must be the first chapter']);
    });

    it('applies filesPerArea and symbolsPerFile, and accepts but ignores a legacy limit with a warning', () => {
        const map = compileBook(mapDoc({ listLogic: 'The data model.' }, { filesPerArea: 1, symbolsPerFile: 1 }), symbols, null, AREAS, vi.fn(), sources).chapters[0];
        expect(map.stale).toBe(false);
        expect(map.sections.map((s) => s.files.map((f) => f.ref.file))).toEqual([['main.js'], ['listLogic.js']]);
        const warn = vi.fn();
        const legacy = compileBook(mapDoc(ROLES, { limit: 1 }), symbols, null, AREAS, warn, sources).chapters[0];
        expect(warn.mock.calls.map((c) => c[0])).toEqual(['Warning: codebook.json: chapter "map": `limit` is ignored — use filesPerArea and symbolsPerFile']);
        expect(legacy.stale).toBe(false);
        expect(legacy.paragraphs).toHaveLength(9);
    });
});

describe('gen-src-manifest writeWebBook', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    let root;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsb-'));
        fs.mkdirSync(path.join(root, 'src'));
        fs.mkdirSync(path.join(root, 'out'));
        fs.writeFileSync(path.join(root, 'src', 'a.js'), 'function a() {\n    one();\n    two();\n    three();\n}\n');
    });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('writes nothing when codebook.json is absent', () => {
        const opts = { srcDir: path.join(root, 'src'), outDir: path.join(root, 'out'), warn: vi.fn() };
        expect(buildWebBook(opts)).toBeNull();
        expect(writeWebBook(opts)).toBeNull();
        expect(fs.existsSync(path.join(root, 'out', 'src-book.json'))).toBe(false);
    });

    it('writes a deterministic src-book.json with tours from the same run', () => {
        const step = (m) => ({ file: 'a.js', symbol: 'a', match: [m], title: 'T', why: 'W' });
        fs.writeFileSync(path.join(root, 'codetour.json'), JSON.stringify({ version: 1, sections: [], tours: [{ id: 'x', section: 's', title: 'X', recap: [], steps: [step('one'), step('two'), step('three')] }] }));
        fs.writeFileSync(path.join(root, 'codebook.json'), JSON.stringify({ version: 1, title: 'B', chapters: [{ id: 'c', title: 'C', area: null, files: ['a.js'], tours: ['x'], body: ['See `a`.'] }] }));
        const opts = { srcDir: path.join(root, 'src'), outDir: path.join(root, 'out'), warn: vi.fn() };
        writeWebBook(opts);
        const first = fs.readFileSync(path.join(root, 'out', 'src-book.json'), 'utf8');
        writeWebBook(opts);
        expect(fs.readFileSync(path.join(root, 'out', 'src-book.json'), 'utf8')).toBe(first);
        const parsed = JSON.parse(first);
        expect(parsed.chapters[0].tours).toEqual([{ id: 'x', title: 'X', steps: 3 }]);
        expect(parsed.chapters[0].paragraphs[0][1].ref).toMatchObject({ file: 'a.js', symbol: 'a', line: 1, end: 5 });
        expect(opts.warn).not.toHaveBeenCalled();
    });
});

// Keeps the real book fresh: a change that breaks a reference must update
// codebook.json in the same PR.
describe('gen-src-manifest real codebook.json', () => {
    const path = require('path');
    const warn = vi.fn();
    const doc = require('../codebook.json');
    const tourDoc = require('../codetour.json');
    const book = buildWebBook({ srcDir: path.resolve(__dirname, '..', 'src'), warn });

    it('compiles every chapter with zero warnings', () => {
        expect(warn.mock.calls.map((c) => c[0])).toEqual([]);
        expect(book.chapters.length).toBe(doc.chapters.length);
        book.chapters.forEach((c) => {
            expect(c.stale).toBe(false);
            expect(c.paragraphs.flat().some((s) => s.ref)).toBe(true);
        });
    });

    const prose = doc.chapters.filter((c) => c.kind !== 'map');

    it('opens with a hierarchical map chapter whose roles cover exactly the ranked symbols', () => {
        expect(doc.chapters[0].kind).toBe('map');
        expect(doc.chapters[0].limit).toBeUndefined();
        const map = book.chapters[0];
        expect(map.kind).toBe('map');
        const areas = require('../codemap.json').areas;
        expect(map.sections.map((s) => s.area.id).sort()).toEqual(areas.map((a) => a.id).sort());
        // The first area is the one the first prose chapter covers.
        expect(map.sections[0].area.id).toBe(doc.chapters.find((c) => c.kind !== 'map' && c.area).area);
        map.sections.forEach((s) => {
            expect(s.files.length).toBeGreaterThan(0);
            expect(s.files.length).toBeLessThanOrEqual(3);
            s.files.forEach((f) => expect(f.symbols.length).toBeLessThanOrEqual(3));
        });
        const tasks = map.sections.find((s) => s.area.id === 'tasks');
        expect(tasks.files[0].ref.file).toBe('listLogic.js');
        const roled = map.sections.flatMap((s) => s.files.flatMap((f) => f.symbols.map((sym) => sym.ref.label)));
        expect(Object.keys(doc.chapters[0].roles).sort()).toEqual(roled.slice().sort());
    });

    it('has 8–10 prose chapters, titles ≤ 60 chars and 3–8 paragraphs each', () => {
        expect(prose.length).toBeGreaterThanOrEqual(8);
        expect(prose.length).toBeLessThanOrEqual(10);
        doc.chapters.forEach((c) => expect(c.title.length).toBeLessThanOrEqual(60));
        prose.forEach((c) => {
            expect(c.title.length).toBeLessThanOrEqual(60);
            expect(c.body.length).toBeGreaterThanOrEqual(3);
            expect(c.body.length).toBeLessThanOrEqual(8);
        });
    });

    it('names files and tours that exist, and areas from codemap.json', () => {
        const symbols = buildWebSymbols({ srcDir: path.resolve(__dirname, '..', 'src') });
        const tourIds = new Set(tourDoc.tours.map((t) => t.id));
        const areaIds = new Set(require('../codemap.json').areas.map((a) => a.id));
        doc.chapters.forEach((c) => {
            c.files.forEach((f) => expect(symbols.files).toHaveProperty([f]));
            c.tours.forEach((t) => expect(tourIds.has(t)).toBe(true));
            if (c.area !== null) expect(areaIds.has(c.area)).toBe(true);
        });
    });

    it('follows the six tour sections top-down and covers every tour once', () => {
        const order = tourDoc.sections.map((s) => s.id);
        const sectionOf = {};
        tourDoc.tours.forEach((t) => { sectionOf[t.id] = order.indexOf(t.section); });
        const seq = doc.chapters.flatMap((c) => c.tours.map((t) => sectionOf[t]));
        expect(seq).toEqual([...seq].sort((a, b) => a - b));
        expect(prose[0].files.slice(0, 2)).toEqual(['index.js', 'main.js']);
        expect(doc.chapters.flatMap((c) => c.tours).sort()).toEqual(tourDoc.tours.map((t) => t.id).sort());
    });
});

// csharp mode builds the same symbols index from the type outline, keyed by
// repo-root-relative .cs path, so tours and the book resolve against C# too.
const { buildCsharpSymbols, readCsharpSources } = gen;
const CS_STORE = [
    'using System;',                                        // 1
    'namespace Demo.Services {',                            // 2
    '    public class TaskStore {',                         // 3
    '        public TaskStore(string path) {',              // 4
    '            _path = path;',                            // 5
    '        }',                                            // 6
    '        public enum Mode { Fast, Safe }',              // 7
    '        public void Save(Task t) {',                   // 8
    '            Validate(t);',                             // 9
    '            Write(t);',                                // 10
    '            Flush();',                                 // 11
    '        }',                                            // 12
    '        public int Count { get; set; }',               // 13
    '        private string Load(int id) {',                // 14
    '            return id.ToString();',                    // 15
    '        }',                                            // 16
    '    }',                                                // 17
    '    public interface IStore {',                        // 18
    '        Task Find(int id);',                           // 19
    '    }',                                                // 20
    '}',                                                    // 21
].join('\n');
const CS_TASK = 'namespace Demo.Models {\n    public class Task {\n        public string Title { get; set; }\n    }\n}\n';

describe('gen-src-manifest buildCsharpSymbols', () => {
    const symbols = buildCsharpSymbols({ sources: [{ name: 'Services/TaskStore.cs', text: CS_STORE }, { name: 'Models/Task.cs', text: CS_TASK }] });

    it('emits the web index shape keyed by repo-root-relative path', () => {
        expect(symbols.version).toBe(1);
        expect(Object.keys(symbols.files)).toEqual(['Models/Task.cs', 'Services/TaskStore.cs']);
        expect(symbols.files['Services/TaskStore.cs'].imports).toEqual({});
    });

    it('emits one def per type and member with parent, start and end', () => {
        expect(symbols.files['Services/TaskStore.cs'].defs).toEqual([
            { name: 'TaskStore', kind: 'class', start: 3, end: 17, parent: null },
            { name: 'constructor', kind: 'constructor', start: 4, end: 6, parent: 'TaskStore' },
            { name: 'Mode', kind: 'enum', start: 7, end: 7, parent: 'TaskStore' },
            { name: 'Save', kind: 'method', start: 8, end: 12, parent: 'TaskStore' },
            { name: 'Count', kind: 'property', start: 13, end: 13, parent: 'TaskStore' },
            { name: 'Load', kind: 'method', start: 14, end: 16, parent: 'TaskStore' },
            { name: 'IStore', kind: 'interface', start: 18, end: 20, parent: null },
            { name: 'Find', kind: 'method', start: 19, end: 19, parent: 'IStore' },
        ]);
        expect(symbols.files['Models/Task.cs'].defs).toEqual([
            { name: 'Task', kind: 'class', start: 2, end: 4, parent: null },
            { name: 'Title', kind: 'property', start: 3, end: 3, parent: 'Task' },
        ]);
    });

    it('resolves a codetour.json step anchored to Class.Method into a snippet', () => {
        const sources = [{ name: 'Services/TaskStore.cs', text: CS_STORE }];
        const step = (m) => ({ file: 'Services/TaskStore.cs', symbol: 'Save', parent: 'TaskStore', match: [m], title: 'T', why: 'W' });
        const doc = { version: 1, sections: [], tours: [{ id: 'save', section: 's', title: 'Save', recap: [], steps: [step('Validate'), step('Write'), step('Flush')] }] };
        const warn = vi.fn();
        const tours = compileTours(doc, buildCsharpSymbols({ sources }), sources, null, warn);
        expect(warn).not.toHaveBeenCalled();
        expect(tours.tours[0].steps.map((s) => s.line)).toEqual([9, 10, 11]);
        expect(tours.tours[0].steps[0].snippet.find((r) => r.hi)).toMatchObject({ n: 9, t: '    Validate(t);' });
    });

    it('resolves .cs file, Type.Member and pinned references in a codebook.json chapter', () => {
        const warn = vi.fn();
        const doc = { version: 1, title: 'B', chapters: [{ id: 'c', title: 'C', files: ['Services/TaskStore.cs', 'Models/Task.cs'],
            body: ['`Models/Task.cs` is saved by `TaskStore.Save` in `Services/TaskStore.cs:Save`.'] }] };
        const ch = compileBook(doc, symbols, null, null, warn).chapters[0];
        expect(warn).not.toHaveBeenCalled();
        expect(ch.stale).toBe(false);
        expect(ch.paragraphs[0].filter((s) => s.ref).map((s) => s.ref)).toEqual([
            { label: 'Models/Task.cs', file: 'Models/Task.cs', symbol: null, parent: null, line: 1, end: null },
            { label: 'TaskStore.Save', file: 'Services/TaskStore.cs', symbol: 'Save', parent: 'TaskStore', line: 8, end: 12 },
            { label: 'Services/TaskStore.cs:Save', file: 'Services/TaskStore.cs', symbol: 'Save', parent: 'TaskStore', line: 8, end: 12 },
        ]);
    });

    it('marks a chapter stale for a .cs file reference not in the index', () => {
        const warn = vi.fn();
        const doc = { version: 1, title: 'B', chapters: [{ id: 'c', title: 'C', files: [], body: ['See `Views/MainForm.xaml.cs`.'] }] };
        const ch = compileBook(doc, symbols, null, null, warn).chapters[0];
        expect(ch.stale).toBe(true);
        expect(ch.warnings[0]).toMatch(/Views\/MainForm\.xaml\.cs/);
        expect(ch.paragraphs[0]).toEqual([{ t: 'See `Views/MainForm.xaml.cs`.' }]);
    });
});

describe('gen-src-manifest csharp mode output', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { execFileSync } = require('child_process');
    let root;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'gcs-'));
        fs.mkdirSync(path.join(root, 'scripts'));
        fs.copyFileSync(path.resolve(__dirname, '..', 'scripts', 'gen-src-manifest.js'), path.join(root, 'scripts', 'gen-src-manifest.js'));
        fs.mkdirSync(path.join(root, 'Services'));
        fs.mkdirSync(path.join(root, 'Models'));
        fs.mkdirSync(path.join(root, 'db'));
        fs.writeFileSync(path.join(root, 'Services', 'TaskStore.cs'), CS_STORE);
        fs.writeFileSync(path.join(root, 'Models', 'Task.cs'), CS_TASK);
        fs.writeFileSync(path.join(root, 'db', 'schema.sql'), 'CREATE TABLE tasks (\n    id int PRIMARY KEY\n);\n');
        const step = (m) => ({ file: 'Services/TaskStore.cs', symbol: 'Save', parent: 'TaskStore', match: [m], title: 'T', why: 'W' });
        fs.writeFileSync(path.join(root, 'codetour.json'), JSON.stringify({ version: 1, sections: [], tours: [{ id: 'save', section: 's', title: 'Save', recap: [], steps: [step('Validate'), step('Write'), step('Flush')] }] }));
        fs.writeFileSync(path.join(root, 'codebook.json'), JSON.stringify({ version: 1, title: 'B', chapters: [{ id: 'c', title: 'C', files: ['Services/TaskStore.cs'], tours: ['save'], body: ['See `TaskStore.Save`.'] }] }));
    });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    const run = (lang, out) => execFileSync(process.execPath, [path.join(root, 'scripts', 'gen-src-manifest.js')], {
        cwd: root, encoding: 'utf8', env: { ...process.env, MANIFEST_LANG: lang, MANIFEST_OUT_DIR: out, MANIFEST_DETERMINISTIC: 'true', MANIFEST_SRC_ROOT: '' },
    });

    it('writes symbols, tours and book in csharp mode with the same log lines', () => {
        const log = run('csharp', 'out');
        const out = path.join(root, 'out');
        expect(log).toMatch(/src-symbols\.json written to out\/ — \d+ defs,/);
        expect(log).toMatch(/src-tours\.json written to out\/ — 1 tours, 3 steps/);
        expect(log).toMatch(/src-book\.json written to out\/ — 1 chapters, 1 references, 0 stale/);
        const symbols = JSON.parse(fs.readFileSync(path.join(out, 'src-symbols.json'), 'utf8'));
        expect(Object.keys(symbols.files)).toEqual(['Models/Task.cs', 'Services/TaskStore.cs']);
        const book = JSON.parse(fs.readFileSync(path.join(out, 'src-book.json'), 'utf8'));
        expect(book.chapters[0].tours).toEqual([{ id: 'save', title: 'Save', steps: 3 }]);
        const first = fs.readFileSync(path.join(out, 'src-symbols.json'), 'utf8');
        run('csharp', 'out');
        expect(fs.readFileSync(path.join(out, 'src-symbols.json'), 'utf8')).toBe(first);
    });

    it('writes none of them in sql mode', () => {
        run('sql', 'out');
        const out = path.join(root, 'out');
        expect(fs.existsSync(path.join(out, 'src-manifest.json'))).toBe(true);
        ['src-symbols.json', 'src-tours.json', 'src-book.json'].forEach((f) => expect(fs.existsSync(path.join(out, f))).toBe(false));
    });

    it('prints the ranked map candidates to stderr behind --print-map-candidates or MANIFEST_PRINT_MAP=1', () => {
        const { spawnSync } = require('child_process');
        const env = { ...process.env, MANIFEST_LANG: 'csharp', MANIFEST_OUT_DIR: 'out', MANIFEST_DETERMINISTIC: 'true', MANIFEST_SRC_ROOT: '' };
        const script = path.join(root, 'scripts', 'gen-src-manifest.js');
        const viaFlag = spawnSync(process.execPath, [script, '--print-map-candidates'], { cwd: root, encoding: 'utf8', env });
        expect(viaFlag.stderr).toMatch(/Map candidates \(1 symbols in 2 areas\)/);
        expect(viaFlag.stderr).toMatch(/\nModels\n {2}Models\/Task\.cs {2}1 {2}0 {2}\(no purpose — role keyed by path\)\n {4}Task {2}1\nServices\n/);
        const viaEnv = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env: { ...env, MANIFEST_PRINT_MAP: '1' } });
        expect(viaEnv.stderr).toBe(viaFlag.stderr);
        expect(spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env }).stderr).not.toMatch(/Map candidates/);
    });

    it('reads the .cs set scoped by srcRoot, paths repo-root-relative', () => {
        expect(readCsharpSources({ repoRoot: root, srcRoot: 'Models' }).map((s) => s.name)).toEqual(['Models/Task.cs']);
    });
});

// Methods named like contextual keywords (add/get/...) index like any other,
// and an overloaded member of one type resolves to its first declaration.
describe('gen-src-manifest csharp contextual-keyword methods and overloads', () => {
    const CS_REPO = [
        'namespace Demo {',                                         // 1
        '    public class CustomerRepository {',                    // 2
        '        public void add(Item i) {',                        // 3
        '            _items.Add(i);',                               // 4
        '        }',                                                // 5
        '        public int get(int id) {',                         // 6
        '            return id;',                                   // 7
        '        }',                                                // 8
        '        public event EventHandler Changed {',              // 9
        '            add { _changed += value; }',                   // 10
        '            remove { _changed -= value; }',                // 11
        '        }',                                                // 12
        '        public int Count { get; private set; }',           // 13
        '    }',                                                    // 14
        '}',                                                        // 15
    ].join('\n');
    const CS_HISTORY = [
        'namespace Demo {',                                         // 1
        '    public class LoginHistory {',                          // 2
        '        public void Record(string user) {',                // 3
        '            Log(user);',                                   // 4
        '        }',                                                // 5
        '        public void Record(string user, DateTime at) {',   // 6
        '            Log(user + at);',                              // 7
        '        }',                                                // 8
        '    }',                                                    // 9
        '}',                                                        // 10
    ].join('\n');
    const CS_AUDIT = 'namespace Demo {\n    public class LoginHistory {\n        public void Record(int code) {\n            Log(code);\n        }\n    }\n}\n';
    const sources = [{ name: 'Data/CustomerRepository.cs', text: CS_REPO }, { name: 'Data/LoginHistory.cs', text: CS_HISTORY }];
    const symbols = buildCsharpSymbols({ sources });
    const book = (body, files) => ({ version: 1, title: 'B', chapters: [{ id: 'c', title: 'C', files: files || [], body: [body] }] });
    const refs = (ch) => ch.paragraphs.flat().filter((s) => s.ref).map((s) => s.ref);

    it('indexes methods named add and get but not event accessors', () => {
        expect(symbols.files['Data/CustomerRepository.cs'].defs).toEqual([
            { name: 'CustomerRepository', kind: 'class', start: 2, end: 14, parent: null },
            { name: 'add', kind: 'method', start: 3, end: 5, parent: 'CustomerRepository' },
            { name: 'get', kind: 'method', start: 6, end: 8, parent: 'CustomerRepository' },
            { name: 'Count', kind: 'property', start: 13, end: 13, parent: 'CustomerRepository' },
        ]);
    });

    it('links `CustomerRepository.add` in a chapter', () => {
        const warn = vi.fn();
        const ch = compileBook(book('See `CustomerRepository.add`.'), symbols, null, null, warn).chapters[0];
        expect(warn).not.toHaveBeenCalled();
        expect(refs(ch)).toEqual([{ label: 'CustomerRepository.add', file: 'Data/CustomerRepository.cs', symbol: 'add', parent: 'CustomerRepository', line: 3, end: 5 }]);
    });

    it('resolves an overloaded member of one type to the first declaration with no warning', () => {
        const warn = vi.fn();
        const ch = compileBook(book('`LoginHistory.Record`, `Record` and `Data/LoginHistory.cs:Record`.'), symbols, null, null, warn).chapters[0];
        expect(warn).not.toHaveBeenCalled();
        expect(ch.stale).toBe(false);
        expect(refs(ch).map((r) => [r.label, r.file, r.parent, r.line, r.end])).toEqual([
            ['LoginHistory.Record', 'Data/LoginHistory.cs', 'LoginHistory', 3, 5],
            ['Record', 'Data/LoginHistory.cs', 'LoginHistory', 3, 5],
            ['Data/LoginHistory.cs:Record', 'Data/LoginHistory.cs', 'LoginHistory', 3, 5],
        ]);
    });

    it('keeps the same name split across two files ambiguous', () => {
        const warn = vi.fn();
        const split = buildCsharpSymbols({ sources: sources.concat([{ name: 'Audit/LoginHistory.cs', text: CS_AUDIT }]) });
        const ch = compileBook(book('`LoginHistory.Record`.'), split, null, null, warn).chapters[0];
        expect(refs(ch)).toEqual([]);
        expect(ch.stale).toBe(true);
        expect(ch.warnings[0]).toMatch(/ambiguous \(3 defs\)/);
    });

    it('resolves a tour step on an overloaded member to the first declaration', () => {
        const warn = vi.fn();
        const st = (symbol, m) => ({ file: symbol === 'Record' ? 'Data/LoginHistory.cs' : 'Data/CustomerRepository.cs', symbol, match: [m], title: 'T', why: 'W' });
        const doc = { version: 1, sections: [], tours: [{ id: 'r', section: 's', title: 'R', recap: [],
            steps: [st('Record', 'Log(user)'), st('add', '_items.Add'), st('get', 'return id')] }] };
        const tours = compileTours(doc, symbols, sources, null, warn);
        expect(warn).not.toHaveBeenCalled();
        expect(tours.tours[0].steps.map((s) => s.line)).toEqual([4, 4, 7]);
    });

    it('leaves JS resolution unchanged: same name under different parents stays ambiguous', () => {
        const warn = vi.fn();
        const js = [src('app.js', 'function outer() {\n    function inner() {}\n}\nfunction other() {\n    function inner() {}\n}\n')];
        const ch = compileBook(book('`inner`.'), buildSymbols(js), null, null, warn).chapters[0];
        expect(refs(ch)).toEqual([]);
        expect(ch.warnings[0]).toMatch(/ambiguous \(2 defs\)/);
    });
});
