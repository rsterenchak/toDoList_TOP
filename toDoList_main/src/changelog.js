// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-27',
        fixed: [
            "Inject to TODO.md now preserves em-dashes, curly quotes, and other non-ASCII characters in the description verbatim.",
            "Editing a todo's due date while \"Sort by Due\" is active now repositions the row immediately instead of waiting for a manual sort toggle or page reload.",
            "Todos added to a newly created project on mobile now reliably survive a page reload.",
            "Descriptions added to todos in non-first projects now survive a page refresh instead of coming back empty.",
        ],
    },
    {
        version: '1.1',
        date: '2026-05-26',
        fixed: [
            "Completing a todo from the Today dashboard now persists across page refreshes.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
