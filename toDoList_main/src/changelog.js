// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-11',
        fixed: [
            'Mobile nav bar now shows only the hamburger menu — the pomodoro, music, and ghost menu icons no longer appear on phones.',
            'Mobile project header now renders in SpaceMono with a project-accent title color, and the empty-state block always paints below the header.',
            'Hamburger menu now anchors at the top-right of the mobile project header, removing the empty nav band that previously sat above it.',
            'Mobile no-todos empty state now positions the task input above the ghost mascot and dotted up-arrow, so the arrow points up at the input it was designed to indicate.',
            'Mobile no-todos empty state\'s dotted up-arrow now sits directly between the task input and the ghost mascot, anchoring its tip to the input above.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
