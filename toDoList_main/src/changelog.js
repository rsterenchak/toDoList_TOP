// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-03',
        fixed: [
            'Ghost and theme toggles moved into a single settings dropdown on the top bar, freeing space while keeping save and import as direct one-click icons.',
        ],
    },
    {
        version: '1.1',
        date: '2026-05-01',
        added: [
            'Floating help button in the bottom-right corner — and the ? key — open a list of every keyboard shortcut, grouped by category.',
            'Up and Down arrows navigate between todo rows, Enter opens the focused row for editing, and Delete removes it after confirmation.',
        ],
    },
    {
        version: '1.1',
        date: '2026-04-30',
        fixed: [
            'Checking off a recurring task now leaves a completed entry in the Completed section so each finished occurrence stays visible as a history alongside the still-recurring original.',
        ],
        changed: [
            'Export and import nav icons restyled as a floppy disk and folder for a clearer save/open metaphor.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
