// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-08',
        fixed: [
            "Deleting a project on one device now sticks across all your devices instead of reappearing after the next sync.",
        ],
    },
    {
        version: '1.1',
        date: '2026-06-07',
        fixed: [
            "When sorting by status, changing a task's status now moves the task to its new position immediately instead of waiting for a manual re-sort.",
            "Pipeline runs are now watched for up to 20 minutes before showing 'Unknown', so longer runs no longer dead-end while still in progress.",
            "The wandering ghost companion now stays on top of every other interface element instead of disappearing behind the chat pane or open dialogs.",
            "Expanding the TODO viewer now fills the panel down to the bottom of the task list instead of leaving blank space below it.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
