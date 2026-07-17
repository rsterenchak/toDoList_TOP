// Sidebar project-badge repaint + index-based project navigation, extracted
// verbatim from main.js. Behaviour-preserving move: the function bodies are
// unchanged except that the `sideMain` node — formerly a component() closure
// local — is resolved here via document.getElementById('sideMa'), the same
// element (id 'sideMa') the closure always referred to. listLogic is imported
// directly so the bodies stay as-is; every call site in main.js keeps calling
// updateAllProjectBadges() / navigateToProjectByIndex() unchanged.
import { listLogic } from './listLogic.js';

// Walk every committed sidebar project row and stamp its incomplete
// count into the row's `.projBadge` child. Driven off the same
// MutationObserver signal that powers updateFooterCounts so badges
// refresh on every add / complete / uncomplete / delete of a todo
// and every add / rename / delete of a project — keeping all sidebar
// counts in lockstep without per-callsite wiring.
export function updateAllProjectBadges() {
    const sideMain = document.getElementById('sideMa');
    if (!sideMain) return;
    const rows = sideMain.querySelectorAll('#projChild');
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const input = row.querySelector('#projInput');
        const badge = row.querySelector('.projBadge');
        if (!badge) continue;
        const name = input ? input.value.trim() : '';
        // Uncommitted rows (new-project input still empty, or input
        // mid-rename with an empty value) have no project to count
        // against — clear the badge so the row stays clean instead
        // of displaying a stray "0" during the input flow.
        if (!name || listLogic.listProjectsArray().indexOf(name) === -1) {
            badge.textContent = '';
            badge.setAttribute('data-empty', 'true');
            continue;
        }
        const count = listLogic.getProjectIncompleteCount(name);
        badge.textContent = String(count);
        badge.removeAttribute('data-empty');
    }
}

// Resolve the project name at the given index in the authoritative
// listLogic order and route the selection through the matching
// #projChild click — the same path the sidebar uses. Returns true
// when the navigation committed (i.e. the target index resolved to
// a real, non-active project), false otherwise. Centralising the
// routing keeps the chevron click and the swipe gesture sharing one
// selection codepath so the existing accent + addAllToDo_DOM dance
// runs unchanged.
export function navigateToProjectByIndex(targetIdx) {
    const sideMain = document.getElementById('sideMa');
    const projects = (listLogic.listProjectsArray && listLogic.listProjectsArray()) || [];
    const total = projects.length;
    if (total === 0) return false;
    if (targetIdx < 0 || targetIdx >= total) return false;
    const targetName = projects[targetIdx];
    const rows = sideMain.querySelectorAll('#projChild');
    for (let i = 0; i < rows.length; i++) {
        const inp = rows[i].querySelector('#projInput');
        if (inp && inp.value.trim() === targetName) {
            rows[i].click();
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                try { navigator.vibrate(10); } catch (_) { /* noop */ }
            }
            return true;
        }
    }
    return false;
}
