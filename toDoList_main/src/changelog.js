// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-23',
        fixed: [
            "Export and import — both local file and Google Drive — are now reachable from the mobile Settings modal.",
            "Removed the empty band below the mobile tab bar; version and project count moved into a new About section in Settings.",
            "Mobile todo rows now have a one-tap copy-title button next to the title and a slimmer due-date pill so the title takes back the space.",
            "Importing from Drive now clears the 'behind' sync indicator instead of leaving it amber.",
            "Editing todos locally now correctly shows the Drive sync indicator as out of sync.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
