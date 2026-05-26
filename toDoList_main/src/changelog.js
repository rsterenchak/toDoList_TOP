// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-26',
        added: [
            "Inject settings now lets you manage routing targets — add, edit, and delete repo + file path entries — with the connection section collapsing once configured to keep the modal tidy.",
            "Inject settings includes a Project routing section where each project picks its own target, and the inject button now reads that target so different projects can post to different repos.",
        ],
        fixed: [
            "A per-project Sort by due toggle reorders the active project's items by ascending due date, with undated items at the bottom and manual drag reordering paused while it is on.",
            "Todo titles can now be renamed from the mobile description editor — tap the pencil next to the title, edit, and press Enter or tap away to commit.",
            "Pressing Backspace on a selected project or todo row now triggers the same delete confirmation as Delete, so the keyboard shortcut works on Mac laptops.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
