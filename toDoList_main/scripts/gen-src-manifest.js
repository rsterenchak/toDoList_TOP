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

const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '..', 'src');
const distDir = path.resolve(__dirname, '..', 'dist');

const files = fs
  .readdirSync(srcDir)
  .filter((f) => /\.(?:jsx?|tsx?|css)$/.test(f))
  .sort();

fs.mkdirSync(distDir, { recursive: true });

const manifest = {
  generatedAt: new Date().toISOString(),
  sha: process.env.GITHUB_SHA || '',
  files,
};

fs.writeFileSync(
  path.join(distDir, 'src-manifest.json'),
  JSON.stringify(manifest, null, 2)
);

console.log('src-manifest.json written:', files.length, 'files');
