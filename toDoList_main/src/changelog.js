// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-19',
        fixed: [
            "The Claude assistant's Chat / Runs tab switcher now stays legible in light theme instead of using dark, low-contrast colors.",
            "The Claude chat message box now adopts light-theme colors when you switch to light mode instead of staying dark.",
        ],
    },
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
