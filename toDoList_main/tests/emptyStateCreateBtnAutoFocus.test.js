// Locks in the auto-focus on the no-projects empty-state Create button so
// keyboard users can press Enter to start without having to tab or click.
// Regression target: tapping into the page with no projects yet used to
// land focus on <body>, leaving the primary action one keystroke harder
// to reach. The fix calls .focus() on #emptyStateCreateBtn after appending
// it, but only when nothing else holds focus — so a re-render shouldn't
// re-steal focus from an already-active control like the hamburger menu.

import { updateEmptyState } from '../src/emptyState.js';

describe('empty-state Create button auto-focus', () => {

    beforeEach(() => {
        document.body.innerHTML = '';
        const mainList = document.createElement('div');
        mainList.id = 'mainList';
        document.body.appendChild(mainList);
    });

    it('focuses #emptyStateCreateBtn when the no-projects empty state renders', () => {
        const mainList = document.getElementById('mainList');
        updateEmptyState(mainList);

        const btn = document.getElementById('emptyStateCreateBtn');
        expect(btn).not.toBeNull();
        expect(document.activeElement).toBe(btn);
    });

    it('does not steal focus when another control already holds focus', () => {
        const hamburger = document.createElement('button');
        hamburger.id = 'hamburger';
        document.body.appendChild(hamburger);
        hamburger.focus();
        expect(document.activeElement).toBe(hamburger);

        const mainList = document.getElementById('mainList');
        updateEmptyState(mainList);

        const btn = document.getElementById('emptyStateCreateBtn');
        expect(btn).not.toBeNull();
        // Focus stays on the hamburger; the empty state does not yank it back.
        expect(document.activeElement).toBe(hamburger);
    });

    it('renders the create button as a real <button> so Enter natively triggers click', () => {
        const mainList = document.getElementById('mainList');
        updateEmptyState(mainList);

        const btn = document.getElementById('emptyStateCreateBtn');
        expect(btn).not.toBeNull();
        // A <button> element activates on Enter without extra keydown wiring;
        // pin the tag + type so a future refactor to a div/span doesn't
        // silently break keyboard activation.
        expect(btn.tagName).toBe('BUTTON');
        expect(btn.type).toBe('button');
    });
});
