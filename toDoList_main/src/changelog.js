// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-12',
        fixed: [
            'Mobile music picker now has a volume slider with mute toggle below the paste-URL button, with the level persisting across reloads.',
            'Swipe-down to dismiss now works anywhere on the mobile bottom utilities drawer, not just the small top handle.',
            'Mobile sidebar drawer close button no longer hides behind the iOS status bar, notch, or Dynamic Island.',
            'Mobile sidebar drawer × button now reliably clears the iOS status bar, notch, and Dynamic Island on every iOS layout.',
            'Mobile sidebar drawer\'s projects block now bottom-anchors to the sidebar\'s vertical midpoint instead of pinning to the top.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
