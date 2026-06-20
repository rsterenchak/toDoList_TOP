import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Returns the normalized declarations (lowercased, whitespace-collapsed,
// trailing-semicolon-stripped) of the first rule block in `css` whose
// selector list contains `selector`.
function declarationsFor(css, selector) {
    const re = new RegExp(
        `([^{}]*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{}]*)\\{([^}]*)\\}`
    );
    const match = css.match(re);
    if (!match) return null;
    return match[2]
        .split(';')
        .map((d) => d.trim().toLowerCase().replace(/\s+/g, ' '))
        .filter(Boolean)
        .sort();
}

// The mic button (id #claudeComposerMic, class .micButton) must present the
// SAME hover affordance as the attach button (#claudeComposerAttach,
// .claudeComposerAttach). The attach button's hover values are the source of
// truth; the mic button's :hover must mirror them verbatim, not approximate.
describe('Composer mic/attach hover parity', () => {
    const css = read('style.css');

    it('defines a hover rule for both the attach and mic buttons', () => {
        expect(declarationsFor(css, '.claudeComposerAttach:hover')).not.toBeNull();
        expect(declarationsFor(css, '.micButton:hover')).not.toBeNull();
    });

    it('mic button hover mirrors the attach button hover declarations verbatim', () => {
        const attach = declarationsFor(css, '.claudeComposerAttach:hover');
        const mic = declarationsFor(css, '.micButton:hover');
        expect(mic).toEqual(attach);
    });
});
