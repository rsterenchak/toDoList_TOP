// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-01',
        fixed: [
            "Automated runs whose outcome can't be verified now show \"Unknown\" instead of being falsely marked failed; only confirmed failures read as failed.",
        ],
    },
    {
        version: '1.1',
        date: '2026-05-31',
        fixed: [
            "The \"newer build is ready\" reload prompt now clears once the new build is live instead of lingering with a dead Reload button.",
            "Run rows reconcile to their true status when you reopen the app, and a run that can no longer be resolved is marked failed instead of showing \"Running\" forever.",
            "The Claude assistant's Runs tab re-checks for a waiting build when opened, so a stale reload prompt no longer lingers when none is needed.",
            "The reload nudge now fully disappears when no new build is waiting instead of lingering on screen.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
