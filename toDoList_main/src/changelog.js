// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-28',
        added: [
            "Days remaining now appear inside the yellow due-date calendar icon on mobile for tasks due in 1-3 days.",
        ],
        fixed: [
            "Days-remaining digit on the mobile yellow due-date icon now centers inside the date-grid body instead of riding up at the calendar's top header line.",
            "Days-remaining digit on the mobile yellow due-date icon no longer overflows the top of the calendar glyph.",
            "Long todo descriptions on desktop now scroll internally instead of pushing into the rows beneath them.",
        ],
    },
    {
        version: '1.1',
        date: '2026-05-27',
        fixed: [
            "Descriptions added to todos in non-first projects now survive a page refresh instead of coming back empty.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
