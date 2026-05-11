// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-11',
        added: [
            'Swipe-left to delete a task on mobile now offers a 5-second UNDO to restore the task at its original spot, and rows with descriptions get a small ¶ marker beside the date pill.',
            'Adding a task on mobile now expands inline with Today / Tomorrow / 📅 date chips and a description toggle, with a purple flash on commit and a "Type the next…" prompt for chained entries.',
            'Tapping a task on mobile now expands the description below the row for a quick read without summoning the keyboard; tap the title or description text to start editing, or tap outside to collapse.',
        ],
        changed: [
            'Mobile swipe-to-complete and swipe-to-delete now commit at half the task row’s width, so the action triggers consistently no matter how wide the row renders.',
        ],
    },
    {
        version: '1.1',
        date: '2026-05-10',
        fixed: [
            'Arrow Down from the sidebar toggle now lands on the first project instead of jumping past the sidebar to the first todo.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
