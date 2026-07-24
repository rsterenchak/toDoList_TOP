import { describe, it, expect } from 'vitest';
import { joinSrcRootPath } from '../src/srcPath.js';

// The shared joiner both structureView.js (blob links) and filePicker.js (File:
// paths) depend on. Manifest files are named relative to `srcRoot`; the joiner
// produces a repo-relative path without ever emitting a leading or double slash.
describe('joinSrcRootPath', () => {
    it('prefixes a non-empty srcRoot with a single slash', () => {
        expect(joinSrcRootPath('toDoList_main/src', 'toDoRow.js'))
            .toBe('toDoList_main/src/toDoRow.js');
    });

    it('leaves the name unchanged for an empty srcRoot (C# / repo-root-relative)', () => {
        expect(joinSrcRootPath('', 'LinearSearch/BST.cs')).toBe('LinearSearch/BST.cs');
    });

    it('treats undefined srcRoot the same as empty — no leading slash', () => {
        expect(joinSrcRootPath(undefined, 'app.js')).toBe('app.js');
    });

    it('strips trailing slashes so no double slash is produced', () => {
        expect(joinSrcRootPath('src//', 'main.js')).toBe('src/main.js');
    });

    it('coerces a missing file name to an empty string', () => {
        expect(joinSrcRootPath('src', undefined)).toBe('src/');
    });
});
