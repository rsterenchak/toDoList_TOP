// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-19',
        added: [
            "The Claude chat composer's attach, send, and layout-inspector buttons now show a purple border and lighter glyph on hover.",
        ],
        fixed: [
            "The Claude assistant's Chat / Runs tab switcher now stays legible in light theme instead of using dark, low-contrast colors.",
            "The Claude chat message box now adopts light-theme colors when you switch to light mode instead of staying dark.",
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
