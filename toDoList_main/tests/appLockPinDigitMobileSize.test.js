// Feature coverage for "Enlarge PIN digit boxes on mobile lock overlay only".
//
// createPinDigitInputs() builds the boxed row for BOTH PIN surfaces — the
// lock overlay (#appLockOverlay) and the setup form (#pinLockModal) — so the
// enlargement is a pure CSS scoping problem, and the silent failure mode is a
// selector that catches the setup form too. Two things are pinned here:
//
//   • the enlarged sizing lives inside @media (max-width: 480px) and is
//     scoped to #appLockOverlay, leaving the shared base rule (and therefore
//     the desktop setup form) at 44x52/20px;
//   • the overlay card is actually wide enough to hold the enlarged row. The
//     boxes are flex items with the default flex-shrink, so a card that is
//     too narrow does not overflow — it quietly shrinks them back, and the
//     stylesheet would look correct while the phone showed no change at all.
//
// jsdom applies no cascade and lays nothing out, so the geometry is read from
// the stylesheet source, in the style of assignmentEditorResize.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    PIN_LENGTH,
    clearAppLock,
    lockApp,
    setAppLockPin,
    unlockApp,
} from '../src/appLock.js';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

// Declaration body of the first rule whose selector text ends with
// `selectorLiteral` immediately before its opening brace.
function ruleBody(selectorLiteral) {
    let from = 0;
    for (;;) {
        const idx = css.indexOf(selectorLiteral, from);
        if (idx === -1) return null;
        const brace = css.indexOf('{', idx);
        if (brace === -1) return null;
        if (/^\s*$/.test(css.slice(idx + selectorLiteral.length, brace))) {
            return css.slice(brace + 1, css.indexOf('}', brace));
        }
        from = idx + selectorLiteral.length;
    }
}

// Body of the @media (max-width: 480px) block that carries the app-lock
// overrides, found by the overlay selector it must contain.
function mobileBlock() {
    const needle = '@media (max-width: 480px)';
    let from = 0;
    for (;;) {
        const idx = css.indexOf(needle, from);
        if (idx === -1) return null;
        const open = css.indexOf('{', idx);
        let depth = 0;
        let i = open;
        for (; i < css.length; i++) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}' && --depth === 0) break;
        }
        // Comments come out so a selector scan can't pick up prose about a
        // rule and read it as part of the rule's selector.
        const body = css.slice(open + 1, i).replace(/\/\*[\s\S]*?\*\//g, '');
        if (body.includes('#appLockOverlay .pinDigitInput')) return body;
        from = i;
    }
}

const px = (body, prop) => {
    const match = new RegExp('(?:^|;|\\{)\\s*' + prop + '\\s*:\\s*(-?[\\d.]+)px', 'm').exec(body);
    return match ? Number(match[1]) : null;
};

describe('mobile lock overlay — enlarged PIN digit boxes', () => {
    it('enlarges the overlay boxes to the variant C geometry', () => {
        const body = ruleBody('#appLockOverlay .pinDigitInput');
        expect(px(body, 'width')).toBe(64);
        expect(px(body, 'height')).toBe(72);
        expect(px(body, 'font-size')).toBe(30);
        expect(px(body, 'border-radius')).toBe(14);
        expect(px(ruleBody('#appLockOverlay .pinDigitRow'), 'gap')).toBe(14);
    });

    it('keeps the enlarged digits above the 16px iOS auto-zoom floor', () => {
        expect(px(ruleBody('#appLockOverlay .pinDigitInput'), 'font-size'))
            .toBeGreaterThanOrEqual(16);
    });

    it('applies the enlargement only under the 480px phone breakpoint', () => {
        const block = mobileBlock();
        expect(block).not.toBeNull();
        expect(block).toContain('#appLockOverlay .pinDigitRow');
        expect(block).toContain('#appLockOverlay .appLockCard');
    });

    it('leaves the shared base rule at the compact size, so #pinLockModal is not resized', () => {
        const base = ruleBody('.pinDigitInput');
        expect(px(base, 'width')).toBe(44);
        expect(px(base, 'height')).toBe(52);
        expect(px(base, 'font-size')).toBe(20);
    });

    it('scopes every enlarged declaration to the overlay, never to the setup modal', () => {
        const block = mobileBlock();
        // Every rule in the block that touches a .pinDigit* class must name the
        // overlay — an unscoped one would catch the setup form through the
        // shared class, and would read as correct at a glance.
        const pinSelectors = block
            .split('}')
            .map((chunk) => chunk.slice(0, chunk.indexOf('{')).trim())
            .filter((sel) => sel.includes('.pinDigit'));

        expect(pinSelectors.length).toBeGreaterThan(0);
        pinSelectors.forEach((sel) => {
            expect(sel).toContain('#appLockOverlay');
            expect(sel).not.toContain('#pinLockModal');
        });
    });

    it('gives the overlay card room for the full-size row instead of flex-shrinking it back', () => {
        const card = ruleBody('#appLockOverlay .appLockCard');
        const digit = ruleBody('#appLockOverlay .pinDigitInput');
        const gap = px(ruleBody('#appLockOverlay .pinDigitRow'), 'gap');
        const padding = /padding\s*:\s*[\d.]+px\s+([\d.]+)px/.exec(card);

        const rowWidth = PIN_LENGTH * px(digit, 'width') + (PIN_LENGTH - 1) * gap;
        const cardInner = px(card, 'max-width') - 2 * Number(padding[1]);

        expect(cardInner).toBeGreaterThanOrEqual(rowWidth);
    });
});

describe('mobile lock overlay — the enlarged selector matches the real markup', () => {
    beforeEach(() => {
        localStorage.clear();
        setAppLockPin('1234');
    });

    afterEach(() => {
        unlockApp();
        clearAppLock();
        localStorage.clear();
    });

    // The CSS above is worthless if the overlay ever stops nesting the shared
    // row inside #appLockOverlay, so pin the structure the selector relies on.
    it('nests the shared digit row and its inputs inside #appLockOverlay', () => {
        lockApp();
        const overlay = document.getElementById('appLockOverlay');
        expect(overlay.querySelector('.appLockCard > .pinDigitRow')).not.toBeNull();
        expect(overlay.querySelectorAll('.pinDigitRow .pinDigitInput')).toHaveLength(PIN_LENGTH);
    });
});
