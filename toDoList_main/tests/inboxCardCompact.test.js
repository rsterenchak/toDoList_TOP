import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the compact one-line INBOX card + tap-to-open read modal contract.
// The Inbox cards were reformatted from a two-line card (project breadcrumb
// ABOVE the title, which clipped against the rounded top edge) to a compact
// card: title on one truncated line, a metadata row (the shared "○ IDEA"
// status label + project name) below it, and a right chevron. Tapping a card
// opens showInboxReadModal, which shows the full title + full description and
// reuses the existing edit (showDescEditorModal) and completion
// (listLogic.setToDoCompleted) paths. jsdom can't observe the CSS-driven
// clipping/truncation, so these assertions are source-pattern based, matching
// the sibling inboxIdeasView.test.js approach.
describe('Compact INBOX card + read-mode modal', () => {
    const main = read('main.js');
    const css = read('style.css');

    function extractFn(name) {
        const idx = main.indexOf('function ' + name);
        expect(idx).toBeGreaterThan(-1);
        const braceStart = main.indexOf('{', idx);
        let depth = 0;
        for (let i = braceStart; i < main.length; i++) {
            if (main[i] === '{') depth++;
            else if (main[i] === '}') {
                depth--;
                if (depth === 0) return main.slice(braceStart, i + 1);
            }
        }
        throw new Error('unterminated ' + name + ' body');
    }

    describe('clipping fix (behavior 1 / regression 1)', () => {
        it('the .inboxRow card does not clip its content (no overflow:hidden; overflow:visible)', () => {
            const idx = css.indexOf('.inboxRow {');
            expect(idx).toBeGreaterThan(-1);
            const rule = css.slice(idx, css.indexOf('}', idx));
            expect(rule).not.toMatch(/overflow:\s*hidden/);
            expect(rule).toMatch(/overflow:\s*visible/);
        });
    });

    describe('compact card structure (behavior 2 / regression 2)', () => {
        const body = extractFn('buildInboxRow');

        it('renders the title ABOVE the metadata row (breadcrumb no longer first)', () => {
            const titleIdx = body.indexOf('inboxRowTitle');
            const metaIdx = body.indexOf('inboxRowMeta');
            expect(titleIdx).toBeGreaterThan(-1);
            expect(metaIdx).toBeGreaterThan(-1);
            expect(titleIdx).toBeLessThan(metaIdx);
        });

        it('keeps the shared status label + project name in the metadata row', () => {
            expect(body).toMatch(/buildStatusLabel\(\s*item\s*\)/);
            expect(body).toMatch(/inboxRowProject/);
        });

        it('adds a right chevron affordance', () => {
            expect(body).toMatch(/inboxRowChevron/);
            expect(body).toMatch(/›/);
        });

        it('truncates the title to a single line with ellipsis in CSS', () => {
            const idx = css.indexOf('.inboxRowTitle {');
            expect(idx).toBeGreaterThan(-1);
            const rule = css.slice(idx, css.indexOf('}', idx));
            expect(rule).toMatch(/white-space:\s*nowrap/);
            expect(rule).toMatch(/text-overflow:\s*ellipsis/);
            expect(rule).toMatch(/overflow:\s*hidden/);
        });
    });

    describe('card is tappable + accessible (behaviors 3, 9)', () => {
        const body = extractFn('buildInboxRow');

        it('makes the card keyboard-focusable with role=button and an aria-label', () => {
            expect(body).toMatch(/setAttribute\(\s*['"]role['"]\s*,\s*['"]button['"]\s*\)/);
            expect(body).toMatch(/setAttribute\(\s*['"]tabindex['"]\s*,\s*['"]0['"]\s*\)/);
            expect(body).toMatch(/setAttribute\(\s*['"]aria-label['"]/);
        });

        it('opens the read modal on click, ignoring taps on the status label', () => {
            expect(body).toMatch(/addEventListener\(\s*['"]click['"]/);
            expect(body).toMatch(/showInboxReadModal\(/);
            expect(body).toMatch(/closest\(\s*['"]\.todoStatusLabel['"]\s*\)/);
        });

        it('activates on Enter/Space via keydown', () => {
            expect(body).toMatch(/addEventListener\(\s*['"]keydown['"]/);
            expect(body).toMatch(/Enter/);
        });
    });

    describe('showInboxReadModal (behaviors 4, 5, 6, 11)', () => {
        const body = extractFn('showInboxReadModal');

        it('mounts a dialog on a dedicated backdrop with modal ARIA', () => {
            expect(body).toMatch(/inboxReadModalBackdrop/);
            expect(body).toMatch(/setAttribute\(\s*['"]role['"]\s*,\s*['"]dialog['"]\s*\)/);
            expect(body).toMatch(/setAttribute\(\s*['"]aria-modal['"]\s*,\s*['"]true['"]\s*\)/);
        });

        it('renders the FULL title and full description (item.tit / item.desc, no truncation)', () => {
            expect(body).toMatch(/textContent\s*=\s*item\.tit/);
            expect(body).toMatch(/item\.desc/);
        });

        it('hides the Description label/body when the entry has no description', () => {
            expect(body).toMatch(/desc\.trim\(\)\.length\s*>\s*0/);
            expect(body).toMatch(/inboxReadModalDescLabel/);
        });

        it('reuses the existing edit and completion handlers — no new mutation logic', () => {
            expect(body).toMatch(/showDescEditorModal\(/);
            expect(body).toMatch(/listLogic\.setToDoCompleted\(/);
            expect(body).not.toMatch(/item\.completed\s*=/);
        });

        it('re-renders the inbox after Done so the completed idea drops out', () => {
            expect(body).toMatch(/renderInbox\(\)/);
        });

        it('closes on backdrop click and Escape, returning focus to the originating card', () => {
            expect(body).toMatch(/event\.target\s*===\s*backdrop/);
            expect(body).toMatch(/event\.key\s*===\s*['"]Escape['"]/);
            expect(body).toMatch(/originatingCard\.focus\(\)/);
        });
    });

    describe('modal CSS (behavior 4 typography)', () => {
        it('styles the backdrop as a fixed centered overlay', () => {
            const idx = css.indexOf('#inboxReadModalBackdrop {');
            expect(idx).toBeGreaterThan(-1);
            const rule = css.slice(idx, css.indexOf('}', idx));
            expect(rule).toMatch(/position:\s*fixed/);
            expect(rule).toMatch(/justify-content:\s*center/);
        });

        it('renders the modal title without truncation (wraps naturally)', () => {
            const idx = css.indexOf('#inboxReadModalTitle {');
            expect(idx).toBeGreaterThan(-1);
            const rule = css.slice(idx, css.indexOf('}', idx));
            expect(rule).toMatch(/white-space:\s*normal/);
            expect(rule).toMatch(/font-size:\s*16px/);
        });

        it('renders the description body with comfortable line-height and no clamp', () => {
            const idx = css.indexOf('#inboxReadModalDescBody {');
            expect(idx).toBeGreaterThan(-1);
            const rule = css.slice(idx, css.indexOf('}', idx));
            expect(rule).toMatch(/line-height:\s*1\.55/);
            expect(rule).not.toMatch(/-webkit-line-clamp/);
        });
    });
});
