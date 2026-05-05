// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-05',
        fixed: [
            'Pressing Delete on a focused project now opens the project-deletion confirmation instead of removing a todo.',
        ],
    },
    {
        version: '1.1',
        date: '2026-05-04',
        fixed: [
            'Ctrl+Enter now mirrors the Expand All button, expanding or collapsing every open task description at once.',
            'Hamburger toggle moved up to the top nav next to the ghost menu so both global controls share one row, leaving the project name, count, and Expand All as a clean second band.',
            'Ctrl+Backspace now toggles the projects sidebar — same collapse/expand as the hamburger button, with the browser’s go-back gesture suppressed.',
            'Press ← to focus the active project icon and → to focus the new-task input.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
