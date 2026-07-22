import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

import {
    STATUS_META,
    STATUS_ORDER,
    REVIEW_LABEL,
    normalizeStatus,
    buildStatusLabel,
    applyTodoStatusClass,
    refreshTodoStatusUI,
    showStatusPopover,
    hideStatusPopover,
    wireStatusLabelDelegation,
    setReviewBadgeTapHandler,
} from '../src/todoStatus.js';
import { wireToDoRowClick } from '../src/toDoRow.js';
import { listLogic } from '../src/listLogic.js';
import { setTaskSort } from '../src/prefs.js';


// buildToDoRow itself is too heavily wired to instantiate end-to-end here (see
// the same caveat in mobileInlineExpandCreate.test.js), so the status slice is
// exercised through its own module's small public surface — the helpers, the
// popover, and the single delegated handler — against light jsdom rows.

// Build a minimal committed-row stand-in: a #toDoChild with an __item anchor,
// a data-value project name, a real checkbox, and the status label the row
// builder inserts. Mirrors the relevant subset of buildToDoRow's output.
function makeRow(item, projectName) {
    const row = document.createElement('div');
    row.id = 'toDoChild';
    row.__item = item;
    row.setAttribute('data-value', projectName || 'Inbox');

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.id = 'checkToDo';
    row.appendChild(check);

    applyTodoStatusClass(row, item.status);
    row.appendChild(buildStatusLabel(item));
    return row;
}

beforeEach(() => {
    document.body.innerHTML = '';
});

afterEach(() => {
    hideStatusPopover();
    vi.restoreAllMocks();
});


describe('status metadata + normalisation', () => {
    it('normalises missing / unknown status to active', () => {
        expect(normalizeStatus(undefined)).toBe('active');
        expect(normalizeStatus('bogus')).toBe('active');
        expect(normalizeStatus('in_progress')).toBe('in_progress');
        expect(normalizeStatus('idea')).toBe('idea');
    });
});


describe('(a) each status renders with its label and CSS class', () => {
    it('builds the correct label text + data-status for each status', () => {
        expect(buildStatusLabel({ status: 'active' }).textContent).toBe('○ ACTIVE');
        expect(buildStatusLabel({ status: 'in_progress' }).textContent).toBe('⏵ IN PROGRESS');
        expect(buildStatusLabel({ status: 'idea' }).textContent).toBe('○ IDEA');

        const label = buildStatusLabel({ status: 'in_progress' });
        expect(label.getAttribute('data-status')).toBe('in_progress');
        expect(label.getAttribute('aria-haspopup')).toBe('menu');
    });

    it('a todo lacking a status renders the active badge (forward-compatible)', () => {
        const label = buildStatusLabel({});
        expect(label.getAttribute('data-status')).toBe('active');
        expect(label.textContent).toBe(STATUS_META.active.label);
    });

    it('applies exactly one status modifier class to the row, clearing prior ones', () => {
        const row = document.createElement('div');
        applyTodoStatusClass(row, 'in_progress');
        expect(row.classList.contains('todo-row--in_progress')).toBe(true);
        expect(row.classList.contains('todo-row--active')).toBe(false);

        applyTodoStatusClass(row, 'idea');
        expect(row.classList.contains('todo-row--idea')).toBe(true);
        expect(row.classList.contains('todo-row--in_progress')).toBe(false);
        expect(row.classList.contains('todo-row--active')).toBe(false);
    });
});


describe('(b) tapping the label opens the popover', () => {
    it('a delegated click on the label opens a single popover with three options', () => {
        const container = document.createElement('div');
        container.id = 'mainList';
        document.body.appendChild(container);
        wireStatusLabelDelegation(container);

        const row = makeRow({ status: 'active', tit: 'Write tests' }, 'Inbox');
        container.appendChild(row);

        expect(document.getElementById('todoStatusPopover')).toBeNull();
        row.querySelector('.todoStatusLabel').click();

        const popover = document.getElementById('todoStatusPopover');
        expect(popover).not.toBeNull();
        expect(popover.querySelectorAll('.todoStatusOption').length).toBe(3);
        expect(row.querySelector('.todoStatusLabel').getAttribute('aria-expanded')).toBe('true');
    });

    it('a second tap on the same label toggles the popover closed', () => {
        const container = document.createElement('div');
        container.id = 'mainList';
        document.body.appendChild(container);
        wireStatusLabelDelegation(container);
        const row = makeRow({ status: 'active', tit: 'X' }, 'Inbox');
        container.appendChild(row);

        const label = row.querySelector('.todoStatusLabel');
        label.click();
        expect(document.getElementById('todoStatusPopover')).not.toBeNull();
        label.click();
        expect(document.getElementById('todoStatusPopover')).toBeNull();
    });

    it('installs the delegated handler only once even across repeat wiring calls', () => {
        const container = document.createElement('div');
        container.id = 'mainList';
        document.body.appendChild(container);
        const spy = vi.spyOn(container, 'addEventListener');
        wireStatusLabelDelegation(container);
        wireStatusLabelDelegation(container);
        expect(spy.mock.calls.filter(c => c[0] === 'click').length).toBe(1);
    });
});


describe('(c) selecting an option updates the status via listLogic', () => {
    it('clicking an option routes through listLogic.setToDoStatus with the new status', () => {
        const spy = vi.spyOn(listLogic, 'setToDoStatus').mockImplementation(() => {});

        const item = { status: 'active', tit: 'Ship it' };
        const container = document.createElement('div');
        container.id = 'mainList';
        document.body.appendChild(container);
        wireStatusLabelDelegation(container);
        const row = makeRow(item, 'Work');
        container.appendChild(row);

        row.querySelector('.todoStatusLabel').click();
        const popover = document.getElementById('todoStatusPopover');
        const inProgressOption = popover.querySelector('.todoStatusOption[data-status="in_progress"]');
        inProgressOption.click();

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('Work', item, 'in_progress');
        // Popover dismisses on selection.
        expect(document.getElementById('todoStatusPopover')).toBeNull();
    });

    it('refreshes the label text + row class in place after a status change', () => {
        const item = { status: 'active', tit: 'Y' };
        const row = makeRow(item, 'Inbox');
        document.body.appendChild(row);

        // Simulate the listLogic update having mutated the item, then refresh.
        item.status = 'idea';
        refreshTodoStatusUI(row, item);

        expect(row.querySelector('.todoStatusLabel').textContent).toBe('○ IDEA');
        expect(row.querySelector('.todoStatusLabel').getAttribute('data-status')).toBe('idea');
        expect(row.classList.contains('todo-row--idea')).toBe(true);
        expect(row.classList.contains('todo-row--active')).toBe(false);
    });
});


describe('(d) existing row interactions are not disturbed by the delegated handler', () => {
    it('a click on the row checkbox does not open the status popover', () => {
        const container = document.createElement('div');
        container.id = 'mainList';
        document.body.appendChild(container);
        wireStatusLabelDelegation(container);
        const row = makeRow({ status: 'active', tit: 'Z' }, 'Inbox');
        container.appendChild(row);

        row.querySelector('#checkToDo').click();
        expect(document.getElementById('todoStatusPopover')).toBeNull();
    });

    it('the checkbox still toggles its own checked state after wiring delegation', () => {
        const container = document.createElement('div');
        container.id = 'mainList';
        document.body.appendChild(container);
        wireStatusLabelDelegation(container);
        const row = makeRow({ status: 'active', tit: 'Z' }, 'Inbox');
        container.appendChild(row);

        const check = row.querySelector('#checkToDo');
        expect(check.checked).toBe(false);
        check.click();
        expect(check.checked).toBe(true);
    });
});


describe('buildToDoRow integration is wired (source-level — row builder is not loadable here)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const toDoRow = readFileSync(resolve(here, '../src/toDoRow.js'), 'utf8');

    it('imports the status helpers from todoStatus.js', () => {
        expect(toDoRow).toMatch(
            /import\s*\{[^}]*buildStatusLabel[^}]*applyTodoStatusClass[^}]*\}\s*from\s*'\.\/todoStatus\.js'/
        );
    });

    it('inserts the badge + applies the class only for committed rows (guarded by item.tit)', () => {
        // The build-path insert is guarded by `if (item.tit)` so blank
        // placeholder rows never get a badge. The badge's review flag now comes
        // from the single derived phase (`phase === PHASE.ACCEPT`) so a
        // shipped-but-unacknowledged entry renders REVIEW — the same phase that
        // drives the glyph, so the two can never disagree.
        expect(toDoRow).toMatch(
            /if\s*\(\s*item\.tit\s*\)\s*\{\s*applyTodoStatusClass\(toDoChild,\s*item\.status\);\s*toDoChild\.insertBefore\(buildStatusLabel\(item,\s*phase\s*===\s*PHASE\.ACCEPT\),\s*descIndicator\);/
        );
    });
});


describe('(e) cross-label popover swap in a single click', () => {
    // Regression: clicking label B while label A's popover is open must tear
    // down A's popover AND mount B's in the same click — no second click. The
    // bug was the delegated handler toggling on the presence of ANY popover
    // (so it hid A's and mounted nothing) instead of on whether THIS label
    // owns the open popover.
    function setupTwoRows() {
        const container = document.createElement('div');
        container.id = 'mainList';
        document.body.appendChild(container);
        wireStatusLabelDelegation(container);

        const itemA = { status: 'active', tit: 'Row A' };
        const itemB = { status: 'idea', tit: 'Row B' };
        const rowA = makeRow(itemA, 'Inbox');
        const rowB = makeRow(itemB, 'Inbox');
        container.appendChild(rowA);
        container.appendChild(rowB);
        return {
            labelA: rowA.querySelector('.todoStatusLabel'),
            labelB: rowB.querySelector('.todoStatusLabel'),
            itemA, itemB,
        };
    }

    it('clicking a different label swaps the popover to it without a second click', () => {
        const { labelA, labelB } = setupTwoRows();

        labelA.click();
        expect(document.getElementById('todoStatusPopover')).not.toBeNull();

        labelB.click();
        // Exactly one popover mounted, and it belongs to B.
        expect(document.querySelectorAll('#todoStatusPopover').length).toBe(1);
        const expanded = document.querySelectorAll('.todoStatusLabel[aria-expanded="true"]');
        expect(expanded.length).toBe(1);
        expect(expanded[0]).toBe(labelB);
        expect(labelA.getAttribute('aria-expanded')).toBe('false');
    });

    it('the swapped-in popover reflects the newly-clicked row\'s status', () => {
        const { labelA, labelB } = setupTwoRows();

        labelA.click();
        labelB.click();
        // B's item is an idea, so the idea option is the selected one — proves
        // the popover was rebuilt for B's item, not left as A's.
        const popover = document.getElementById('todoStatusPopover');
        const selected = popover.querySelector('.todoStatusOption.selected');
        expect(selected.getAttribute('data-status')).toBe('idea');
    });

    it('clicking the same label twice still toggles closed (not a swap)', () => {
        const { labelA } = setupTwoRows();

        labelA.click();
        expect(document.getElementById('todoStatusPopover')).not.toBeNull();
        labelA.click();
        expect(document.getElementById('todoStatusPopover')).toBeNull();
        expect(labelA.getAttribute('aria-expanded')).toBe('false');
    });

    it('the first click on a fresh page still opens the popover', () => {
        const { labelA } = setupTwoRows();

        // No popover anywhere; the new aria-expanded check must not mistake the
        // absence of an expanded label for "this label is already expanded."
        expect(document.getElementById('todoStatusPopover')).toBeNull();
        labelA.click();
        expect(document.getElementById('todoStatusPopover')).not.toBeNull();
        expect(labelA.getAttribute('aria-expanded')).toBe('true');
    });

    it('Inbox parity: a cross-row swap in #inboxView behaves identically', () => {
        const container = document.createElement('div');
        container.id = 'inboxView';
        document.body.appendChild(container);
        wireStatusLabelDelegation(container);

        const rowA = makeRow({ status: 'active', tit: 'IA' }, 'Inbox');
        const rowB = makeRow({ status: 'in_progress', tit: 'IB' }, 'Inbox');
        container.appendChild(rowA);
        container.appendChild(rowB);
        const labelA = rowA.querySelector('.todoStatusLabel');
        const labelB = rowB.querySelector('.todoStatusLabel');

        labelA.click();
        labelB.click();
        expect(document.querySelectorAll('#todoStatusPopover').length).toBe(1);
        const expanded = document.querySelectorAll('.todoStatusLabel[aria-expanded="true"]');
        expect(expanded.length).toBe(1);
        expect(expanded[0]).toBe(labelB);
    });
});


describe('(h) derived REVIEW badge — shipped-but-unacknowledged overlay', () => {
    // Build a committed row whose label is already in the review state, mirroring
    // what buildToDoRow does when needsEntryReview(item) is true.
    function makeReviewRow(item, projectName) {
        const row = document.createElement('div');
        row.id = 'toDoChild';
        row.__item = item;
        row.setAttribute('data-value', projectName || 'Inbox');
        applyTodoStatusClass(row, item.status);
        row.appendChild(buildStatusLabel(item, true));
        return row;
    }

    it('REVIEW is a display-only state — absent from STATUS_META, STATUS_ORDER, and the popover', () => {
        expect(REVIEW_LABEL).toBe('⌁ REVIEW');
        expect(STATUS_META.review).toBeUndefined();
        expect(STATUS_ORDER).toEqual(['active', 'in_progress', 'idea']);
        expect(STATUS_ORDER).not.toContain('review');
    });

    it('buildStatusLabel(item, true) renders the REVIEW overlay regardless of stored status', () => {
        const label = buildStatusLabel({ status: 'in_progress', tit: 'X' }, true);
        expect(label.getAttribute('data-status')).toBe('review');
        expect(label.textContent).toBe('⌁ REVIEW');
        // Acknowledge-not-open ARIA: no menu semantics in the review state.
        expect(label.hasAttribute('aria-haspopup')).toBe(false);
        expect(label.getAttribute('aria-label')).toBe('Acknowledge shipped task');
    });

    it('buildStatusLabel(item, false) renders the manual status with menu ARIA', () => {
        const label = buildStatusLabel({ status: 'idea', tit: 'X' }, false);
        expect(label.getAttribute('data-status')).toBe('idea');
        expect(label.textContent).toBe('○ IDEA');
        expect(label.getAttribute('aria-haspopup')).toBe('menu');
        expect(label.getAttribute('aria-label')).toBe('Change task status');
    });

    it('the review overlay never drives the row modifier class — that keys off the manual status', () => {
        const item = { status: 'idea', tit: 'X' };
        const row = makeReviewRow(item, 'Inbox');
        // Badge is REVIEW…
        expect(row.querySelector('.todoStatusLabel').getAttribute('data-status')).toBe('review');
        // …but the row's stripe/muting class tracks the manual status (idea).
        expect(row.classList.contains('todo-row--idea')).toBe(true);
        expect(row.classList.contains('todo-row--review')).toBe(false);
    });

    it('tapping a REVIEW badge invokes the registered open handler with the entry id + project and opens no popover', () => {
        const ackSpy = vi.spyOn(listLogic, 'markEntryReviewed').mockImplementation(() => ({ ok: true }));
        const openSpy = vi.fn();
        setReviewBadgeTapHandler(openSpy);
        const item = { id: 'todo-42', entryId: 'entry-abc', status: 'active', tit: 'Shipped thing' };
        const container = document.createElement('div');
        container.id = 'mainList';
        document.body.appendChild(container);
        wireStatusLabelDelegation(container);
        const row = makeReviewRow(item, 'Work');
        container.appendChild(row);

        row.querySelector('.todoStatusLabel').click();

        expect(openSpy).toHaveBeenCalledTimes(1);
        expect(openSpy).toHaveBeenCalledWith('entry-abc', 'Work');
        // Acknowledging no longer happens from the row — it lives in the viewer.
        expect(ackSpy).not.toHaveBeenCalled();
        // No popover on a review tap.
        expect(document.getElementById('todoStatusPopover')).toBeNull();
        setReviewBadgeTapHandler(null);
    });

    it('a REVIEW badge tap does not stamp entryReviewedAt from the row — the badge stays in review', () => {
        setReviewBadgeTapHandler(() => {});
        const item = { id: 'todo-7', entryId: 'entry-7', status: 'in_progress', tit: 'Shipped thing' };
        const container = document.createElement('div');
        container.id = 'mainList';
        document.body.appendChild(container);
        wireStatusLabelDelegation(container);
        const row = makeReviewRow(item, 'Work');
        container.appendChild(row);

        row.querySelector('.todoStatusLabel').click();

        // No stamp on tap — the badge clears only once acknowledged from the
        // viewer (via TODO_RUN_STATUS_EVENT), so it stays in the review state.
        expect(item.entryReviewedAt).toBeUndefined();
        const label = row.querySelector('.todoStatusLabel');
        expect(label.getAttribute('data-status')).toBe('review');
        expect(label.textContent).toBe('⌁ REVIEW');
        setReviewBadgeTapHandler(null);
    });

    it('a REVIEW badge tap with no registered handler is a safe no-op (no throw, no popover)', () => {
        setReviewBadgeTapHandler(null);
        const item = { id: 'todo-8', entryId: 'entry-8', status: 'active', tit: 'Shipped thing' };
        const container = document.createElement('div');
        container.id = 'mainList';
        document.body.appendChild(container);
        wireStatusLabelDelegation(container);
        const row = makeReviewRow(item, 'Work');
        container.appendChild(row);

        expect(() => row.querySelector('.todoStatusLabel').click()).not.toThrow();
        expect(document.getElementById('todoStatusPopover')).toBeNull();
    });

    it('a non-review badge tap still opens the popover (review path does not intercept it)', () => {
        const item = { id: 'todo-9', status: 'active', tit: 'Normal' };
        const ackSpy = vi.spyOn(listLogic, 'markEntryReviewed').mockImplementation(() => ({ ok: true }));
        const container = document.createElement('div');
        container.id = 'mainList';
        document.body.appendChild(container);
        wireStatusLabelDelegation(container);
        const row = makeRow(item, 'Work'); // manual-status badge, not review
        container.appendChild(row);

        row.querySelector('.todoStatusLabel').click();

        expect(ackSpy).not.toHaveBeenCalled();
        expect(document.getElementById('todoStatusPopover')).not.toBeNull();
    });

    it('refreshTodoStatusUI(row, item, true) overlays REVIEW; (…, false) restores the manual status', () => {
        const item = { status: 'idea', tit: 'X' };
        const row = makeRow(item, 'Inbox');
        document.body.appendChild(row);

        refreshTodoStatusUI(row, item, true);
        let label = row.querySelector('.todoStatusLabel');
        expect(label.getAttribute('data-status')).toBe('review');
        expect(label.textContent).toBe('⌁ REVIEW');
        // Row class still tracks the manual status even under the overlay.
        expect(row.classList.contains('todo-row--idea')).toBe(true);

        refreshTodoStatusUI(row, item, false);
        label = row.querySelector('.todoStatusLabel');
        expect(label.getAttribute('data-status')).toBe('idea');
        expect(label.textContent).toBe('○ IDEA');
    });
});


describe('(i) listLogic.markEntryReviewed stamps the acknowledgement without touching status', () => {
    beforeEach(() => {
        try { localStorage.clear(); } catch (e) { /* ignore */ }
        listLogic._reset();
        listLogic.addProject('Proj');
        listLogic.addToDo('Proj', 'Shipped task');
    });

    it('stamps entryReviewedAt on the matching todo and leaves the manual status alone', () => {
        const item = listLogic.listItems('Proj').find((i) => i.tit === 'Shipped task');
        item.status = 'in_progress';
        expect(item.entryReviewedAt).toBeUndefined();

        const res = listLogic.markEntryReviewed(item.id);

        expect(res.ok).toBe(true);
        expect(typeof item.entryReviewedAt).toBe('string');
        expect(Number.isNaN(Date.parse(item.entryReviewedAt))).toBe(false);
        // The acknowledgement must never rewrite the settable status field.
        expect(item.status).toBe('in_progress');
    });

    it('is a no-op for a missing id or an unknown todo', () => {
        expect(listLogic.markEntryReviewed().ok).toBe(false);
        expect(listLogic.markEntryReviewed('no-such-id').ok).toBe(false);
    });
});


describe('popover dismissal affordances', () => {
    it('closes on an outside click', () => {
        const item = { status: 'active', tit: 'A' };
        const label = buildStatusLabel(item);
        document.body.appendChild(label);
        showStatusPopover(label, item, 'Inbox', makeRow(item, 'Inbox'));
        expect(document.getElementById('todoStatusPopover')).not.toBeNull();

        document.body.click();
        expect(document.getElementById('todoStatusPopover')).toBeNull();
    });

    it('closes on Escape', () => {
        const item = { status: 'active', tit: 'B' };
        const label = buildStatusLabel(item);
        document.body.appendChild(label);
        showStatusPopover(label, item, 'Inbox', makeRow(item, 'Inbox'));
        expect(document.getElementById('todoStatusPopover')).not.toBeNull();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(document.getElementById('todoStatusPopover')).toBeNull();
    });
});


// ── Regression: the row's click handler must treat the status label as a
// sub-control and skip its input-focus + activate side effects, so the popover
// the delegated #mainList handler mounts on the same click survives. The real
// bug was browser-specific (focus()'s scroll-into-view fired a `scroll` event
// that the popover's own scroll-dismissal listener removed it on). jsdom
// doesn't scroll on focus(), so we make the focus→scroll causality explicit by
// patching focus() to dispatch a scroll — proving that IF the row focused the
// input on a label click, the popover would be torn down. With the fix in
// place focus() is never called for a label click, so the popover persists.
function makeWiredRow(item, projectName) {
    const mainList = document.createElement('div');
    mainList.id = 'mainList';

    const row = document.createElement('div');
    row.id = 'toDoChild';
    row.__item = item;
    row.setAttribute('data-value', projectName || 'Inbox');

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'toDoInput';
    input.value = item.tit || 'a committed task';

    const title = document.createElement('span');
    title.className = 'toDoTitleDisplay';
    title.textContent = input.value;

    applyTodoStatusClass(row, item.status);
    const label = buildStatusLabel(item);

    row.appendChild(input);
    row.appendChild(title);
    row.appendChild(label);
    mainList.appendChild(row);
    document.body.appendChild(mainList);

    wireStatusLabelDelegation(mainList);
    wireToDoRowClick(row, input, null);
    return { mainList, row, input, title, label };
}

// ── Regression: committing a status change in the popover must re-sort the
// row to its new sorted position when the global sort is "Status". The bug was
// the handler calling applyTaskFilter() (counts + visibility only) but never
// reorderToDoDOM(), so the row stayed at its old index until a manual re-sort.
// reorderToDoDOM internally calls applyTaskFilter(), so the counts pass is
// preserved by the switch.
describe('(f) status change in the popover re-sorts the row (sort = Status)', () => {
    // Build a #mainList holding one #toDoChild row per item, each anchored to
    // the SAME item object listLogic owns, so reorderToDoDOM finds existing
    // rows by __item and never needs the (un-loadable here) buildToDoRow path.
    function buildMainListFor(projectName) {
        const mainList = document.createElement('div');
        mainList.id = 'mainList';
        document.body.appendChild(mainList);
        const items = listLogic.listItems(projectName);
        items.forEach(function (item) {
            mainList.appendChild(makeRow(item, projectName));
        });
        wireStatusLabelDelegation(mainList);
        return mainList;
    }

    function rowTitles(mainList) {
        return Array.from(mainList.querySelectorAll('#toDoChild'))
            .map(function (r) { return r.__item.tit; });
    }

    function commitStatus(mainList, item, status) {
        const row = Array.from(mainList.querySelectorAll('#toDoChild'))
            .find(function (r) { return r.__item === item; });
        row.querySelector('.todoStatusLabel').click();
        const popover = document.getElementById('todoStatusPopover');
        popover.querySelector('.todoStatusOption[data-status="' + status + '"]').click();
    }

    beforeEach(() => {
        try { localStorage.clear(); } catch (e) { /* ignore */ }
        listLogic._reset();
        listLogic.addProject('Proj');
        listLogic.addToDo('Proj', 'Active task');
        listLogic.addToDo('Proj', 'Idea task');
        const items = listLogic.listItems('Proj');
        const idea = items.find((i) => i.tit === 'Idea task');
        listLogic.setToDoStatus('Proj', idea, 'idea');
    });

    it('moves an idea row above an active row when changed to in_progress', () => {
        setTaskSort('status');
        const mainList = buildMainListFor('Proj');
        const ideaItem = listLogic.listItems('Proj').find((i) => i.tit === 'Idea task');

        // Before commit: build order — Active precedes Idea.
        expect(rowTitles(mainList)).toEqual(['', 'Active task', 'Idea task']);

        commitStatus(mainList, ideaItem, 'in_progress');

        // in_progress (rank 0) sorts above active (rank 1): the row repositions.
        expect(rowTitles(mainList)).toEqual(['', 'Idea task', 'Active task']);
    });

    it('does NOT reposition the row when sort = None', () => {
        setTaskSort('none');
        const mainList = buildMainListFor('Proj');
        const ideaItem = listLogic.listItems('Proj').find((i) => i.tit === 'Idea task');

        commitStatus(mainList, ideaItem, 'in_progress');

        // sort=none → renderOrderForSort is identity → build order preserved.
        expect(rowTitles(mainList)).toEqual(['', 'Active task', 'Idea task']);
    });

    it('persists the change and closes the popover on commit', () => {
        setTaskSort('status');
        const spy = vi.spyOn(listLogic, 'setToDoStatus');
        const mainList = buildMainListFor('Proj');
        const ideaItem = listLogic.listItems('Proj').find((i) => i.tit === 'Idea task');

        commitStatus(mainList, ideaItem, 'in_progress');

        expect(spy).toHaveBeenCalledWith('Proj', ideaItem, 'in_progress');
        expect(document.getElementById('todoStatusPopover')).toBeNull();
    });
});


describe('(g) popover commit wiring is reorderToDoDOM, not applyTaskFilter', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../src/todoStatus.js'), 'utf8');

    it('imports reorderToDoDOM from toDoRow.js', () => {
        expect(src).toMatch(/import\s*\{\s*reorderToDoDOM\s*\}\s*from\s*'\.\/toDoRow\.js'/);
    });

    it('the popover option handler calls reorderToDoDOM(projectName)', () => {
        expect(src).toMatch(/reorderToDoDOM\(projectName\)/);
    });

    it('no longer imports applyTaskFilter from taskFilter.js (the dead import is removed)', () => {
        expect(src).not.toMatch(/import\s*\{[^}]*applyTaskFilter[^}]*\}\s*from\s*'\.\/taskFilter\.js'/);
    });

    it('no longer invokes applyTaskFilter() directly (reorderToDoDOM runs it internally)', () => {
        expect(src).not.toMatch(/[^.\w]applyTaskFilter\s*\(/);
    });
});


describe('status label click is excluded from the row activate/focus path', () => {
    ['active', 'in_progress', 'idea'].forEach((status) => {
        it(`clicking a ${status} row's status label mounts the popover and keeps it mounted`, async () => {
            const { input, label } = makeWiredRow({ status, tit: 'T' }, 'Inbox');
            // Simulate the browser's focus-into-view scroll. It fires AFTER the
            // current task (deferred to a frame), matching the real ordering in
            // which the involuntary scroll lands once the popover is already
            // mounted and its scroll-dismissal listener is live.
            input.focus = () => requestAnimationFrame(
                () => window.dispatchEvent(new Event('scroll')),
            );

            label.click();
            expect(document.getElementById('todoStatusPopover')).not.toBeNull();

            await Promise.resolve();
            expect(document.getElementById('todoStatusPopover')).not.toBeNull();
            await new Promise((r) => requestAnimationFrame(r));
            await new Promise((r) => requestAnimationFrame(r));
            expect(document.getElementById('todoStatusPopover')).not.toBeNull();
        });
    });

    it('clicking the status label does not focus the input or activate the row', () => {
        const { row, input, label } = makeWiredRow({ status: 'active', tit: 'T' }, 'Inbox');
        const focusSpy = vi.spyOn(input, 'focus');

        label.click();

        expect(focusSpy).not.toHaveBeenCalled();
        expect(document.activeElement).not.toBe(input);
        expect(row.classList.contains('todo-active')).toBe(false);
    });

    it('clicking the row title still focuses the input and activates the row', () => {
        const { row, input, title } = makeWiredRow({ status: 'active', tit: 'T' }, 'Inbox');
        const focusSpy = vi.spyOn(input, 'focus');

        title.click();

        expect(focusSpy).toHaveBeenCalled();
        expect(row.classList.contains('todo-active')).toBe(true);
    });

    it('a genuine user scroll after a label-mounted popover still dismisses it', () => {
        const { label } = makeWiredRow({ status: 'active', tit: 'T' }, 'Inbox');

        label.click();
        expect(document.getElementById('todoStatusPopover')).not.toBeNull();

        window.dispatchEvent(new Event('scroll'));
        expect(document.getElementById('todoStatusPopover')).toBeNull();
    });

    it('the row click handler early-returns on a status-label target before focusing the input', () => {
        const src = readFileSync(
            resolve(dirname(fileURLToPath(import.meta.url)), '../src/toDoRow.js'),
            'utf8',
        );
        const body = src.slice(src.indexOf('function wireToDoRowClick'));
        const guardIdx = body.indexOf(".closest('.todoStatusLabel')");
        const focusIdx = body.indexOf('toDoInput.focus()');
        expect(guardIdx).toBeGreaterThan(-1);
        expect(focusIdx).toBeGreaterThan(-1);
        expect(guardIdx).toBeLessThan(focusIdx);
    });
});
