// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-24',
        fixed: [
            "The app now checks for a new version every time you re-open the tab, so installed clients stop running stale code in the background.",
            "Drive sync now also refreshes when you return to the tab, when the window regains focus, and once a minute while the tab is visible — so a device left open notices edits made on another device without you having to touch it.",
        ],
    },
    {
        version: '1.1',
        date: '2026-05-23',
        fixed: [
            "The Drive menu is now a single Sync button — auto-sync picks push or pull on its own, and a chooser appears only when there's a real conflict to resolve.",
            "Sync indicator no longer flickers to 'Drive is newer' immediately after a successful sync.",
            "Switching to another project no longer triggers an unnecessary sync to Drive.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
