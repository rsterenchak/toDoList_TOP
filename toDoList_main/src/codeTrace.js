// CODE TRACE — resolves a tapped name in the code viewer to where it is defined.
//
// The deploy publishes `src-symbols.json` beside the manifest: every JS
// definition per file with its start/end lines and enclosing definition, plus
// each file's import bindings (see `buildSymbols` in scripts/gen-src-manifest.js).
// This module is the pure half of tap-to-trace over that index — loading it,
// deciding which tokens on a line are worth making tappable, and ranking the
// definitions a tapped name could mean. The peek sheet, the picker and the trail
// are DOM, and live in codeViewer.js beside the listing they decorate.
//
// Files in the index are keyed relative to the manifest's srcRoot (`main.js`),
// the same way the manifest names them; callers convert to and from the
// repo-relative paths the viewer reads with.

// No imports: codeViewer.js loads this module, and structureRemoteCapture.js
// (home of `pagesUrlFor`) imports structureView, which imports codeViewer — so
// borrowing that helper here would close an import cycle. The Pages URL
// convention is restated below instead.

// `owner/name` → `https://owner.github.io/name/`, or null for anything else.
function pagesUrlFor(repo) {
    const parts = typeof repo === 'string' ? repo.trim().split('/') : [];
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) return null;
    return 'https://' + parts[0].trim() + '.github.io/' + parts[1].trim() + '/';
}

// repo → Promise<symbols | null>, once per repo per session.
const symbolsCache = new Map();
// repo → the resolved index, so a render can decorate synchronously once loaded.
const loaded = new Map();

// Reserved words and literals — never tappable, even when a scan somewhere has
// picked one up as a name. Contextual words (`get`, `of`, `async`…) are left out
// on purpose: they are also ordinary method names. `from` and `as` are in, since
// an import line would otherwise underline them.
const JS_KEYWORDS = new Set([
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
    'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
    'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'return',
    'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined', 'var',
    'void', 'while', 'with', 'yield', 'await', 'from', 'as',
]);

function normalizeSymbols(data) {
    if (!data || typeof data !== 'object' || !data.files || typeof data.files !== 'object') return null;
    return data;
}

// The repo's definitions index, or null when it can't be had — in which case
// nothing in the viewer is tappable. Never rejects.
export function loadSymbols(repo) {
    if (symbolsCache.has(repo)) return symbolsCache.get(repo);
    const base = pagesUrlFor(repo);
    let p;
    if (!base || typeof fetch !== 'function') {
        p = Promise.resolve(null);
    } else {
        p = Promise.resolve()
            .then(function () { return fetch(base + 'src-symbols.json', { cache: 'no-cache' }); })
            .then(function (res) { return res && res.ok ? res.json() : null; })
            .then(normalizeSymbols)
            .catch(function () { return null; });
    }
    p = p.then(function (symbols) {
        loaded.set(repo, symbols);
        return symbols;
    });
    symbolsCache.set(repo, p);
    return p;
}

// The index if it has already loaded, else null (or undefined while in flight).
export function getLoadedSymbols(repo) {
    return loaded.get(repo);
}

// Drop the per-session cache. A test seam.
export function resetSymbolsCache() {
    symbolsCache.clear();
    loaded.clear();
}

// Every definition name in the repo, built once per index.
function defNames(symbols) {
    if (symbols._defNames) return symbols._defNames;
    const names = new Set();
    Object.keys(symbols.files).forEach(function (f) {
        const defs = symbols.files[f] && symbols.files[f].defs;
        if (Array.isArray(defs)) defs.forEach(function (d) { if (d && d.name) names.add(d.name); });
    });
    Object.defineProperty(symbols, '_defNames', { value: names, enumerable: false });
    return names;
}

// Whether `name` is worth a button in `file`: a definition somewhere in the repo,
// or a local import binding here, and never a keyword.
export function isTraceable(symbols, file, name) {
    if (!symbols || !name || JS_KEYWORDS.has(name)) return false;
    if (defNames(symbols).has(name)) return true;
    const entry = symbols.files[file];
    return !!(entry && entry.imports && Object.prototype.hasOwnProperty.call(entry.imports, name));
}

// Split one source line into segments: `{ text }` for plain runs and
// `{ text, name, qualifier }` for a tappable identifier. A best-effort lexer over
// a single line — quoted strings, template text and `//` / `/* */` comments are
// plain text, as is a line that reads as the inside of a block comment. The
// qualifier is the identifier before a `.`, so `listLogic.getProjectTargetId`
// carries `listLogic`.
export function tokenizeLine(text, isKnown) {
    const s = String(text == null ? '' : text);
    const out = [];
    let plain = '';
    function flush() { if (plain) { out.push({ text: plain }); plain = ''; } }
    if (/^\s*(?:\*|\/\*)/.test(s) && !/\*\/\s*\S/.test(s)) return [{ text: s }];
    let i = 0;
    let lastId = null;   // the identifier just passed, for a following `.name`
    let afterDot = null; // the qualifier when the previous significant char was `.`
    while (i < s.length) {
        const c = s[i];
        if (c === '/' && s[i + 1] === '/') { plain += s.slice(i); break; }
        if (c === '/' && s[i + 1] === '*') {
            const end = s.indexOf('*/', i + 2);
            const stop = end < 0 ? s.length : end + 2;
            plain += s.slice(i, stop); i = stop; lastId = null; afterDot = null; continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            let j = i + 1;
            while (j < s.length && s[j] !== c) { if (s[j] === '\\') j++; j++; }
            j = Math.min(s.length, j + 1);
            plain += s.slice(i, j); i = j; lastId = null; afterDot = null; continue;
        }
        if (/[A-Za-z_$]/.test(c) && !(i > 0 && /[\w$]/.test(s[i - 1]))) {
            let j = i + 1;
            while (j < s.length && /[\w$]/.test(s[j])) j++;
            const word = s.slice(i, j);
            const qualifier = afterDot;
            if (!JS_KEYWORDS.has(word) && isKnown(word)) {
                flush();
                out.push({ text: word, name: word, qualifier: qualifier || null });
            } else {
                plain += word;
            }
            lastId = word; afterDot = null; i = j; continue;
        }
        if (c === '.') {
            afterDot = (lastId && s[i - 1] !== '.' && s[i + 1] !== '.') ? lastId : null;
            lastId = null;
        } else if (!/\s/.test(c)) {
            lastId = null; afterDot = null;
        }
        plain += c; i++;
    }
    flush();
    return out;
}

// The definitions in `file` whose range holds `line`, innermost first.
function enclosingChain(defs, line) {
    return defs
        .filter(function (d) { return d.start <= line && line <= d.end && d.end > d.start; })
        .sort(function (a, b) { return (b.start - a.start) || (a.end - b.end); });
}

function isTopLevel(d) { return d.parent == null; }

// Rank the definitions `name` could mean when tapped on `line` of `file`.
// Returns `[{ file, def, rank, reason }]`, best first; a lower rank is better, and
// several candidates sharing the best rank is what calls for a picker. Tiers, each
// tried only when the one before found nothing:
//   1. qualified through an import (`listLogic.x`) — defs owned by the imported
//      export first (the IIFE-owner pattern), then the imported file's top level;
//   2. the same file, scoped — defs whose parent is on the tapped line's
//      enclosing-definition chain, deepest first, top level last;
//   3. a local import binding of that name;
//   4. any definition of that name anywhere in the repo.
export function resolveName(symbols, file, line, name, qualifier) {
    if (!symbols || !symbols.files || !name) return [];
    const files = symbols.files;
    const entry = files[file] || { defs: [], imports: {} };
    const defs = Array.isArray(entry.defs) ? entry.defs : [];
    const imports = entry.imports || {};
    const own = Object.prototype.hasOwnProperty;
    const ln = Number(line) || 0;

    if (qualifier && own.call(imports, qualifier)) {
        const imp = imports[qualifier];
        const target = files[imp.from];
        const tdefs = target && Array.isArray(target.defs) ? target.defs : [];
        const out = [];
        tdefs.forEach(function (d) {
            if (d.name !== name) return;
            if (imp.name !== '*' && imp.name !== 'default' && d.parent === imp.name) {
                out.push({ file: imp.from, def: d, rank: 0, reason: 'import' });
            } else if (isTopLevel(d)) {
                out.push({ file: imp.from, def: d, rank: 1, reason: 'import' });
            }
        });
        if (out.length) return sortCandidates(out);
    }

    const chain = enclosingChain(defs, ln);
    const scoped = [];
    defs.forEach(function (d) {
        if (d.name !== name) return;
        if (isTopLevel(d)) {
            scoped.push({ file: file, def: d, rank: chain.length, reason: 'same scope' });
            return;
        }
        for (let k = 0; k < chain.length; k++) {
            const sc = chain[k];
            if (d.parent === sc.name && d.start >= sc.start && d.end <= sc.end && d !== sc) {
                scoped.push({ file: file, def: d, rank: k, reason: 'same scope' });
                return;
            }
        }
    });
    if (scoped.length) return sortCandidates(scoped);

    if (own.call(imports, name)) {
        const imp = imports[name];
        const target = files[imp.from];
        const tdefs = target && Array.isArray(target.defs) ? target.defs : [];
        const want = imp.name === 'default' || imp.name === '*' ? name : imp.name;
        const out = tdefs.filter(function (d) { return d.name === want; }).map(function (d) {
            return { file: imp.from, def: d, rank: isTopLevel(d) ? 0 : 1, reason: 'import' };
        });
        if (out.length) return sortCandidates(out);
    }

    // Last resort: every definition of the name. Same-file ones sort first, but
    // they all share one rank — a name match alone decides nothing.
    const out = [];
    Object.keys(files).forEach(function (f) {
        const fdefs = files[f] && Array.isArray(files[f].defs) ? files[f].defs : [];
        fdefs.forEach(function (d) {
            if (d.name === name) out.push({ file: f, def: d, rank: 0, reason: f === file ? 'same file' : 'name match' });
        });
    });
    return out.sort(function (a, b) {
        const af = a.file === file ? 0 : 1, bf = b.file === file ? 0 : 1;
        if (af !== bf) return af - bf;
        if (a.file !== b.file) return a.file < b.file ? -1 : 1;
        return a.def.start - b.def.start;
    });
}

function sortCandidates(list) {
    return list.sort(function (a, b) { return (a.rank - b.rank) || (a.def.start - b.def.start); });
}

// How many candidates share the best rank — one means peek, more means pick.
export function topRanked(candidates) {
    if (!candidates || !candidates.length) return [];
    const best = candidates[0].rank;
    return candidates.filter(function (c) { return c.rank === best; });
}
