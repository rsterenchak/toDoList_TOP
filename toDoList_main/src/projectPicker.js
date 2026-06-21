// Desktop project-picker dropdown subsystem (≥1024px), extracted from the
// ~5,900-line component() in main.js as the first component() closure-to-factory
// carve-out. createProjectPicker() receives the DOM nodes component() builds and
// the component() functions the picker calls (injected, never imported back from
// main.js — that would be circular) and returns the picker's public methods.
//
// At desktop widths the slide-in drawer is replaced by an anchored dropdown menu
// that opens directly below the project pill. It reads the SAME project list +
// counts the drawer uses (listLogic), so the two surfaces never drift, and
// routes a row click through the same project-selection path the drawer's rows
// use (navigateToProjectByIndex → #projChild.click()). The drawer stays the
// mobile (<1024px) trigger, untouched. The dropdown element is built in
// component() and passed in; it lives on document.body and is positioned off the
// pill's bounding rect each time it opens.
import { listLogic } from './listLogic.js';
import { syncProjectRowInjectBolt, deleteProjectFlow } from './projectRow.js';

export function createProjectPicker(deps) {
    const {
        projectPickerDropdown,
        mobileProjName,
        mobileProjHeader,
        mobileProjChevron,
        sideMain,
        navigateToProjectByIndex,
        updateFooterCounts,
        applyProjectInitial,
        onCreateProjectNamed,
    } = deps;

    function projectPickerIsOpen() {
        return projectPickerDropdown.classList.contains('open');
    }

    // The single in-progress inline rename editor inside the dropdown (or
    // null). Tracked at picker scope so dismissing the dropdown can cancel a
    // half-finished edit cleanly — no orphan input, no stale commit.
    let activeRowEditor = null;
    function cancelActiveRowEditor() {
        if (activeRowEditor) activeRowEditor.cancel();
    }

    // The single inline "create project" input mounted at the top of the
    // dropdown list (or hidden when closed). Desktop-only: the dropdown's
    // header + button reveals it in place instead of opening the sidebar
    // drawer; the user names the project there and Enter / the confirm +
    // button commits through the injected create flow. Tracked at picker
    // scope so dropdown dismissal (outside click, Escape, resize) can cancel a
    // half-typed name cleanly — no orphan input, no stale value.
    let inlineCreateOpen = false;
    let inlineCreateRow = null;
    let inlineCreateInput = null;

    // Rebuild the dropdown rows from the authoritative project list. Active
    // project gets the purple accent + ✓; zero-count projects get a quieter
    // count color. The header row carries a "+ new project" button on its
    // right that reveals the inline create input mounted just below the header;
    // committing that input routes through the injected onCreateProjectNamed
    // callback, which drives the SAME create-project handler the mobile +
    // button (#projButton) uses — no parallel create path is invented here.
    function buildProjectPickerRows() {
        projectPickerDropdown.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'projectPickerHeader';

        const headerLabel = document.createElement('span');
        headerLabel.className = 'projectPickerHeaderLabel';
        headerLabel.textContent = 'PROJECTS';
        header.appendChild(headerLabel);

        // "+ new project" affordance on the right of the header row. On
        // desktop it reveals the inline create input mounted just below the
        // header (instead of opening the sidebar drawer) so the user names the
        // project in place. The click is stopped from bubbling so it isn't
        // read as an outside-click dismissal.
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'projectPickerAddBtn';
        addBtn.setAttribute('aria-label', 'Add new project');
        addBtn.textContent = '+';
        addBtn.addEventListener('click', function(event) {
            event.stopPropagation();
            toggleInlineCreate();
        });
        header.appendChild(addBtn);

        projectPickerDropdown.appendChild(header);

        // Inline "create project" input row, mounted directly beneath the
        // header and above the project list (hidden until the + button reveals
        // it). Desktop naming happens here so the create flow never has to
        // open the sidebar drawer.
        projectPickerDropdown.appendChild(buildInlineCreateRow());

        const list = document.createElement('div');
        list.className = 'projectPickerList';
        projectPickerDropdown.appendChild(list);

        const projects = (listLogic.listProjectsArray && listLogic.listProjectsArray()) || [];
        const activeName = mobileProjName.textContent || '';

        projects.forEach(function(name, idx) {
            const row = document.createElement('div');
            row.className = 'projectPickerRow';
            row.setAttribute('role', 'menuitem');
            const isActive = name === activeName;
            if (isActive) row.classList.add('active');

            const label = document.createElement('span');
            label.className = 'projectPickerName';
            label.textContent = name;

            const count = listLogic.getProjectIncompleteCount
                ? listLogic.getProjectIncompleteCount(name)
                : 0;
            const countEl = document.createElement('span');
            countEl.className = 'projectPickerCount';
            if (count === 0) countEl.classList.add('zero');
            countEl.textContent = (isActive ? '✓ ' : '') + count;

            row.appendChild(label);
            row.appendChild(countEl);

            // Leading ⚡ when this project has a routed inject target — same
            // per-project gate as the sidebar rows, mounted here so the bolt
            // surfaces inside the dropdown too (rows are rebuilt on each open,
            // so a one-shot sync is enough — no persistent listeners).
            syncProjectRowInjectBolt(row, name);

            row.addEventListener('click', function() {
                // Active row: just dismiss (no project change). Otherwise
                // route through the shared selection path, then dismiss.
                if (!isActive) navigateToProjectByIndex(idx);
                closeProjectPicker();
            });

            // Right-click / long-press → "Delete project…" context menu.
            attachProjectPickerRowContextMenu(row, name);

            list.appendChild(row);
        });
    }

    // Build the inline "create project" row that sits between the header and
    // the project list. Hidden by default (no `.open`); the header + button
    // toggles it. Contains a text input (placeholder "New project name…") and
    // a confirm + button. Enter or the confirm button commit; Escape cancels
    // and clears without closing the dropdown; empty / duplicate names show
    // inline red validation and keep the input open. Commit routes through the
    // injected onCreateProjectNamed — the SAME create+select path the mobile +
    // button drives — so no parallel create path is invented here.
    function buildInlineCreateRow() {
        const row = document.createElement('div');
        row.className = 'projectPickerCreateRow';
        if (inlineCreateOpen) row.classList.add('open');

        // Soft "create card" wrapping the leading + adornment, the borderless
        // input, and the labeled Create button. Purple signals focus via the
        // card's :focus-within (matching the rename input / inject sub-modal)
        // rather than the input wearing an always-on purple border.
        const card = document.createElement('div');
        card.className = 'projectPickerCreateCard';

        const adorn = document.createElement('span');
        adorn.className = 'projectPickerCreateAdorn';
        adorn.setAttribute('aria-hidden', 'true');
        adorn.textContent = '+';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'projectPickerCreateInput';
        input.placeholder = 'New project name…';
        input.setAttribute('aria-label', 'New project name');

        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.className = 'projectPickerCreateConfirm';
        confirm.setAttribute('aria-label', 'Create project');
        confirm.textContent = 'Create';

        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitInlineCreate();
            } else if (e.key === 'Escape') {
                // Cancel only the inline create; keep the dropdown open. The
                // document-level Escape handler in main.js defers to this via
                // the picker's cancelInlineCreate(), so the dropdown's own
                // Escape-to-close never fires while a name is being typed.
                e.preventDefault();
                e.stopPropagation();
                cancelInlineCreate();
            } else {
                input.classList.remove('error');
            }
        });

        confirm.addEventListener('click', function(e) {
            // The row lives inside the dropdown, so this is already an "inside"
            // click; stopPropagation keeps it from racing any outside-click
            // handler and matches the header button's guard.
            e.stopPropagation();
            submitInlineCreate();
        });

        card.appendChild(adorn);
        card.appendChild(input);
        card.appendChild(confirm);
        row.appendChild(card);

        inlineCreateRow = row;
        inlineCreateInput = input;
        return row;
    }

    function toggleInlineCreate() {
        if (inlineCreateOpen) {
            cancelInlineCreate();
        } else {
            openInlineCreate();
        }
    }

    function openInlineCreate() {
        inlineCreateOpen = true;
        if (inlineCreateRow) inlineCreateRow.classList.add('open');
        if (inlineCreateInput) {
            inlineCreateInput.classList.remove('error');
            inlineCreateInput.focus();
        }
    }

    // Cancel + clear the inline create input without closing the dropdown.
    // Returns true when an inline create input was actually open (so the
    // shared Escape handler in main.js can give it priority over the
    // dropdown's Escape-to-close), false when there was nothing to cancel.
    function cancelInlineCreate() {
        if (!inlineCreateOpen) return false;
        inlineCreateOpen = false;
        if (inlineCreateInput) {
            inlineCreateInput.value = '';
            inlineCreateInput.classList.remove('error');
        }
        if (inlineCreateRow) inlineCreateRow.classList.remove('open');
        return true;
    }

    // Inline error treatment (empty / duplicate name) — red border, keep the
    // input open and re-selected so the user can correct it. Mirrors the
    // rename editor's rejectAndStayOpen.
    function rejectInlineCreate() {
        if (!inlineCreateInput) return;
        inlineCreateInput.classList.add('error');
        inlineCreateInput.focus();
        if (typeof inlineCreateInput.select === 'function') inlineCreateInput.select();
    }

    function submitInlineCreate() {
        if (!inlineCreateInput) return;
        const trimmed = inlineCreateInput.value.trim();
        // Reject empty / whitespace-only — keep the input open + red.
        if (trimmed.length === 0) { rejectInlineCreate(); return; }
        // Reject duplicates (mirror the rename collision guard).
        const names = (listLogic.listProjectsArray && listLogic.listProjectsArray()) || [];
        if (names.indexOf(trimmed) !== -1) { rejectInlineCreate(); return; }

        // Commit through the injected create flow (mobile + button parity):
        // it builds the backing #projChild row, makes the new project the
        // active selection, and renders its todos. Mark the inline input
        // closed first so the rebuild below renders it hidden + cleared, then
        // repaint the badges + active pill name and rebuild the dropdown rows
        // so the freshly-created project shows as the active row.
        inlineCreateOpen = false;
        if (typeof onCreateProjectNamed === 'function') onCreateProjectNamed(trimmed);
        updateFooterCounts();
        buildProjectPickerRows();
    }

    // Swap a dropdown row in place into a focused text input pre-populated
    // with the project's current name (select-all'd so a single keypress
    // replaces). Mirrors the sidebar's #projInput edit behavior, scoped to the
    // dropdown's own row geometry. Enter / blur commit through the same
    // listLogic rename mutation the sidebar's #projInput commit uses; Escape
    // (and dropdown dismissal) cancels and restores the row.
    function enterRowEditMode(row, projectName) {
        if (row.classList.contains('editing')) return;
        // Only one inline editor at a time — settle any other first.
        cancelActiveRowEditor();

        const nameEl  = row.querySelector('.projectPickerName');
        const countEl = row.querySelector('.projectPickerCount');

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'projectPickerRenameInput';
        input.value = projectName;
        input.setAttribute('aria-label', 'Rename project');

        row.classList.add('editing');
        if (nameEl)  nameEl.style.display  = 'none';
        if (countEl) countEl.style.display = 'none';
        row.appendChild(input);

        input.focus();
        if (typeof input.select === 'function') input.select();

        let settled = false;

        const api = { cancel: cancel };
        activeRowEditor = api;

        function teardown() {
            if (input.parentNode) input.parentNode.removeChild(input);
            if (nameEl)  nameEl.style.display  = '';
            if (countEl) countEl.style.display = '';
            row.classList.remove('editing');
            if (activeRowEditor === api) activeRowEditor = null;
        }

        function cancel() {
            if (settled) return;
            settled = true;
            teardown();
        }

        // Inline error treatment matching the sidebar's #projInput reject
        // path (red) — keep the editor open so the user can correct it.
        function rejectAndStayOpen() {
            input.classList.add('error');
            input.focus();
            if (typeof input.select === 'function') input.select();
        }

        function commit() {
            if (settled) return;
            const trimmed = input.value.trim();
            // Unchanged value (incl. a no-edit blur): revert cleanly, no write.
            if (trimmed === projectName) { cancel(); return; }
            // Reject empty / whitespace-only.
            if (trimmed.length === 0) { rejectAndStayOpen(); return; }
            // Reject duplicates (mirror the sidebar's name-collision guard).
            const names = (listLogic.listProjectsArray && listLogic.listProjectsArray()) || [];
            if (names.indexOf(trimmed) !== -1) { rejectAndStayOpen(); return; }

            // Commit through the SAME listLogic mutation the sidebar's
            // #projInput commit uses — one rename mutation site, no parallel
            // writer.
            const originalIdx = names.indexOf(projectName);
            listLogic.editProject(projectName, trimmed);
            // editProject appends the renamed key to the end of the project
            // order; restore its original slot so the row keeps its sort
            // position and every row's index closure stays valid.
            const movedIdx = listLogic.listProjectsArray().indexOf(trimmed);
            if (originalIdx !== -1 && movedIdx !== -1 && movedIdx !== originalIdx) {
                listLogic.reorderProject(movedIdx, originalIdx);
            }
            // Keep the backing drawer row (#projChild) in sync so the sidebar
            // surface and every name-keyed lookup agree with the new name.
            const projChild = findProjChildByName(projectName);
            if (projChild) {
                const backingInput = projChild.querySelector('#projInput');
                if (backingInput) backingInput.value = trimmed;
                applyProjectInitial(projChild, trimmed);
            }
            settled = true;
            teardown();
            // Repaint: badges + the active pill name (when the renamed project
            // is active), then rebuild the dropdown rows. The dropdown stays
            // open and the row sits at its restored sort position, now with the
            // new name and a fresh, correct index closure.
            updateFooterCounts();
            buildProjectPickerRows();
        }

        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                commit();
            } else if (e.key === 'Escape') {
                // Cancel only the edit; keep the dropdown open (don't let the
                // dropdown's own Escape handler also fire).
                e.preventDefault();
                e.stopPropagation();
                cancel();
            } else {
                input.classList.remove('error');
            }
        });

        input.addEventListener('blur', function() {
            // Defer so a dropdown dismissal (outside click → closeProjectPicker
            // → cancelActiveRowEditor) settles as a cancel before this would
            // commit. A blur that stays inside the still-open dropdown commits.
            setTimeout(function() {
                if (settled) return;
                commit();
            }, 0);
        });
    }

    function positionProjectPicker() {
        const rect = mobileProjHeader.getBoundingClientRect();
        const top = rect.bottom + window.scrollY + 4;
        const left = rect.left + window.scrollX;
        projectPickerDropdown.style.top = top + 'px';
        projectPickerDropdown.style.left = left + 'px';
    }

    function openProjectPicker() {
        buildProjectPickerRows();
        positionProjectPicker();
        projectPickerDropdown.classList.add('open');
        projectPickerDropdown.setAttribute('aria-hidden', 'false');
        mobileProjHeader.classList.add('picker-open');
        mobileProjChevron.textContent = '▴';
    }

    function closeProjectPicker() {
        // Dismissing the dropdown cancels any in-progress inline rename or
        // inline create so a half-finished edit never strands an orphan input
        // or commits a stale value.
        cancelActiveRowEditor();
        cancelInlineCreate();
        projectPickerDropdown.classList.remove('open');
        projectPickerDropdown.setAttribute('aria-hidden', 'true');
        mobileProjHeader.classList.remove('picker-open');
        mobileProjChevron.textContent = '▾';
        // The delete context menu is portaled onto document.body, so it can
        // outlive the dropdown that spawned it. Tear it down whenever the
        // dropdown closes (outside click, Escape, resize to mobile) so a
        // portaled child never strands without its conceptual parent.
        hideProjectRowContextMenu();
    }

    function toggleProjectPicker() {
        projectPickerIsOpen() ? closeProjectPicker() : openProjectPicker();
    }

    // ── desktop project-row context menu (Rename / Delete project…) ──
    // The desktop dropdown rows mirror the drawer's right-click / long-press
    // menu for the two project actions — Rename and Delete (the inline color
    // picker stays on the drawer's #projContextMenu, reserved for a follow-up
    // here). The delete flow reuses the drawer's tested deleteProjectFlow — same
    // confirmation copy (project name + exact todo count, count clause dropped
    // when zero), the same cascade delete through listLogic.removeProject, and
    // the same active-project fallback to the first remaining project or the
    // empty state — by resolving the dropdown row back to its backing
    // #projChild row.
    let projRowContextMenu = null;

    function onProjRowCtxOutsideClick(e) {
        if (projRowContextMenu && projRowContextMenu.contains(e.target)) return;
        hideProjectRowContextMenu();
    }
    function onProjRowCtxOutsideCtx(e) {
        if (projRowContextMenu && projRowContextMenu.contains(e.target)) return;
        hideProjectRowContextMenu();
    }
    function onProjRowCtxKeydown(e) {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        hideProjectRowContextMenu();
    }

    function hideProjectRowContextMenu() {
        if (projRowContextMenu && projRowContextMenu.parentNode) {
            projRowContextMenu.parentNode.removeChild(projRowContextMenu);
        }
        projRowContextMenu = null;
        document.removeEventListener('click', onProjRowCtxOutsideClick, true);
        document.removeEventListener('contextmenu', onProjRowCtxOutsideCtx, true);
        document.removeEventListener('keydown', onProjRowCtxKeydown, true);
        window.removeEventListener('resize', hideProjectRowContextMenu);
        window.removeEventListener('scroll', hideProjectRowContextMenu, true);
    }

    // Resolve a project name to its backing drawer row (#projChild). The
    // desktop dropdown is a thin view over the same listLogic order the drawer
    // renders, so every dropdown row has a 1:1 #projChild behind it;
    // deleteProjectFlow operates on that row for its DOM teardown + fallback.
    function findProjChildByName(name) {
        const rows = sideMain.querySelectorAll('#projChild');
        for (let i = 0; i < rows.length; i++) {
            const inp = rows[i].querySelector('#projInput');
            if (inp && inp.value.trim() === name) return rows[i];
        }
        return null;
    }

    function showProjectRowContextMenu(x, y, projectName, row) {
        hideProjectRowContextMenu();

        const menu = document.createElement('div');
        menu.id = 'projRowContextMenu';
        menu.setAttribute('role', 'menu');

        // Rename sits above Delete (no separator — the color picker that would
        // normally sit between them stays gated for a follow-up). It edits the
        // dropdown's own row in place: the row swaps into a focused text input,
        // and commits through the same listLogic rename mutation the sidebar's
        // #projInput commit uses, so the two surfaces produce identical results.
        // The dropdown stays open while editing.
        const rename = document.createElement('div');
        rename.className = 'projContextMenuItem';
        rename.setAttribute('role', 'menuitem');
        rename.tabIndex = 0;
        rename.textContent = 'Rename';
        rename.addEventListener('click', function(event) {
            // The menu is portaled to document.body, so this item is NOT a DOM
            // descendant of #projectPickerDropdown. Without stopping propagation,
            // the click bubbles to the dropdown's document-level outside-click
            // handler, which reads it as "outside," closes the picker, and tears
            // down the inline editor enterRowEditMode just mounted.
            event.stopPropagation();
            hideProjectRowContextMenu();
            if (row) enterRowEditMode(row, projectName);
        });
        menu.appendChild(rename);

        const del = document.createElement('div');
        del.className = 'projContextMenuItem danger';
        del.setAttribute('role', 'menuitem');
        del.tabIndex = 0;
        del.textContent = 'Delete project…';
        del.addEventListener('click', function(event) {
            // Symmetric with Rename: clicks on a context-menu item belong to the
            // menu, not to "outside the dropdown." stopPropagation keeps the
            // dropdown's outside-click handler from also firing on this click.
            event.stopPropagation();
            hideProjectRowContextMenu();
            closeProjectPicker();
            const projChild = findProjChildByName(projectName);
            if (projChild) deleteProjectFlow(projChild, projectName);
        });
        menu.appendChild(del);

        menu.style.position = 'fixed';
        menu.style.left = x + 'px';
        menu.style.top  = y + 'px';
        document.body.appendChild(menu);
        projRowContextMenu = menu;

        // Clamp into the viewport (mirrors #projContextMenu's edge handling).
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = Math.max(0, window.innerWidth - rect.width - 4) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = Math.max(0, window.innerHeight - rect.height - 4) + 'px';
        }

        // Close vocabulary (4 ways): selecting the item (above), clicking
        // outside, pressing Escape, or right-clicking elsewhere. Capture phase
        // so the dismissers always see the event first; resize / scroll also
        // dismiss so the menu can't strand off its anchor.
        document.addEventListener('click', onProjRowCtxOutsideClick, true);
        document.addEventListener('contextmenu', onProjRowCtxOutsideCtx, true);
        document.addEventListener('keydown', onProjRowCtxKeydown, true);
        window.addEventListener('resize', hideProjectRowContextMenu);
        window.addEventListener('scroll', hideProjectRowContextMenu, true);
    }

    // Wire the delete context menu onto a dropdown row: desktop right-click
    // plus a ~500ms touch long-press with a 10px movement-cancel threshold (so
    // a scroll never fires the menu), mirroring projectRow.js's pattern.
    function attachProjectPickerRowContextMenu(row, projectName) {
        row.addEventListener('contextmenu', function(event) {
            event.preventDefault();
            showProjectRowContextMenu(event.clientX, event.clientY, projectName, row);
        });

        let lpTimer  = null;
        let lpStartX = 0;
        let lpStartY = 0;
        let lpFired  = false;

        row.addEventListener('touchstart', function(event) {
            if (event.touches.length !== 1) return;
            const t = event.touches[0];
            lpStartX = t.clientX;
            lpStartY = t.clientY;
            lpFired  = false;
            lpTimer  = setTimeout(function() {
                lpFired = true;
                showProjectRowContextMenu(lpStartX, lpStartY, projectName, row);
            }, 500);
        }, { passive: true });

        row.addEventListener('touchmove', function(event) {
            if (!lpTimer) return;
            const t = event.touches[0];
            if (Math.abs(t.clientX - lpStartX) > 10 || Math.abs(t.clientY - lpStartY) > 10) {
                clearTimeout(lpTimer);
                lpTimer = null;
            }
        }, { passive: true });

        row.addEventListener('touchend', function(event) {
            if (lpTimer) {
                clearTimeout(lpTimer);
                lpTimer = null;
            }
            if (lpFired) {
                // long-press already opened the menu — suppress the tap
                // (project navigation) that would otherwise follow.
                event.preventDefault();
                lpFired = false;
            }
        });

        row.addEventListener('touchcancel', function() {
            if (lpTimer) {
                clearTimeout(lpTimer);
                lpTimer = null;
            }
        });
    }

    // Dismiss the dropdown when the viewport crosses down to mobile widths where
    // the drawer takes over; while it stays at desktop, re-anchor it to the pill.
    window.addEventListener('resize', function() {
        if (!projectPickerIsOpen()) return;
        if (window.innerWidth < 1024) { closeProjectPicker(); return; }
        positionProjectPicker();
    });

    return {
        open: openProjectPicker,
        close: closeProjectPicker,
        toggle: toggleProjectPicker,
        isOpen: projectPickerIsOpen,
        cancelInlineCreate: cancelInlineCreate,
    };
}
