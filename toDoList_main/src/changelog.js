// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-06',
        added: [
            'Pomodoro timer in the header with focus and break modes, editable durations, and a chime, tab-title flash, and favicon swap when a session ends.',
        ],
    },
    {
        version: '1.1',
        date: '2026-05-05',
        fixed: [
            'The active highlight now shifts to the neighboring todo after a deletion so arrow-key navigation keeps a visible anchor.',
            'The delete confirmation modal now opens focused on Cancel, with Left/Right arrows and Tab cycling focus between Cancel and Delete inside the dialog.',
            'Down arrow on the last project now moves focus to the add-project button, where Enter creates a new project.',
            'The empty-state Create button now starts focused so pressing Enter creates your first project without a tab or click.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
