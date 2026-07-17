// Task-sort surface controller extracted from main.js (a behaviour-preserving
// move). Owns the five sort functions — syncTaskSortButton, the desktop
// dropdown (show/hideTaskSortMenu) and the mobile bottom sheet
// (show/hideTaskSortSheet) — plus the two private wireDismissable handles they
// share (taskSortDismiss / taskSortSheetDismiss). Everything else in the sort
// cluster stays in main.js: the DOM triggers, TASK_SORT_OPTIONS, the sort
// get/set/label helpers, the shared dismiss wiring, activeSortTrigger, and the
// two callbacks that reach back into this cluster (applyTaskSortChoice,
// onTaskSortOutsideClick). Those all arrive as factory deps, so the moved
// function bodies are identical to the inline originals.
export function createTaskSort({
    getTaskSort,
    taskSortButtonText,
    taskSortBtnLabel,
    taskSortBtn,
    mobileSortBtn,
    TASK_SORT_OPTIONS,
    wireDismissable,
    activeSortTrigger,
    applyTaskSortChoice,
    onTaskSortOutsideClick,
}) {
    function syncTaskSortButton() {
        const key = getTaskSort();
        const text = taskSortButtonText(key);
        taskSortBtnLabel.textContent = text;
        taskSortBtn.setAttribute('data-sort', key);
        // Mobile trigger: drive its data-sort (CSS tints the icon-only glyph
        // accent purple when a sort other than None is active) and keep its
        // aria-label current — the glyph itself is aria-hidden, so the label
        // names the control + sort.
        mobileSortBtn.setAttribute('data-sort', key);
        mobileSortBtn.setAttribute('aria-label', text);
    }

    // Holds the wireDismissable handle for the open dropdown so hideTaskSortMenu
    // — which the outside-click / resize / scroll / menu-item paths also reach
    // directly — can detach the shared Escape listener. Only Escape restores
    // focus to the trigger (via restoreFocusTo below); the other dismiss paths
    // deliberately leave focus where it is, exactly as before.
    let taskSortDismiss = null;

    function hideTaskSortMenu() {
        const existing = document.getElementById('taskSortMenu');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        taskSortBtn.setAttribute('aria-expanded', 'false');
        mobileSortBtn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onTaskSortOutsideClick, true);
        if (taskSortDismiss) { taskSortDismiss.removeKeydown(); taskSortDismiss = null; }
        window.removeEventListener('resize', hideTaskSortMenu);
        window.removeEventListener('scroll', hideTaskSortMenu, true);
    }

    function showTaskSortMenu() {
        const current = getTaskSort();
        const menu = document.createElement('div');
        menu.id = 'taskSortMenu';
        menu.setAttribute('role', 'menu');
        TASK_SORT_OPTIONS.forEach(function(opt) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'taskSortMenuItem' + (opt.key === current ? ' selected' : '');
            item.setAttribute('role', 'menuitemradio');
            item.setAttribute('aria-checked', opt.key === current ? 'true' : 'false');
            item.setAttribute('data-sort', opt.key);
            const label = document.createElement('span');
            label.className = 'taskSortMenuItemLabel';
            label.textContent = opt.label;
            item.appendChild(label);
            if (opt.subtitle) {
                const sub = document.createElement('span');
                sub.className = 'taskSortMenuItemSub';
                sub.textContent = opt.subtitle;
                item.appendChild(sub);
            }
            item.addEventListener('click', function() {
                hideTaskSortMenu();
                applyTaskSortChoice(opt.key);
            });
            menu.appendChild(item);
        });
        document.body.appendChild(menu);

        // Anchor beneath whichever trigger is on-screen (desktop overlay or the
        // mobile filter-row button), right-aligned, clamped to the viewport —
        // mirrors the settings menu's positioning.
        const rect = activeSortTrigger().getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        let top = rect.bottom + 4;
        let left = rect.right - menuRect.width;
        if (left < 4) left = 4;
        if (top + menuRect.height > window.innerHeight) {
            top = Math.max(4, window.innerHeight - menuRect.height - 4);
        }
        menu.style.top = top + 'px';
        menu.style.left = left + 'px';

        taskSortBtn.setAttribute('aria-expanded', 'true');
        mobileSortBtn.setAttribute('aria-expanded', 'true');
        document.addEventListener('click', onTaskSortOutsideClick, true);
        taskSortDismiss = wireDismissable({
            onClose: hideTaskSortMenu,
            restoreFocusTo: activeSortTrigger,
        });
        window.addEventListener('resize', hideTaskSortMenu);
        window.addEventListener('scroll', hideTaskSortMenu, true);
    }

    // ── Mobile Sort bottom sheet ──
    // On mobile the Sort trigger opens a slide-up bottom sheet (not the desktop
    // dropdown): three chips — None / Due date / Status — with the active choice
    // purple-filled. It shares the same TASK_SORT_OPTIONS / getTaskSort /
    // applyTaskSortChoice machinery as the desktop dropdown, so both surfaces
    // drive one persisted sort state. Three-affordance close per CLAUDE.md — X
    // button, backdrop tap, Escape — reusing the .completedMobileSheet* chrome.
    let taskSortSheetDismiss = null;

    function hideTaskSortSheet() {
        const backdrop = document.getElementById('taskSortSheetBackdrop');
        if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        mobileSortBtn.setAttribute('aria-expanded', 'false');
        if (taskSortSheetDismiss) {
            taskSortSheetDismiss.removeKeydown();
            taskSortSheetDismiss = null;
        }
        try { mobileSortBtn.focus(); } catch (_) { /* defensive */ }
    }

    function showTaskSortSheet() {
        const current = getTaskSort();

        const backdrop = document.createElement('div');
        backdrop.id = 'taskSortSheetBackdrop';

        const sheet = document.createElement('div');
        sheet.id = 'taskSortSheet';
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-modal', 'true');
        sheet.setAttribute('aria-labelledby', 'taskSortSheetTitle');

        const handle = document.createElement('span');
        handle.className = 'completedMobileSheetHandle';
        handle.setAttribute('aria-hidden', 'true');

        const headerEl = document.createElement('div');
        headerEl.className = 'completedMobileSheetHeader';
        const title = document.createElement('div');
        title.id = 'taskSortSheetTitle';
        title.className = 'completedMobileSheetTitle';
        title.textContent = 'Sort by';
        const closeX = document.createElement('button');
        closeX.type = 'button';
        closeX.className = 'completedMobileSheetClose';
        closeX.setAttribute('aria-label', 'Close sort menu');
        closeX.textContent = '×';
        headerEl.appendChild(title);
        headerEl.appendChild(closeX);

        const body = document.createElement('div');
        body.className = 'completedMobileSheetBody';
        const chips = document.createElement('div');
        chips.className = 'taskSortSheetChips';
        TASK_SORT_OPTIONS.forEach(function(opt) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'taskSortSheetChip' + (opt.key === current ? ' selected' : '');
            chip.setAttribute('role', 'menuitemradio');
            chip.setAttribute('aria-checked', opt.key === current ? 'true' : 'false');
            chip.setAttribute('data-sort', opt.key);
            const label = document.createElement('span');
            label.className = 'taskSortSheetChipLabel';
            label.textContent = opt.label;
            chip.appendChild(label);
            if (opt.subtitle) {
                const sub = document.createElement('span');
                sub.className = 'taskSortSheetChipSub';
                sub.textContent = opt.subtitle;
                chip.appendChild(sub);
            }
            chip.addEventListener('click', function() {
                hideTaskSortSheet();
                applyTaskSortChoice(opt.key);
            });
            chips.appendChild(chip);
        });
        body.appendChild(chips);

        sheet.appendChild(handle);
        sheet.appendChild(headerEl);
        sheet.appendChild(body);
        backdrop.appendChild(sheet);
        document.body.appendChild(backdrop);

        // Three-way close (X / backdrop / Escape) plus mobileSortBtn focus
        // restore, wired through the shared helper. Focus restoration stays in
        // hideTaskSortSheet so the chip-select and toggle-close paths — which
        // call it directly, not through the helper — also restore focus.
        taskSortSheetDismiss = wireDismissable({
            onClose: hideTaskSortSheet,
            closeBtn: closeX,
            backdrop: backdrop,
            preventDefaultOnEscape: true,
        });

        mobileSortBtn.setAttribute('aria-expanded', 'true');
        requestAnimationFrame(function() { backdrop.classList.add('is-open'); });
        try { closeX.focus(); } catch (_) { /* defensive */ }
    }

    return {
        syncTaskSortButton,
        hideTaskSortMenu,
        showTaskSortMenu,
        hideTaskSortSheet,
        showTaskSortSheet,
    };
}
