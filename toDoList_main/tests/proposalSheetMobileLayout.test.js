import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

function rule(selector) {
    const match = css.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
        '\\s*\\{([^}]*)\\}'));
    return match ? match[1] : null;
}

// The proposal review sheet used to size itself with `max-height: 92vh` inside a
// centred backdrop. `vh` resolves against iOS Safari's LARGE viewport — the one
// measured with the browser toolbars retracted — so on a phone a sheet holding more
// than a couple of proposals rendered taller than the visible viewport: the header
// rode up under the status bar and the pinned Close sat below the bottom toolbar,
// out of reach with no way to scroll to it (the dialog itself doesn't scroll; only
// its card list does). These assertions pin the full-height-column shape that fixed
// it, since the geometry is CSS-only and nothing in jsdom computes it.
describe('proposal review sheet — phone-viewport layout', () => {
    // The @media (max-width: 480px) block that governs the sheet, read by brace
    // matching — the file has many such blocks, so a plain split lands in the
    // wrong one.
    const mobileBlock = (function () {
        const marker = '@media (max-width: 480px)';
        let from = 0;
        for (;;) {
            const start = css.indexOf(marker, from);
            if (start === -1) return null;
            const open = css.indexOf('{', start);
            let depth = 0;
            let end = -1;
            for (let i = open; i < css.length; i++) {
                if (css[i] === '{') depth++;
                else if (css[i] === '}') {
                    depth--;
                    if (depth === 0) { end = i; break; }
                }
            }
            if (end === -1) return null;
            const block = css.slice(open, end + 1);
            if (block.indexOf('#proposalReviewModal') !== -1) return block;
            from = end + 1;
        }
    })();

    it('has a phone block that governs the sheet', () => {
        expect(mobileBlock).toBeTruthy();
    });

    it('drops the vh-sized dialog for a dynamic-viewport, safe-area-inset backdrop', () => {
        // No `vh` height left on the sheet — that unit is what overflowed.
        expect(mobileBlock).not.toMatch(/#proposalReviewModal\s*\{[^}]*max-height:\s*\d+vh/);
        // The backdrop tracks the DYNAMIC viewport and stretches the dialog.
        expect(mobileBlock).toMatch(/#proposalReviewModalBackdrop\s*\{[^}]*height:\s*100dvh/);
        expect(mobileBlock).toMatch(/#proposalReviewModalBackdrop\s*\{[^}]*align-items:\s*stretch/);
        // Top padding clears the status bar; the bottom reuses the shared capped
        // home-indicator reserve the rest of the mobile chrome uses.
        expect(mobileBlock).toMatch(/env\(safe-area-inset-top/);
        expect(mobileBlock).toMatch(/var\(--mobile-bottom-inset\)/);
        // The dialog fills the inset backdrop rather than sizing to its content.
        expect(mobileBlock).toMatch(/#proposalReviewModal\s*\{[^}]*height:\s*100%/);
    });

    it('keeps the header and footer unshrinkable so the pinned Close survives a long list', () => {
        expect(rule('#proposalReviewModalHeader')).toMatch(/flex:\s*0 0 auto/);
        expect(rule('#proposalReviewModalActions')).toMatch(/flex:\s*0 0 auto/);
        // The card list is the only scroller in the column.
        const body = rule('#proposalReviewModalBody');
        expect(body).toMatch(/flex:\s*1 1 auto/);
        expect(body).toMatch(/min-height:\s*0/);
        expect(body).toMatch(/overflow:\s*auto/);
        expect(rule('#proposalReviewModal')).toMatch(/flex-direction:\s*column/);
    });

    it('clamps a collapsed card preview to two lines and lifts the clamp when expanded', () => {
        expect(rule('.proposalCardPreview')).toMatch(/-webkit-line-clamp:\s*2/);
        expect(rule('.proposalCard.is-expanded .proposalCardPreview'))
            .toMatch(/-webkit-line-clamp:\s*unset/);
    });
});
