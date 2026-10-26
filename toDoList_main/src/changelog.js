// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-10-26',
        added: [
            'Keep what you learn in the code book with notes in your own words, pinned to a paragraph (from its Note button or long-press) or to selected lines in the code viewer, or saved straight from a Claude answer with Keep, shown in place and listed on the shelf with a Copy button.',
        ],
        changed: [
            'Your notes in the code viewer and the code book now show as a single line until you tap to expand them (a pencil edits), a Marks toggle hides them all at once, and Keep starts from the answer\'s first sentence with a character count that turns amber past 200.',
        ],
        fixed: [
            'Pausing mid-sentence while dictating a todo no longer adds a half-finished item, only a tap adds it, and if the phone stops listening on its own your words stay in the field.',
            'Leaving voice dictation running for a minute no longer adds a todo on its own, the mic stops listening and your words stay in the field for you to add.',
        ],
    },
    {
        version: '1.1',
        date: '2026-10-25',
        added: [
            'A Notes toggle in the code viewer annotates the open file with a short note beside each line (or beneath it on narrow screens) saying what it is for and what it connects to, skipping lines a comment already explains, and tapping a note asks Claude about that line.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}

// Build the changelog entry DOM (one <section.changelogEntry> per release,
// newest-first) and append it into `container`. Shared by the desktop
// footer changelog modal (modals.js) and the mobile Settings → Version
// changelog sheet (mobileSheets.js) so both surfaces render identically
// from a single source of truth. Returns the container for chaining.
export function renderChangelogEntries(container) {
    if (!container) return container;
    changelog.forEach(function(entry) {
        const block = document.createElement('section');
        block.className = 'changelogEntry';

        const heading = document.createElement('div');
        heading.className = 'changelogEntryHeading';

        const ver = document.createElement('span');
        ver.className = 'changelogEntryVersion';
        ver.textContent = 'v' + entry.version;

        const date = document.createElement('span');
        date.className = 'changelogEntryDate';
        date.textContent = entry.date;

        heading.appendChild(ver);
        heading.appendChild(date);
        block.appendChild(heading);

        [
            ['Added',   entry.added],
            ['Changed', entry.changed],
            ['Fixed',   entry.fixed]
        ].forEach(function(pair) {
            const label = pair[0];
            const bullets = pair[1];
            if (!bullets || !bullets.length) return;

            const groupLabel = document.createElement('div');
            groupLabel.className = 'changelogGroupLabel';
            groupLabel.textContent = label;

            const list = document.createElement('ul');
            list.className = 'changelogBullets';
            bullets.forEach(function(text) {
                const li = document.createElement('li');
                li.textContent = text;
                list.appendChild(li);
            });

            block.appendChild(groupLabel);
            block.appendChild(list);
        });

        container.appendChild(block);
    });
    return container;
}
