// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-18',
        fixed: [
            "SVG markup inside a drafted TODO entry now stays as text instead of rendering as an image in the Claude chat.",
            "The attach, mic, text field, and send controls in the Claude chat composer now sit in a single, vertically aligned row.",
        ],
    },
    {
        version: '1.1',
        date: '2026-06-17',
        fixed: [
            "Your current project now stays selected when tasks refresh from the cloud, instead of jumping to another project.",
            "Todo rows and the sort controls no longer get clipped off the right edge on narrow mobile screens.",
            "SVG visuals in Claude's chat replies now render as images instead of showing as raw markup text.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
