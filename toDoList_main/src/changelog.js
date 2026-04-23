// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-04-23',
        added: [
            'Prominent "Create your first project" button on the first-run empty state.',
        ],
    },
    {
        version: '1.1',
        date: '2026-04-23',
        added: [
            'Collapsible "Completed" section for checked-off todos.',
        ],
        fixed: [
            'Due date field restored on mobile layouts below 420px.',
            'Drag-and-drop reordering now keeps completed items at the bottom.',
        ],
        changed: [
            'Project row drag handle now covers the full row, including empty space after short titles.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
