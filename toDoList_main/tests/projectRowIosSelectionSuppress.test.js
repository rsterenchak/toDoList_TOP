import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the iOS long-press selection suppression on project rows. Without
// these rules, long-pressing a project row in the mobile drawer fires
// BOTH the app's custom 500ms long-press context menu AND the iOS native
// text-selection gesture (blue selection handles + the Edit / Copy /
// Look Up callout bar). The two render on top of each other.
//
// Fix is purely CSS:
//   - #projChild gets user-select: none, -webkit-user-select: none,
//     -webkit-touch-callout: none. Suppresses selection + callout on
//     the whole row's tappable area.
//   - #projInput re-enables user-select: auto / -webkit-user-select:
//     auto so the rename flow's focused input can still place a caret
//     and select text. pointer-events on the input is toggled by JS,
//     so this only takes effect in edit mode.
describe('Project row iOS long-press selection suppression', () => {
    const css = read('style.css');

    function extractRule(selector) {
        // Match a top-level (non-media-query) rule for the exact selector.
        // We scan forward from the first match of `<selector> {` and
        // grab everything up to the matching `}`.
        const escaped = selector.replace(/[#.\[\]]/g, m => '\\' + m);
        const re = new RegExp('(^|\\n)\\s*' + escaped + '\\s*\\{([^}]*)\\}');
        const match = css.match(re);
        expect(match, 'expected a rule for ' + selector).not.toBeNull();
        return match[2];
    }

    it('#projChild suppresses iOS selection and the long-press callout bar', () => {
        const rule = extractRule('#projChild');
        expect(rule).toMatch(/user-select:\s*none/);
        expect(rule).toMatch(/-webkit-user-select:\s*none/);
        expect(rule).toMatch(/-webkit-touch-callout:\s*none/);
    });

    it('#projInput re-enables user-select so the rename flow works once focused', () => {
        // The parent #projChild's user-select: none would otherwise be
        // inherited by the input, blocking the user from placing a caret
        // or selecting text mid-rename. The override lives in CSS so it
        // takes effect automatically when the JS unlocks pointer-events
        // — no JS toggle of user-select required.
        const rule = extractRule('#projInput');
        expect(rule).toMatch(/(^|\s|;)user-select:\s*auto/);
        expect(rule).toMatch(/-webkit-user-select:\s*auto/);
    });
});
