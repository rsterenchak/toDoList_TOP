// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-04-26',
        fixed: [
            'Starting a new project and clicking away with a name typed now commits the project, while clicking away with an empty name silently discards the in-progress row.',
            'Clearing a project title and pressing Enter or clicking away now reverts to the previous name instead of leaving the project unnamed and its todos unreachable.',
        ],
    },
    {
        version: '1.1',
        date: '2026-04-25',
        changed: [
            'Theme switch in the nav bar is now a sun/moon icon button that fades and rotates as you flip between light and dark.',
        ],
    },
    {
        version: '1.1',
        date: '2026-04-24',
        fixed: [
            'Tapping the add-project button in the sidebar on mobile now focuses the new project name input immediately so the soft keyboard appears without a second tap.',
            'Footer background now reaches the bottom edge of the viewport on iOS Safari so the version label and open/done counts stay fully visible.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
