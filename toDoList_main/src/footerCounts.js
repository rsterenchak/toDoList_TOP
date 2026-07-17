// Footer/header count writer extracted from main.js (a behaviour-preserving
// move). updateFooterCounts refreshes the sidebar project badges, tallies the
// selected project's open/done items, writes the two footer count spans, and
// hands the same tally to the mobile project header writer. The three DOM refs
// it reads (sideMain plus the two footer count spans) and the sibling header
// writer (updateMobileProjHeader) arrive as factory deps, so the returned
// updateFooterCounts body is identical to the inline original. listLogic and
// updateAllProjectBadges are shared module singletons, imported directly the
// same way main.js imports them.
import { listLogic } from './listLogic.js';
import { updateAllProjectBadges } from './projectBadges.js';

export function createFooterCounts({
    sideMain,
    footOpen,
    footDone,
    updateMobileProjHeader,
}) {
    function updateFooterCounts() {
        updateAllProjectBadges();
        const selected = sideMain.querySelector('.selectedProject');
        let open = 0, done = 0;
        let name = '';
        if (selected) {
            const input = selected.querySelector('#projInput');
            name = input ? input.value.trim() : '';
            const items = listLogic.listItems(name) || [];
            items.forEach(function(i) {
                if (!i.tit) return;
                if (i.completed) done++; else open++;
            });
        }
        footOpen.textContent = open + ' OPEN';
        footDone.textContent = done + ' DONE';

        updateMobileProjHeader(name, open, done);
    }

    return { updateFooterCounts };
}
