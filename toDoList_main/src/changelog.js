// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-11',
        fixed: [
            'Mobile no-todos empty state now positions the task input above the ghost mascot and dotted up-arrow, so the arrow points up at the input it was designed to indicate.',
            'Mobile no-todos empty state\'s dotted up-arrow now sits directly between the task input and the ghost mascot, anchoring its tip to the input above.',
            'Desktop placeholder task row no longer shows the mobile date chips and description toggle, matching the appearance of committed rows.',
            'Welcome empty state on notched iPhones now reserves space above the ghost mascot so the iOS status bar and Dynamic Island no longer overlap it.',
            'Long-pressing a project row on iOS now opens only the app\'s context menu, suppressing the iOS native text-selection handles and callout bar.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
