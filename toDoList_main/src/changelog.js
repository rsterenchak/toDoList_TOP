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
        ],
        changed: [
            "Local-file export and import removed from the menus; the ghost icon and Drive section header now show a Drive sync-state badge instead.",
        ],
    },
    {
        version: '1.1',
        date: '2026-05-22',
        fixed: [
            "Ghost menu's export and import rows are now grouped under labeled LOCAL and DRIVE sections.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
