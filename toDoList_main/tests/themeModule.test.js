import {
    THEMES,
    THEME_KEY,
    LAST_DARK_THEME_KEY,
    readStoredTheme,
    getCurrentTheme,
    getLastDarkTheme,
    nextThemeInCycle,
    switchTheme,
    createThemeToggleButton,
} from '../src/theme.js';
import { buildThemeSelectorRow } from '../src/drawerRows.js';

// Behavioural pins for the three-theme model: Void ('dark', default), Light,
// and Phosphor. Stored ids are validated against THEMES, the menu cycle runs
// Dark → Light → Phosphor, and the sun/moon button returns from Light to the
// last dark theme used.
describe('theme.js — three-theme model', () => {
    beforeEach(() => {
        localStorage.clear();
        document.documentElement.removeAttribute('data-theme');
        document.documentElement.classList.remove('theme-transitioning');
    });

    it('lists dark, light and phosphor', () => {
        expect(THEMES).toEqual(['dark', 'light', 'phosphor']);
    });

    it('readStoredTheme accepts every listed id, including phosphor', () => {
        THEMES.forEach((id) => {
            localStorage.setItem(THEME_KEY, id);
            expect(readStoredTheme()).toBe(id);
        });
    });

    it('readStoredTheme rejects unknown ids and a missing key', () => {
        expect(readStoredTheme()).toBeNull();
        ['solarized', 'Phosphor', '', 'void'].forEach((id) => {
            localStorage.setItem(THEME_KEY, id);
            expect(readStoredTheme()).toBeNull();
        });
    });

    it('getCurrentTheme returns the data-theme value, falling back to dark', () => {
        expect(getCurrentTheme()).toBe('dark');
        document.documentElement.setAttribute('data-theme', 'phosphor');
        expect(getCurrentTheme()).toBe('phosphor');
        document.documentElement.setAttribute('data-theme', 'light');
        expect(getCurrentTheme()).toBe('light');
        document.documentElement.setAttribute('data-theme', 'bogus');
        expect(getCurrentTheme()).toBe('dark');
    });

    it('cycles Dark → Light → Phosphor → Dark', () => {
        expect(nextThemeInCycle('dark')).toBe('light');
        expect(nextThemeInCycle('light')).toBe('phosphor');
        expect(nextThemeInCycle('phosphor')).toBe('dark');
    });

    it('switchTheme applies, persists, marks the transition and remembers dark picks', () => {
        switchTheme('phosphor');
        expect(document.documentElement.getAttribute('data-theme')).toBe('phosphor');
        expect(document.documentElement.classList.contains('theme-transitioning')).toBe(true);
        expect(localStorage.getItem(THEME_KEY)).toBe('phosphor');
        expect(localStorage.getItem(LAST_DARK_THEME_KEY)).toBe('phosphor');

        switchTheme('light');
        expect(localStorage.getItem(THEME_KEY)).toBe('light');
        expect(localStorage.getItem(LAST_DARK_THEME_KEY)).toBe('phosphor');
    });

    it('the sun/moon button returns from Light to the last dark theme used', () => {
        const btn = createThemeToggleButton();
        expect(getLastDarkTheme()).toBe('dark');

        switchTheme('phosphor');
        btn.click();
        expect(getCurrentTheme()).toBe('light');
        btn.click();
        expect(getCurrentTheme()).toBe('phosphor');

        switchTheme('dark');
        btn.click();
        btn.click();
        expect(getCurrentTheme()).toBe('dark');
    });

    it('the settings Theme row selects each theme and marks the active segment', () => {
        document.documentElement.setAttribute('data-theme', 'dark');
        const { row } = buildThemeSelectorRow();
        const segs = Array.from(row.querySelectorAll('.drawerThemeSeg'));
        expect(segs.map((s) => s.textContent)).toEqual(['Void', 'Light', 'Phosphor']);
        expect(segs[0].getAttribute('aria-checked')).toBe('true');

        segs[2].click();
        expect(getCurrentTheme()).toBe('phosphor');
        expect(localStorage.getItem(THEME_KEY)).toBe('phosphor');
        expect(segs[2].classList.contains('selected')).toBe(true);
        expect(segs[0].getAttribute('aria-checked')).toBe('false');

        segs[1].click();
        expect(getCurrentTheme()).toBe('light');
        expect(segs[1].getAttribute('aria-checked')).toBe('true');
    });
});
