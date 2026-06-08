import { listLogic } from './listLogic.js';
import { getActiveView } from './prefs.js';
import { buildStatusLabel, wireStatusLabelDelegation } from './todoStatus.js';
import { showDescEditorModal } from './modals.js';

// The INBOX view: a cross-project list of every idea-status todo. This
// cluster reaches the DOM via document.getElementById/createElement at call
// time (no component() closure capture) and never calls applyActiveView, so
// there is no back-edge into main.js — only renderInbox is exported; the row
// builder and the status-rerender arm stay module-private.

// Build a single inbox row from a LIVE idea item plus its project name. The
// row carries the live __item reference, plus a `.todoStatusLabel` tap
// target built by the shared buildStatusLabel. That shared wiring is exactly
// why the row must carry the LIVE in-memory item (returned by
// getIdeaTodosAcrossProjects) — the popover routes through
// listLogic.setToDoStatus, which mutates the item in place. The metadata
// line reads "○ IDEA · <project>"; the title sits below, muted to match
// the entry-#2 idea styling via CSS (no inline color).
function buildInboxRow(item, projectName) {
    const row = document.createElement('div');
    row.id = 'toDoChild';
    row.className = 'inboxRow';
    row.setAttribute('data-value', projectName);
    row.__item = item;

    // Whole-row tap opens the existing description editor — expose the row as
    // a focusable button so keyboard and assistive-tech users get the same
    // affordance (Enter/Space activate the tap).
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', 'Open idea: ' + (item.tit || ''));

    // Non-interactive checkbox-style glyph on the left, echoing the per-
    // project row affordance. Status changes happen through the label.
    const check = document.createElement('div');
    check.className = 'inboxRowCheck';
    check.setAttribute('aria-hidden', 'true');
    row.appendChild(check);

    const body = document.createElement('div');
    body.className = 'inboxRowBody';

    // Compact one-line layout: the title sits on a single line (truncated to
    // an ellipsis via CSS) with the status pill + project name on a metadata
    // row below it.
    const title = document.createElement('div');
    title.className = 'inboxRowTitle';
    title.textContent = item.tit;
    body.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'inboxRowMeta';
    meta.appendChild(buildStatusLabel(item));
    const proj = document.createElement('span');
    proj.className = 'inboxRowProject';
    proj.textContent = '· ' + projectName;
    meta.appendChild(proj);
    body.appendChild(meta);

    row.appendChild(body);

    // Decorative chevron signalling tappability. It carries NO own handler —
    // clicks on it propagate up to the row's whole-row tap handler.
    const chev = document.createElement('span');
    chev.className = 'inboxRowChev';
    chev.setAttribute('aria-hidden', 'true');
    chev.textContent = '›';
    row.appendChild(chev);

    // Whole-row tap → the EXISTING description editor (showDescEditorModal),
    // the same modal the project-page row tap uses (toDoRow.js). That modal
    // has no completion wiring whatsoever, so no dismiss path can ever mark an
    // idea complete. After a save commits, route the persist through
    // listLogic.editToDoItem (so the Supabase mirror fires, matching
    // toDoRow.js) and call renderInbox() to refresh the row's preview.
    function openInboxEditor() {
        showDescEditorModal(item, {
            projectName: projectName,
            onSave: function () {
                if (projectName) listLogic.editToDoItem(projectName, item);
                renderInbox();
            },
            onTitleSave: function () {
                if (projectName) listLogic.editToDoItem(projectName, item);
                renderInbox();
            }
        });
    }
    // Bail on the status-label chip (its delegated popover wins) and the
    // check glyph — mirrors the target-check idiom in wireToDoRowClick.
    row.addEventListener('click', function (e) {
        if (e.target.closest('.todoStatusLabel') ||
            e.target.closest('.inboxRowCheck')) return;
        openInboxEditor();
    });
    row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            openInboxEditor();
        }
    });

    return row;
}

// Defer an INBOX re-render to just after a status-change commits. The
// shared entry-#2 popover lives on document.body and commits via its own
// bubble-phase click handler that calls stopPropagation(), so a bubble
// listener here would never see it — a capture-phase document listener
// fires first instead. The re-render is queued on a microtask so it runs
// AFTER the synchronous setToDoStatus mutation has landed, by which point
// the promoted task no longer matches the status==='idea' filter and drops
// out of the rebuilt list. Scoped to the INBOX view so per-project status
// changes are untouched. Installed once (idempotent guard).
let _inboxStatusRerenderWired = false;
function ensureInboxStatusRerender() {
    if (_inboxStatusRerenderWired) return;
    _inboxStatusRerenderWired = true;
    document.addEventListener('click', function (event) {
        const opt = event.target.closest && event.target.closest('.todoStatusOption');
        if (!opt) return;
        if (getActiveView() !== 'inbox') return;
        Promise.resolve().then(renderInbox);
    }, true);
}

// Render the INBOX view: a cross-project list of every idea-status todo,
// newest capture first. Clears #inboxView of any leftover shell nodes (the
// inert Today date-header / count-summary / empty-state / ghost spacer
// carried over from the removed Today view) and rebuilds its contents from
// listLogic.getIdeaTodosAcrossProjects(). When no ideas exist anywhere, a
// single centered .inboxEmptyState message is shown instead. Reuses the
// entry-#2 status popover by wiring wireStatusLabelDelegation on the
// persistent #inboxView container (idempotent) and arming the
// status-change re-render. Safe to call before component() has built the
// shell (missing #inboxView short-circuits).
export function renderInbox() {
    const inboxView = document.getElementById('inboxView');
    if (!inboxView) return;

    // Reuse the entry-#2 status-change popover on the inbox surface. The
    // delegated handler reads the tapped row's __item + data-value, so it
    // behaves identically here as on #mainList. Both calls are idempotent.
    wireStatusLabelDelegation(inboxView);
    ensureInboxStatusRerender();

    while (inboxView.firstChild) inboxView.removeChild(inboxView.firstChild);

    const ideas = listLogic.getIdeaTodosAcrossProjects();

    if (!ideas.length) {
        const empty = document.createElement('div');
        empty.className = 'inboxEmptyState';
        empty.textContent =
            "Nothing captured yet. Ideas you don't commit to right away end up here.";
        inboxView.appendChild(empty);
        return;
    }

    const sections = document.createElement('div');
    sections.id = 'inboxSections';
    ideas.forEach(function (entry) {
        sections.appendChild(buildInboxRow(entry.item, entry.project));
    });
    inboxView.appendChild(sections);
}
