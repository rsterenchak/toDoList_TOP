import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import {
    buildFileReadout,
    refreshFileReadout,
    applyPhaseLayout,
    DESC_PANEL_CHILD_SELECTORS,
} from '../src/toDoRow.js';
import { parseFilePathsFromEntry, insertFilePathIntoEntry } from '../src/filePicker.js';
import { PHASE } from '../src/phase.js';

// Feature pins for "group the actions in a row and add a FILE readout":
//   - Inject / Generate / Discuss are grouped into one `.descActionsRow` wrapper
//     rather than each spanning the panel full-width, so the wrapper (not the
//     buttons) is the placed #descSibling grid child.
//   - A read-only FILE readout mirrors the entry's `- File:` line, parsed with
//     the SAME matcher the picker inserts with, so the two can never disagree.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const toDoRow = readFileSync(resolve(srcDir, 'toDoRow.js'), 'utf8');

describe('detail panel — actions grouped into one horizontal row', () => {
    it('groups Inject / Generate / Discuss inside the .descActionsRow wrapper, not directly on the panel', () => {
        expect(toDoRow).toMatch(/actionsRow\.appendChild\(injectBtn\)/);
        expect(toDoRow).toMatch(/actionsRow\.appendChild\(generateBtn\)/);
        expect(toDoRow).toMatch(/actionsRow\.appendChild\(discussBtn\)/);
        // The row now mounts into the panel's docked `.descPanelFooter` stack
        // rather than straight onto #descSibling — the wrapper is what the detail
        // pane pins to its floor. The grouping this pin exists for is unchanged.
        expect(toDoRow).toMatch(/footer\.appendChild\(actionsRow\)/);
        // The buttons are no longer mounted directly onto #descSibling.
        expect(toDoRow).not.toMatch(/descSibling\.appendChild\(injectBtn\)/);
        expect(toDoRow).not.toMatch(/descSibling\.appendChild\(generateBtn\)/);
        expect(toDoRow).not.toMatch(/descSibling\.appendChild\(discussBtn\)/);
    });

    it('registers the wrapper and readout in the child contract and drops the individual buttons', () => {
        expect(DESC_PANEL_CHILD_SELECTORS).toContain('#descSibling .descActionsRow');
        expect(DESC_PANEL_CHILD_SELECTORS).toContain('#descSibling .descFileReadout');
        expect(DESC_PANEL_CHILD_SELECTORS).not.toContain('#descSibling .injectBtn');
        expect(DESC_PANEL_CHILD_SELECTORS).not.toContain('#descSibling .generateBtn');
        expect(DESC_PANEL_CHILD_SELECTORS).not.toContain('#descSibling .discussBtn');
    });

    it('applyPhaseLayout still hides the nested Inject/Generate in `done`, leaving Discuss and the wrapper', () => {
        const descSibling = document.createElement('div');
        descSibling.id = 'descSibling';
        const actionsRow = document.createElement('div');
        actionsRow.className = 'descActionsRow';
        const inject = document.createElement('button');
        inject.className = 'injectBtn';
        const generate = document.createElement('button');
        generate.className = 'generateBtn';
        const discuss = document.createElement('button');
        discuss.className = 'discussBtn';
        actionsRow.append(inject, generate, discuss);
        descSibling.appendChild(actionsRow);

        applyPhaseLayout(descSibling, PHASE.DONE);
        // Authoring buttons hide even though they are nested in the wrapper…
        expect(inject.hidden).toBe(true);
        expect(generate.hidden).toBe(true);
        // …but Discuss (not in the authoring group) and the wrapper itself stay,
        // so `done` never leaves an empty actions row.
        expect(discuss.hidden).toBe(false);
        expect(actionsRow.hidden).toBe(false);
    });
});

describe('detail panel — FILE readout mirrors the entry File: line', () => {
    function panelWithReadout() {
        const descSibling = document.createElement('div');
        descSibling.id = 'descSibling';
        descSibling.appendChild(buildFileReadout());
        return descSibling;
    }

    it('renders one line per comma-separated path from the File: line', () => {
        const descSibling = panelWithReadout();
        refreshFileReadout(descSibling, [
            '- [ ] Something',
            '  - Type: feature',
            '  - File: `src/a.js`, `src/b.css`',
        ].join('\n'));

        const lines = descSibling.querySelectorAll('.descFileReadoutPath');
        expect([...lines].map((l) => l.textContent)).toEqual(['src/a.js', 'src/b.css']);
        expect(descSibling.querySelector('.descFileReadoutEmpty')).toBeNull();
    });

    it('shows a "no target" note when the entry names no File: line', () => {
        const descSibling = panelWithReadout();
        refreshFileReadout(descSibling, '- [ ] No file line here\n  - Type: bug');
        expect(descSibling.querySelectorAll('.descFileReadoutPath')).toHaveLength(0);
        const empty = descSibling.querySelector('.descFileReadoutEmpty');
        expect(empty).not.toBeNull();
        expect(empty.textContent).toMatch(/no target/i);
    });

    it('treats an empty File: line as no target', () => {
        const descSibling = panelWithReadout();
        refreshFileReadout(descSibling, '  - File:');
        expect(descSibling.querySelectorAll('.descFileReadoutPath')).toHaveLength(0);
        expect(descSibling.querySelector('.descFileReadoutEmpty')).not.toBeNull();
    });

    it('repaints when the entry text changes', () => {
        const descSibling = panelWithReadout();
        refreshFileReadout(descSibling, '  - File: `src/a.js`');
        expect(descSibling.querySelectorAll('.descFileReadoutPath')).toHaveLength(1);
        refreshFileReadout(descSibling, '  - File: `src/a.js`, `src/b.js`, `src/c.js`');
        expect([...descSibling.querySelectorAll('.descFileReadoutPath')].map((l) => l.textContent))
            .toEqual(['src/a.js', 'src/b.js', 'src/c.js']);
    });

    it('agrees with the picker: a path the picker inserts is exactly what the readout shows', () => {
        const descSibling = panelWithReadout();
        // Start from an entry with no File: line, then insert through the picker's
        // own logic — the readout, parsing with the shared matcher, must reflect it.
        const entry = insertFilePathIntoEntry('- [ ] Task\n  - Type: feature', 'src/style.css');
        refreshFileReadout(descSibling, entry);
        const shown = [...descSibling.querySelectorAll('.descFileReadoutPath')].map((l) => l.textContent);
        expect(shown).toEqual(['src/style.css']);
    });

    it('is a no-op when the panel carries no readout (placeholder / closed panel)', () => {
        const bare = document.createElement('div');
        bare.id = 'descSibling';
        expect(() => refreshFileReadout(bare, '  - File: `src/a.js`')).not.toThrow();
        expect(bare.querySelector('.descFileReadout')).toBeNull();
    });
});

describe('parseFilePathsFromEntry — shared File: matcher', () => {
    it('parses backtick-wrapped comma-separated paths tolerant of indent and case', () => {
        expect(parseFilePathsFromEntry('   - file:  `x/y.js` , `z.css`  ')).toEqual(['x/y.js', 'z.css']);
    });
    it('returns [] with no File: line', () => {
        expect(parseFilePathsFromEntry('- [ ] Task\n  - Type: bug')).toEqual([]);
    });
    it('returns [] for a bare File: line', () => {
        expect(parseFilePathsFromEntry('  - File:')).toEqual([]);
    });
    it('reads only the first File: line', () => {
        expect(parseFilePathsFromEntry('  - File: `a`\n  - File: `b`')).toEqual(['a']);
    });
});
