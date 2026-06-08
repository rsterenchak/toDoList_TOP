import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeEach } from 'vitest';
import { attachProjectInjectIndicator } from '../src/projectRow.js';
import { initInjectConfig } from '../src/inject.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Build a minimal committed project row mirroring main.js's two row-creation
// paths: a #projChild grid with a #projInput title, a .projBadge count pill,
// and the trailing spacer. attachProjectInjectIndicator wires the green ⚡.
function makeRow() {
    const projChild = document.createElement('div');
    projChild.id = 'projChild';
    const titleInput = document.createElement('input');
    titleInput.id = 'projInput';
    titleInput.value = 'Alpha';
    const badge = document.createElement('div');
    badge.className = 'projBadge';
    const spacer = document.createElement('div');
    projChild.appendChild(titleInput);
    projChild.appendChild(badge);
    projChild.appendChild(spacer);
    document.body.appendChild(projChild);
    return { projChild, titleInput };
}

function configureInject() {
    localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.dev');
    localStorage.setItem('todoapp_injectSharedSecret', 'shh');
    initInjectConfig();
}

function clearInject() {
    localStorage.removeItem('todoapp_injectWorkerUrl');
    localStorage.removeItem('todoapp_injectSharedSecret');
    initInjectConfig();
}

describe('project-row inject thunderbolt — runtime behavior', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        clearInject();
    });

    it('shows no bolt when inject is not configured', () => {
        const { projChild } = makeRow();
        attachProjectInjectIndicator(projChild, document.querySelector('#projInput'));
        expect(projChild.classList.contains('hasInjectBolt')).toBe(false);
    });

    it('surfaces a green ⚡ at the start of the row when inject is configured', () => {
        configureInject();
        const { projChild } = makeRow();
        attachProjectInjectIndicator(projChild, document.querySelector('#projInput'));

        expect(projChild.classList.contains('hasInjectBolt')).toBe(true);
        const bolt = projChild.querySelector('.projInjectBolt');
        expect(bolt).not.toBeNull();
        // U+26A1 HIGH VOLTAGE — the thunderbolt glyph
        expect(bolt.textContent).toContain('⚡');
        // leading element so it reads as a prefix to the title
        expect(projChild.firstChild).toBe(bolt);
        // decorative only — kept out of the accessibility tree
        expect(bolt.getAttribute('aria-hidden')).toBe('true');
    });

    it('hides the bolt while the title is being renamed and restores it on blur', () => {
        configureInject();
        const { projChild, titleInput } = makeRow();
        attachProjectInjectIndicator(projChild, titleInput);
        expect(projChild.classList.contains('hasInjectBolt')).toBe(true);

        // entering rename mode focuses the input → bolt hides
        titleInput.focus();
        titleInput.dispatchEvent(new FocusEvent('focus'));
        expect(document.activeElement).toBe(titleInput);
        expect(projChild.classList.contains('hasInjectBolt')).toBe(false);

        // leaving rename mode restores it
        titleInput.blur();
        titleInput.dispatchEvent(new FocusEvent('blur'));
        expect(projChild.classList.contains('hasInjectBolt')).toBe(true);
    });

    it('updates live on inject config save/clear without re-attaching (injectConfigChanged event)', () => {
        const { projChild } = makeRow();
        attachProjectInjectIndicator(projChild, document.querySelector('#projInput'));
        // starts unconfigured → no bolt
        expect(projChild.classList.contains('hasInjectBolt')).toBe(false);

        // user saves inject config → indicator appears with no reload
        configureInject();
        document.dispatchEvent(new CustomEvent('injectConfigChanged'));
        expect(projChild.classList.contains('hasInjectBolt')).toBe(true);

        // user clears it → indicator disappears
        clearInject();
        document.dispatchEvent(new CustomEvent('injectConfigChanged'));
        expect(projChild.classList.contains('hasInjectBolt')).toBe(false);
    });

    it('does not insert a second bolt when re-attached to the same row', () => {
        configureInject();
        const { projChild, titleInput } = makeRow();
        attachProjectInjectIndicator(projChild, titleInput);
        attachProjectInjectIndicator(projChild, titleInput);
        expect(projChild.querySelectorAll('.projInjectBolt').length).toBe(1);
    });
});

// Source / CSS invariants that jsdom can't exercise (it applies no
// stylesheet): the bolt must not steal pointer events, must not eat the
// title's truncation budget when absent, and the inject config write must
// broadcast a change event the rows listen for.
describe('project-row inject thunderbolt — CSS & wiring invariants', () => {
    const css = read('style.css');
    const projectRow = read('projectRow.js');
    const inject = read('inject.js');

    it('the bolt carries pointer-events: none so taps fall through to the row', () => {
        const idx = css.indexOf('.projInjectBolt {');
        expect(idx).toBeGreaterThan(-1);
        const block = css.slice(idx, idx + 400);
        expect(block).toMatch(/pointer-events:\s*none/);
        // tinted with the app's theme-aware green, not a hardcoded one-off
        expect(block).toMatch(/color:\s*var\(--type-feature/);
    });

    it('the bolt only occupies a grid column when present, preserving title truncation', () => {
        // default row keeps the original 3-column template (no bolt column)
        const base = css.match(/#projChild\s*\{([^}]*)\}/);
        expect(base[1]).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+12px/);
        // the bolt column is added only under .hasInjectBolt
        expect(css).toMatch(/#projChild\.hasInjectBolt\s*\{[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+auto\s+12px/);
        // and the bolt itself is hidden by default, shown only then
        expect(css).toMatch(/\.projInjectBolt\s*\{[^}]*display:\s*none/);
        expect(css).toMatch(/#projChild\.hasInjectBolt\s+\.projInjectBolt\s*\{[^}]*display:\s*inline/);
    });

    it('saveInjectConfig broadcasts injectConfigChanged so rows can refresh live', () => {
        const fnIdx = inject.indexOf('function saveInjectConfig(');
        expect(fnIdx).toBeGreaterThan(-1);
        const body = inject.slice(fnIdx, fnIdx + 900);
        expect(body).toMatch(/dispatchEvent\(new CustomEvent\(['"]injectConfigChanged['"]\)\)/);
    });

    it('the indicator listens for injectConfigChanged and gates on isInjectConfigured', () => {
        expect(projectRow).toMatch(/import\s*\{\s*isInjectConfigured\s*\}\s*from\s*['"]\.\/inject\.js['"]/);
        const fnIdx = projectRow.indexOf('export function attachProjectInjectIndicator(');
        expect(fnIdx).toBeGreaterThan(-1);
        const body = projectRow.slice(fnIdx, fnIdx + 1200);
        expect(body).toMatch(/addEventListener\(['"]injectConfigChanged['"]/);
        expect(body).toMatch(/isInjectConfigured\(\)/);
    });
});
