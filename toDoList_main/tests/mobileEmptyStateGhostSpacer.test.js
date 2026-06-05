import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

function stripCssComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Pulls the body of the first @media (max-width: 700px) block that contains a
// rule for `selector`, then returns that rule body. Walks brace depth so nested
// blocks (e.g. the @media (max-width: 600px) child query) don't trip the
// scanner.
function extractMobileRule(css, selector) {
    const cleaned = stripCssComments(css);
    const re = /@media\s*\(\s*max-width:\s*700px\s*\)\s*\{/g;
    const selectorEsc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ruleRe = new RegExp(
        '(?:^|[},\\s])' + selectorEsc + '\\s*\\{([^}]*)\\}'
    );
    let match;
    while ((match = re.exec(cleaned)) !== null) {
        const bodyStart = match.index + match[0].length;
        let depth = 1;
        let i = bodyStart;
        for (; i < cleaned.length && depth > 0; i++) {
            if (cleaned[i] === '{') depth++;
            else if (cleaned[i] === '}') depth--;
        }
        const block = cleaned.slice(bodyStart, i - 1);
        const m = block.match(ruleRe);
        if (m) return m[1];
    }
    return null;
}

// The mobile fix for two related layout issues:
//   1. Calendar hamburger overlap — the absolute-positioned #sidebarToggle
//      collided with the calendar's next-month chevron on narrow viewports.
//      Bumping #calendarView's mobile padding-top from a +24px content offset
//      to +64px lifts the calendar header onto its own row beneath the
//      hamburger.
//   2. Empty-state void — Today and Projects views on mobile left a large
//      unanchored void below short item lists. A mobile-only flex spacer
//      anchored to the bottom of each view fills that void with a dimmed
//      purple ghost mascot and a short caption ("Nothing else due" for Today,
//      "That's all for this project" for Projects). The spacer honors the
//      existing companion-ghost preference toggle — when turned off, the
//      mascot+caption hide via visibility:hidden so the layout doesn't shift.
describe('Calendar hamburger overlap fix — #calendarView mobile padding-top', () => {
    const css = read('style.css');

    it('uses an offset of at least 60px above the safe-area floor so the calendar header clears the 44×44 hamburger button', () => {
        const rule = extractMobileRule(css, '#calendarView');
        expect(rule).not.toBeNull();
        const match = rule.match(
            /padding\s*:\s*calc\(\s*max\(\s*env\(\s*safe-area-inset-top\s*,\s*0px\s*\)\s*,\s*24px\s*\)\s*\+\s*(\d+)px\s*\)/
        );
        expect(match).not.toBeNull();
        const offset = parseInt(match[1], 10);
        // Hamburger sits at max(inset, 24) + 8 and is 44px tall, so its bottom
        // edge is max(inset, 24) + 52. The calendar header needs at least
        // ~8px of breathing room below that bottom edge.
        expect(offset).toBeGreaterThanOrEqual(60);
    });

    it('keeps the calendar safe-area inset floor at 24px so the hamburger / top chrome stay above the iOS Dynamic Island', () => {
        const rule = extractMobileRule(css, '#calendarView');
        expect(rule).not.toBeNull();
        expect(rule).toMatch(
            /max\(\s*env\(\s*safe-area-inset-top\s*,\s*0px\s*\)\s*,\s*24px\s*\)/
        );
    });
});

describe('Empty-state ghost spacer — CSS', () => {
    const css = read('style.css');
    const cleaned = stripCssComments(css);

    it('declares .viewGhostSpacer as display: none at the top level so desktop hides it entirely', () => {
        // Find a top-level (depth-0) .viewGhostSpacer rule. Walk brace depth so
        // the @media-nested override below doesn't false-match.
        let depth = 0;
        let found = false;
        for (let i = 0; i < cleaned.length; i++) {
            const c = cleaned[i];
            if (c === '{') { depth++; continue; }
            if (c === '}') { depth--; continue; }
            if (depth !== 0) continue;
            if (cleaned.slice(i).match(/^\.viewGhostSpacer\s*\{/)) {
                const blockStart = cleaned.indexOf('{', i);
                const blockEnd   = cleaned.indexOf('}', blockStart);
                const body = cleaned.slice(blockStart + 1, blockEnd);
                expect(body).toMatch(/display\s*:\s*none/);
                found = true;
                break;
            }
        }
        expect(found).toBe(true);
    });

    it('paints .viewGhostSpacer as a flex column with flex:1 inside @media (max-width: 700px) so it fills the column space', () => {
        const rule = extractMobileRule(css, '.viewGhostSpacer');
        expect(rule).not.toBeNull();
        expect(rule).toMatch(/display\s*:\s*flex/);
        expect(rule).toMatch(/flex-direction\s*:\s*column/);
        expect(rule).toMatch(/flex\s*:\s*1\s+1\s+auto/);
        expect(rule).toMatch(/justify-content\s*:\s*center/);
        expect(rule).toMatch(/align-items\s*:\s*center/);
    });

    it('reuses the ghost_purple.svg asset as the .viewGhostMascot background, dimmed to ~50% opacity', () => {
        const rule = extractMobileRule(css, '.viewGhostMascot');
        expect(rule).not.toBeNull();
        expect(rule).toMatch(/background-image\s*:\s*url\(\s*['"]?\.\/ghost_purple\.svg/);
        const opacityMatch = rule.match(/opacity\s*:\s*([\d.]+)/);
        expect(opacityMatch).not.toBeNull();
        const opacity = parseFloat(opacityMatch[1]);
        expect(opacity).toBeGreaterThanOrEqual(0.3);
        expect(opacity).toBeLessThanOrEqual(0.6);
    });

    it('hides the projects spacer while #mainList.emptyStatePresent is active so the existing welcome ghost is not doubled', () => {
        const m = cleaned.match(
            /#mainList\.emptyStatePresent\s+#projectsGhostSpacer\s*\{([^}]*)\}/
        );
        expect(m).not.toBeNull();
        expect(m[1]).toMatch(/display\s*:\s*none/);
    });

    it('keeps the spacer\'s reserved space (visibility:hidden, not display:none) when body.companion-ghost-off is set', () => {
        const m = cleaned.match(
            /body\.companion-ghost-off\s+\.viewGhostMascot\s*,\s*body\.companion-ghost-off\s+\.viewGhostCaption\s*\{([^}]*)\}/
        );
        expect(m).not.toBeNull();
        expect(m[1]).toMatch(/visibility\s*:\s*hidden/);
        // Crucially NOT display:none so the spacer's flex space stays put and
        // the layout doesn't shift when the user flips the toggle.
        expect(m[1]).not.toMatch(/display\s*:\s*none/);
    });
});

describe('Empty-state ghost spacer — main.js Inbox view wiring', () => {
    const js = read('main.js');

    it('appends a #inboxGhostSpacer with the painted mascot and caption to #inboxView', () => {
        expect(js).toMatch(/inboxGhostSpacer\.id\s*=\s*['"]inboxGhostSpacer['"]/);
        expect(js).toMatch(/inboxGhostSpacer\.className\s*=\s*['"]viewGhostSpacer['"]/);
        expect(js).toMatch(/inboxGhostMascot\.className\s*=\s*['"]viewGhostMascot['"]/);
        expect(js).toMatch(/inboxGhostCaption\.className\s*=\s*['"]viewGhostCaption['"]/);
        expect(js).toMatch(/inboxGhostCaption\.textContent\s*=\s*['"]Nothing else due['"]/);
        // The spacer is the last child appended to inboxView so it sits below
        // the date header, count summary, sections, and #inboxEmpty.
        expect(js).toMatch(/inboxView\.appendChild\(\s*inboxGhostSpacer\s*\)/);
    });

    it('defines applyCompanionGhostPreference and wires it to the initial boot + the two ghost-toggle handlers', () => {
        expect(js).toMatch(/function\s+applyCompanionGhostPreference\s*\(/);
        // Initial boot reads the pref onto body once the body exists.
        expect(js).toMatch(/setTimeout\(\s*applyCompanionGhostPreference/);
        // Both toggle handlers (desktop settings menu + mobile drawer) call
        // applyCompanionGhostPreference after flipping the pref so the mobile
        // ghosts hide/show without waiting for a re-render.
        const occurrences = js.match(/applyCompanionGhostPreference\s*\(\s*\)/g) || [];
        expect(occurrences.length).toBeGreaterThanOrEqual(2);
    });
});

describe('Empty-state ghost spacer — emptyState.js Projects view wiring', () => {
    const js = read('emptyState.js');

    it('defines ensureMainListGhostSpacer with the spec\'d caption and the purple ghost mascot element', () => {
        expect(js).toMatch(/function\s+ensureMainListGhostSpacer\s*\(/);
        expect(js).toMatch(/['"]projectsGhostSpacer['"]/);
        expect(js).toMatch(/['"]viewGhostSpacer['"]/);
        expect(js).toMatch(/['"]viewGhostMascot['"]/);
        expect(js).toMatch(/['"]viewGhostCaption['"]/);
        expect(js).toMatch(/That's all for this project/);
    });

    it('ensures the spacer is the last child of #mainList so subsequent row appends do not strand it mid-list', () => {
        // The helper compares mainListDiv.lastChild === spacer and re-appends
        // if not — that's the move-to-end contract.
        expect(js).toMatch(/lastChild\s*!==\s*spacer/);
        expect(js).toMatch(/appendChild\s*\(\s*spacer\s*\)/);
    });

    it('is called from updateEmptyState\'s three return paths so every render leaves the spacer present', () => {
        // The fn body contains three callsites: case A (no rows), case B/C
        // (open > 0), and the trailing case (empty state painted).
        const callsites = js.match(/ensureMainListGhostSpacer\s*\(\s*mainListDiv\s*\)/g) || [];
        expect(callsites.length).toBeGreaterThanOrEqual(3);
    });
});
