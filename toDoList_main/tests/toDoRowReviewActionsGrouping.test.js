import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import { buildReviewActions } from '../src/toDoRow.js';

// The ACCEPT-face action row is two clusters with a rule between them, not five
// loose buttons: ACCEPT & CLOSE / REVERT are the primary/danger decision pair, and
// OPEN IN TODO.MD / COPY CONTEXT / ITERATE are the read-only tertiary routes.
// buildReviewActions is host-neutral (desktop detail pane AND mobile description-
// editor modal), so the grouping is asserted for both hosts, along with the thing a
// pure-markup restructure most easily breaks: the existing click wiring.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const css = readFileSync(resolve(srcDir, 'style.css'), 'utf8');

const PRIMARY = '.descReviewActionsPrimary';
const TERTIARY = '.descReviewActionsTertiary';
const DIVIDER = '.descReviewActionsDivider';

function makeItem(overrides) {
    return Object.assign({
        id: 't1',
        tit: 'Add a widget',
        entryId: '4b179cbf-3678-4c8b-90af-abc123def456',
        desc: '- [ ] **[MEDIUM]** Add a widget\n  - Type: feature',
    }, overrides || {});
}

const classesOf = (host, sel) => Array.from(host.querySelectorAll(sel + ' .descReviewBtn'))
    .map((b) => b.className.replace('descReviewBtn ', ''));

describe('ACCEPT-face action row — primary / tertiary clustering', () => {
    it('groups ACCEPT & CLOSE and REVERT, in that order, as the primary pair', () => {
        const actions = buildReviewActions(makeItem(), 'Proj');
        expect(classesOf(actions, PRIMARY))
            .toEqual(['descReviewBtn--accept', 'descReviewBtn--revert']);
    });

    it('groups OPEN IN TODO.MD, COPY CONTEXT and ITERATE, in that order, as the tertiary cluster', () => {
        const actions = buildReviewActions(makeItem(), 'Proj');
        expect(classesOf(actions, TERTIARY))
            .toEqual(['descReviewBtn--open', 'descReviewBtn--copyctx', 'descReviewBtn--iterate']);
    });

    it('renders the divider between the two clusters', () => {
        const actions = buildReviewActions(makeItem(), 'Proj');
        const kids = Array.from(actions.children).map((el) => el.className);
        expect(kids).toEqual([
            'descReviewError',
            'descReviewActionsPrimary',
            'descReviewActionsDivider',
            'descReviewActionsTertiary',
        ]);
    });

    it('hides the divider from assistive tech — it is decoration, not a control', () => {
        const divider = buildReviewActions(makeItem(), 'Proj').querySelector(DIVIDER);
        expect(divider.getAttribute('aria-hidden')).toBe('true');
        expect(divider.textContent).toBe('');
    });

    it('keeps the error line a direct child of the row so it holds its own full-width line', () => {
        const actions = buildReviewActions(makeItem(), 'Proj');
        const errorEl = actions.querySelector('.descReviewError');
        expect(errorEl.parentElement).toBe(actions);
        expect(errorEl.hidden).toBe(true);
    });

    it('still mounts all five controls, with their existing classes, on BOTH hosts', () => {
        const hosts = [
            buildReviewActions(makeItem(), 'Proj'),
            buildReviewActions(makeItem(), 'Proj', { onOpenInViewer() {}, onIterate() {} }),
        ];
        hosts.forEach((actions) => {
            expect(actions.querySelectorAll('.descReviewBtn').length).toBe(5);
            ['accept', 'revert', 'open', 'copyctx', 'iterate'].forEach((k) => {
                expect(actions.querySelector('.descReviewBtn--' + k)).not.toBeNull();
            });
            // The row itself keeps the class and entry tag syncReviewPanel /
            // renderReviewBlock query by, so the idempotent repaint guard still holds.
            expect(actions.className).toBe('descReviewActions');
            expect(actions.getAttribute('data-review-entry'))
                .toBe('4b179cbf-3678-4c8b-90af-abc123def456');
        });
    });

    it('keeps the modal host hooks wired to the now-nested tertiary buttons', () => {
        const seen = [];
        const actions = buildReviewActions(makeItem(), 'Proj', {
            onOpenInViewer: function () { seen.push('open'); },
            onIterate: function (entryId, repo) { seen.push(['iterate', entryId, repo]); },
        });
        actions.querySelector('.descReviewBtn--open').click();
        actions.querySelector('.descReviewBtn--iterate').click();
        expect(seen[0]).toBe('open');
        expect(seen[1][0]).toBe('iterate');
        expect(seen[1][1]).toBe('4b179cbf-3678-4c8b-90af-abc123def456');
    });
});

describe('ACCEPT-face action row — cluster layout', () => {
    // `from` skips past the shared `.primary, .tertiary` rule so the per-cluster
    // blocks below it can be read individually.
    const bodyOf = (sel, from) => {
        const idx = css.indexOf(sel + ' {', from || 0);
        expect(idx).toBeGreaterThan(-1);
        return css.slice(idx, css.indexOf('}', idx));
    };
    const sharedIdx = css.indexOf(PRIMARY + ',\n' + TERTIARY + ' {');
    const afterShared = css.indexOf('}', sharedIdx);

    it('wraps inside each cluster at the row\'s own 8px gap', () => {
        const body = bodyOf(PRIMARY + ',\n' + TERTIARY);
        expect(body).toMatch(/flex-wrap:\s*wrap/);
        expect(body).toMatch(/gap:\s*8px/);
        // The tertiary cluster absorbs the leftover width so it re-flows beside the
        // rule instead of pushing the rule onto a line of its own.
        expect(bodyOf(PRIMARY, afterShared)).toMatch(/flex:\s*0 0 auto/);
        expect(bodyOf(TERTIARY, afterShared)).toMatch(/flex:\s*1 1 auto/);
    });

    it('draws the divider as a 1px rule in the shared border token', () => {
        const body = bodyOf(DIVIDER);
        expect(body).toMatch(/flex:\s*0 0 1px/);
        expect(body).toMatch(/background:\s*var\(--border-bright\)/);
        expect(body).toMatch(/align-self:\s*stretch/);
    });

    it('turns the divider horizontal in the narrow mobile modal so nothing dangles', () => {
        // Below 1024px the detail pane is gone and the row renders inside the mobile
        // description-editor modal, too narrow for both clusters on one line.
        const start = css.indexOf(DIVIDER + ' {', css.indexOf('@media (max-width: 1023px)', css.indexOf(DIVIDER + ' {')));
        const block = css.slice(start, start + 400);
        expect(block).toMatch(/flex:\s*0 0 100%/);
        expect(block).toMatch(/height:\s*1px/);
        expect(block).toMatch(new RegExp(TERTIARY.slice(1) + '[\\s\\S]*flex:\\s*1 1 100%'));
    });
});
