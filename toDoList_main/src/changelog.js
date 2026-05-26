// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-25',
        fixed: [
            "Mobile todo rows now have wider screen-edge gutters so titles don't hug the viewport, with task titles slightly compacted on narrow phones to keep room for text.",
            "Mobile todo rows now show due dates as a single color-coded calendar icon — red overdue, amber due soon, purple future, gray unset — freeing horizontal room for the task title; tap the icon to open the date picker.",
            "Mobile todo rows hide the description chevron so titles get more horizontal room — tapping the row still opens the description.",
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
