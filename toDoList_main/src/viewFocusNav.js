// ArrowDown drop-in navigation from the view-switcher pills into the visible
// main pane, extracted verbatim from main.js. Behaviour-preserving move: the
// function body is unchanged from its former home. The module-level helpers it
// reads are imported here directly — isAnyModalOrPopoverOpen from modals.js and
// firstFocusableInTaskFilterBar from taskFilter.js, plus firstFocusableInActiveMainView
// from main.js (a top-level function there; imported back so the body stays as-is).
import { isAnyModalOrPopoverOpen } from './modals.js';
import { firstFocusableInTaskFilterBar } from './taskFilter.js';
import { firstFocusableInActiveMainView } from './main.js';

// ArrowDown drop-in from the view pills into the visible main pane.
// Mirrors the sidebarToggle → first project row transition for the
// spatially-adjacent content directly beneath the pills. The
// destination depends on the currently active view so the keystroke
// lands on rendered items rather than a hidden node:
//   • PROJECTS — the blank-placeholder #toDoInput in #mainList (or
//     #emptyStateInput when the project is empty, or the first
//     committed #toDoChild row as a last resort).
// Without these handlers the document-level todo arrow-nav handler at
// best lands focus on a stale .todo-active row and at worst silently
// no-ops — leaving the rendered items unreachable from the header
// chrome. stopPropagation keeps that document handler from also firing
// and clobbering the focus we just placed.
export function dropFocusIntoMainView(e) {
    if (e.key !== 'ArrowDown') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (isAnyModalOrPopoverOpen()) return;
    // In PROJECTS view the status/sort filter bar sits directly between the
    // pills and the list, so ArrowDown lands there first — a second
    // ArrowDown (handled on the bar's controls) drops into the list. The
    // bar is display:none outside PROJECTS, so firstFocusableInTaskFilterBar
    // returns null in Agent/Structure and focus falls straight into the
    // pane, preserving those views' behaviour.
    const target = firstFocusableInTaskFilterBar() || firstFocusableInActiveMainView();
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    target.focus();
}
