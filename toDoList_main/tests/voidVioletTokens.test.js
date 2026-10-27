import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

// Regression for: ~309 color values in style.css named the Void violets
// directly (#6C5DF5, #9D93EE, #8b7bff and their rgba forms) instead of
// reading theme tokens, so they ignored data-theme. They now resolve through
// --accent-strong / --accent-soft / --accent, defined per theme.
describe('Void violets resolve through theme tokens', () => {
    function block(selector) {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = css.match(new RegExp('(?:^|\\n)' + escaped + '\\s*\\{([^}]*)\\}'));
        if (!match) throw new Error(`Block for "${selector}" not found`);
        return match[1];
    }

    it('defines --accent-strong and --accent-soft with the Void values in :root', () => {
        const root = block(':root');
        expect(root).toMatch(/--accent-strong:\s*#6C5DF5;/i);
        expect(root).toMatch(/--accent-soft:\s*#9D93EE;/i);
    });

    it('gives both tokens the darker light-theme violets', () => {
        const light = block(':root[data-theme="light"]');
        expect(light).toMatch(/--accent-strong:\s*#5d4eca;/i);
        expect(light).toMatch(/--accent-soft:\s*#4a3bb8;/i);
    });

    it('leaves no Void violet literal outside the :root token definitions', () => {
        const withoutRoot = css.replace(block(':root'), '');
        expect(withoutRoot).not.toMatch(/#(?:6C5DF5|9D93EE|8b7bff)\b/i);
        expect(withoutRoot).not.toMatch(/rgba\(\s*(?:108\s*,\s*93\s*,\s*245|139\s*,\s*123\s*,\s*255|157\s*,\s*147\s*,\s*238)\s*,/i);
    });

    it('expresses translucent violets as color-mix over the matching token', () => {
        expect(css).toMatch(/color-mix\(in srgb, var\(--accent-strong\) 18%, transparent\)/);
        expect(css).toMatch(/color-mix\(in srgb, var\(--accent\) 12%, transparent\)/);
        expect(css).toMatch(/color-mix\(in srgb, var\(--accent-soft\) 30%, transparent\)/);
    });
});

// Regression for: Phosphor still showed Void's violet-grey in a few places
// (Completed header, COVERAGE pill, TODO.md buttons) because the purple-cast
// neutrals and lavenders were left as hex. Every rule outside the :root token
// block and light-theme rules now reads a token, so no new rule may hardcode a
// violet-cast color: hue 225–290° with the blue channel above green.
describe('no violet-cast literal outside the token blocks', () => {
    function hue(r, g, b) {
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max === min) return null;
        const d = max - min;
        let h;
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        return h < 0 ? h + 360 : h;
    }

    function isVioletCast(r, g, b) {
        const h = hue(r, g, b);
        return h !== null && b > g && h >= 225 && h <= 290;
    }

    // Walks the stylesheet's declarations, tracking the innermost selector so
    // the :root token block and light-theme rules can be skipped.
    function violetLiterals(source) {
        const stripped = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
        const hits = [];
        const selectors = [];
        let buf = '';
        let line = 1;
        for (const c of stripped) {
            if (c === '\n') line++;
            if (c === '{') { selectors.push(buf.trim()); buf = ''; continue; }
            if (c === '}') { selectors.pop(); buf = ''; continue; }
            if (c !== ';' || !selectors.length) { buf += c; continue; }
            const selector = selectors[selectors.length - 1];
            const decl = buf;
            buf = '';
            if (selector === ':root' || selector.includes('[data-theme="light"]')) continue;
            const colors = /#([0-9a-f]{6}|[0-9a-f]{3})\b|rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/gi;
            for (const m of decl.matchAll(colors)) {
                let r, g, b;
                if (m[1]) {
                    const hex = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
                    [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
                } else {
                    [r, g, b] = [m[2], m[3], m[4]].map(Number);
                }
                if (isVioletCast(r, g, b)) hits.push(`line ${line}: ${selector} → ${m[0]}`);
            }
        }
        return hits;
    }

    it('flags violet-cast hex and rgb literals but not neutrals or semantic colors', () => {
        const sample = [
            '.a { color: #7a74a8; }',
            '.b { background: rgba(122, 108, 240, 0.35); }',
            '.c { color: #fff; border-color: #ffbd5e; background: #e06a7a; }',
            '.d { color: #9ad0a8; background: #111; }',
        ].join('\n');
        const hits = violetLiterals(sample);
        expect(hits).toHaveLength(2);
        expect(hits[0]).toContain('#7a74a8');
        expect(hits[1]).toContain('rgba(122, 108, 240');
    });

    it('skips the :root token block and light-theme rules', () => {
        const sample = [
            ':root { --accent: #8b7bff; }',
            ':root[data-theme="light"] { --accent: #5d4eca; }',
            ':root[data-theme="light"] .x { color: #4a3bb8; }',
        ].join('\n');
        expect(violetLiterals(sample)).toEqual([]);
    });

    it('leaves no violet-cast color in style.css outside the token blocks', () => {
        expect(violetLiterals(css)).toEqual([]);
    });

    it('routes the reported Phosphor leaks through tokens', () => {
        expect(css).toMatch(/#completedHeader\s*\{[^}]*color:\s*color-mix\(in srgb, var\(--accent-soft\) 45%, var\(--text-muted\)\)/);
        const coverage = css.match(/#desktopChatPane #claudeTabCoverage\s*\{([^}]*)\}/)[1];
        expect(coverage).toMatch(/background:\s*var\(--bg-elevated\)/);
        expect(coverage).toMatch(/border:\s*1px solid var\(--border-bright\)/);
        expect(coverage).toMatch(/color:\s*var\(--text-secondary\)/);
        for (const btn of ['.todoMdViewerOverflowBtn', '.todoMdViewerCollapseBtn']) {
            const esc = btn.replace('.', '\\.');
            expect(css).toMatch(new RegExp(`\\n${esc}\\s*\\{[^}]*background:\\s*var\\(--bg-elevated\\)[^}]*color:\\s*var\\(--text-secondary\\)`));
            expect(css).toMatch(new RegExp(`\\n${esc}:hover\\s*\\{[^}]*background:\\s*var\\(--bg-raised\\)[^}]*color:\\s*var\\(--text-primary\\)`));
        }
    });
});
