// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-29',
        changed: [
            "The TODO.md viewer's expand/collapse button is now hidden on mobile to reduce header clutter.",
            "On mobile the TODO.md viewer now stacks its synced status onto its own line and gives the run control and Sync button a roomier full-width row instead of crowding them beside the tabs.",
        ],
        fixed: [
            "Tapping the Completed header on mobile now opens a slide-up bottom sheet with the completed list and the Rendered / Raw markdown viewer.",
            "The TODO.md viewer's run-status pill now survives switching projects and reloading the page, re-attaching to an in-progress run instead of losing track of it.",
            "The TODO.md viewer now opens full-screen on mobile instead of as a partial bottom sheet, so the underlying page no longer peeks through behind it.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
