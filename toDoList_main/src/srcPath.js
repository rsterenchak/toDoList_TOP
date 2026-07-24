// Shared source-path joiner. The Structure manifest (`src-manifest.json`) names
// its files RELATIVE to the manifest's `srcRoot` key — `auth.js`, not
// `toDoList_main/src/auth.js` — so both the GitHub blob links built in
// structureView.js and the `File:`-line paths the picker writes must prefix
// that root to produce a real repo-relative path. One joiner, shared by both
// callers, so they can never drift.

// Join a manifest `srcRoot` to a manifest-relative `file` name, producing a
// repo-relative path. Trailing slashes on the root are stripped and the root is
// prefixed with a single `/` only when it is non-empty, so no leading or double
// slash is ever produced. `srcRoot` is `undefined` for older / non-object
// manifests and `''` for the C# / repo-root-relative shape; both mean "use the
// file name unchanged".
export function joinSrcRootPath(srcRoot, file) {
    const name = String(file || '');
    const root = String(srcRoot || '').replace(/\/+$/, '');
    return root ? root + '/' + name : name;
}
