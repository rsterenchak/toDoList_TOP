// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-07',
        fixed: [
            "Choosing Rename in the desktop project dropdown's menu no longer makes the dropdown close — the inline editor opens and stays put while you rename.",
            "Tapping a task's status label now opens its menu on the first tap even when another row's status menu is already open.",
            "Tapping a task's status label now reliably opens its status menu instead of flickering shut on the same tap.",
            "On desktop, the filter and sort row now matches the background of the view-tab band above it, removing the mismatched seam between the two header rows.",
            "On desktop, the filter and sort row no longer paints a greyer chrome stripe — its background again matches the view-tab band above it.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
