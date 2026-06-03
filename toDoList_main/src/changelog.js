// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-03',
        added: [
            "Mockup HTML and SVG snippets in the Claude chat now render inline as live previews instead of as raw code.",
        ],
    },
    {
        version: '1.1',
        date: '2026-06-02',
        added: [
            "BookHavenBookstore_Sophia is now selectable as a workspace in the Claude chat.",
        ],
        changed: [
            "The Claude chat workspace list now updates automatically from the server, so newly added repos appear without an app update.",
        ],
    },
    {
        version: '1.1',
        date: '2026-06-01',
        fixed: [
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
