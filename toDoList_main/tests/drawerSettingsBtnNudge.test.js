import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the -16px upward nudge of the drawer Settings button. The button
// (#drawerSettingsBtn) is a flex-centered item inside #drawerSettingsBtnWrap
// within the ≤1023px mobile drawer. The nudge is applied as a relative
// `top: -16px` offset so it shifts up without reflowing its reserved box —
// keeping the footer sibling below it exactly where it was. The offset is
// capped at the button's own 16px top margin so it stays flush with the
// wrap's top edge instead of spilling above it and overlapping the drawer
// item above the wrap (an earlier -20px nudge overshot by 4px).
describe('drawer Settings button — 16px upward nudge', () => {
    const css = read('style.css');
    const mobileBlock = css.match(/@media \(max-width:\s*1023px\)\s*\{[\s\S]*?\n\}/);

    it('the mobile drawer media block exists', () => {
        expect(mobileBlock).toBeTruthy();
    });

    it('#drawerSettingsBtn carries a relative top: -16px offset in the mobile drawer', () => {
        const block = mobileBlock[0];
        // The rule that positions the button must be relative AND carry the
        // -16px top offset in the same declaration block. `[^}]*` keeps the
        // match inside a single rule so the two declarations are colocated.
        const rule = block.match(/#drawerSettingsBtn\s*\{[^}]*position:\s*relative;[^}]*top:\s*-16px;[^}]*\}/);
        expect(rule, 'expected a #drawerSettingsBtn rule with position:relative and top:-16px').not.toBeNull();
    });

    it('the upward nudge does not exceed the button\'s own top margin (no spill above the wrap)', () => {
        // The overlap fix caps the offset at the button's 16px top margin so
        // the button stays flush with #drawerSettingsBtnWrap's top edge. A
        // larger offset (e.g. the earlier -20px) pushes the button above the
        // wrap and overlaps the drawer item above it.
        const block = mobileBlock[0];
        const marginRule = block.match(/#drawerSettingsBtn\s*\{[^}]*margin:\s*([^;]+);[^}]*\}/);
        expect(marginRule, 'expected a #drawerSettingsBtn margin declaration').not.toBeNull();
        const topMargin = parseInt(marginRule[1].trim().split(/\s+/)[0], 10);

        const offsetRule = block.match(/#drawerSettingsBtn\s*\{[^}]*top:\s*(-?\d+)px;[^}]*\}/);
        expect(offsetRule).not.toBeNull();
        const offset = Math.abs(parseInt(offsetRule[1], 10));

        expect(offset).toBeLessThanOrEqual(topMargin);
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
