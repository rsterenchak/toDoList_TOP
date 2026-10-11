// The code map's area graph — pure data, no DOM. Feeds the Structure tab's Map
// lens from the manifest's `modules` (per-JS-file lines + local imports) and its
// `areas` (the committed codemap.json: named groups of files with a purpose and
// a normalized position). Each area becomes a node sized by its line count; each
// pair of areas whose files import one another becomes an edge weighted by the
// number of those imports, counted in both directions.

// Index of src-relative file path → owning area id. A file claimed by more than
// one area belongs to the first that lists it, so it is never counted twice.
function areaIndex(areas) {
    const owner = new Map();
    areas.forEach(function (a) {
        (Array.isArray(a.files) ? a.files : []).forEach(function (f) {
            if (typeof f === 'string' && !owner.has(f)) owner.set(f, a.id);
        });
    });
    return owner;
}

// { areas: [{ id, name, purpose, pos, fileCount, lines }], edges: [{ a, b,
// weight }], totals: { areas, files, lines } }. Files in no area are ignored;
// imports between two files of the same area draw no edge; an edge with weight
// 0 is dropped. Edge endpoints are ordered by the areas' order in `areas`, so
// the A→B and B→A imports land on the same edge.
export function deriveAreaGraph(modules, areas) {
    const areaList = (Array.isArray(areas) ? areas : []).filter(function (a) {
        return a && typeof a.id === 'string';
    });
    const mods = (Array.isArray(modules) ? modules : []).filter(function (m) {
        return m && typeof m.path === 'string';
    });
    const owner = areaIndex(areaList);
    const order = new Map();
    const stats = new Map();
    areaList.forEach(function (a, i) {
        order.set(a.id, i);
        stats.set(a.id, { fileCount: 0, lines: 0 });
    });

    const weights = new Map();
    mods.forEach(function (m) {
        const from = owner.get(m.path);
        if (!from) return;
        const s = stats.get(from);
        s.fileCount += 1;
        s.lines += Number(m.lines) || 0;
        (Array.isArray(m.imports) ? m.imports : []).forEach(function (imp) {
            const to = owner.get(imp);
            if (!to || to === from) return;
            const pair = order.get(from) < order.get(to) ? [from, to] : [to, from];
            const key = pair[0] + '\u0000' + pair[1];
            const prior = weights.get(key);
            if (prior) prior.weight += 1;
            else weights.set(key, { a: pair[0], b: pair[1], weight: 1 });
        });
    });

    const nodes = areaList.map(function (a) {
        const s = stats.get(a.id);
        return {
            id: a.id,
            name: typeof a.name === 'string' && a.name ? a.name : a.id,
            purpose: typeof a.purpose === 'string' ? a.purpose : '',
            pos: Array.isArray(a.pos) && a.pos.length >= 2
                ? [Number(a.pos[0]) || 0, Number(a.pos[1]) || 0]
                : [0.5, 0.5],
            fileCount: s.fileCount,
            lines: s.lines,
        };
    });
    const edges = Array.from(weights.values()).filter(function (e) { return e.weight > 0; });
    return {
        areas: nodes,
        edges: edges,
        totals: {
            areas: nodes.length,
            files: nodes.reduce(function (n, a) { return n + a.fileCount; }, 0),
            lines: nodes.reduce(function (n, a) { return n + a.lines; }, 0),
        },
    };
}

// The edges touching area `id`, heaviest first (ties keep their graph order).
export function linksFor(graph, id) {
    const edges = graph && Array.isArray(graph.edges) ? graph.edges : [];
    return edges
        .filter(function (e) { return e.a === id || e.b === id; })
        .map(function (e, i) { return { e: e, i: i }; })
        .sort(function (x, y) { return (y.e.weight - x.e.weight) || (x.i - y.i); })
        .map(function (x) { return x.e; });
}

// A compact line count for labels: `775`, `17.3k`.
export function formatLines(n) {
    const v = Number(n) || 0;
    if (v < 1000) return String(v);
    return (v / 1000).toFixed(1) + 'k';
}

// Level 2's file list for one area: a row per file in `area.files` as { path,
// lines, purpose, usedBy, uses }. `usedBy` counts the modules repo-wide (not
// just this area's) whose imports include the file; `uses` is its own import
// count. `sort` 'used' orders by usedBy then lines, 'size' by lines — both
// descending, ties by path. A file with no module entry is skipped.
export function areaFiles(modules, area, sort) {
    const mods = (Array.isArray(modules) ? modules : []).filter(function (m) {
        return m && typeof m.path === 'string';
    });
    const byPath = new Map();
    mods.forEach(function (m) { if (!byPath.has(m.path)) byPath.set(m.path, m); });
    const usedBy = new Map();
    mods.forEach(function (m) {
        const imports = Array.isArray(m.imports) ? m.imports : [];
        new Set(imports).forEach(function (imp) {
            usedBy.set(imp, (usedBy.get(imp) || 0) + 1);
        });
    });
    const files = area && Array.isArray(area.files) ? area.files : [];
    const rows = [];
    const seen = new Set();
    files.forEach(function (f) {
        const m = byPath.get(f);
        if (!m || seen.has(f)) return;
        seen.add(f);
        rows.push({
            path: f,
            lines: Number(m.lines) || 0,
            purpose: typeof m.purpose === 'string' && m.purpose ? m.purpose : null,
            usedBy: usedBy.get(f) || 0,
            uses: Array.isArray(m.imports) ? m.imports.length : 0,
        });
    });
    return rows.sort(function (x, y) {
        const primary = sort === 'size'
            ? y.lines - x.lines
            : (y.usedBy - x.usedBy) || (y.lines - x.lines);
        return primary || (x.path < y.path ? -1 : x.path > y.path ? 1 : 0);
    });
}
