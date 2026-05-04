// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-04',
        added: [
            'Help modal explains tasks, projects, the ghost menu, and keyboard shortcuts — opens from the ? button, the ? key, or the new Help item in the ghost menu.',
        ],
        fixed: [
            'Ctrl+Enter now mirrors the Expand All button, expanding or collapsing every open task description at once.',
            'Hamburger toggle moved up to the top nav next to the ghost menu so both global controls share one row, leaving the project name, count, and Expand All as a clean second band.',
        ],
    },
    {
        version: '1.1',
        date: '2026-05-03',
        fixed: [
            'Top-bar hamburger now shares the same neutral color as the save and import icons, with a subtle divider before the settings menu so it reads as a separate group.',
            'The `\\` shortcut now toggles focus between the projects rail and the new-task input even when the empty-state placeholder is showing.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
