// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-29',
        added: [
            "Tapping the TODO.md viewer on mobile now opens it as a slide-up bottom sheet so the rendered markdown and Rendered / Raw tabs are easier to read on touch.",
            "A Run backlog button in the TODO.md viewer header dispatches the automation routine to pick up the next task.",
            "After a backlog run is dispatched, the TODO.md viewer header shows a live status pill that tracks the run from queued to done, turning green on success or red with a link to the run on failure.",
        ],
        changed: [
            "The TODO.md viewer's expand/collapse button is now hidden on mobile to reduce header clutter.",
        ],
        fixed: [
            "Tapping the Completed header on mobile now opens a slide-up bottom sheet with the completed list and the Rendered / Raw markdown viewer.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
