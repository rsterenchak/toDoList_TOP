// Shared mobile-viewport check. Lives in its own tiny module so both
// main.js and mobileSheets.js can import it without forming a circular
// import. Keep the `< 1024` comparison exactly as-is — it's the invariant
// that keeps jsdom's 1024px default in desktop mode for tests.
export function isMobileViewport() {
    return typeof window !== 'undefined' && window.innerWidth < 1024;
}
