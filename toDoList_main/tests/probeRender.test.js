// Temporary probe to capture runtime errors during initial render.
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('probe', () => {
    it('renders the app without throwing', async () => {
        const errors = [];
        window.addEventListener('error', e => errors.push(['error', e.message, e.filename, e.lineno]));
        const orig = console.error;
        console.error = (...args) => errors.push(['console.error', ...args]);
        try {
            const main = await import('../src/main.js');
            try {
                document.body.appendChild(main.component());
            } catch (e) {
                errors.push(['component-throw', e.message, e.stack && e.stack.split('\n').slice(0,8).join(' | ')]);
            }
            try {
                main.restoreFromStorage();
            } catch (e) {
                errors.push(['restore-throw', e.message, e.stack && e.stack.split('\n').slice(0,8).join(' | ')]);
            }
        } catch (e) {
            errors.push(['import-throw', e.message, e.stack && e.stack.split('\n').slice(0,8).join(' | ')]);
        }
        console.error = orig;
        for (const row of errors) console.log(JSON.stringify(row));
        console.log('body length:', document.body.innerHTML.length);
    });
});
