// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-06',
        changed: [
            "On wide screens the Claude chat now appears as a persistent panel beside your tasks instead of a slide-up sheet.",
        ],
    },
    {
        version: '1.1',
        date: '2026-06-05',
        changed: [
            "The layout now switches to the mobile view on screens narrower than 1024px instead of 700px, so tablets and medium-width windows get the touch-optimized layout.",
            "On wide screens the projects list now slides in as an overlay drawer from the hamburger button instead of taking up a permanent left column.",
            "On wide screens the active project now shows as a pill in the header that opens the projects drawer, and the hamburger button is hidden.",
        ],
        fixed: [
            "The first-run welcome tour now opens the projects drawer when spotlighting the sample project and the add-project button, so those steps highlight the real controls instead of empty screen edge.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
