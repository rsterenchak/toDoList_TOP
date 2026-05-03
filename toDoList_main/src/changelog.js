// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-03',
        fixed: [
            'Projects and Todo Items column headers are now left-aligned so they line up with the project rows and todo rows beneath them.',
            'Add-project + button moved into the PROJECTS column header so the projects list starts higher in the sidebar.',
            'Removed the redundant TODO ITEMS column header label — the add-task input directly below already conveys what the column is.',
            'Top-bar hamburger now shares the same neutral color as the save and import icons, with a subtle divider before the settings menu so it reads as a separate group.',
        ],
        changed: [
            'Save, import, theme, and floating-ghost controls now live in a single ghost-icon menu in the top-right of the nav.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
