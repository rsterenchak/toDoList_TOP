import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// The collapsed "COMPLETED (N)" accordion divider is a passive element, so it
// should not carry caution-level attention. Its base color is dimmed to a
// muted neutral/purple rather than the brighter accent it used before.
describe('COMPLETED section header color', () => {
    const css = read('style.css');

    it('dims the base #completedHeader color to a muted neutral/purple', () => {
        // Match the standalone base rule (`#completedHeader { ... }`), not the
        // :hover / :focus-visible variants or the emptyState selector list.
        const m = css.match(/(?:^|\})\s*#completedHeader\s*\{([^}]*)\}/m);
        expect(m).not.toBeNull();
        const rule = m[1];
        expect(rule.toLowerCase()).toMatch(/color:\s*#7a74a8/);
        // The brighter accent that read as caution-level attention is retired.
        expect(rule).not.toMatch(/color:\s*var\(--accent-text\)/);
    });
});
