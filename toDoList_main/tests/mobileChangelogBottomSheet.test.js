import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { openChangelogMobileSheet, isAnyMobileSheetOpen } from '../src/mobileSheets.js';
import { changelog, renderChangelogEntries } from '../src/changelog.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the mobile changelog bottom sheet opened from the
// Settings modal's About → Version row. The sheet reuses the COMPLETED /
// viewer sheet shell and renders the changelog through the shared
// renderChangelogEntries() so the desktop modal and the mobile sheet can
// never drift. The open/close machinery is importable in jsdom (it has no
// main.js dependency), so these are runtime tests; the Version-row wiring
// lives in main.js (too large to instantiate) and is pinned by source.
describe('renderChangelogEntries (shared changelog renderer)', () => {
    it('renders one .changelogEntry section per changelog entry', () => {
        const host = document.createElement('div');
        renderChangelogEntries(host);
        const entries = host.querySelectorAll('.changelogEntry');
        expect(entries.length).toBe(changelog.length);
    });

    it('renders the version, date, group labels, and bullets for an entry', () => {
        const host = document.createElement('div');
        renderChangelogEntries(host);
        const first = host.querySelector('.changelogEntry');
        expect(first.querySelector('.changelogEntryVersion').textContent)
            .toBe('v' + changelog[0].version);
        expect(first.querySelector('.changelogEntryDate').textContent)
            .toBe(changelog[0].date);
        // Every populated category produces a label + a <ul> of bullets.
        const totalBullets = ['added', 'changed', 'fixed']
            .map((k) => (changelog[0][k] || []).length)
            .reduce((a, b) => a + b, 0);
        expect(first.querySelectorAll('.changelogBullets li').length).toBe(totalBullets);
    });

    it('returns the container and is a no-op on a null container', () => {
        const host = document.createElement('div');
        expect(renderChangelogEntries(host)).toBe(host);
        expect(() => renderChangelogEntries(null)).not.toThrow();
    });
});

describe('Mobile changelog bottom sheet', () => {
    afterEach(() => {
        // Tear down any sheet left open so state doesn't leak between tests.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        const stray = document.getElementById('changelogMobileSheetBackdrop');
        if (stray && stray.parentNode) stray.parentNode.removeChild(stray);
    });

    it('builds a dialog sheet with role + aria-modal + a label tying to its title', () => {
        openChangelogMobileSheet();
        const sheet = document.getElementById('changelogMobileSheet');
        expect(sheet).not.toBeNull();
        expect(sheet.getAttribute('role')).toBe('dialog');
        expect(sheet.getAttribute('aria-modal')).toBe('true');
        expect(sheet.getAttribute('aria-labelledby')).toBe('changelogMobileSheetTitle');
        const title = document.getElementById('changelogMobileSheetTitle');
        expect(title.textContent).toBe('Changelog');
    });

    it('renders the changelog into the sheet body via the shared renderer', () => {
        openChangelogMobileSheet();
        const body = document.getElementById('changelogMobileSheetBody');
        expect(body).not.toBeNull();
        expect(body.querySelectorAll('.changelogEntry').length).toBe(changelog.length);
    });

    it('reports open via isAnyMobileSheetOpen while showing', () => {
        expect(isAnyMobileSheetOpen()).toBe(false);
        openChangelogMobileSheet();
        expect(isAnyMobileSheetOpen()).toBe(true);
    });

    it('is idempotent — a second open call does not stack a second backdrop', () => {
        openChangelogMobileSheet();
        openChangelogMobileSheet();
        expect(document.querySelectorAll('#changelogMobileSheetBackdrop').length).toBe(1);
    });

    it('closes on the X button click', () => {
        openChangelogMobileSheet();
        const closeX = document.querySelector('#changelogMobileSheet .completedMobileSheetClose');
        expect(closeX).not.toBeNull();
        closeX.click();
        expect(document.getElementById('changelogMobileSheetBackdrop')).toBeNull();
        expect(isAnyMobileSheetOpen()).toBe(false);
    });

    it('closes on a backdrop tap (but not on a tap inside the sheet)', () => {
        openChangelogMobileSheet();
        const sheet = document.getElementById('changelogMobileSheet');
        // A click that originates inside the sheet must NOT close it.
        sheet.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.getElementById('changelogMobileSheetBackdrop')).not.toBeNull();
        // A click on the backdrop itself closes it.
        const backdrop = document.getElementById('changelogMobileSheetBackdrop');
        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.getElementById('changelogMobileSheetBackdrop')).toBeNull();
    });

    it('closes on Escape', () => {
        openChangelogMobileSheet();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(document.getElementById('changelogMobileSheetBackdrop')).toBeNull();
    });

    it('marks the newest changelog entry seen on open (clears the unseen-dot baseline)', () => {
        try { localStorage.removeItem('todoapp_changelogLastSeen'); } catch (_) { /* */ }
        openChangelogMobileSheet();
        expect(localStorage.getItem('todoapp_changelogLastSeen')).toBe(changelog[0].date);
    });
});

describe('Mobile changelog sheet — source + style pins', () => {
    const main = read('main.js');
    const sheets = read('mobileSheets.js');
    const css = read('style.css');

    it('wires the four-affordance close vocabulary in mobileSheets.js', () => {
        const fnIdx = sheets.indexOf('function openChangelogMobileSheet(');
        expect(fnIdx).toBeGreaterThan(-1);
        const slice = sheets.slice(fnIdx, fnIdx + 4000);
        expect(slice).toMatch(/closeX\.addEventListener\(\s*['"]click['"]\s*,\s*closeChangelogMobileSheet\s*\)/);
        expect(slice).toMatch(/backdrop\.addEventListener\(\s*['"]click['"][\s\S]{0,200}event\.target\s*===\s*backdrop[\s\S]{0,120}closeChangelogMobileSheet/);
        expect(slice).toMatch(/event\.key\s*!==\s*['"]Escape['"]/);
        expect(slice).toMatch(/addEventListener\(\s*['"]keydown['"]\s*,\s*onKeydown\s*,\s*true\s*\)/);
        expect(slice).toMatch(/attachCompletedSheetSwipeDown\(\s*handle\s*,/);
        expect(slice).toMatch(/attachCompletedSheetSwipeDown\(\s*headerEl\s*,/);
    });

    it('renders the body through the shared renderChangelogEntries import', () => {
        expect(sheets).toMatch(/import\s*\{[^}]*renderChangelogEntries[^}]*\}\s*from\s*['"]\.\/changelog\.js['"]/);
        const fnIdx = sheets.indexOf('function openChangelogMobileSheet(');
        const slice = sheets.slice(fnIdx, fnIdx + 4000);
        expect(slice).toMatch(/renderChangelogEntries\(\s*body\s*\)/);
    });

    it('makes the About → Version row a tappable changelog affordance in main.js', () => {
        const idx = main.indexOf("aboutSection.querySelector('.drawerInfoRow')");
        expect(idx).toBeGreaterThan(-1);
        const slice = main.slice(idx, idx + 2200);
        expect(slice).toMatch(/versionRow\.classList\.add\(\s*['"]drawerInfoRow--tappable['"]\s*\)/);
        expect(slice).toMatch(/versionRow\.setAttribute\(\s*['"]role['"]\s*,\s*['"]button['"]\s*\)/);
        expect(slice).toMatch(/versionRow\.setAttribute\(\s*['"]aria-haspopup['"]\s*,\s*['"]dialog['"]\s*\)/);
        expect(slice).toMatch(/openChangelogMobileSheet\(\s*\)/);
        // Enter / Space keyboard activation parity with a real button.
        expect(slice).toMatch(/event\.key\s*===\s*['"]Enter['"]/);
    });

    it('keeps the Version row pinned to createDrawerInfoRow with the v1.1 value (unchanged contract)', () => {
        expect(main).toMatch(
            /aboutSection\.appendChild\(\s*createDrawerInfoRow\(\s*['"]Version['"][\s\S]{0,120}return\s*['"]v1\.1['"]/
        );
    });

    it('stops the update pill click from also opening the changelog', () => {
        const idx = main.indexOf('updatePill.addEventListener');
        expect(idx).toBeGreaterThan(-1);
        const slice = main.slice(idx, idx + 600);
        expect(slice).toMatch(/updatePill\.addEventListener\(\s*['"]click['"][\s\S]{0,400}stopPropagation\(\s*\)/);
    });

    it('styles the sheet as a bottom-anchored slide-up overlay', () => {
        const backdropBlock = css.match(/#changelogMobileSheetBackdrop\s*\{[^}]*\}/);
        expect(backdropBlock).toBeTruthy();
        expect(backdropBlock[0]).toMatch(/position:\s*fixed/);
        expect(backdropBlock[0]).toMatch(/align-items:\s*flex-end/);
        const sheetBlock = css.match(/#changelogMobileSheet\s*\{[^}]*\}/);
        expect(sheetBlock).toBeTruthy();
        expect(sheetBlock[0]).toMatch(/transform:\s*translateY\(100%\)/);
        expect(css).toMatch(/#changelogMobileSheetBackdrop\.is-open\s+#changelogMobileSheet\s*\{[\s\S]*?transform:\s*translateY\(0\)/);
    });

    it('gives the tappable Version row pointer + press feedback and a proper touch target', () => {
        const block = css.match(/\.drawerInfoRow--tappable\s*\{[^}]*\}/);
        expect(block).toBeTruthy();
        expect(block[0]).toMatch(/cursor:\s*pointer/);
        // Touch target height is inherited from .drawerInfoRow (min-height:44px).
        const baseRow = css.match(/\.drawerInfoRow\s*\{[^}]*\}/);
        expect(baseRow[0]).toMatch(/min-height:\s*44px/);
        expect(css).toMatch(/\.drawerInfoRow--tappable:active\s*\{[^}]*background/);
    });
});
