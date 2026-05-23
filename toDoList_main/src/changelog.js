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
        ],
    },
    {
        version: '1.1',
        date: '2026-05-22',
        fixed: [
            "Completion slide-out fade now plays on the row you actually checked off instead of the row that ends up at the bottom.",
            "Import your todos directly from Google Drive via the ghost menu.",
            "Ghost menu's Export to Drive row now shows how long ago you last backed up to Drive.",
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
