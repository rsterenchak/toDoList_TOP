// Pins the color-warn behavior on the last-exported footer label. The
// label color and the inline triangle glyph escalate as the gap since the
// last export grows, giving users a passive backup nudge without a new
// timer or dependency.
//
// Thresholds (must match exportImport.js):
//   - under 3 days  → fresh (muted gray, no glyph)
//   - 3 to 7 days   → warn  (amber, glyph)
//   - over 7 days   → urgent (red, glyph)
//   - never exported / unparseable → urgent (red, glyph)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
    exportStalenessState,
    refreshFooterExportLabel,
} from '../src/exportImport.js';
import {
    LAST_EXPORTED_AT_KEY,
    writeLastExportedAt,
} from '../src/prefs.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(rel) { return readFileSync(resolve(srcDir, rel), 'utf8'); }

const NOW = new Date('2026-05-04T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysAgo(days) {
    return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}


describe('exportStalenessState — boundary thresholds', () => {

    it('returns "urgent" when no timestamp has been recorded', () => {
        expect(exportStalenessState(null, NOW)).toBe('urgent');
        expect(exportStalenessState(undefined, NOW)).toBe('urgent');
        expect(exportStalenessState('', NOW)).toBe('urgent');
    });

    it('returns "urgent" when the stored value is unparseable', () => {
        expect(exportStalenessState('not-a-date', NOW)).toBe('urgent');
    });

    it('returns "fresh" for exports under 3 days old', () => {
        expect(exportStalenessState(isoDaysAgo(0), NOW)).toBe('fresh');
        expect(exportStalenessState(isoDaysAgo(1), NOW)).toBe('fresh');
        expect(exportStalenessState(isoDaysAgo(2), NOW)).toBe('fresh');
        // Just shy of the 3-day boundary still reads as fresh.
        const justUnder = new Date(NOW.getTime() - (3 * DAY_MS - 1)).toISOString();
        expect(exportStalenessState(justUnder, NOW)).toBe('fresh');
    });

    it('returns "warn" between 3 and 7 days, inclusive', () => {
        expect(exportStalenessState(isoDaysAgo(3), NOW)).toBe('warn');
        expect(exportStalenessState(isoDaysAgo(5), NOW)).toBe('warn');
        expect(exportStalenessState(isoDaysAgo(7), NOW)).toBe('warn');
    });

    it('returns "urgent" past 7 days', () => {
        expect(exportStalenessState(isoDaysAgo(8), NOW)).toBe('urgent');
        expect(exportStalenessState(isoDaysAgo(30), NOW)).toBe('urgent');
        expect(exportStalenessState(isoDaysAgo(365), NOW)).toBe('urgent');
    });
});


describe('refreshFooterExportLabel — color state class + glyph', () => {

    beforeEach(() => {
        try { localStorage.removeItem(LAST_EXPORTED_AT_KEY); } catch (e) { /* ignore */ }
        const stale = document.getElementById('footExport');
        if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
        const span = document.createElement('span');
        span.id = 'footExport';
        document.body.appendChild(span);
    });

    it('marks the never-exported state as urgent and renders the glyph', () => {
        refreshFooterExportLabel();
        const el = document.getElementById('footExport');

        expect(el.classList.contains('footExport--urgent')).toBe(true);
        expect(el.classList.contains('footExport--warn')).toBe(false);
        expect(el.classList.contains('footExport--fresh')).toBe(false);

        // Glyph present alongside the label; SVG has no text content so
        // textContent stays equal to the label string.
        expect(el.querySelector('svg.footExportGlyph')).not.toBeNull();
        expect(el.textContent).toBe('Never synced');
    });

    it('keeps the fresh state unstyled with no glyph for sub-3-day exports', () => {
        writeLastExportedAt(new Date(Date.now() - 1 * DAY_MS).toISOString());
        refreshFooterExportLabel();
        const el = document.getElementById('footExport');

        expect(el.classList.contains('footExport--fresh')).toBe(true);
        expect(el.classList.contains('footExport--warn')).toBe(false);
        expect(el.classList.contains('footExport--urgent')).toBe(false);
        expect(el.querySelector('svg.footExportGlyph')).toBeNull();
        expect(el.textContent).toBe('Synced 1 day ago');
    });

    it('escalates to warn with the glyph at the 3-day boundary', () => {
        writeLastExportedAt(new Date(Date.now() - 3 * DAY_MS).toISOString());
        refreshFooterExportLabel();
        const el = document.getElementById('footExport');

        expect(el.classList.contains('footExport--warn')).toBe(true);
        expect(el.classList.contains('footExport--urgent')).toBe(false);
        expect(el.querySelector('svg.footExportGlyph')).not.toBeNull();
        expect(el.textContent).toBe('Synced 3 days ago');
    });

    it('escalates to urgent with the glyph past the 7-day boundary', () => {
        writeLastExportedAt(new Date(Date.now() - 10 * DAY_MS).toISOString());
        refreshFooterExportLabel();
        const el = document.getElementById('footExport');

        expect(el.classList.contains('footExport--urgent')).toBe(true);
        expect(el.classList.contains('footExport--warn')).toBe(false);
        expect(el.querySelector('svg.footExportGlyph')).not.toBeNull();
        expect(el.textContent).toBe('Synced 10 days ago');
    });

    it('does not accumulate glyphs across repeated refreshes', () => {
        writeLastExportedAt(new Date(Date.now() - 5 * DAY_MS).toISOString());
        refreshFooterExportLabel();
        refreshFooterExportLabel();
        refreshFooterExportLabel();
        const el = document.getElementById('footExport');
        expect(el.querySelectorAll('svg.footExportGlyph').length).toBe(1);
    });
});


describe('exportStaleness — CSS color states + glyph styling', () => {
    const css = read('style.css');

    it('declares the warn color rule using --text-warning', () => {
        expect(css).toMatch(
            /#footExport\.footExport--warn\s*\{[^}]*color:\s*var\(--text-warning\)/
        );
    });

    it('declares the urgent color rule using --text-danger', () => {
        expect(css).toMatch(
            /#footExport\.footExport--urgent\s*\{[^}]*color:\s*var\(--text-danger\)/
        );
    });

    it('keeps the fresh default muted gray on #footExport', () => {
        // The base rule still maps to --text-muted; the modifier classes
        // override only when the warn / urgent state is applied.
        const idx = css.indexOf('#footExport');
        expect(idx).toBeGreaterThan(-1);
        const block = css.slice(idx, idx + 600);
        expect(block).toMatch(/color:\s*var\(--text-muted\)/);
    });
});
