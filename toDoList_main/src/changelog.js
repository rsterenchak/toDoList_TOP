// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-17',
        added: [
            "Your tasks now refresh from the cloud automatically when you return to the app and every few minutes, so data stays in sync across devices.",
        ],
        changed: [
            "Long lines in the mobile description editor now wrap inside the box instead of running off the right edge.",
        ],
        fixed: [
            "Your current project now stays selected when tasks refresh from the cloud, instead of jumping to another project.",
        ],
    },
    {
        version: '1.1',
        date: '2026-06-16',
        fixed: [
            "The mobile Sort control now shows its \"Sort\" label instead of only a bare caret on narrow phones.",
            "Swipe-to-complete and swipe-to-delete work on mobile again even when a task sort is active.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
