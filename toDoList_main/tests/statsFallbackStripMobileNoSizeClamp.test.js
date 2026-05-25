import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Locks in the fix for the recurring-task stats drawer cropping the
// strip's caption, date labels, miss callout, and missed-pill list
// past #statsSibling's bottom border on ≤420px viewports. The drawer
// is a flex column whose grid track inside #mainList sizes from each
// item's painted block-size — any fixed `height`, `max-height`, or
// `overflow: hidden/clip` on the mobile-strip wrapper (or on the
// SVG nested inside it) would cap what the wrapper reports up to
// the parent flex column and re-introduce the overflow.
//
// The companion checks for #statsSibling itself live in
// statsMissCalloutContained.test.js — this file is the matching
// lock-in for the strip wrapper that hosts the SVG.
describe('.statsFallbackStripMobile never caps its own block size', () => {
    const css = read('style.css');

    // Walk every rule (top-level and nested @media) whose selector list
    // contains the given selector token, and run `check` against each
    // rule body. Catches base declarations and any @media-block variants
    // that might sneak a constraint in later.
    function eachRuleBody(selectorToken, check) {
        const escaped = selectorToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escaped + '\\s*\\{([^}]*)\\}', 'g');
        let seen = 0;
        let match;
        while ((match = re.exec(css)) !== null) {
            check(match[1]);
            seen++;
        }
        return seen;
    }

    it('declares no fixed `height` value (only min-height is allowed)', () => {
        // `(?:^|\s|;)height:` matches the height shorthand without
        // matching `min-height:` or `line-height:` (their preceding
        // characters are letters, not whitespace/semicolon/start).
        const seen = eachRuleBody('.statsFallbackStripMobile', function(body) {
            expect(body).not.toMatch(/(?:^|\s|;)height:/);
        });
        // At least the base rule should be found — guards against the
        // selector being renamed and the test silently passing.
        expect(seen).toBeGreaterThan(0);
    });

    it('declares no max-height', () => {
        eachRuleBody('.statsFallbackStripMobile', function(body) {
            expect(body).not.toMatch(/max-height:/);
        });
    });

    it('declares no overflow clip on either axis', () => {
        eachRuleBody('.statsFallbackStripMobile', function(body) {
            expect(body).not.toMatch(/overflow:\s*(?:hidden|clip)\s*;/);
            expect(body).not.toMatch(/overflow-x:\s*(?:hidden|clip)\s*;/);
            expect(body).not.toMatch(/overflow-y:\s*(?:hidden|clip)\s*;/);
        });
    });

    it('the ≤420px rule explicitly sets min-height: 0 so flex children contribute their full height', () => {
        // The base rule is a flex column. The phone-breakpoint rule
        // adds min-height: 0 — without it, an enclosing flex column
        // (#statsSibling is one) can keep a flex item from shrinking
        // below its min-content size during a re-render, which is the
        // shape of the original regression where the missed-pill row
        // leaked past the drawer's bottom edge after the user toggled
        // the window selector.
        const phoneBlockMatch = css.match(
            /@media\s*\(\s*max-width:\s*420px\s*\)\s*\{[\s\S]*?\.statsFallbackStripMobile\s*\{([^}]*)\}/
        );
        expect(phoneBlockMatch).not.toBeNull();
        expect(phoneBlockMatch[1]).toMatch(/min-height:\s*0\s*;/);
    });

    it('#statsSibling picks up the same defensive `overflow: visible` + `min-height: 0` inside the ≤420px block', () => {
        // The drawer and its strip wrapper share the same load-bearing
        // role — any size clamp on either re-introduces the overflow,
        // so the regression guard must cover both.
        const phoneStatsRuleMatch = css.match(
            /@media\s*\(\s*max-width:\s*420px\s*\)\s*\{[\s\S]*?#statsSibling\s*\{([^}]*)\}/
        );
        expect(phoneStatsRuleMatch).not.toBeNull();
        const body = phoneStatsRuleMatch[1];
        expect(body).toMatch(/overflow:\s*visible\s*;/);
        expect(body).toMatch(/min-height:\s*0\s*;/);
    });
});
