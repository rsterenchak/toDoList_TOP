// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-04-30',
        fixed: [
            'Checking off a recurring task now leaves a completed entry in the Completed section so each finished occurrence stays visible as a history alongside the still-recurring original.',
        ],
        changed: [
            'Export and import nav icons restyled as a floppy disk and folder for a clearer save/open metaphor.',
        ],
    },
    {
        version: '1.1',
        date: '2026-04-28',
        added: [
            'Manual JSON export and import of every project and todo, with drag-and-drop import on desktop and a footer reminder when no backup has happened in over a week.',
            'Recurring tasks repeat on daily, weekdays, weekly, monthly, yearly, or custom schedules; checking one advances its due date to the next occurrence instead of marking it done.',
        ],
    },
    {
        version: '1.1',
        date: '2026-04-26',
        fixed: [
            'Adding the app to a light-mode iOS home screen now shows a lighter-purple app icon that matches the system theme instead of the dark-tuned default.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
