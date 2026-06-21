import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Locks in the fix for the inject-settings "Connected" status pill overflowing
// the modal. When the Worker connection tests OK, the pill text grows to
// something like "Connected (target: <nickname>) · last tested 5 minutes ago".
// The pill lived in the connection section header as a non-shrinking flex item
// (`flex: 0 0 auto`) with `white-space` unset, so the long text forced the
// header — and the whole modal — wider than the viewport, pushing content out
// of view. The fix caps the pill width and truncates with an ellipsis, and
// lets the status row shrink so the title stays put while the pill clips.
describe('inject settings status pill stays within the modal', () => {
    const css = read('style.css');

    function extractTopLevelRule(selector) {
        let depth = 0;
        for (let i = 0; i < css.length; i++) {
            const c = css[i];
            if (c === '{') { depth++; continue; }
            if (c === '}') { depth--; continue; }
            if (depth !== 0) continue;
            if (!css.startsWith(selector, i)) continue;
            const after = css[i + selector.length] || '';
            if (after !== '{' && after !== ',' && !/\s/.test(after)) continue;
            let j = i - 1;
            while (j >= 0 && /\s/.test(css[j])) j--;
            const prev = j < 0 ? '' : css[j];
            if (prev !== '' && prev !== '}' && prev !== ',' && prev !== '/') continue;
            const blockStart = css.indexOf('{', i);
            const blockEnd = css.indexOf('}', blockStart);
            return css.slice(blockStart + 1, blockEnd);
        }
        throw new Error(`Top-level rule for "${selector}" not found`);
    }

    const pillRule = extractTopLevelRule('.injectStatusPill');
    const statusRowRule = extractTopLevelRule('.injectSettingsSection #injectSettingsStatusRow');

    it('caps the pill width to its container', () => {
        expect(pillRule).toMatch(/max-width:\s*100%\s*;/);
    });

    it('truncates long pill text with an ellipsis instead of wrapping or growing', () => {
        expect(pillRule).toMatch(/white-space:\s*nowrap\s*;/);
        expect(pillRule).toMatch(/overflow:\s*hidden\s*;/);
        expect(pillRule).toMatch(/text-overflow:\s*ellipsis\s*;/);
    });

    it('lets the status row shrink so the pill can clip rather than push the header wide', () => {
        // flex-shrink must be non-zero (the old `flex: 0 0 auto` could not shrink).
        const match = statusRowRule.match(/flex:\s*\d+(?:\.\d+)?\s+([\d.]+)\s+\S+\s*;/);
        expect(match).not.toBeNull();
        expect(parseFloat(match[1])).toBeGreaterThan(0);
        // min-width:0 is required for a flex item to shrink below its content size.
        expect(statusRowRule).toMatch(/min-width:\s*0\s*;/);
    });
});
