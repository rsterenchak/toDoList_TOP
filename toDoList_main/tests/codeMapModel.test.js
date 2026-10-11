import { deriveAreaGraph, linksFor, formatLines } from '../src/codeMapModel.js';

// The Map lens's area graph: areas sized by their files' lines, edges weighted
// by the imports between two areas' files, counted in both directions.
const AREAS = [
    { id: 'pipe', name: 'Pipeline', purpose: 'Ships entries.', pos: [0.7, 0.5], files: ['inject.js', 'runState.js'] },
    { id: 'tasks', name: 'Tasks', purpose: 'The list.', pos: [0.2, 0.5], files: ['listLogic.js', 'toDo.js'] },
    { id: 'shell', name: 'Shell', purpose: 'The frame.', pos: [0.5, 0.2], files: ['main.js'] },
    { id: 'ghost', name: 'Ghost', purpose: 'Boo.', pos: [0.9, 0.4], files: ['companion.js'] },
];

const MODULES = [
    { path: 'inject.js', lines: 100, imports: ['listLogic.js', 'runState.js'] },
    { path: 'runState.js', lines: 50, imports: [] },
    { path: 'listLogic.js', lines: 300, imports: ['inject.js', 'unassigned.js'] },
    { path: 'toDo.js', lines: 200, imports: ['listLogic.js', 'runState.js', 'inject.js'] },
    { path: 'main.js', lines: 1000, imports: ['toDo.js', 'inject.js'] },
    { path: 'companion.js', lines: 10, imports: [] },
    { path: 'unassigned.js', lines: 999, imports: ['main.js'] },
];

describe('deriveAreaGraph', () => {
    const graph = deriveAreaGraph(MODULES, AREAS);
    const edge = (a, b) => graph.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));

    it('sums edge weights across both import directions', () => {
        // pipe→tasks: inject→listLogic (1); tasks→pipe: listLogic→inject, toDo→runState, toDo→inject (3).
        expect(edge('pipe', 'tasks').weight).toBe(4);
        expect(graph.edges.filter((e) => edge('pipe', 'tasks') === e)).toHaveLength(1);
    });

    it('excludes imports between files of the same area', () => {
        // inject→runState and toDo→listLogic stay inside their areas.
        expect(graph.edges.some((e) => e.a === e.b)).toBe(false);
    });

    it('ignores files in no area, on both ends of an import', () => {
        // unassigned.js imports main.js and is imported by listLogic.js — neither counts.
        expect(edge('shell', 'tasks').weight).toBe(1);
        expect(graph.totals.lines).toBe(1660);
    });

    it('drops zero-weight edges, so an unlinked area has none', () => {
        expect(graph.edges.some((e) => e.a === 'ghost' || e.b === 'ghost')).toBe(false);
        expect(graph.edges.every((e) => e.weight > 0)).toBe(true);
        expect(graph.edges).toHaveLength(3);
    });

    it('reports per-area files and lines plus repo totals', () => {
        const pipe = graph.areas.find((a) => a.id === 'pipe');
        expect(pipe).toMatchObject({ name: 'Pipeline', purpose: 'Ships entries.', pos: [0.7, 0.5], fileCount: 2, lines: 150 });
        expect(graph.totals).toEqual({ areas: 4, files: 6, lines: 1660 });
    });

    it('tolerates missing modules or areas', () => {
        expect(deriveAreaGraph(undefined, AREAS).totals).toEqual({ areas: 4, files: 0, lines: 0 });
        expect(deriveAreaGraph(MODULES, undefined)).toEqual({ areas: [], edges: [], totals: { areas: 0, files: 0, lines: 0 } });
    });
});

describe('linksFor', () => {
    const graph = deriveAreaGraph(MODULES, AREAS);

    it("returns an area's edges heaviest first", () => {
        const links = linksFor(graph, 'pipe');
        expect(links.map((e) => e.weight)).toEqual([4, 1]);
        expect(links[0]).toMatchObject({ a: 'pipe', b: 'tasks' });
    });

    it('returns an empty list for an unlinked or unknown area', () => {
        expect(linksFor(graph, 'ghost')).toEqual([]);
        expect(linksFor(graph, 'nope')).toEqual([]);
    });
});

describe('formatLines', () => {
    it('shows thousands with one decimal and small counts as-is', () => {
        expect(formatLines(17338)).toBe('17.3k');
        expect(formatLines(775)).toBe('775');
    });
});
