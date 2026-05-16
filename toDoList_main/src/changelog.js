// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-16',
        fixed: [
            'Mobile bottom-sheet expanded panel no longer bleeds past the bottom of the viewport into the home-indicator zone when idle or peeking.',
            'Mobile project header no longer shows the redundant ⋯ overflow button, and the idle bottom-sheet nub is hidden so no stray gray bar floats above the tab bar.',
            'Mobile idle and peek states no longer show a stray gray drag-handle bar between the bottom tab bar and the footer.',
            'Bottom-sheet idle nub no longer paints above the mobile tab bar in any state.',
            'Mobile project header now paints reliably on the Projects view instead of staying hidden after first load.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
