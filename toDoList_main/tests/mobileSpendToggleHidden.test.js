import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// Regression: the desktop API-spend button (#usageSpendToggle) is appended to
// #navBar in main.js and has no place on mobile — its intended mobile entry
// point is the chat-sheet control (#claudeSpendControl). Before this fix the
// button rendered in the mobile top-header because it was missing from the
// ≤1023px right-cluster hide rule that already hides the other nav toggles.
// These assertions pin the button into that single hide rule so a future nav
// addition is checked against the same list rather than leaking onto mobile.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

describe('mobile hides the top-header API-spend toggle', () => {
    const css = read('style.css');
    const claudeSheet = read('claudeSheet.js');

    it('creates the desktop #usageSpendToggle in the top header', () => {
        const js = read('main.js');
        expect(js).toMatch(/spendToggle\.id\s*=\s*['"]usageSpendToggle['"]/);
        expect(js).toMatch(/nav\.appendChild\(spendToggle\)/);
    });

    it('lists #usageSpendToggle in the ≤1023px right-cluster hide rule', () => {
        const mobileBlock = css.match(
            /@media \(max-width:\s*1023px\)\s*\{[\s\S]*?#usageSpendToggle,[\s\S]*?display:\s*none/,
        );
        expect(mobileBlock).not.toBeNull();
    });

    it('hides #usageSpendToggle alongside the other hidden nav toggles', () => {
        // The whole right cluster is suppressed together in one rule, so the
        // spend button sits between the music/pomodoro utilities and the gear.
        expect(css).toMatch(
            /#musicToggle,\s*\n\s*#usageSpendToggle,\s*\n\s*#focusModeToggle,\s*\n\s*#settingsToggle\s*\{\s*display:\s*none/,
        );
    });

    it('leaves the mobile chat-sheet spend control (#claudeSpendControl) intact', () => {
        // The mobile entry point lives in the chat header, not the top header,
        // and must be untouched by hiding the desktop button.
        expect(claudeSheet).toMatch(/id\s*=\s*['"]claudeSpendControl['"]/);
    });
});
