// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-26',
        fixed: [
            "Todo titles can now be renamed from the mobile description editor — tap the pencil next to the title, edit, and press Enter or tap away to commit.",
            "Pressing Backspace on a selected project or todo row now triggers the same delete confirmation as Delete, so the keyboard shortcut works on Mac laptops.",
            "Descriptions edited from the mobile todo editor now persist across page refreshes.",
            "Inject settings modal now scrolls instead of clipping on mobile when its content runs taller than the viewport.",
            "Mobile description editor footer buttons no longer overflow the dialog on narrow viewports.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
