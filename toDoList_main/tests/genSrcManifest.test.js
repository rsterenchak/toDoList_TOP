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
