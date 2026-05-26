import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { toDo } from '../src/toDo.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Source-inspection tests for the Inject to TODO.md feature — the desktop
// description-panel button, the mobile edit modal button, the per-device
// settings modal, and the localStorage-backed config cache. Mirrors the
// pattern used by mobileDescEditorModal.test.js since instantiating
// buildToDoRow + the full UI is out of scope for these tests.

describe('inject feature — toDo factory carries injectedAt', () => {

    it('toDo() return shape includes injectedAt defaulting to null', () => {
        const item = toDo('Title', 'Desc', '5-26-2026', null, 0);
        expect(item).toHaveProperty('injectedAt');
        expect(item.injectedAt).toBeNull();
    });
});

describe('inject feature — inject.js module shape', () => {

    const inject = read('inject.js');

    it('exports initInjectConfig, isInjectConfigured, showInjectSettingsModal, makeInjectButton, refreshInjectButton', () => {
        expect(inject).toMatch(/export\s+function\s+initInjectConfig\s*\(/);
        expect(inject).toMatch(/export\s+function\s+isInjectConfigured\s*\(/);
        expect(inject).toMatch(/export\s+function\s+showInjectSettingsModal\s*\(/);
        expect(inject).toMatch(/export\s+function\s+makeInjectButton\s*\(/);
        expect(inject).toMatch(/export\s+function\s+refreshInjectButton\s*\(/);
    });

    it('uses the spec-named localStorage keys for URL and shared secret', () => {
        expect(inject).toMatch(/['"]todoapp_injectWorkerUrl['"]/);
        expect(inject).toMatch(/['"]todoapp_injectSharedSecret['"]/);
        expect(inject).toMatch(/['"]todoapp_injectLastTestedAt['"]/);
        expect(inject).toMatch(/['"]todoapp_injectLastTestResult['"]/);
    });

    it('sends the Authorization header as `Bearer <secret>` on the POST', () => {
        expect(inject).toMatch(/['"]Authorization['"]\s*:\s*['"]Bearer\s*['"]\s*\+\s*cachedSecret/);
    });

    it('the inject POST body carries the description verbatim under `entry`', () => {
        // The description value is `item.desc` straight from the data
        // model — markdown formatting must round-trip unchanged. With
        // per-project routing, the body also carries `repo` and
        // `filePath` from the resolved target; those are asserted in
        // projectInjectRouting.test.js.
        expect(inject).toMatch(/entry\s*:\s*item\.desc/);
        expect(inject).toMatch(/postToWorker\s*\(\s*body\s*\)/);
    });

    it('the test-connection POST body always carries `test: true`', () => {
        // Repo / filePath are optionally added when at least one target
        // is defined — asserted in projectInjectRouting.test.js. The
        // `test: true` flag itself stays on the body unconditionally so
        // the Worker can short-circuit before touching the GitHub API.
        expect(inject).toMatch(/const\s+body\s*=\s*\{\s*test\s*:\s*true\s*\}/);
    });

    it('stamps injectedAt = Date.now() on the item and saves to storage on success', () => {
        expect(inject).toMatch(/item\.injectedAt\s*=\s*Date\.now\s*\(\s*\)/);
        expect(inject).toMatch(/listLogic\.saveToStorage\s*\(\s*\)/);
    });

    it('caches config in module-level variables read by isInjectConfigured', () => {
        expect(inject).toMatch(/let\s+cachedUrl\b/);
        expect(inject).toMatch(/let\s+cachedSecret\b/);
        expect(inject).toMatch(/return\s+!!\(\s*cachedUrl\s*&&\s*cachedSecret\s*\)/);
    });
});

describe('inject feature — settings modal shell', () => {

    const inject = read('inject.js');

    it('mounts the modal under #injectSettingsBackdrop / #injectSettingsModal', () => {
        expect(inject).toMatch(/['"]injectSettingsBackdrop['"]/);
        expect(inject).toMatch(/['"]injectSettingsModal['"]/);
    });

    it('renders a Worker URL input and a password Shared secret input', () => {
        expect(inject).toMatch(/['"]injectWorkerUrlInput['"]/);
        expect(inject).toMatch(/['"]injectSharedSecretInput['"]/);
        // Default to password type so the secret isn't shoulder-surfable.
        expect(inject).toMatch(/secretInput\.type\s*=\s*['"]password['"]/);
    });

    it('the show/hide eye toggle swaps the input type between password and text', () => {
        // Acceptance criterion: "The show/hide eye toggle on the secret
        // field swaps `type=\"password\"` and `type=\"text\"` without
        // losing input." Toggling via .type leaves .value intact.
        expect(inject).toMatch(/secretInput\.type\s*===\s*['"]password['"][\s\S]{0,80}secretInput\.type\s*=\s*['"]text['"]/);
    });

    it('renders Save, Test connection, and Clear buttons', () => {
        expect(inject).toMatch(/textContent\s*=\s*['"]Save['"]/);
        expect(inject).toMatch(/textContent\s*=\s*['"]Test connection['"]/);
        expect(inject).toMatch(/textContent\s*=\s*['"]Clear['"]/);
    });

    it('the Clear button routes through showConfirmModal before wiping config', () => {
        // CLAUDE.md: destructive actions require a confirmation step. The
        // Clear handler is destructive — both URL and secret are wiped —
        // so it must funnel through showConfirmModal.
        expect(inject).toMatch(/import\s*\{[^}]*showConfirmModal[^}]*\}\s*from\s*['"]\.\/modals\.js['"]/);
        const clearIdx = inject.indexOf("'injectSettingsClear'");
        expect(clearIdx).toBeGreaterThan(-1);
        const tail = inject.slice(clearIdx);
        expect(tail).toMatch(/showConfirmModal\s*\(/);
    });

    it('closes on the close X, backdrop click, and Escape — all three affordances', () => {
        expect(inject).toMatch(/closeX\.addEventListener\(\s*['"]click['"]\s*,\s*close\s*\)/);
        expect(inject).toMatch(
            /backdrop\.addEventListener\(\s*['"]click['"]\s*,\s*function\s*\(\s*event\s*\)\s*\{\s*if\s*\(\s*event\.target\s*===\s*backdrop\s*\)\s*close\(\)/
        );
        expect(inject).toMatch(/event\.key\s*===\s*['"]Escape['"][\s\S]{0,80}close\(\)/);
    });

    it('text inputs use 16px font-size to avoid iOS Safari auto-zoom on focus', () => {
        // CLAUDE.md mobile-input rule — both fields must be ≥16px.
        const css = read('style.css');
        const block = css.match(/#injectWorkerUrlInput[^{]*\{[^}]*\}/);
        expect(block).toBeTruthy();
        expect(css).toMatch(/#injectWorkerUrlInput[\s\S]{0,200}font-size:\s*16px/);
        expect(css).toMatch(/#injectSharedSecretInput[\s\S]{0,200}font-size:\s*16px/);
    });

    it('wraps Connection, Targets, and Project routing in a scroll container so the modal does not clip on mobile', () => {
        // Regression for the inject settings modal being clipped at the
        // bottom of the viewport on phones. The three sections must live
        // inside a #injectSettingsScroll container that grows to fill the
        // remaining modal height and scrolls overflow internally.
        expect(inject).toMatch(/['"]injectSettingsScroll['"]/);
        const scrollIdx = inject.indexOf("'injectSettingsScroll'");
        expect(scrollIdx).toBeGreaterThan(-1);
        const tail = inject.slice(scrollIdx);
        // The three sections are appended to the scroll wrapper, not the
        // dialog root.
        expect(tail).toMatch(/scrollBody\.appendChild\(\s*connSection\s*\)/);
        expect(tail).toMatch(/scrollBody\.appendChild\(\s*targetsSection\s*\)/);
        expect(tail).toMatch(/scrollBody\.appendChild\(\s*routingSection\s*\)/);
        expect(tail).toMatch(/dialog\.appendChild\(\s*scrollBody\s*\)/);
    });

    it('modal shell CSS caps height and the scroll container holds the overflow', () => {
        const css = read('style.css');
        // Modal root caps height and clips so its scroll child handles the overflow.
        expect(css).toMatch(/#injectSettingsModal[^}]*max-height:\s*85vh/);
        expect(css).toMatch(/#injectSettingsModal[^}]*overflow:\s*hidden/);
        // Scroll child grows to fill remaining space and scrolls vertically.
        expect(css).toMatch(/#injectSettingsScroll[^}]*flex:\s*1\s+1\s+auto/);
        expect(css).toMatch(/#injectSettingsScroll[^}]*overflow-y:\s*auto/);
        // Tighter cap on phones.
        expect(css).toMatch(/@media[^{]*max-width:\s*480px[\s\S]*#injectSettingsModal[^}]*max-height:\s*90vh/);
    });
});

describe('inject feature — modal registered in global modal-open guard', () => {

    const modals = read('modals.js');

    it('isAnyModalOrPopoverOpen lists injectSettingsBackdrop', () => {
        expect(modals).toMatch(
            /isAnyModalOrPopoverOpen[\s\S]*injectSettingsBackdrop/
        );
    });
});

describe('inject feature — inject button states', () => {

    const inject = read('inject.js');

    it('refreshInjectButton hides the button when description is empty', () => {
        // hasDesc check + display = none + state = hidden
        expect(inject).toMatch(/item\.desc\s*&&\s*item\.desc\.trim\(\)\.length\s*>\s*0/);
        expect(inject).toMatch(/btn\.style\.display\s*=\s*['"]none['"]/);
        expect(inject).toMatch(/btn\.dataset\.state\s*=\s*['"]hidden['"]/);
    });

    it('refreshInjectButton sets state="injected" when item.injectedAt is truthy', () => {
        expect(inject).toMatch(/if\s*\(\s*item\.injectedAt\s*\)[\s\S]{0,200}btn\.dataset\.state\s*=\s*['"]injected['"]/);
    });

    it('refreshInjectButton sets state="unconfigured" when no inject config is set and item is non-empty', () => {
        expect(inject).toMatch(/!isInjectConfigured\(\)[\s\S]{0,200}btn\.dataset\.state\s*=\s*['"]unconfigured['"]/);
    });

    it('refreshInjectButton sets state="ready" when config is set and item is not yet injected', () => {
        expect(inject).toMatch(/btn\.dataset\.state\s*=\s*['"]ready['"]/);
    });

    it('clicking the inject button when unconfigured opens the settings modal', () => {
        // The click handler must invoke showInjectSettingsModal from the
        // unconfigured branch — the dimmed-but-clickable button needs a
        // somewhere-to-go.
        expect(inject).toMatch(/state\s*===\s*['"]unconfigured['"][\s\S]{0,120}showInjectSettingsModal\s*\(/);
    });

    it('the click handler disables the button before awaiting the POST so double-clicks are no-ops', () => {
        // Acceptance criterion: "Double-clicking the inject button does
        // not produce two commits." The disable must precede the await
        // so the second click is dropped by the disabled guard.
        const clickIdx = inject.search(/btn\.addEventListener\(\s*['"]click['"]/);
        expect(clickIdx).toBeGreaterThan(-1);
        const tail = inject.slice(clickIdx);
        const readyBranch = tail.match(/state\s*===\s*['"]ready['"][\s\S]{0,800}/);
        expect(readyBranch).toBeTruthy();
        const disableIdx = readyBranch[0].indexOf('btn.disabled = true');
        const awaitIdx = readyBranch[0].search(/await\s+injectDescription/);
        expect(disableIdx).toBeGreaterThan(-1);
        expect(awaitIdx).toBeGreaterThan(-1);
        expect(disableIdx).toBeLessThan(awaitIdx);
    });
});

describe('inject feature — wired into desktop description panel', () => {

    const toDoRow = read('toDoRow.js');

    it('toDoRow.js imports makeInjectButton and refreshInjectButton from inject.js', () => {
        expect(toDoRow).toMatch(
            /import\s*\{[^}]*makeInjectButton[^}]*\}\s*from\s*['"]\.\/inject\.js['"]/
        );
        expect(toDoRow).toMatch(
            /import\s*\{[^}]*refreshInjectButton[^}]*\}\s*from\s*['"]\.\/inject\.js['"]/
        );
    });

    it('buildToDoRow creates an inject button and appends it inside the descSibling panel', () => {
        // injectBtn factory call + appended into descSibling alongside
        // the existing spacer1, descInput, spacer2. The factory call
        // now also passes a projectName option for per-project routing;
        // tests of that wiring live in projectInjectRouting.test.js.
        expect(toDoRow).toMatch(/makeInjectButton\s*\(\s*item\s*,/);
        expect(toDoRow).toMatch(/descSibling\.appendChild\(\s*injectBtn\s*\)/);
    });

    it('refreshInjectButton is called on every keystroke and blur so the empty/non-empty visibility tracks the textarea', () => {
        // Hook into the existing keyup and blur handlers that already
        // sync item.desc — the inject button rides the same change pulse
        // so its state stays in lock-step with what's in the textarea.
        const keyupMatches = toDoRow.match(/descInput\.addEventListener\(\s*['"]keyup['"][\s\S]{0,300}/g) || [];
        const blurMatches = toDoRow.match(/descInput\.addEventListener\(\s*['"]blur['"][\s\S]{0,300}/g) || [];
        expect(keyupMatches.some(m => /refreshInjectButton/.test(m))).toBe(true);
        expect(blurMatches.some(m => /refreshInjectButton/.test(m))).toBe(true);
    });
});

describe('inject feature — wired into mobile edit modal', () => {

    const modals = read('modals.js');

    it('modals.js imports makeInjectButton from inject.js', () => {
        expect(modals).toMatch(
            /import\s*\{[^}]*makeInjectButton[^}]*\}\s*from\s*['"]\.\/inject\.js['"]/
        );
    });

    it('the mobile edit modal\'s actions row appends an inject button alongside Clear and Copy', () => {
        const fnIdx = modals.indexOf('function showDescEditorModal(');
        expect(fnIdx).toBeGreaterThan(-1);
        const fn = modals.slice(fnIdx);
        // The factory call now takes a projectName option alongside item;
        // tests of that wiring live in projectInjectRouting.test.js.
        expect(fn).toMatch(/makeInjectButton\s*\(\s*item\s*,/);
        expect(fn).toMatch(/actions\.appendChild\(\s*injectBtn\s*\)/);
    });

    it('the textarea input listener syncs item.desc and refreshes the inject button so its visibility tracks the draft', () => {
        // Item.desc only persists to storage on close, but the inject
        // button reads item.desc directly to decide visibility — so the
        // input handler must keep both in lock-step during editing.
        const fnIdx = modals.indexOf('function showDescEditorModal(');
        const fn = modals.slice(fnIdx);
        expect(fn).toMatch(/textarea\.addEventListener\(\s*['"]input['"][\s\S]{0,300}refreshInjectButton\s*\(/);
    });
});

describe('inject feature — ghost menu Configure inject row', () => {

    const main = read('main.js');

    it('main.js imports initInjectConfig and showInjectSettingsModal from inject.js', () => {
        expect(main).toMatch(
            /import\s*\{[^}]*initInjectConfig[^}]*\}\s*from\s*['"]\.\/inject\.js['"]/
        );
        expect(main).toMatch(
            /import\s*\{[^}]*showInjectSettingsModal[^}]*\}\s*from\s*['"]\.\/inject\.js['"]/
        );
    });

    it('main.js calls initInjectConfig() at module load so the cache is warm before any button renders', () => {
        // Boot-path acceptance: read once on app boot. Must run before
        // component() so the first descSibling render sees correct state.
        expect(main).toMatch(/initInjectConfig\s*\(\s*\)/);
    });

    it('the ghost menu contains a "Configure inject" row that opens the settings modal', () => {
        expect(main).toMatch(/['"]Configure inject['"]/);
        // The row's click handler invokes showInjectSettingsModal.
        const rowIdx = main.indexOf("'Configure inject'");
        expect(rowIdx).toBeGreaterThan(-1);
        const tail = main.slice(rowIdx);
        expect(tail).toMatch(/showInjectSettingsModal\s*\(\s*\)/);
    });

    it('the mobile Settings modal also contains a "Configure inject" row that opens the settings modal', () => {
        // Parity with the desktop ghost menu row above. The mobile Settings
        // modal is built by showSettingsModal() and Configure inject must
        // live in its Data section (next to Export/Import) so the inject
        // config is reachable from a phone.
        const fnIdx = main.indexOf('function showSettingsModal()');
        expect(fnIdx).toBeGreaterThan(-1);
        const slice = main.slice(fnIdx, fnIdx + 15000);
        // The Configure inject row is built via createDrawerActionRow, the
        // same helper the Export/Import rows in the Data section use.
        expect(slice).toMatch(/createDrawerActionRow\(\s*['"]Configure inject['"]/);
        // The row's click handler invokes showInjectSettingsModal after
        // closing the modal — mirrors the Export/Import close()-then-act
        // pattern so the inject modal lands on a clean surface.
        const rowIdx = slice.indexOf("createDrawerActionRow('Configure inject'");
        expect(rowIdx).toBeGreaterThan(-1);
        const rowSlice = slice.slice(rowIdx, rowIdx + 400);
        expect(rowSlice).toMatch(/close\(\s*\)/);
        expect(rowSlice).toMatch(/showInjectSettingsModal\s*\(\s*\)/);
        // Row is appended to the Data section (next to Export/Import),
        // not Account or About, so it sits alongside the other data-
        // management actions.
        expect(slice).toMatch(/dataSection\.appendChild\(\s*injectRow\s*\)/);
    });
});
