import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Locks in the mobile sidebar backdrop fix. The bug was: with the projects
// drawer open on mobile, the tasks pane stayed bright and tappable — #mainBar
// is position:relative with no z-index, so any positioned task-pane child
// with a z-index above the overlay's 8 painted over #sidebarOverlay, and taps
// meant for the drawer landed on todo rows. The fix (mobile only):
// - #sidebarOverlay dims deeper (rgba(0,0,0,0.68)) with blur(3px)
// - while #sideBar.sidebar-open, its sibling #mainBar is pinned to its own
//   z-index:0 stacking context (below the overlay's 8, so the overlay sits
//   between the tasks pane and the z-index:9 drawer) and stops taking taps
// Desktop keeps the original backdrop and the click-to-close wiring.
describe('Mobile sidebar overlay blocks and darkens the tasks pane', () => {
    const css = read('style.css');
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

    function mediaBody(query) {
        const media = stripped.indexOf(query);
        expect(media).toBeGreaterThan(-1);
        let depth = 0;
        const open = stripped.indexOf('{', media);
        for (let i = open; i < stripped.length; i++) {
            if (stripped[i] === '{') depth++;
            else if (stripped[i] === '}') {
                depth--;
                if (depth === 0) return stripped.slice(open + 1, i);
            }
        }
        return stripped.slice(open + 1);
    }

    function rule(haystack, selector) {
        const esc = selector.replace(/[#.~()]/g, m => '\\' + m).replace(/\s+/g, '\\s*');
        const match = haystack.match(new RegExp('(?:^|[}\\s])' + esc + '\\s*\\{([^}]*)\\}'));
        expect(match, 'expected a rule for ' + selector).not.toBeNull();
        return match[1];
    }

    const mobile = mediaBody('@media (max-width: 1023px)');

    it('deepens the mobile backdrop dim and blur', () => {
        const r = rule(mobile, '#sidebarOverlay');
        expect(r).toMatch(/background:\s*rgba\(0,\s*0,\s*0,\s*0?\.68\)/);
        expect(r).toMatch(/(?:^|[;\s])backdrop-filter:\s*blur\(3px\)/);
        expect(r).toMatch(/-webkit-backdrop-filter:\s*blur\(3px\)/);
    });

    it('stacks the overlay between the tasks pane and the drawer', () => {
        const overlay = rule(stripped, '#sidebarOverlay');
        const overlayZ = Number(overlay.match(/z-index:\s*(\d+)/)[1]);
        const side = rule(mobile, '#sideBar');
        const sideZ = Number(side.match(/z-index:\s*(\d+)/)[1]);
        const pane = rule(mobile, '#sideBar.sidebar-open ~ #mainBar');
        const paneZ = Number(pane.match(/z-index:\s*(\d+)/)[1]);
        expect(sideZ).toBe(9);
        expect(overlayZ).toBeLessThan(sideZ);
        expect(paneZ).toBeLessThan(overlayZ);
    });

    it('stops the tasks pane taking taps while the drawer is open', () => {
        const pane = rule(mobile, '#sideBar.sidebar-open ~ #mainBar');
        expect(pane).toMatch(/pointer-events:\s*none/);
    });

    it('leaves the desktop backdrop untouched', () => {
        const desktop = mediaBody('@media (min-width: 1024px)');
        expect(desktop).not.toMatch(/#sidebarOverlay\s*\{/);
        expect(desktop).not.toMatch(/sidebar-open\s*~\s*#mainBar/);
        const base = rule(stripped, '#sidebarOverlay');
        expect(base).toMatch(/background:\s*rgba\(0,0,0,0\.5\)/);
    });

    it('keeps the backdrop click-to-close wiring', () => {
        const main = read('main.js');
        expect(main).toMatch(/sidebarOverlay\.addEventListener\(\s*['"]click['"]\s*,\s*closeSidebar\s*\)/);
    });
});
