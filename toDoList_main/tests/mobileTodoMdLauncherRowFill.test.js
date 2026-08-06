import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

const css = read('style.css');

// Walk the sheet once, tracking comment and string state, and return the text
// with comments blanked out (length-preserving, so offsets stay meaningful)
// plus the offset of every `*/` that closed nothing. A stray terminator is the
// failure this file exists to catch: it ends the comment early, leaving the
// remaining prose as a rule prelude that swallows the NEXT rule's block whole.
function scanComments(text) {
    const strays = [];
    let out = '';
    let i = 0;
    let inComment = false;
    let quote = '';
    while (i < text.length) {
        const two = text.slice(i, i + 2);
        if (inComment) {
            if (two === '*/') { out += '  '; i += 2; inComment = false; continue; }
            out += text[i] === '\n' ? '\n' : ' ';
            i += 1;
            continue;
        }
        if (quote) {
            if (text[i] === '\\') { out += text.slice(i, i + 2); i += 2; continue; }
            if (text[i] === quote) quote = '';
            out += text[i];
            i += 1;
            continue;
        }
        if (two === '/*') { out += '  '; i += 2; inComment = true; continue; }
        if (two === '*/') { strays.push(i); out += two; i += 2; continue; }
        if (text[i] === '"' || text[i] === "'") { quote = text[i]; out += text[i]; i += 1; continue; }
        out += text[i];
        i += 1;
    }
    return { stripped: out, strays, unterminated: inComment };
}

const { stripped, strays, unterminated } = scanComments(css);

function lineOf(offset) {
    return css.slice(0, offset).split('\n').length;
}

// Specificity as (ids, classes+attrs+pseudo-classes, elements+pseudo-elements).
function specificity(selector) {
    const s = selector.trim();
    const ids = (s.match(/#[\w-]+/g) || []).length;
    const classes = (s.match(/\.[\w-]+/g) || []).length
        + (s.match(/\[[^\]]*\]/g) || []).length
        + (s.match(/:(?!:)[\w-]+/g) || []).length;
    const elements = (s.match(/::[\w-]+/g) || []).length;
    return [ids, classes, elements];
}

function compareSpecificity(a, b) {
    const x = specificity(a);
    const y = specificity(b);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
}

// Find a rule in the comment-stripped sheet and return its prelude, its
// declaration block, and its offset — reading from the stripped text means a
// rule whose prelude is polluted by leaked comment prose cannot masquerade as
// a live rule the way a plain `css.match()` against the raw source would.
function findRule(preludeRe) {
    const ruleRe = /([^{}]*)\{([^{}]*)\}/g;
    let m;
    while ((m = ruleRe.exec(stripped)) !== null) {
        const prelude = m[1].replace(/\s+/g, ' ').trim();
        if (preludeRe.test(prelude)) {
            return { prelude, body: m[2], pos: m.index + m[1].length - prelude.length };
        }
    }
    return null;
}

function inMobileMediaBlock(pos) {
    const mediaIdx = stripped.lastIndexOf('@media (max-width: 1023px)', pos);
    if (mediaIdx === -1) return false;
    let depth = 0;
    let openSeen = false;
    for (let i = stripped.indexOf('{', mediaIdx); i < stripped.length; i++) {
        if (stripped[i] === '{') { depth++; openSeen = true; }
        else if (stripped[i] === '}') {
            depth--;
            if (openSeen && depth === 0) return pos <= i;
        }
    }
    return false;
}

// The collapsed in-list TODO.md launcher was briefly painted --bg-row to put it
// on the task rows' interactive layer. That was reversed: the rows usually on
// screen are .todo-row--in_progress (painted --bg-hover), so --bg-row landed the
// launcher in a near-match rather than a match. It is back on --bg-surface, one
// clear step below the row layer — see mobileTodoMdLauncherChevron.test.js for
// the fill contract that supersedes it.
//
// The second half of this file guards the delivery mechanism rather than the
// fill. The launcher's sizing rule shipped behind a comment with a premature
// `*/`, so its prelude was the leftover prose and browsers dropped the whole
// rule — the exact place that background lives. Source inspection per CLAUDE.md
// (style.css is large; we assert the CSS contract rather than instantiating a
// layout engine).
describe('Mobile TODO.md launcher — fill sits below the task rows', () => {
    const LAUNCHER_RE = /^#mainList\s*>\s*#todoMdViewerCard$/;
    const LAUNCHER_ACTIVE_RE = /^#mainList\s*>\s*#todoMdViewerCard:active$/;

    it('parses with no stray comment terminators', () => {
        expect(strays.map(lineOf)).toEqual([]);
        expect(unterminated).toBe(false);
    });

    it('keeps the launcher rule live rather than swallowed by comment prose', () => {
        const hit = findRule(LAUNCHER_RE);
        expect(hit).toBeTruthy();
        // A prelude that survived comment-stripping intact is a real selector,
        // not a Raw blob the browser discards along with its declarations.
        expect(hit.prelude).toBe('#mainList > #todoMdViewerCard');
        // The sizing declarations the entry describes are still delivered.
        expect(hit.body).toMatch(/height:\s*var\(--item-h\)/);
        expect(hit.body).toMatch(/margin:\s*3px 10px/);
        expect(hit.body).toMatch(/max-height:\s*50px/);
        expect(hit.body).toMatch(/border-color:\s*var\(--border-mid\)/);
        expect(inMobileMediaBlock(hit.pos)).toBe(true);
    });

    it('paints the launcher on --bg-surface, below the rows interactive layer', () => {
        const hit = findRule(LAUNCHER_RE);
        expect(hit.body).toMatch(/background:\s*var\(--bg-surface\)/);
        expect(hit.body).not.toMatch(/background:\s*var\(--bg-row\)/);
    });

    it('keeps the pressed state a lift, at a specificity that survives the fill', () => {
        const active = findRule(LAUNCHER_ACTIVE_RE);
        expect(active).toBeTruthy();
        expect(active.body).toMatch(/background:\s*var\(--bg-hover\)/);
        expect(inMobileMediaBlock(active.pos)).toBe(true);
        // The fill rule is two ids; the general `#mainList .todoMdViewerCard:active`
        // is one id + two classes and would lose to it. The launcher-scoped
        // :active must outrank the fill or the press reads as no feedback.
        const fill = findRule(LAUNCHER_RE);
        expect(compareSpecificity(active.prelude, fill.prelude)).toBeGreaterThan(0);
    });

    it('keeps the mobile layers ordered surface < row < hover', () => {
        const vars = findRule(/^:root:not\(\[data-theme="light"\]\)$/);
        expect(vars).toBeTruthy();
        expect(inMobileMediaBlock(vars.pos)).toBe(true);
        const row = vars.body.match(/--bg-row:\s*(#[0-9a-f]{6})/i);
        const hover = vars.body.match(/--bg-hover:\s*(#[0-9a-f]{6})/i);
        expect(row).toBeTruthy();
        expect(hover).toBeTruthy();
        const sum = (hex) => parseInt(hex.slice(1, 3), 16)
            + parseInt(hex.slice(3, 5), 16)
            + parseInt(hex.slice(5, 7), 16);
        // The launcher's --bg-surface must read a step below the row layer,
        // and the :active --bg-hover must still lift above the launcher.
        const base = findRule(/^\.todoMdViewerCard$/);
        expect(base.body).toMatch(/background:\s*var\(--bg-surface\)/);
        const surfaceDecl = css.match(/--bg-surface:\s*(#[0-9a-f]{6})/i);
        expect(surfaceDecl).toBeTruthy();
        expect(sum(row[1])).toBeGreaterThan(sum(surfaceDecl[1]));
        expect(sum(hover[1])).toBeGreaterThan(sum(row[1]));
    });

    it('leaves the other viewer hosts on --bg-surface', () => {
        // Base card rule — the fill every non-launcher host still inherits.
        const base = findRule(/^\.todoMdViewerCard$/);
        expect(base).toBeTruthy();
        expect(base.body).toMatch(/background:\s*var\(--bg-surface\)/);
        expect(inMobileMediaBlock(base.pos)).toBe(false);

        // No viewer-card rule anywhere claims --bg-row any more.
        const rowFilled = [];
        const ruleRe = /([^{}]*)\{([^{}]*)\}/g;
        let m;
        while ((m = ruleRe.exec(stripped)) !== null) {
            const prelude = m[1].replace(/\s+/g, ' ').trim();
            if (!/todoMdViewerCard/.test(prelude)) continue;
            if (!/background:\s*var\(--bg-row\)/.test(m[2])) continue;
            rowFilled.push(prelude);
        }
        expect(rowFilled).toEqual([]);

        // The sheet, the pane-hosted card, and the rail strip are untouched.
        for (const re of [
            /^#todoMdViewerMobileSheet \.todoMdViewerCard$/,
            /^#descDetailPane \.todoMdViewerCard$/,
        ]) {
            const host = findRule(re);
            expect(host).toBeTruthy();
            expect(host.body).not.toMatch(/background:\s*var\(--bg-row\)/);
        }
    });
});
