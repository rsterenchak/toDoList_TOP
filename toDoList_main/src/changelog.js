// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-07',
        fixed: [
            "The TODO.md viewer's 'Show completed' control now uses a checkmark icon and moves to the header's right edge, and the redundant fullscreen-expand button was removed to ease crowding.",
            "Idea entries once again appear in both the Projects and Inbox tabs after the recent Inbox card redesign was rolled back.",
            "Filter pill counts (Active, Ideas, All) no longer include completed tasks, so they reflect only outstanding work.",
            "When sorting by status, changing a task's status now moves the task to its new position immediately instead of waiting for a manual re-sort.",
            "Pipeline runs are now watched for up to 20 minutes before showing 'Unknown', so longer runs no longer dead-end while still in progress.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
