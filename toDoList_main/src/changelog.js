// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-13',
        added: [
            'New Today dashboard view with a TODAY / PROJECTS pill switcher at the top of the main panel; Today shows a date header and an empty-state placeholder, with item aggregation coming next.',
            'Switching to the Today view now auto-collapses the projects sidebar to its icon rail, and switching back to Projects auto-expands it; the hamburger still works as a manual override within either view.',
            'Today dashboard now lists overdue, today, and upcoming todos aggregated across every project, with a count summary and a checkbox plus project pill on each row.',
        ],
        changed: [
            'View-switch pills moved into the top bar next to the hamburger, and the sidebar PROJECTS label was removed so the project list begins at the sidebar\'s top edge.',
        ],
        fixed: [
            'TODAY / PROJECTS view-switch pills in the top bar reduced to a more compact size.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
