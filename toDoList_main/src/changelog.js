// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-12',
        fixed: [
            'Mobile project header now spaces its label, title row, and counts row further apart so each reads as its own band.',
            'Mobile sidebar drawer now reaches the bottom of the screen on iOS and its PROJECTS header clears the status bar and notch.',
            'Mobile sidebar drawer background now extends flush to the bottom of the screen with no footer strip showing through behind it.',
            'Mobile music picker now has a volume slider with mute toggle below the paste-URL button, with the level persisting across reloads.',
            'Swipe-down to dismiss now works anywhere on the mobile bottom utilities drawer, not just the small top handle.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
