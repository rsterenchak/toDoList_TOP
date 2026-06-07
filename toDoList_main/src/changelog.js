// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-07',
        fixed: [
            "On desktop, the Claude chat pane's CHAT and RUNS tabs are no longer hidden behind the view-tab band.",
            "On desktop, a thin divider line now separates the Claude chat pane from the view-tab band, so the two header bands read as distinct surfaces.",
            "On desktop, the view-tab band now paints its full row, removing the thin grey strip that showed below the view tabs.",
            "The TODO.md viewer's 'Show completed' control is now a compact icon button with a count badge, so the viewer header no longer clips on narrow mobile screens.",
            "The TODO.md viewer's 'Show completed' control now uses a simpler checkmark icon and sits at the far-right of the header, replacing the removed collapse button.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
