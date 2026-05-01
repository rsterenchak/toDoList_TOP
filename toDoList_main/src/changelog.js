// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-01',
        added: [
            'Floating help button in the bottom-right corner — and the ? key — open a list of every keyboard shortcut, grouped by category.',
        ],
    },
    {
        version: '1.1',
        date: '2026-04-30',
        added: [
            'Press N from anywhere to jump to the new-task input, which now shows a leading plus glyph and inviting placeholder text.',
        ],
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
            'Recurring tasks repeat on daily, weekdays, weekly, monthly, yearly, or custom schedules; checking one advances its due date to the next occurrence instead of marking it done.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
