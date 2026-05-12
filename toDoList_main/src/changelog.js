// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-12',
        fixed: [
            'Mobile sidebar drawer × button now reliably clears the iOS status bar, notch, and Dynamic Island on every iOS layout.',
            'Mobile sidebar drawer\'s projects block now bottom-anchors to the sidebar\'s vertical midpoint instead of pinning to the top.',
            'Mobile sidebar drawer\'s projects block now centers within the upper half so empty space splits evenly above and below it.',
            'Mobile sidebar projects list now scrolls internally with a fading bottom edge when many projects exist, keeping the header and add-project button pinned in place.',
            'Mobile sidebar drawer\'s Settings button now centers within the lower half on both axes instead of pinning to the top.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
