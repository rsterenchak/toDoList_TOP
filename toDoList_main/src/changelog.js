// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-11-17',
        added: [
            'The Understanding book\'s pipeline chapters now walk the task row\'s own Dispatch, Retry and review controls, with new tours for a run that fails, a run that lands while the app is closed, and accepting or reverting a shipped change.',
            'The Understanding book has a new chapter on how Generate turns a task into a draft, with tours for a task that drafts, a triage that asks you a question, and one that fails or never starts.',
        ],
    },
    {
        version: '1.1',
        date: '2026-11-16',
        added: [
            'The Understanding book has a new Signing in chapter, with step-through tours for signing in with a code, a refused email or code, using the app offline, and signing out.',
            'The Understanding book\'s data chapter now explains what a sync does and doesn\'t protect, with new tours for a save that never reaches the server, live updates dropping and recovering, and a project deleted on another device.',
        ],
    },
    {
        version: '1.1',
        date: '2026-11-12',
        fixed: [
            'Tasks whose agent run takes longer than 15 minutes now flip to Review on their own when the run finishes, without needing a page reload.',
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
