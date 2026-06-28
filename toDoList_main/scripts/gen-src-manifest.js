// Build helper — writes the current source inventory to dist/src-manifest.json
// so the in-app Claude assistant's Worker can fetch an always-current file list
// instead of relying on a hand-maintained list baked into the Worker prompt.
//
// Run by deploy.yml AFTER the webpack build (webpack's `clean: true` wipes dist/,
// so this must run after) and BEFORE the Pages publish. The published JSON is
// served at https://<pages-host>/src-manifest.json and read by the Worker with
// a short TTL cache.
//
// Pure Node, no dependencies. Lists JS / JSX / TS / TSX / CSS files under src/,
// sorted, with a generated-at timestamp and the commit SHA (from GITHUB_SHA
// when present). The widened extension list lets the same script work for
// vanilla-JS projects (toDoList_TOP) and React/Vite projects (matchingGame-test).
//
// It also emits a build-time UI index, used by the Structure tab's UI lens:
//   • `regions` — every id / data-region handle found in the source, mapped to
//     the file(s) and line(s) that define it (`{ selector, label, file, line,
//     files }`), JS definition preferred as the primary owner. This powers
//     "Find in code" (selector → owner file) and the published UI map shown for
//     repos that aren't the running app.
//   • `hasDom` — whether the repo has any UI surface at all (any regions found),
//     so a DOM-less repo can render a distinct "no UI surface" state.
//   • `srcRoot` — the repo-root-relative path of the scanned source folder, so
//     the consumer can build GitHub blob deep links for files and regions.
// These keys are ADDITIVE — `files` keeps its exact prior shape so the Code lens
// and the chat attach picker keep working unchanged.

const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '..', 'src');
const distDir = path.resolve(__dirname, '..', 'dist');
const repoRoot = path.resolve(__dirname, '..', '..');

// Files listed in `files` (the existing, unchanged inventory).
const FILE_RE = /\.(?:jsx?|tsx?|css)$/;
// Files scanned for region definitions — source plus the HTML template.
const SCAN_RE = /\.(?:jsx?|tsx?|css|html)$/;

function isJsName(name) {
  return /\.(?:jsx?|tsx?)$/.test(name);
}

// Turn an id/data-region token into a human label — mirror structureView's
// prettify so live and published labels read identically.
function prettify(token) {
  return String(token || '')
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

// Scan a list of `{ name, isJs, text }` sources for id / data-region handles and
// group them into the `regions` array. Pure (no fs / no module state) so it can
// be unit-tested directly. Matching is regex-based and deliberately approximate
// — the index is a navigation aid, not a parser.
function scanRegions(sources) {
  const list = Array.isArray(sources) ? sources : [];
  const occ = []; // { selector, label, file, line, isJs }
  const definedIds = new Set();
  const definedRegions = new Set();

  function pushOcc(selector, label, file, line, isJs) {
    occ.push({ selector: selector, label: label, file: file, line: line, isJs: !!isJs });
  }

  // Pass 1 — JS / HTML: id and data-region DEFINITIONS.
  list.forEach(function (s) {
    if (/\.css$/i.test(s.name)) return;
    const text = String(s.text || '');
    text.split(/\r?\n/).forEach(function (line, i) {
      const ln = i + 1;
      let m;
      // `id = 'x'`, `id: 'x'`, `el.id = "x"`, `id="x"` — but not `data-id=` etc.
      const idAssign = /(?<![\w-])id\s*[:=]\s*['"]([A-Za-z][\w-]*)['"]/g;
      while ((m = idAssign.exec(line))) {
        definedIds.add(m[1]);
        pushOcc('#' + m[1], prettify(m[1]), s.name, ln, s.isJs);
      }
      // `setAttribute('id', 'x')` form.
      const idSet = /['"]id['"]\s*,\s*['"]([A-Za-z][\w-]*)['"]/g;
      while ((m = idSet.exec(line))) {
        definedIds.add(m[1]);
        pushOcc('#' + m[1], prettify(m[1]), s.name, ln, s.isJs);
      }
      // `data-region="x"`, `data-region: 'x'`.
      const drAttr = /data-region\s*[:=]\s*['"]([^'"]+)['"]/g;
      while ((m = drAttr.exec(line))) {
        definedRegions.add(m[1]);
        pushOcc('[data-region="' + m[1] + '"]', m[1], s.name, ln, s.isJs);
      }
      // `setAttribute('data-region', 'x')` form.
      const drSet = /data-region['"]\s*,\s*['"]([^'"]+)['"]/g;
      while ((m = drSet.exec(line))) {
        definedRegions.add(m[1]);
        pushOcc('[data-region="' + m[1] + '"]', m[1], s.name, ln, s.isJs);
      }
    });
  });

  // Pass 2 — CSS: record `#id` / `[data-region="x"]` USAGES, but only for
  // handles already defined in JS/HTML. This keeps hex colors (`#fff`) and
  // unrelated attribute selectors out of the index.
  list.forEach(function (s) {
    if (!/\.css$/i.test(s.name)) return;
    const text = String(s.text || '');
    text.split(/\r?\n/).forEach(function (line, i) {
      const ln = i + 1;
      let m;
      const idUse = /#([A-Za-z][\w-]*)/g;
      while ((m = idUse.exec(line))) {
        if (!definedIds.has(m[1])) continue;
        pushOcc('#' + m[1], prettify(m[1]), s.name, ln, false);
      }
      const drUse = /\[data-region[~^$*|]?=['"]?([^\]'"]+)['"]?\]/g;
      while ((m = drUse.exec(line))) {
        if (!definedRegions.has(m[1])) continue;
        pushOcc('[data-region="' + m[1] + '"]', m[1], s.name, ln, false);
      }
    });
  });

  // Dedupe to the earliest occurrence per (selector, file).
  const byKey = new Map();
  occ.forEach(function (o) {
    const key = o.selector + '\n' + o.file;
    const prev = byKey.get(key);
    if (!prev || o.line < prev.line) byKey.set(key, o);
  });

  // Group by selector; primary owner is the JS definition when one exists.
  const bySelector = new Map();
  Array.from(byKey.values()).forEach(function (o) {
    if (!bySelector.has(o.selector)) bySelector.set(o.selector, []);
    bySelector.get(o.selector).push(o);
  });

  const regions = [];
  bySelector.forEach(function (group, selector) {
    group.sort(function (a, b) {
      if (a.isJs !== b.isJs) return a.isJs ? -1 : 1;
      if (a.file !== b.file) return a.file < b.file ? -1 : 1;
      return a.line - b.line;
    });
    const primary = group[0];
    regions.push({
      selector: selector,
      label: primary.label,
      file: primary.file,
      line: primary.line,
      files: group.map(function (o) { return { file: o.file, line: o.line }; }),
    });
  });

  regions.sort(function (a, b) {
    return a.selector < b.selector ? -1 : (a.selector > b.selector ? 1 : 0);
  });
  return regions;
}

// Read src/ and assemble the full manifest object. Pure-ish (reads fs, no
// writes) so the writing step can stay behind the CLI guard below.
function buildManifest() {
  const files = fs
    .readdirSync(srcDir)
    .filter(function (f) { return FILE_RE.test(f); })
    .sort();

  const sources = fs
    .readdirSync(srcDir)
    .filter(function (f) { return SCAN_RE.test(f); })
    .map(function (f) {
      return { name: f, isJs: isJsName(f), text: fs.readFileSync(path.join(srcDir, f), 'utf8') };
    });

  const regions = scanRegions(sources);
  const srcRoot = path.relative(repoRoot, srcDir).split(path.sep).join('/');

  return {
    generatedAt: new Date().toISOString(),
    sha: process.env.GITHUB_SHA || '',
    files: files,
    srcRoot: srcRoot,
    regions: regions,
    hasDom: regions.length > 0,
  };
}

module.exports = { scanRegions: scanRegions, prettify: prettify, buildManifest: buildManifest };

if (require.main === module) {
  const manifest = buildManifest();
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(
    path.join(distDir, 'src-manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  console.log(
    'src-manifest.json written:',
    manifest.files.length, 'files,',
    manifest.regions.length, 'regions'
  );
}
