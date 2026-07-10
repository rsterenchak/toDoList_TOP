// Empty-state block + Completed section header for the main todo list.
//
// `updateEmptyState` decides what to show when the active project has no
// open todos: a "no projects yet" prompt with a Create-Project button when
// no projects exist at all, a "no todos yet" hint when the project is
// brand-new, or an "all caught up" message when every todo is completed.
// `updateCompletedSection` injects (or removes) the collapsible
// "Completed (N)" header that partitions completed rows at the bottom of
// the list and keeps it in sync with the persisted open/closed flag.
//
// Both helpers are idempotent — every render path (project switch, drag
// reorder, restoreFromStorage) calls them after touching #mainList, so they
// must rebuild from current DOM rather than diffing prior state.
//
// The completed-section open/closed flag is persisted via prefs.js
// (COMPLETED_SECTION_KEY) — these helpers only read/write through the
// imported getter/setter so the persisted surface stays consolidated there.

import { isCompletedSectionOpen, setCompletedSectionOpen } from './prefs.js';


// Mobile-only ghost spacer that fills the vertical void below the todo rows
// when a project has only a few items. Painted via the .viewGhostSpacer CSS
// rule (purple ghost SVG + caption, dimmed to 50% opacity) which only fires
// inside the @media (max-width: 1023px) block, so on desktop this element is
// inert. Idempotent — every call ensures the spacer exists and is the last
// child of #mainList so subsequent row appends don't leave it stranded mid-
// list. The companion-ghost preference is enforced via the body class set
// in main.js, not by toggling the spacer itself, so flipping the toggle
// doesn't disturb the layout.
function ensureMainListGhostSpacer(mainListDiv) {
    if (!mainListDiv) return;
    let spacer = mainListDiv.querySelector('#projectsGhostSpacer');
    if (!spacer) {
        spacer = document.createElement('div');
        spacer.id = 'projectsGhostSpacer';
        spacer.className = 'viewGhostSpacer';
        spacer.setAttribute('aria-hidden', 'true');
        const mascot = document.createElement('div');
        mascot.className = 'viewGhostMascot';
        const caption = document.createElement('div');
        caption.className = 'viewGhostCaption';
        caption.textContent = "That's all for this project";
        spacer.appendChild(mascot);
        spacer.appendChild(caption);
    }
    if (mainListDiv.lastChild !== spacer) {
        mainListDiv.appendChild(spacer);
    }
    // Every render path that ensures the spacer also re-sizes it, so a project
    // whose list now fills the screen collapses the spacer instead of trailing
    // a fixed slab below the content.
    sizeMainListGhostSpacer(mainListDiv);
}


// Minimum leftover room (px) worth showing a ghost in: the mascot is 112×130
// and the caption sits below it, so anything under ~160px would clip the ghost.
// A gap smaller than this collapses to zero rather than trailing a partial slab
// (and the ghost's eyes) under the content.
const MIN_GHOST_SPACE = 160;


// Count the selected project's committed todo items in #mainList: every
// #toDoChild whose #toDoInput carries a non-blank value. The trailing blank
// placeholder row (empty input) is excluded, matching how updateEmptyState
// decides open/done counts. Completed rows still carry their text, so they
// count as items — a project with only completed todos is not "empty".
function countCommittedTodoItems(mainListDiv) {
    const rows = mainListDiv.querySelectorAll('#toDoChild');
    let count = 0;
    rows.forEach(function (row) {
        const input = row.querySelector('#toDoInput');
        const val = input ? input.value.trim() : '';
        if (val) count++;
    });
    return count;
}


// Mobile-only: size — or collapse — the ghost spacer based on how much vertical
// room the visible task list leaves beneath it. On a project whose rows already
// fill or overflow the #mainList scroll viewport, the spacer collapses to zero
// so no black band trails the content; on a sparse project it expands to
// exactly the leftover height and shows the centered ghost, as before.
//
// The spacer is painted in two layout ranges (see style.css): the ≤1023px
// mobile STACK breakpoint, and the wider layout a large-screen TOUCH device
// falls into (≥1024px with a coarse pointer), where #mainList still renders as
// a single stacked column and the sidebar is an overlay drawer. Run the sizing
// in both so a short list never trails a bare #mainList background band there.
// True desktop (a fine pointer ≥1024px) keeps the spacer display:none via the
// base .viewGhostSpacer rule, and the #mainList.emptyStatePresent override owns
// the empty-state case — bail in both so this never fights CSS or reflows for
// nothing.
export function sizeMainListGhostSpacer(mainListDiv) {
    if (!mainListDiv) return;
    const spacer = mainListDiv.querySelector('#projectsGhostSpacer');
    if (!spacer) return;

    const hasMatchMedia = typeof window !== 'undefined' && window.matchMedia;
    const mobileMq = hasMatchMedia ? window.matchMedia('(max-width: 1023px)') : null;
    const wideTouchMq = hasMatchMedia
        ? window.matchMedia('(min-width: 1024px) and (pointer: coarse)')
        : null;
    const spacerPainted = (mobileMq && mobileMq.matches)
        || (wideTouchMq && wideTouchMq.matches);
    if (!spacerPainted) return;

    if (mainListDiv.classList.contains('emptyStatePresent')) return;

    // Gate the "that's all for this project" ghost strictly on the selected
    // project having zero committed todo items — never on the surrounding
    // layout. The old leftover-height-only heuristic let the ghost expand
    // whenever a project's list was short, which on non-repo projects (no tall
    // TODO.md viewer card to fill the column) surfaced the ghost even when the
    // project still had items. As soon as one or more items exist, collapse the
    // ghost regardless of how much room is left below the list.
    if (countCommittedTodoItems(mainListDiv) > 0) {
        spacer.classList.add('viewGhostSpacer--collapsed');
        spacer.style.height = '';
        return;
    }

    // Exclude the spacer's own height from the measurement so revealing or
    // collapsing it can't feed back into the next reading and flip-flop:
    //   content   = everything in the list except the spacer
    //   remaining = viewport room left beneath that content
    const content = mainListDiv.scrollHeight - spacer.offsetHeight;
    const remaining = mainListDiv.clientHeight - content;

    if (remaining >= MIN_GHOST_SPACE) {
        spacer.classList.remove('viewGhostSpacer--collapsed');
        spacer.style.height = remaining + 'px';
    } else {
        spacer.classList.add('viewGhostSpacer--collapsed');
        spacer.style.height = '';
    }
}


// Re-size the current #mainList spacer on viewport resize / orientation change
// so a rotate or window resize re-evaluates whether the list now fills the
// screen. One-shot guarded so repeated render passes don't stack listeners.
if (typeof window !== 'undefined' && !window.__ghostSpacerResizeBound) {
    window.__ghostSpacerResizeBound = true;
    const reSize = function () {
        const ml = document.getElementById('mainList');
        if (ml) sizeMainListGhostSpacer(ml);
    };
    window.addEventListener('resize', reSize);
    // orientationchange doesn't always emit a resize on every browser, and a
    // rotate can swap which layout range (mobile vs. wide-touch) applies, so
    // re-evaluate explicitly there too.
    window.addEventListener('orientationchange', reSize);
}


// One-time install of a document-wide click handler that re-focuses the
// empty-state Create button after any click on a non-interactive region
// of the page. The empty state's whole UX is "press Enter to create" —
// but a stray click on background chrome (the navbar gutter, sidebar
// surface, an empty mainList area, the body margin around outerContainer,
// floating popover backdrops) drops focus to <body> and silently breaks
// that affordance. Attaching to <body> covers everything inside
// outerContainer plus anything else mounted as a top-level child of body
// (modals, menus, the help FAB region, etc.).
//
// The handler is a no-op when the Create button isn't rendered (any
// non-empty-state screen), so leaving it permanently attached is cheap.
// We skip clicks on real interactive controls so they keep their normal
// focus / open-menu / activate behavior — the goal is to recover from
// "click hit empty space" cases, not to trap focus on the button.
let bodyRefocusInstalled = false;
function ensureBodyCreateBtnRefocus() {
    if (bodyRefocusInstalled) return;
    if (!document.body) return;
    bodyRefocusInstalled = true;
    document.body.addEventListener('click', function(event) {
        const createBtn = document.getElementById('emptyStateCreateBtn');
        if (!createBtn) return;
        if (event.target === createBtn || createBtn.contains(event.target)) return;
        // closest() walks up to find any actual interactive control the
        // click might have been meant for — buttons, inputs, role=button
        // divs (projButton, projChild rail icons), menu items, links.
        // If we hit one, leave focus alone so its handler runs cleanly.
        const interactive = event.target.closest(
            'button, input, textarea, select, a, [role="button"], [role="menuitem"], [contenteditable="true"]'
        );
        if (interactive) return;
        createBtn.focus();
    });
}


// Insert a collapsible "Completed (N)" header before the first completed row
// in mainList, or remove it entirely if no completed rows exist. Applies the
// collapsed class to mainList so CSS can hide the completed rows (and any
// open description panels directly beneath them) while the section is closed.
// Safe to call repeatedly — each invocation rebuilds the header from scratch,
// so it can be called after every render or DOM reorder.
export function updateCompletedSection(mainListDiv) {
    if (!mainListDiv) mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;

    const existing = mainListDiv.querySelector('#completedHeader');
    if (existing) mainListDiv.removeChild(existing);

    const completedRows = mainListDiv.querySelectorAll('#toDoChild.completed');
    if (completedRows.length === 0) {
        mainListDiv.classList.remove('completedCollapsed');
        updateEmptyState(mainListDiv);
        try {
            document.dispatchEvent(new CustomEvent('mainListRendered'));
        } catch (e) { /* defensive */ }
        return;
    }

    const open = isCompletedSectionOpen();
    mainListDiv.classList.toggle('completedCollapsed', !open);

    const header = document.createElement('div');
    header.id = 'completedHeader';
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', open ? 'true' : 'false');

    const caret = document.createElement('span');
    caret.className = 'completedCaret';
    caret.textContent = open ? '▼' : '▶';
    caret.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'completedLabel';
    label.textContent = 'Completed (' + completedRows.length + ')';

    header.appendChild(caret);
    header.appendChild(label);

    function toggle() {
        const nowOpen = !isCompletedSectionOpen();
        setCompletedSectionOpen(nowOpen);
        mainListDiv.classList.toggle('completedCollapsed', !nowOpen);
        caret.textContent = nowOpen ? '▼' : '▶';
        header.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
        // Collapsing/expanding the completed section hides or reveals rows via
        // a class with no DOM mutation or resize, so the content height changes
        // under the spacer. Re-size it here so the void collapses (or the ghost
        // re-expands) to match the new list height instead of leaving a stale
        // band or a stale gap below the content.
        sizeMainListGhostSpacer(mainListDiv);
    }

    header.addEventListener('click', toggle);
    header.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle();
        }
    });

    mainListDiv.insertBefore(header, completedRows[0]);
    updateEmptyState(mainListDiv);
    // Notify downstream consumers that #mainList just finished a render
    // pass. Used by the read-only TODO.md viewer card in main.js to
    // (re)mount itself for the currently selected project's inject target
    // without each render-path caller having to opt in by hand.
    try {
        document.dispatchEvent(new CustomEvent('mainListRendered'));
    } catch (e) { /* defensive */ }
}


// Insert a friendly empty-state block when the selected project has no
// open (uncompleted, committed) todos. Two variants:
//  • done > 0  → "All caught up" celebratory message
//  • done === 0 → "No todos yet" welcome hint
// The block contains a centered input — typing there and pressing Enter
// creates a new todo via the same path as the normal placeholder row.
// Idempotent; safe to call from every render path.
export function updateEmptyState(mainListDiv) {
    if (!mainListDiv) mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;

    // Preserve focus state across idempotent re-renders so the user can keep
    // typing if updateEmptyState fires mid-keystroke (e.g. via the MutationObserver).
    const prior = mainListDiv.querySelector('#emptyState');
    const priorInput = prior ? prior.querySelector('#emptyStateInput') : null;
    const wasFocused = priorInput && document.activeElement === priorInput;
    const priorValue = priorInput ? priorInput.value : '';
    const priorSelStart = priorInput ? priorInput.selectionStart : null;
    const priorSelEnd   = priorInput ? priorInput.selectionEnd   : null;

    if (prior) prior.remove();

    const rows = mainListDiv.querySelectorAll('#toDoChild');

    // Case A — no todo rows at all means no project is selected/exists. The
    // only path to a todo is via a project, so this variant has no input; it
    // simply points the user at the + button in the Projects sidebar.
    if (rows.length === 0) {
        mainListDiv.classList.add('emptyStatePresent');

        const block = document.createElement('div');
        block.id = 'emptyState';
        block.classList.add('emptyStateNoProjects');

        // Purple ghost mascot — visible at the ≤1023px STACK breakpoint via
        // CSS; hidden on desktop where the existing ✦ glyph + title carry
        // the visual weight. Painted via background-image in style.css.
        const mascot = document.createElement('div');
        mascot.className = 'emptyStateMascot emptyStateMascotPurple';
        mascot.setAttribute('aria-hidden', 'true');

        const icon = document.createElement('div');
        icon.className = 'emptyStateIcon';
        icon.textContent = '✦';

        // Two title spans — desktop keeps the existing copy, STACK mobile
        // swaps in the friendlier "Welcome." heading. CSS toggles
        // visibility via display:none so screen readers only see the
        // appropriate one for the current breakpoint.
        const title = document.createElement('div');
        title.className = 'emptyStateTitle';
        const titleDesktop = document.createElement('span');
        titleDesktop.className = 'emptyStateTitleDesktop';
        titleDesktop.textContent = 'No projects yet';
        const titleMobile = document.createElement('span');
        titleMobile.className = 'emptyStateTitleMobile';
        titleMobile.textContent = 'Welcome.';
        title.appendChild(titleDesktop);
        title.appendChild(titleMobile);

        const sub = document.createElement('div');
        sub.className = 'emptyStateSub';
        sub.textContent = 'Create your first project to start tracking todos.';

        const createBtn = document.createElement('button');
        createBtn.id = 'emptyStateCreateBtn';
        createBtn.type = 'button';
        const ctaDesktop = document.createElement('span');
        ctaDesktop.className = 'ctaTextDesktop';
        ctaDesktop.textContent = 'CREATE YOUR FIRST PROJECT';
        const ctaMobile = document.createElement('span');
        ctaMobile.className = 'ctaTextMobile';
        ctaMobile.textContent = '+ New project';
        createBtn.appendChild(ctaDesktop);
        createBtn.appendChild(ctaMobile);
        createBtn.addEventListener('click', function() {
            // The projects sidebar is an overlay drawer translated off-screen
            // at every breakpoint; open it synchronously so the new projInput
            // is in-layout and iOS Safari honors the .focus() call inside this
            // same user-gesture tick. Deferring the focus behind the slide
            // transition drops the keyboard.
            const sideBar = document.getElementById('sideBar');
            const overlay = document.getElementById('sidebarOverlay');
            if (sideBar) sideBar.classList.add('sidebar-open');
            if (overlay) overlay.classList.add('visible');
            const projBtn = document.getElementById('projButton');
            if (projBtn) projBtn.click();
            // focus the newly-appended project input so the user can type immediately
            const sideMaDiv = document.getElementById('sideMa');
            if (sideMaDiv) {
                const inputs = sideMaDiv.querySelectorAll('#projInput');
                const last = inputs[inputs.length - 1];
                if (last) last.focus();
            }
        });

        const hint = document.createElement('div');
        hint.className = 'emptyStateHint';
        hint.innerHTML = 'or press <kbd>Enter</kbd> to create';

        block.appendChild(mascot);
        block.appendChild(icon);
        block.appendChild(title);
        block.appendChild(sub);
        block.appendChild(createBtn);
        block.appendChild(hint);
        mainListDiv.appendChild(block);

        ensureBodyCreateBtnRefocus();

        // Auto-focus the create-project button so keyboard users can press Enter
        // to start. Only apply when nothing else currently holds focus — don't
        // re-steal it if the user has already moved on (e.g., to the hamburger
        // menu) by the time this re-render lands.
        if (!document.activeElement || document.activeElement === document.body) {
            createBtn.focus();
        }
        ensureMainListGhostSpacer(mainListDiv);
        return;
    }

    // Case B/C — project has rows; decide between "no todos yet" and "all caught up".
    let open = 0, done = 0;
    rows.forEach(function(row) {
        const input = row.querySelector('#toDoInput');
        const val = input ? input.value.trim() : '';
        if (!val) return;
        if (row.classList.contains('completed')) done++; else open++;
    });

    if (open > 0) {
        mainListDiv.classList.remove('emptyStatePresent');
        ensureMainListGhostSpacer(mainListDiv);
        return;
    }

    mainListDiv.classList.add('emptyStatePresent');

    const block = document.createElement('div');
    block.id = 'emptyState';

    // Mascot variants — gray ghost for "no todos yet" (waiting), green
    // ghost for "all caught up" (success). STACK mobile (≤1023px) swaps
    // the inline ✦/✓ glyph for the mascot via CSS; desktop ignores it.
    const mascot = document.createElement('div');
    mascot.className = 'emptyStateMascot';
    mascot.setAttribute('aria-hidden', 'true');

    const icon = document.createElement('div');
    icon.className = 'emptyStateIcon';

    const title = document.createElement('div');
    title.className = 'emptyStateTitle';

    const sub = document.createElement('div');
    sub.className = 'emptyStateSub';

    if (done === 0) {
        block.classList.add('emptyStateNoTodos');
        mascot.classList.add('emptyStateMascotGray');
        icon.textContent  = '✦';
        title.textContent = 'No todos yet';
        sub.textContent   = 'Type below to add your first one.';
    } else {
        block.classList.add('emptyStateAllCaughtUp');
        mascot.classList.add('emptyStateMascotGreen');
        icon.textContent  = '✓';
        title.textContent = 'All caught up';
        sub.textContent   = done === 1
            ? '1 todo completed in this project.'
            : done + ' todos completed in this project.';
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'emptyStateInput';
    input.autocomplete = 'off';
    input.placeholder = 'New item';
    input.value = priorValue;

    // Commit-on-Enter — delegate to the hidden placeholder row's input so the
    // real commit path (date defaults, blank-row rebuild, reveal controls,
    // re-render) runs unchanged.
    input.addEventListener('keydown', function(event) {
        if (event.key !== 'Enter') return;
        const val = input.value.trim();
        if (!val) return;
        // Find the placeholder row among all #toDoChild nodes — it's the one whose
        // own #toDoInput is currently blank. Use that specific input to commit.
        const allRows = mainListDiv.querySelectorAll('#toDoChild');
        let target = null;
        for (let i = 0; i < allRows.length; i++) {
            const pi = allRows[i].querySelector('#toDoInput');
            if (pi && pi.value.trim() === '') { target = pi; break; }
        }
        if (!target) return;
        target.value = val;
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    // STACK-only flourishes — sparkles around the green ghost on the
    // "all caught up" screen; a dotted up-arrow pointing at the input
    // on the "no todos yet" screen. Both are positioned absolutely
    // around the mascot via CSS and are display:none on desktop.
    if (done === 0) {
        // On NO TODOS YET, mobile renders the input above the mascot so the
        // dotted up-arrow visually anchors to the input it's pointing at.
        // The arrow is appended directly after the input (and before the
        // mascot) so the chevron tip terminates near the input's bottom
        // edge — putting the arrow under the mascot would leave it
        // pointing at the wrong element. Desktop preserves the
        // [icon, title, sub, input] layout via a CSS `order: 99` rule on
        // the input — mascot and arrow are display:none on desktop so
        // reordering them in source has no visible effect there.
        block.appendChild(input);
        const upArrow = document.createElement('div');
        upArrow.className = 'emptyStateUpArrow';
        upArrow.setAttribute('aria-hidden', 'true');
        block.appendChild(upArrow);
        block.appendChild(mascot);
        block.appendChild(icon);
        block.appendChild(title);
        block.appendChild(sub);
    } else {
        // On ALL CAUGHT UP, mobile renders the input above the green
        // ghost so the user can keep adding tasks without scrolling past
        // the celebratory mascot. Desktop preserves the historical
        // [icon, title, sub, input] layout via a CSS `order: 99` rule on
        // the input — mascot, sparkles, and icon are display:none on
        // desktop so reordering them in source has no visible effect.
        block.appendChild(input);
        block.appendChild(mascot);
        block.appendChild(icon);
        const sparkles = document.createElement('div');
        sparkles.className = 'emptyStateSparkles';
        sparkles.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 4; i++) {
            const sp = document.createElement('span');
            sp.className = 'emptyStateSparkle';
            sp.textContent = '✦';
            sparkles.appendChild(sp);
        }
        block.appendChild(sparkles);
        block.appendChild(title);
        block.appendChild(sub);
    }

    // Insert at the top of mainList. The placeholder row is hidden via CSS
    // (#mainList.emptyStatePresent #toDoChild:first-of-type) so the block
    // visually occupies the slot where the placeholder would be.
    mainListDiv.insertBefore(block, mainListDiv.firstChild);

    if (wasFocused) {
        input.focus();
        if (priorSelStart !== null && priorSelEnd !== null) {
            try { input.setSelectionRange(priorSelStart, priorSelEnd); } catch (e) { /* ignore */ }
        }
    }
    ensureMainListGhostSpacer(mainListDiv);
}
