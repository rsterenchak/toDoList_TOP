// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-19',
        fixed: [
            "First-run welcome tour now seeds a \"Getting started\" sample project so every step has a real row to anchor against — rename or delete the sample whenever you're done with it.",
            "First-run welcome tour now walks through the focus-music and settings buttons on their own steps so every navbar control gets a proper introduction.",
            "Mobile first-run flow now opens a four-card welcome carousel introducing projects, the slide-out menu, music, and settings; replay it any time from settings.",
        ],
    },
    {
        version: '1.1',
        date: '2026-05-18',
        fixed: [
            "Calendar view now sits within a horizontal gutter on wide screens so day cells stay sized for readability.",
            "Page scrollbars now blend into the Void aesthetic — an ultra-thin neutral gray thumb on a transparent track, lifting slightly on hover, across every scrollable surface.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
