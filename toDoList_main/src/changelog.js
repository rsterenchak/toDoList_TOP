// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-08-18',
        added: [
            'The repo check now says whether each out-of-date routine file can be safely refreshed or needs a hand merge, and onboarding offers an opt-in to refresh the ones with no local edits.',
        ],
        changed: [
            'A task added while the IN PROGRESS filter is selected now starts as in progress, so it stays on screen instead of vanishing the moment you press Enter.',
            'Reverting a shipped change now rolls its paperwork back too: a derived proposal returns to the Proposed list, and a hand-written entry reopens unchecked in TODO.md.',
        ],
        fixed: [
            'The mobile welcome carousel now runs only when the sample project was actually created for you, so it no longer plays over your real projects on a fresh browser or after a slow sign-in.',
            'A load that breaks partway through now hands off to the automatic recovery screen instead of leaving you staring at an empty app.',
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
