// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-04-26',
        added: [
            'Compact Titles toggle in the Todo Items header trims long titles to a single line with an ellipsis; hover the row to reveal the full text.',
            'Ghost companion now blinks on its own at irregular intervals while idle.',
        ],
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
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
