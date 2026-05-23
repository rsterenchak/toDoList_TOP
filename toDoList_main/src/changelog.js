// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-23',
        fixed: [
            "Mobile todo rows now have a one-tap copy-title button next to the title and a slimmer due-date pill so the title takes back the space.",
            "Importing from Drive now clears the 'behind' sync indicator instead of leaving it amber.",
            "Editing todos locally now correctly shows the Drive sync indicator as out of sync.",
            "Drive sync indicator now correctly returns to green after a successful import or export.",
            "Drive import no longer shows a misleading 'try again' error after a successful restore.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
