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
