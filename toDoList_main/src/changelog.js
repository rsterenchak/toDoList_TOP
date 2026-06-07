// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-07',
        fixed: [
            "The desktop project dropdown's Delete option is reachable again — its menu now opens above the dropdown instead of behind it.",
            "Choosing Rename in the desktop project dropdown now edits the name inline in the row instead of switching to the project.",
            "Choosing Rename in the desktop project dropdown's menu no longer makes the dropdown close — the inline editor opens and stays put while you rename.",
            "Tapping a task's status label now opens its menu on the first tap even when another row's status menu is already open.",
            "Tapping a task's status label now reliably opens its status menu instead of flickering shut on the same tap.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
