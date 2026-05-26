// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-26',
        fixed: [
            "Desktop description editor now preserves multi-line markdown formatting through paste, save, reload, and copy.",
            "A per-project Sort by due toggle reorders the active project's items by ascending due date, with undated items at the bottom and manual drag reordering paused while it is on.",
            "Todo titles can now be renamed from the mobile description editor — tap the pencil next to the title, edit, and press Enter or tap away to commit.",
        ],
    },
    {
        version: '1.1',
        date: '2026-05-25',
        fixed: [
            "Tapping a todo row on a touch device now opens a full-screen description editor with a monospace textarea, a copy-to-clipboard button for drafting TODO.md entries, and a confirmation-gated Clear; rows carrying a description show a small purple note glyph beside the title.",
            "Mobile description editor no longer lets iOS rewrite markdown punctuation, so TODO.md drafts paste and copy with formatting intact.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
