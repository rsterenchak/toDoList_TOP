// Tests for the mobile Settings modal's single state-aware Sync card —
// the consolidation that brings the mobile Settings modal to parity
// with the desktop ghost-menu DRIVE section. Source-level pins cover
// the structural contract; the file complements the structural pins
// in settingsModalDataGrid.test.js with a few finer-grained shape
// checks that specifically pin the click → action routing, the
// mobile-chrome glyph mirror on #drawerSettingsBtn, and the diverged
// conflict modal reuse.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(rel) { return readFileSync(resolve(srcDir, rel), 'utf8'); }


describe('mobile Settings modal Sync card — click routing reuses desktop dispatchers', () => {
    const main = read('main.js');

    // The whole point of the consolidation: the mobile card must route
    // through the SAME onDriveSyncClick / openDriveConflictPopover the
    // desktop ghost-menu Sync row routes through, so the two surfaces
    // can't drift behaviorally. Asserting the mobile card calls into
    // these top-level helpers (vs reimplementing per-state branches
    // inline) pins that contract at the source level.
    it('the mobile Sync card builder calls onDriveSyncClick (no inline state switch)', () => {
        const idx = main.indexOf('function buildSettingsModalDriveSyncCard');
        expect(idx).toBeGreaterThan(-1);
        const body = main.slice(idx, idx + 2400);
        expect(body).toMatch(/onDriveSyncClick\(\s*state\s*\)/);
    });

    it('the diverged branch reuses openDriveConflictPopover (no parallel mobile conflict surface)', () => {
        // Reuse of the existing modal primitive means mobile gets the
        // same 3-way close (X / backdrop / Escape) and the same overwrite
        // copy desktop already ships, satisfying the CLAUDE.md modal
        // contract without inventing a new pattern.
        const dispatcherIdx = main.indexOf('function onDriveSyncClick');
        expect(dispatcherIdx).toBeGreaterThan(-1);
        const body = main.slice(dispatcherIdx, dispatcherIdx + 2400);
        expect(body).toMatch(/openDriveConflictPopover\s*\(\s*\)/);
    });
});


describe('mobile Settings modal Sync card — runtime build', () => {
    // Lifts the buildSettingsModalDriveSyncCard slice and the verb /
    // sublabel helpers into a sandbox so we can exercise the card
    // shape against a real DOM. main.js is too large to instantiate
    // end-to-end in jsdom (per CLAUDE.md), so we extract just the
    // helpers under test. Anything they don't directly need (theming,
    // ghost menu, list rendering) is stubbed in the factory closure.

    const main = read('main.js');

    function extractFn(name) {
        const idx = main.indexOf('function ' + name);
        if (idx === -1) throw new Error(name + ' not found');
        const after = main.slice(idx);
        const bodyStart = after.indexOf('{');
        let depth = 0;
        for (let i = bodyStart; i < after.length; i++) {
            const c = after.charAt(i);
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) return after.slice(0, i + 1);
            }
        }
        throw new Error('unbalanced braces in ' + name);
    }

    function makeBuilder({
        state = 'synced',
        lastSyncedIso = '2026-05-22T10:00:00.000Z',
        onClickSpy = null,
    } = {}) {
        const verbFn       = extractFn('computeSettingsModalDriveSyncVerb');
        const subFn        = extractFn('computeSettingsModalDriveSyncSubLabel');
        const cardFn       = extractFn('buildSettingsModalDriveSyncCard');
        const glyphFn      = extractFn('syncStateToGlyphClass');

        // Minimal stand-ins for the closure references the slice needs.
        // The point of the test isn't to re-verify state computation
        // (that's pinned elsewhere) — it's to verify the runtime DOM
        // shape and the click-listener handoff. So getCurrentSyncState
        // is stubbed to return the seed state, and onDriveSyncClick is
        // captured via the spy.
        const source = [
            'const SYNC_GLYPH_SVG = {',
            '  "ti-cloud-check": "<svg id=\\"glyph-check\\"></svg>",',
            '  "ti-cloud-up":    "<svg id=\\"glyph-up\\"></svg>",',
            '  "ti-cloud-off":   "<svg id=\\"glyph-off\\"></svg>",',
            '  "ti-cloud-x":     "<svg id=\\"glyph-x\\"></svg>",',
            '};',
            glyphFn,
            verbFn,
            subFn,
            cardFn,
            'return buildSettingsModalDriveSyncCard;',
        ].join('\n');

        const factory = new Function(
            'document',
            'getCurrentSyncState',
            'getCachedDriveModifiedTime',
            'getCachedAccessToken',
            'readLastDriveSyncedAt',
            'formatRelativeExportedAt',
            'onDriveSyncClick',
            source
        );
        return factory(
            document,
            function() { return state; },
            function() { return null; },
            function() { return 'token'; },
            function() { return lastSyncedIso; },
            function(iso) {
                if (!iso) return 'Synced just now';
                return 'Synced 5 minutes ago';
            },
            onClickSpy || function() {}
        );
    }

    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('builds a button with the consolidated tile chrome + driveSync anchor + stable id', () => {
        const build = makeBuilder({ state: 'synced' });
        const tile = build();
        expect(tile.tagName).toBe('BUTTON');
        expect(tile.id).toBe('settingsModalDriveSyncCard');
        expect(tile.className).toContain('settingsModalDataTile');
        expect(tile.className).toContain('settingsModalDataTile--driveSync');
        expect(tile.getAttribute('data-sync-state')).toBe('synced');
    });

    it('renders icon span containing the state-mapped SVG glyph', () => {
        const build = makeBuilder({ state: 'synced' });
        const tile = build();
        const icon = tile.querySelector('.settingsModalDataTileIcon');
        expect(icon).not.toBeNull();
        expect(icon.getAttribute('data-sync-glyph')).toBe('ti-cloud-check');
        expect(icon.querySelector('#glyph-check')).not.toBeNull();
    });

    it('synced state uses the check glyph + "Sync" verb + relative-time sublabel', () => {
        const build = makeBuilder({ state: 'synced' });
        const tile = build();
        expect(tile.querySelector('.settingsModalDataTileVerb').textContent).toBe('Sync');
        expect(tile.querySelector('.settingsModalDataTileSub').textContent)
            .toMatch(/^Synced/);
    });

    it('never state uses the off glyph + "Connect" verb + "Sign in to Drive" sublabel', () => {
        const build = makeBuilder({ state: 'never' });
        const tile = build();
        expect(tile.getAttribute('data-sync-state')).toBe('never');
        expect(tile.querySelector('.settingsModalDataTileIcon')
            .getAttribute('data-sync-glyph')).toBe('ti-cloud-off');
        expect(tile.querySelector('.settingsModalDataTileVerb').textContent).toBe('Connect');
        expect(tile.querySelector('.settingsModalDataTileSub').textContent).toBe('Sign in to Drive');
    });

    it('diverged state uses the x glyph + "Sync" verb + "Conflict — tap to resolve" sublabel', () => {
        const build = makeBuilder({ state: 'diverged' });
        const tile = build();
        expect(tile.querySelector('.settingsModalDataTileIcon')
            .getAttribute('data-sync-glyph')).toBe('ti-cloud-x');
        expect(tile.querySelector('.settingsModalDataTileSub').textContent)
            .toBe('Conflict — tap to resolve');
    });

    it('ahead/behind states share the cloud-up glyph but show direction-specific sublabels', () => {
        const ahead = makeBuilder({ state: 'ahead' })();
        const behind = makeBuilder({ state: 'behind' })();
        expect(ahead.querySelector('.settingsModalDataTileIcon')
            .getAttribute('data-sync-glyph')).toBe('ti-cloud-up');
        expect(behind.querySelector('.settingsModalDataTileIcon')
            .getAttribute('data-sync-glyph')).toBe('ti-cloud-up');
        expect(ahead.querySelector('.settingsModalDataTileSub').textContent)
            .toBe('Local has unsaved changes');
        expect(behind.querySelector('.settingsModalDataTileSub').textContent)
            .toBe('Drive is newer');
    });

    it('failed state uses the off glyph + "Sync failed — tap to retry" sublabel', () => {
        const tile = makeBuilder({ state: 'failed' })();
        expect(tile.querySelector('.settingsModalDataTileIcon')
            .getAttribute('data-sync-glyph')).toBe('ti-cloud-off');
        expect(tile.querySelector('.settingsModalDataTileSub').textContent)
            .toBe('Sync failed — tap to retry');
    });

    it('in-flight states (syncing-push / syncing-pull) disable the card and spin the icon', () => {
        const push = makeBuilder({ state: 'syncing-push' })();
        const pull = makeBuilder({ state: 'syncing-pull' })();
        expect(push.disabled).toBe(true);
        expect(push.getAttribute('aria-disabled')).toBe('true');
        expect(push.querySelector('.settingsModalDataTileIcon').className)
            .toContain('settingsModalDataTileIcon--spinning');
        expect(pull.disabled).toBe(true);
        expect(pull.querySelector('.settingsModalDataTileVerb').textContent)
            .toBe('Syncing…');
    });

    it('clicking the card in a non-in-flight state calls onDriveSyncClick with the current state', () => {
        const calls = [];
        const build = makeBuilder({
            state: 'ahead',
            onClickSpy: function(s) { calls.push(s); },
        });
        const tile = build();
        tile.click();
        expect(calls).toEqual(['ahead']);
    });

    it('clicking the card in an in-flight state is a no-op (no listener attached)', () => {
        const calls = [];
        const build = makeBuilder({
            state: 'syncing-push',
            onClickSpy: function(s) { calls.push(s); },
        });
        const tile = build();
        tile.click();
        expect(calls).toEqual([]);
    });
});


describe('mobile chrome sync-state glyph — drawerSettingsBtn badge', () => {
    const main = read('main.js');
    const css  = read('style.css');

    it('the drawer Settings button mounts a sibling sync badge alongside the label span', () => {
        // Two siblings inside the button: a dedicated label span (so the
        // "Settings" text doesn't pollute the badge's positioning) and
        // the badge itself. Pinning the source order keeps the badge
        // from re-landing as the button's textContent (which would
        // overwrite "Settings" the moment paintSyncBadge runs).
        expect(main).toMatch(/drawerSettingsBtnLabel\.textContent\s*=\s*['"]Settings['"]/);
        expect(main).toMatch(/drawerSettingsBtnSyncBadge\.id\s*=\s*['"]drawerSettingsBtnSyncBadge['"]/);
        const labelIdx = main.indexOf('drawerSettingsBtn.appendChild(drawerSettingsBtnLabel)');
        const badgeIdx = main.indexOf('drawerSettingsBtn.appendChild(drawerSettingsBtnSyncBadge)');
        expect(labelIdx).toBeGreaterThan(-1);
        expect(badgeIdx).toBeGreaterThan(labelIdx);
    });

    it('paintAllSyncBadges paints the new drawer badge (state mirror with the ghost-icon overlay)', () => {
        // The single paint pipeline drives the desktop ghost-icon overlay,
        // the desktop DRIVE menu badge, AND the mobile drawer badge —
        // one state read fans out to every surface.
        const idx = main.indexOf('function paintAllSyncBadges');
        expect(idx).toBeGreaterThan(-1);
        const body = main.slice(idx, idx + 1500);
        expect(body).toMatch(/drawerSettingsBtnSyncBadge/);
    });

    it('CSS positions the badge inside the relatively-positioned Settings button', () => {
        // The button gets `position: relative` so the absolutely-
        // positioned badge anchors to it instead of escaping out to the
        // first ancestor with positioning context.
        expect(css).toMatch(/#drawerSettingsBtn\s*\{[^}]*position:\s*relative/);
        expect(css).toMatch(/\.drawerSettingsBtnSyncBadge\s*\{[^}]*position:\s*absolute/);
    });

    it('CSS state-color rules mirror the ghost-icon overlay palette (success / warning / danger / muted)', () => {
        expect(css).toMatch(/\.drawerSettingsBtnSyncBadge\[data-sync-state="synced"\]/);
        expect(css).toMatch(/\.drawerSettingsBtnSyncBadge\[data-sync-state="ahead"\]/);
        expect(css).toMatch(/\.drawerSettingsBtnSyncBadge\[data-sync-state="behind"\]/);
        expect(css).toMatch(/\.drawerSettingsBtnSyncBadge\[data-sync-state="diverged"\]/);
        expect(css).toMatch(/\.drawerSettingsBtnSyncBadge\[data-sync-state="failed"\]/);
        expect(css).toMatch(/\.drawerSettingsBtnSyncBadge\[data-sync-state="never"\]/);
    });
});


describe('mobile Settings modal — event subscription teardown', () => {
    // Sanity check: the named handler references the modal registers for
    // driveSyncStateChanged / driveConnectionChanged must be the SAME
    // identifiers passed to removeEventListener inside close(). A bug
    // here (e.g., anonymous wrappers passed at registration time) would
    // leak the listener and re-render dead modal nodes on every state
    // tick after the modal closes.
    const main = read('main.js');

    function extractFn(name) {
        const idx = main.indexOf('function ' + name);
        if (idx === -1) throw new Error(name + ' not found');
        const after = main.slice(idx);
        const bodyStart = after.indexOf('{');
        let depth = 0;
        for (let i = bodyStart; i < after.length; i++) {
            const c = after.charAt(i);
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) return after.slice(0, i + 1);
            }
        }
        throw new Error('unbalanced braces in ' + name);
    }

    it('registers and removes the same named handler for driveSyncStateChanged', () => {
        const body = extractFn('showSettingsModal');
        const addMatches = body.match(
            /addEventListener\(\s*['"]driveSyncStateChanged['"]\s*,\s*(\w+)/g
        ) || [];
        const removeMatches = body.match(
            /removeEventListener\(\s*['"]driveSyncStateChanged['"]\s*,\s*(\w+)/g
        ) || [];
        expect(addMatches.length).toBe(1);
        expect(removeMatches.length).toBe(1);
        const addIdent    = addMatches[0].match(/,\s*(\w+)/)[1];
        const removeIdent = removeMatches[0].match(/,\s*(\w+)/)[1];
        expect(addIdent).toBe(removeIdent);
    });

    it('registers and removes the same named handler for driveConnectionChanged', () => {
        const body = extractFn('showSettingsModal');
        const addMatches = body.match(
            /addEventListener\(\s*['"]driveConnectionChanged['"]\s*,\s*(\w+)/g
        ) || [];
        const removeMatches = body.match(
            /removeEventListener\(\s*['"]driveConnectionChanged['"]\s*,\s*(\w+)/g
        ) || [];
        expect(addMatches.length).toBe(1);
        expect(removeMatches.length).toBe(1);
        const addIdent    = addMatches[0].match(/,\s*(\w+)/)[1];
        const removeIdent = removeMatches[0].match(/,\s*(\w+)/)[1];
        expect(addIdent).toBe(removeIdent);
    });
});
