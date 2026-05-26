// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-26',
        added: [
            "Swiping a todo right to complete it on a touch device now flashes a large purple checkmark in the center of the screen.",
        ],
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
