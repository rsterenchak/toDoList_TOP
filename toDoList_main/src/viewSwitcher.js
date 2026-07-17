import { isAnyModalOrPopoverOpen } from './modals.js';

// Roving-tabindex ArrowLeft/ArrowRight navigation across the three view pills.
// The switcher is an ARIA tablist, so exactly one pill is in the Tab order at a
// time (tabindex 0) while the others are tabindex -1; ArrowLeft / ArrowRight
// move focus among them and hand the roving 0 to the newly-focused pill.
// Movement wraps: ArrowRight on the last pill (STRUCTURE) lands on the first
// (Task View) and ArrowLeft on the first lands on the last. The active pill's
// tabindex is kept in sync by applyActiveView in main.js; this module just owns
// the arrow-key walk between them.
//
// The nav takes priority over the header-wide nav ArrowLeft/Right walk: the
// handler stopPropagation()s so neither the document-level cross-pane handler
// (which would yank focus into the task pane in Projects view) nor any ancestor
// listener also fires. Enter/Space activation is left to native <button>
// behaviour, so the click handlers in main.js keep switching views on those
// keys.
//
// The factory closes over the `viewSwitcherPills` array (the three pill
// elements, in order) passed in from main.js, so focus movement stays anchored
// to the same ordered set main.js seeds and applyActiveView keeps in sync.
export function createViewSwitcher({ viewSwitcherPills }) {
    function focusViewPillAt(index) {
        const pill = viewSwitcherPills[index];
        if (!pill) return;
        viewSwitcherPills.forEach(function(p) {
            p.setAttribute('tabindex', p === pill ? '0' : '-1');
        });
        pill.focus();
    }
    function viewSwitcherArrowNav(e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (isAnyModalOrPopoverOpen()) return;
        const idx = viewSwitcherPills.indexOf(e.target);
        if (idx === -1) return;
        const len = viewSwitcherPills.length;
        const delta = e.key === 'ArrowRight' ? 1 : -1;
        const nextIdx = (idx + delta + len) % len;
        e.preventDefault();
        e.stopPropagation();
        focusViewPillAt(nextIdx);
    }
    return { focusViewPillAt, viewSwitcherArrowNav };
}
