// Date-based section grouping for the todo list. Partitions the active
// project's open (uncompleted, committed) todos into three buckets keyed off
// each item's `due` field at render time:
//
//   • Due today  — `due` is today or earlier (overdue rolls up here)
//   • This week  — `due` is within the next 7 days
//   • Later      — everything else, including items with no due date
//
// The Completed section header (handled by emptyState.js) sits below all
// three groups; the blank placeholder row stays pinned above them.
//
// `updateDueGroupHeaders` walks #mainList in DOM order, removes any prior
// section headers, and re-inserts them whenever the bucket changes between
// consecutive rows. Empty buckets are not rendered. Idempotent — every
// render path that touches #mainList rows can call it without reasoning
// about prior state.

import { parseItemDue } from './dueDate.js';

export const GROUP_TODAY = 'today';
export const GROUP_WEEK  = 'week';
export const GROUP_LATER = 'later';

const GROUP_LABELS = {
    [GROUP_TODAY]: 'Due today',
    [GROUP_WEEK]:  'This week',
    [GROUP_LATER]: 'Later',
};


// Compute which bucket an item falls into based on its due date. Mirrors
// the daysUntilDue rounding (whole days from today; negative = overdue).
export function dueGroupForItem(item) {
    const parsed = parseItemDue(item);
    if (!parsed) return GROUP_LATER;
    const due = new Date(parsed.y, parsed.m - 1, parsed.d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((due - today) / 86400000);
    if (days <= 0) return GROUP_TODAY;
    if (days <= 7) return GROUP_WEEK;
    return GROUP_LATER;
}


function buildSectionHeader(group, count) {
    const header = document.createElement('div');
    header.className = 'dueGroupHeader';
    header.setAttribute('data-group', group);

    const dot = document.createElement('span');
    dot.className = 'dueGroupDot';
    dot.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'dueGroupLabel';
    label.textContent = GROUP_LABELS[group] + ' (' + count + ')';

    header.appendChild(dot);
    header.appendChild(label);
    return header;
}


// Walk #mainList rows in DOM order, classify each open committed row by due
// group, and insert a section header before the first row of each non-empty
// group. Skips the blank placeholder (no title) and any completed rows —
// the blank stays at the top and completed rows are partitioned by the
// existing #completedHeader path.
export function updateDueGroupHeaders(mainListDiv) {
    if (!mainListDiv) mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;

    // Remove any prior section headers first so we can rebuild from scratch.
    const prior = mainListDiv.querySelectorAll('.dueGroupHeader');
    prior.forEach(function(h) { if (h.parentNode) h.parentNode.removeChild(h); });

    // Bucket-counting pass: collect open committed rows + their groups so the
    // header label can include a count, then walk again to insert headers.
    const rows = mainListDiv.querySelectorAll('#toDoChild');
    const candidates = [];
    rows.forEach(function(row) {
        if (row.classList.contains('completed')) return;
        const item = row.__item;
        if (!item || !item.tit) return;   // skip blank placeholder
        candidates.push({ row: row, group: dueGroupForItem(item) });
    });

    if (candidates.length === 0) return;

    const counts = { [GROUP_TODAY]: 0, [GROUP_WEEK]: 0, [GROUP_LATER]: 0 };
    candidates.forEach(function(c) { counts[c.group]++; });

    let lastGroup = null;
    candidates.forEach(function(c) {
        if (c.group !== lastGroup) {
            const header = buildSectionHeader(c.group, counts[c.group]);
            mainListDiv.insertBefore(header, c.row);
            lastGroup = c.group;
        }
    });
}
