// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-01',
        added: [
            "The Claude chat now shows an Inject & run card for entries you paste directly into the composer, not just ones the assistant drafts.",
        ],
        changed: [
            "The file-picker button now sits in the Claude chat sheet header alongside the tabs instead of in the message composer.",
        ],
        fixed: [
            "Automated runs whose outcome can't be verified now show \"Unknown\" instead of being falsely marked failed; only confirmed failures read as failed.",
            "The Claude chat file picker now drops down directly beneath its header button instead of opening at the bottom of the sheet.",
            "The Claude chat file picker now closes when you tap outside it, instead of staying open until you tap its button again.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
