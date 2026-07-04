import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the -20px upward nudge of the drawer Settings button. The button
// (#drawerSettingsBtn) is a flex-centered item inside #drawerSettingsBtnWrap
// within the ≤1023px mobile drawer. The nudge is applied as a relative
// `top: -20px` offset so it shifts up without reflowing its reserved box —
// keeping the footer sibling below it exactly where it was.
describe('drawer Settings button — 20px upward nudge', () => {
    const css = read('style.css');
    const mobileBlock = css.match(/@media \(max-width:\s*1023px\)\s*\{[\s\S]*?\n\}/);

    it('the mobile drawer media block exists', () => {
        expect(mobileBlock).toBeTruthy();
    });

    it('#drawerSettingsBtn carries a relative top: -20px offset in the mobile drawer', () => {
        const block = mobileBlock[0];
        // The rule that positions the button must be relative AND carry the
        // -20px top offset in the same declaration block. `[^}]*` keeps the
        // match inside a single rule so the two declarations are colocated.
        const rule = block.match(/#drawerSettingsBtn\s*\{[^}]*position:\s*relative;[^}]*top:\s*-20px;[^}]*\}/);
        expect(rule, 'expected a #drawerSettingsBtn rule with position:relative and top:-20px').not.toBeNull();
    });

    it('the nudge does not reintroduce sibling-reflowing centering onto #sidebarBottom', () => {
        // The footer stays bottom-anchored: the nudge lives on the button's
        // own relative offset, not on shared parent flex centering.
        const block = mobileBlock[0];
        const bottomRule = block.match(/#sidebarBottom\s*\{([^}]*)\}/);
        expect(bottomRule).not.toBeNull();
        expect(bottomRule[1]).not.toMatch(/justify-content:\s*center/);
        expect(bottomRule[1]).not.toMatch(/align-items:\s*center/);
    });
});
