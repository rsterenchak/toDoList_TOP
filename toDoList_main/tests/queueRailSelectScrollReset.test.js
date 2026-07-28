import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// Clicking a committed row enters title-edit mode and parks the caret at the
// end of the title (setSelectionRange(end, end)). The browser then scrolls the
// input to reveal that caret, so at the 308px queue rail the start of a long
// title is hidden and the selected row — the one being worked on — shows only
// its tail. The fix resets toDoInput.scrollLeft to 0 after the programmatic
// caret placement so the title reads from its beginning while the caret stays
// at the end for typing. jsdom does not implement input scrolling, so this is a
// source-inspection assertion; behavior must be verified in a real browser.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(rel) { return readFileSync(resolve(srcDir, rel), 'utf8'); }

describe('queue rail: selecting a row does not scroll its title out of view', () => {
    const toDoRow = read('toDoRow.js');

    it('resets scrollLeft to 0 immediately after the programmatic caret-at-end selection', () => {
        // The reset must follow setSelectionRange(end, end) so the browser's
        // focus-time scroll-to-caret is undone rather than pre-empted.
        expect(toDoRow).toMatch(
            /setSelectionRange\(end,\s*end\);[\s\S]{0,1200}toDoInput\.scrollLeft\s*=\s*0/
        );
    });

    it('also defers a scrollLeft reset via requestAnimationFrame, not a timeout', () => {
        // Focus scrolling settles on the next frame, so a deferred reset backs
        // up the synchronous one. It must be requestAnimationFrame, not
        // setTimeout, per the entry.
        expect(toDoRow).toMatch(
            /requestAnimationFrame\(function\(\)\s*\{\s*toDoInput\.scrollLeft\s*=\s*0;\s*\}\)/
        );
        // Guard that the caret still lands at the end — moving it to 0 would
        // change where typing inserts, a worse regression.
        expect(toDoRow).toMatch(/setSelectionRange\(end,\s*end\)/);
    });
});
