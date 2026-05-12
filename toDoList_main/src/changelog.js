// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-12',
        fixed: [
            'Mobile project header now switches projects via prev/next chevrons and a horizontal swipe on the title row, replacing the page-dot indicator.',
            'Mobile top chrome now keeps breathing room above the hamburger button, project header, and welcome screen in browser tabs and on non-notched devices.',
            'Per-row delete button is hidden on mobile in favor of the swipe-left gesture with its UNDO toast.',
            'Project header on mobile now leaves taller top clearance so the project label and title clear the iOS status bar and Dynamic Island.',
            'Mobile project header now spaces its label, title row, and counts row further apart so each reads as its own band.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
