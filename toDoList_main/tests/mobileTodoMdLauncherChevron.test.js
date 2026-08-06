import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

const css = read('style.css');

// Blank out comments length-preservingly so rule offsets stay meaningful and a
// prelude polluted by leaked comment prose can't masquerade as a live rule.
function scanComments(text) {
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
        if (text[i] === '"' || text[i] === "'") { quote = text[i]; out += text[i]; i += 1; continue; }
        out += text[i];
        i += 1;
    }
    return out;
}

const stripped = scanComments(css);

// Specificity as (ids, classes+attrs+pseudo-classes, elements+pseudo-elements).
function specificity(selector) {
    const s = selector.trim();
    const ids = (s.match(/#[\w-]+/g) || []).length;
    const elements = (s.match(/::[\w-]+/g) || []).length;
    const classes = (s.replace(/::[\w-]+/g, '').match(/\.[\w-]+/g) || []).length
        + (s.match(/\[[^\]]*\]/g) || []).length
        + (s.replace(/::[\w-]+/g, '').match(/:[\w-]+/g) || []).length;
    return [ids, classes, elements];
}

function compareSpecificity(a, b) {
    const x = specificity(a);
    const y = specificity(b);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
}

function allRules() {
    const out = [];
    const ruleRe = /([^{}]*)\{([^{}]*)\}/g;
    let m;
    while ((m = ruleRe.exec(stripped)) !== null) {
        const prelude = m[1].replace(/\s+/g, ' ').trim();
        out.push({ prelude, body: m[2], pos: m.index + m[1].length - prelude.length });
    }
    return out;
}

const RULES = allRules();

function findRule(preludeRe) {
    return RULES.find((r) => preludeRe.test(r.prelude)) || null;
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

// Two follow-ups to the launcher fill change.
//
// 1. Painting the launcher --bg-row put it on the task rows' interactive layer,
//    but the rows actually on screen are usually .todo-row--in_progress, which
//    paints --bg-hover — so the launcher landed in an awkward near-match rather
//    than lining up. Put it back on --bg-surface, one clear step below the row
//    layer and still lifted off the --bg-elevated mobile canvas.
// 2. The launcher opens the bottom sheet on tap but carried no affordance
//    saying so. Add a decorative chevron after the TODO.md label.
//
// Source inspection per CLAUDE.md (style.css is large; we assert the CSS
// contract rather than instantiating a layout engine).
describe('Mobile TODO.md launcher — surface step and chevron affordance', () => {
    const LAUNCHER_RE = /^#mainList\s*>\s*#todoMdViewerCard$/;
    const LAUNCHER_ACTIVE_RE = /^#mainList\s*>\s*#todoMdViewerCard:active$/;
    const HEADER_BEFORE_RE =
        /^#mainList\s*>\s*#todoMdViewerCard \.todoMdViewerHeader::before$/;
    const HEADER_AFTER_RE =
        /^#mainList\s*>\s*#todoMdViewerCard \.todoMdViewerHeader::after$/;

    it('paints the launcher --bg-surface, a step below the row layer', () => {
        const hit = findRule(LAUNCHER_RE);
        expect(hit).toBeTruthy();
        expect(hit.prelude).toBe('#mainList > #todoMdViewerCard');
        expect(hit.body).toMatch(/background:\s*var\(--bg-surface\)/);
        expect(hit.body).not.toMatch(/background:\s*var\(--bg-row\)/);
        expect(inMobileMediaBlock(hit.pos)).toBe(true);
    });

    it('keeps the launcher sizing and its --border-mid edge', () => {
        const hit = findRule(LAUNCHER_RE);
        expect(hit.body).toMatch(/height:\s*var\(--item-h\)/);
        expect(hit.body).toMatch(/margin:\s*3px 10px/);
        expect(hit.body).toMatch(/max-height:\s*50px/);
        expect(hit.body).toMatch(/border-color:\s*var\(--border-mid\)/);
    });

    it('no viewer-card rule anywhere still claims --bg-row', () => {
        const rowFilled = RULES
            .filter((r) => /todoMdViewerCard/.test(r.prelude))
            .filter((r) => /background:\s*var\(--bg-row\)/.test(r.body))
            .map((r) => r.prelude);
        expect(rowFilled).toEqual([]);
    });

    it('keeps the pressed state a lift that outranks the fill', () => {
        const active = findRule(LAUNCHER_ACTIVE_RE);
        expect(active).toBeTruthy();
        expect(active.body).toMatch(/background:\s*var\(--bg-hover\)/);
        expect(inMobileMediaBlock(active.pos)).toBe(true);
        // The launcher fill is two ids, so the general
        // `#mainList .todoMdViewerCard:active` would lose to it — the
        // launcher-scoped :active is what keeps the press readable.
        const fill = findRule(LAUNCHER_RE);
        expect(compareSpecificity(active.prelude, fill.prelude)).toBeGreaterThan(0);
    });

    it('renders a muted right-pointing chevron after the label', () => {
        const hit = findRule(HEADER_AFTER_RE);
        expect(hit).toBeTruthy();
        expect(inMobileMediaBlock(hit.pos)).toBe(true);
        // A right-pointing chevron glyph, not an empty decorative box.
        expect(hit.body).toMatch(/content:\s*'[›❯▸>]'/);
        expect(hit.body).toMatch(/font-size:\s*14px/);
        expect(hit.body).toMatch(/color:\s*#7a74a8/);
        // A small gap so it doesn't butt against the label.
        expect(hit.body).toMatch(/margin-left:\s*\d/);
    });

    it('pins the label and chevron ahead of the right-aligned meta group', () => {
        const before = findRule(HEADER_BEFORE_RE);
        const after = findRule(HEADER_AFTER_RE);
        expect(before.body).toMatch(/order:\s*-2/);
        expect(after.body).toMatch(/order:\s*-1/);
        // .todoMdViewerMeta stays at default order so its margin-left:auto
        // keeps the run / deploy / sync / overflow buttons right-aligned.
        const meta = findRule(/^\.todoMdViewerMeta$/);
        expect(meta).toBeTruthy();
        expect(meta.body).toMatch(/margin-left:\s*auto/);
        expect(meta.body).not.toMatch(/order:/);
    });

    it('leaves the label content untouched by the chevron', () => {
        const before = findRule(HEADER_BEFORE_RE);
        // The glyph lives on ::after, so the label's own colour and size stay
        // independent — no string concatenation onto ::before.
        expect(before.body).toMatch(/content:\s*'TODO\.md'\s*;/);
        expect(before.body).not.toMatch(/[›❯▸]/);
    });

    it('keeps the chevron decorative — not a tap target, not announced', () => {
        const hit = findRule(HEADER_AFTER_RE);
        expect(hit.body).toMatch(/pointer-events:\s*none/);
        // Alt-text syntax hides it from the a11y tree, with a plain `content`
        // declared first so browsers without alt-text support still paint it.
        expect(hit.body).toMatch(/content:\s*'[›❯▸>]'\s*\/\s*''/);
    });

    it('shows the chevron on no other viewer host', () => {
        const chevronHosts = RULES
            .filter((r) => /todoMdViewer/.test(r.prelude))
            .filter((r) => /::after/.test(r.prelude))
            .filter((r) => /content:\s*'[›❯▸]/.test(r.body))
            .map((r) => r.prelude);
        expect(chevronHosts).toEqual([
            '#mainList > #todoMdViewerCard .todoMdViewerHeader::after',
        ]);

        // The bottom sheet, the pane-hosted card, and the desktop rail strip
        // keep --bg-surface and gain nothing from this change.
        for (const re of [
            /^#todoMdViewerMobileSheet \.todoMdViewerCard$/,
            /^#descDetailPane \.todoMdViewerCard$/,
        ]) {
            const host = findRule(re);
            expect(host).toBeTruthy();
            expect(host.body).not.toMatch(/background:\s*var\(--bg-row\)/);
        }
        const base = findRule(/^\.todoMdViewerCard$/);
        expect(base).toBeTruthy();
        expect(base.body).toMatch(/background:\s*var\(--bg-surface\)/);
        expect(inMobileMediaBlock(base.pos)).toBe(false);
    });
});
