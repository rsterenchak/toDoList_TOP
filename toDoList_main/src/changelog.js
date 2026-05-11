// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-11',
        added: [
            'Adding a task on mobile now expands inline with Today / Tomorrow / 📅 date chips and a description toggle, with a purple flash on commit and a "Type the next…" prompt for chained entries.',
            'Tapping a task on mobile now expands the description below the row for a quick read without summoning the keyboard; tap the title or description text to start editing, or tap outside to collapse.',
        ],
        changed: [
            'Mobile swipe-to-complete and swipe-to-delete now commit at half the task row’s width, so the action triggers consistently no matter how wide the row renders.',
            'Mobile project header now sits flush above the todo list with page dots visible on the stats row, and the footer no longer duplicates the open/done counts.',
        ],
        fixed: [
            'Mobile nav bar now shows only the hamburger menu — the pomodoro, music, and ghost menu icons no longer appear on phones.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
