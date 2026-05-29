// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-28',
        fixed: [
            "Days-remaining digit on the mobile yellow due-date icon no longer overflows the top of the calendar glyph.",
            "Long todo descriptions on desktop now scroll internally instead of pushing into the rows beneath them.",
            "Sync button in the TODO.md viewer header no longer overflows past the card edge on narrow mobile screens.",
            "Open todo descriptions and the expanded Completed section no longer overlap each other.",
            "Opening a todo description now auto-collapses the Completed section, and vice versa, so the two never overlap.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
