// Light/dark theme module.
//
// Dark is the default; light is a user-toggleable alternative. The chosen
// theme is expressed as a `data-theme` attribute on <html>, which CSS
// variable overrides in style.css key off. main.js calls `applyTheme(
// resolveInitialTheme())` at module load (before component() builds the DOM)
// so the first paint already matches the saved preference — no dark-to-light
// flash on reload.
//
// Theme persistence stays alongside this module rather than living in
// prefs.js because the read happens during the synchronous boot path before
// any other preference is touched.

export const THEME_KEY = 'todoapp_theme';

function readStoredTheme() {
    try {
        const saved = localStorage.getItem(THEME_KEY);
        return saved === 'light' || saved === 'dark' ? saved : null;
    } catch (e) {
        return null;
    }
}

export function resolveInitialTheme() {
    const saved = readStoredTheme();
    if (saved) return saved;
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        return 'light';
    }
    return 'dark';
}

export function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
}

export function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

// Pixel-art sun + moon — 7×7 grids of 1-unit rects, rendered with
// shape-rendering="crispEdges" so the squares stay aliased even at small
// sizes. Matches the chunky 1px-grid feel of the companion ghost.
export const MOON_SVG = '<svg class="themeIcon themeIconMoon" viewBox="0 0 7 7" width="16" height="16" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">' +
    '<rect x="2" y="0" width="2" height="1"/>' +
    '<rect x="1" y="1" width="2" height="1"/>' +
    '<rect x="0" y="2" width="2" height="3"/>' +
    '<rect x="1" y="5" width="2" height="1"/>' +
    '<rect x="2" y="6" width="2" height="1"/>' +
    '</svg>';
export const SUN_SVG  = '<svg class="themeIcon themeIconSun" viewBox="0 0 7 7" width="16" height="16" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">' +
    '<rect x="3" y="0" width="1" height="1"/>' +
    '<rect x="1" y="1" width="1" height="1"/>' +
    '<rect x="5" y="1" width="1" height="1"/>' +
    '<rect x="2" y="2" width="3" height="3"/>' +
    '<rect x="0" y="3" width="1" height="1"/>' +
    '<rect x="6" y="3" width="1" height="1"/>' +
    '<rect x="1" y="5" width="1" height="1"/>' +
    '<rect x="5" y="5" width="1" height="1"/>' +
    '<rect x="3" y="6" width="1" height="1"/>' +
    '</svg>';

// Builds and wires the theme-toggle button. The visible glyph represents the
// *target* mode — moon when light is active (tap to go dark), sun when dark
// is active (tap to go light); CSS cross-fades and rotates the two layered
// SVGs on theme change. Caller is responsible for appending the returned
// button to the DOM.
export function createThemeToggleButton() {
    const themeToggle = document.createElement('button');
    themeToggle.id   = 'themeToggle';
    themeToggle.type = 'button';
    themeToggle.setAttribute('aria-label', 'Toggle light theme');
    themeToggle.innerHTML = MOON_SVG + SUN_SVG;

    function syncThemeToggle() {
        themeToggle.setAttribute('aria-pressed', getCurrentTheme() === 'light' ? 'true' : 'false');
    }
    syncThemeToggle();

    themeToggle.addEventListener('click', function () {
        const next = getCurrentTheme() === 'light' ? 'dark' : 'light';
        document.documentElement.classList.add('theme-transitioning');
        applyTheme(next);
        try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore quota/private-mode */ }
        syncThemeToggle();
        setTimeout(function () {
            document.documentElement.classList.remove('theme-transitioning');
        }, 220);
    });

    return themeToggle;
}
