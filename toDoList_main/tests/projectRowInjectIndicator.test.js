import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeEach } from 'vitest';
import { attachProjectInjectIndicator, syncProjectRowInjectBolt } from '../src/projectRow.js';
import { initInjectConfig } from '../src/inject.js';
import { listLogic } from '../src/listLogic.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Build a minimal committed project row mirroring main.js's two row-creation
// paths: a #projChild grid with a #projInput title, a .projBadge count pill,
// and the trailing spacer. attachProjectInjectIndicator wires the green ⚡.
function makeRow(name = 'Alpha') {
    const projChild = document.createElement('div');
    projChild.id = 'projChild';
    const titleInput = document.createElement('input');
    titleInput.id = 'projInput';
    titleInput.value = name;
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

// Register a project in the data model and (optionally) route it at a
// per-project inject target — the bolt now gates on this target_id, not on
// the global inject-configured flag alone.
function makeProject(name, { target = false } = {}) {
    listLogic.addProject(name);
    if (target) listLogic.setProjectTargetId(name, 'tgt-' + name);
}

function clearProjects() {
    listLogic.listProjectsArray().slice().forEach(function(name) {
        listLogic.removeProject(name);
    });
}

describe('project-row inject thunderbolt — runtime behavior', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        clearInject();
        clearProjects();
    });

    it('shows no bolt when inject is not configured (even with a routed target)', () => {
        makeProject('Alpha', { target: true });
        const { projChild } = makeRow('Alpha');
        attachProjectInjectIndicator(projChild, document.querySelector('#projInput'));
        expect(projChild.classList.contains('hasInjectBolt')).toBe(false);
    });

    it('surfaces a green ⚡ at the start of the row when the project has a routed inject target', () => {
        configureInject();
        makeProject('Alpha', { target: true });
        const { projChild } = makeRow('Alpha');
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

    it('shows no bolt when inject is configured but the project has no routed target', () => {
        // Per-project filtering: a globally-configured inject setup is not
        // enough — the bolt only appears for rows whose project is actually
        // routed at a target.
        configureInject();
        makeProject('Beta', { target: false });
        const { projChild } = makeRow('Beta');
        attachProjectInjectIndicator(projChild, document.querySelector('#projInput'));
        expect(projChild.classList.contains('hasInjectBolt')).toBe(false);
    });

    it('shows the bolt on the routed project and not on the unrouted one (per-project filtering)', () => {
        configureInject();
        makeProject('Routed', { target: true });
        makeProject('Bare', { target: false });

        const routed = makeRow('Routed');
        const bare = makeRow('Bare');
        attachProjectInjectIndicator(routed.projChild, routed.titleInput);
        attachProjectInjectIndicator(bare.projChild, bare.titleInput);

        expect(routed.projChild.classList.contains('hasInjectBolt')).toBe(true);
        expect(bare.projChild.classList.contains('hasInjectBolt')).toBe(false);
    });

    it('hides the bolt while the title is being renamed and restores it on blur', () => {
        configureInject();
        makeProject('Alpha', { target: true });
        const { projChild, titleInput } = makeRow('Alpha');
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
        makeProject('Alpha', { target: true });
        const { projChild } = makeRow('Alpha');
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

    it('updates live when the project gains or loses a routed target (injectTargetsChanged event)', () => {
        configureInject();
        makeProject('Alpha', { target: false });
        const { projChild } = makeRow('Alpha');
        attachProjectInjectIndicator(projChild, document.querySelector('#projInput'));
        // configured globally but unrouted → no bolt
        expect(projChild.classList.contains('hasInjectBolt')).toBe(false);

        // routing the project at a target lights the bolt with no reload
        listLogic.setProjectTargetId('Alpha', 'tgt-Alpha');
        document.dispatchEvent(new CustomEvent('injectTargetsChanged'));
        expect(projChild.classList.contains('hasInjectBolt')).toBe(true);

        // unrouting it removes the bolt
        listLogic.setProjectTargetId('Alpha', null);
        document.dispatchEvent(new CustomEvent('injectTargetsChanged'));
        expect(projChild.classList.contains('hasInjectBolt')).toBe(false);
    });

    it('does not insert a second bolt when re-attached to the same row', () => {
        configureInject();
        makeProject('Alpha', { target: true });
        const { projChild, titleInput } = makeRow('Alpha');
        attachProjectInjectIndicator(projChild, titleInput);
        attachProjectInjectIndicator(projChild, titleInput);
        expect(projChild.querySelectorAll('.projInjectBolt').length).toBe(1);
    });
});

// Build a minimal project-picker dropdown row mirroring main.js's
// buildProjectPickerRows: a .projectPickerRow with a .projectPickerName label
// and a .projectPickerCount. The dropdown variant of the indicator
// (syncProjectRowInjectBolt) takes the project name directly because these rows
// have no rename <input> of their own.
function makePickerRow(name = 'Alpha') {
    const row = document.createElement('div');
    row.className = 'projectPickerRow';
    const label = document.createElement('span');
    label.className = 'projectPickerName';
    label.textContent = name;
    const count = document.createElement('span');
    count.className = 'projectPickerCount';
    row.appendChild(label);
    row.appendChild(count);
    document.body.appendChild(row);
    return row;
}

describe('project-picker dropdown inject thunderbolt — runtime behavior', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        clearInject();
        clearProjects();
    });

    it('shows no bolt when inject is not configured (even with a routed target)', () => {
        makeProject('Alpha', { target: true });
        const row = makePickerRow('Alpha');
        syncProjectRowInjectBolt(row, 'Alpha');
        expect(row.classList.contains('hasInjectBolt')).toBe(false);
    });

    it('surfaces an ⚡ at the start of the dropdown row when the project has a routed inject target', () => {
        configureInject();
        makeProject('Alpha', { target: true });
        const row = makePickerRow('Alpha');
        syncProjectRowInjectBolt(row, 'Alpha');

        expect(row.classList.contains('hasInjectBolt')).toBe(true);
        const bolt = row.querySelector('.projInjectBolt');
        expect(bolt).not.toBeNull();
        expect(bolt.textContent).toContain('⚡');
        // leads the row so it reads as a prefix to the project name
        expect(row.firstChild).toBe(bolt);
        // decorative only — kept out of the accessibility tree
        expect(bolt.getAttribute('aria-hidden')).toBe('true');
    });

    it('shows no bolt when inject is configured but the project has no routed target', () => {
        configureInject();
        makeProject('Beta', { target: false });
        const row = makePickerRow('Beta');
        syncProjectRowInjectBolt(row, 'Beta');
        expect(row.classList.contains('hasInjectBolt')).toBe(false);
    });

    it('shows the bolt on the routed dropdown row and not on the unrouted one (per-project filtering)', () => {
        configureInject();
        makeProject('Routed', { target: true });
        makeProject('Bare', { target: false });

        const routed = makePickerRow('Routed');
        const bare = makePickerRow('Bare');
        syncProjectRowInjectBolt(routed, 'Routed');
        syncProjectRowInjectBolt(bare, 'Bare');

        expect(routed.classList.contains('hasInjectBolt')).toBe(true);
        expect(bare.classList.contains('hasInjectBolt')).toBe(false);
    });

    it('does not insert a second bolt when re-synced on the same row (idempotent rebuilds)', () => {
        configureInject();
        makeProject('Alpha', { target: true });
        const row = makePickerRow('Alpha');
        syncProjectRowInjectBolt(row, 'Alpha');
        syncProjectRowInjectBolt(row, 'Alpha');
        expect(row.querySelectorAll('.projInjectBolt').length).toBe(1);
    });
});

// Source / CSS invariants that jsdom can't exercise (it applies no
// stylesheet): the bolt must not steal pointer events, must not eat the
// title's truncation budget when absent, renders at every breakpoint (no
// mobile-only guard), and the inject config write must broadcast a change
// event the rows listen for.
describe('project-row inject thunderbolt — CSS & wiring invariants', () => {
    const css = read('style.css');
    const projectRow = read('projectRow.js');
    const inject = read('inject.js');

    it('the bolt carries pointer-events: none so taps fall through to the row', () => {
        const idx = css.indexOf('.projInjectBolt {');
        expect(idx).toBeGreaterThan(-1);
        const block = css.slice(idx, idx + 400);
        expect(block).toMatch(/pointer-events:\s*none/);
        // tinted with the amber accent that reads against both themes
        expect(block).toMatch(/color:\s*#ffbd5e/);
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

    it('the bolt show/hide rule carries no media query or touch-only guard (renders on desktop too)', () => {
        // The only rule that toggles bolt visibility is the unconditional
        // `.hasInjectBolt .projInjectBolt { display: inline }` — there must be
        // no breakpoint that re-hides it, or the bolt would vanish on desktop.
        const showIdx = css.indexOf('#projChild.hasInjectBolt .projInjectBolt');
        expect(showIdx).toBeGreaterThan(-1);
        // no other selector targets .projInjectBolt with display:none beyond
        // the single default-hidden base rule
        const hideMatches = css.match(/\.projInjectBolt[^{]*\{[^}]*display:\s*none/g) || [];
        expect(hideMatches.length).toBe(1);
    });

    it('the dropdown rows have their own show rule so the bolt surfaces inside the picker', () => {
        // The sidebar show rule is `#projChild`-scoped, so the desktop
        // project-picker dropdown needs an explicit, non-ancestor-excluded
        // rule to reveal the same bolt on its own rows.
        expect(css).toMatch(/\.projectPickerRow\.hasInjectBolt\s+\.projInjectBolt\s*\{[^}]*display:\s*inline/);
    });

    it('the dropdown row build wires the per-project bolt sync', () => {
        const main = read('main.js');
        // attached for every dropdown row regardless of mount point
        expect(main).toMatch(/syncProjectRowInjectBolt\s*\(\s*row\s*,\s*name\s*\)/);
        expect(main).toMatch(/import[\s\S]{0,200}syncProjectRowInjectBolt[\s\S]{0,200}from\s*['"]\.\/projectRow\.js['"]/);
    });

    it('saveInjectConfig broadcasts injectConfigChanged so rows can refresh live', () => {
        const fnIdx = inject.indexOf('function saveInjectConfig(');
        expect(fnIdx).toBeGreaterThan(-1);
        const body = inject.slice(fnIdx, fnIdx + 900);
        expect(body).toMatch(/dispatchEvent\(new CustomEvent\(['"]injectConfigChanged['"]\)\)/);
    });

    it('routing a project at a target notifies rows so the bolt updates without reload', () => {
        // The autosave routing handler must emit injectTargetsChanged after
        // setProjectTargetId so the sidebar bolts re-evaluate live.
        expect(inject).toMatch(
            /setProjectTargetId\s*\(\s*projectName\s*,\s*newId\s*\)[\s\S]{0,1000}notifyInjectTargetsChanged\s*\(\s*\)/
        );
    });

    it('the indicator gates on the per-project target and listens for both refresh events', () => {
        expect(projectRow).toMatch(/import\s*\{\s*isInjectConfigured\s*\}\s*from\s*['"]\.\/inject\.js['"]/);
        const fnIdx = projectRow.indexOf('export function attachProjectInjectIndicator(');
        expect(fnIdx).toBeGreaterThan(-1);
        const body = projectRow.slice(fnIdx, fnIdx + 1600);
        // per-project gate, not the global flag alone
        expect(body).toMatch(/getProjectTargetId\s*\(\s*titleInput\.value\s*\)/);
        expect(body).toMatch(/isInjectConfigured\(\)/);
        // live refresh on both config and routing changes
        expect(body).toMatch(/addEventListener\(['"]injectConfigChanged['"]/);
        expect(body).toMatch(/addEventListener\(['"]injectTargetsChanged['"]/);
    });
});
