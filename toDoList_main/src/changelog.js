// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-20',
        added: [
            "The Claude assistant now opens automatically when you switch to a project that has a repo configured, and closes when you switch to one that doesn't.",
        ],
        fixed: [
            "The Claude assistant's voice-input button now carries the same purple outer glow as the other composer buttons.",
            "The Claude assistant's voice-input button now shows the same purple border and glyph highlight on hover as the other composer buttons.",
        ],
    },
    {
        version: '1.1',
        date: '2026-06-19',
        fixed: [
            "The Run button in the TODO.md viewer now switches to a light outlined style in light mode instead of staying a heavy dark fill.",
            "The collapse button in the TODO.md viewer now uses a consistent purple outlined style in both light and dark themes.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
