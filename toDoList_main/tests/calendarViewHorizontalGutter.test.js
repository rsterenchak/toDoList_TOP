import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Strip /* ... */ comments so single-property regexes don't need to account
// for explanatory blocks between declarations.
function stripCssComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Walks the stylesheet top-level (depth-0) rules and returns the body of the
// first rule whose selector exactly matches `selector`. Same helper used in
// calendarViewColumnLayout.test.js — kept inline rather than shared because
// the harness has no test util module yet.
function extractTopLevelRule(css, selector) {
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

// Pulls the body of the @media (max-width: 1023px) block, then returns the
// nested rule body for the given selector within it. Returns null if the
// selector has no override inside that block.
function extractMobileRule(css, selector) {
    const start = css.search(/@media\s*\(\s*max-width:\s*1023px\s*\)\s*\{/);
    if (start < 0) throw new Error('@media (max-width: 1023px) block not found');
    const bodyStart = css.indexOf('{', start) + 1;
    let depth = 1;
    let i = bodyStart;
    for (; i < css.length && depth > 0; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') depth--;
    }
    const block = css.slice(bodyStart, i - 1);
    const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
    const m = block.match(re);
    return m ? m[1] : null;
}

// Parses a CSS `padding: ...` shorthand into a {top, right, bottom, left}
// object using the standard CSS expansion rules. Values keep their original
// unit string so tests can assert on raw declarations. Splitting tracks
// parenthesis depth so a calc()/max()/env() expression with internal
// whitespace is treated as a single value (e.g. the mobile #calendarView
// rule's `calc(max(env(safe-area-inset-top, 0px), 24px) + 24px) 12px 0`).
function parsePaddingShorthand(value) {
    const parts = [];
    let current = '';
    let depth = 0;
    for (const ch of value.trim()) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (depth === 0 && /\s/.test(ch)) {
            if (current.length) { parts.push(current); current = ''; }
        } else {
            current += ch;
        }
    }
    if (current.length) parts.push(current);
    if (parts.length === 1) {
        return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
    }
    if (parts.length === 2) {
        return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
    }
    if (parts.length === 3) {
        return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
    }
    return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
}

// Locks in the calendar-view horizontal-gutter fix: on wide viewports the
// calendar grid grew edge-to-edge with the content area, leaving day numbers
// stranded in oversized cells. Adding ~48px of horizontal padding to
// #calendarView constrains the grid (and the day-detail panel beneath it,
// since both are children of the same column-flex container) inside a gutter
// while the existing 1:1 aspect-ratio on cells keeps them square at the
// reduced inner width. The mobile breakpoint trims the gutter so narrow
// viewports still use most of the available width.
describe('#calendarView horizontal gutter', () => {
    const css = read('style.css');

    it('applies at least 40px of horizontal padding on the top-level #calendarView rule', () => {
        const rule = stripCssComments(extractTopLevelRule(css, '#calendarView'));
        const paddingMatch = rule.match(/(?:^|;)\s*padding\s*:\s*([^;]+);/);
        expect(paddingMatch).not.toBeNull();
        const { left, right } = parsePaddingShorthand(paddingMatch[1]);
        const leftPx = parseFloat(left);
        const rightPx = parseFloat(right);
        expect(Number.isFinite(leftPx)).toBe(true);
        expect(Number.isFinite(rightPx)).toBe(true);
        expect(left.endsWith('px')).toBe(true);
        expect(right.endsWith('px')).toBe(true);
        expect(leftPx).toBeGreaterThanOrEqual(40);
        expect(rightPx).toBeGreaterThanOrEqual(40);
    });

    it('uses a narrower horizontal gutter inside @media (max-width: 1023px) so mobile keeps near-full width', () => {
        const desktopRule = stripCssComments(extractTopLevelRule(css, '#calendarView'));
        const desktopMatch = desktopRule.match(/(?:^|;)\s*padding\s*:\s*([^;]+);/);
        const desktopH = parseFloat(parsePaddingShorthand(desktopMatch[1]).left);

        const mobileRule = extractMobileRule(stripCssComments(css), '#calendarView');
        expect(mobileRule).not.toBeNull();
        const mobileMatch = mobileRule.match(/(?:^|;)\s*padding\s*:\s*([^;]+);/);
        expect(mobileMatch).not.toBeNull();
        const mobileH = parseFloat(parsePaddingShorthand(mobileMatch[1]).left);
        expect(Number.isFinite(mobileH)).toBe(true);
        expect(mobileH).toBeLessThan(desktopH);
    });
});
