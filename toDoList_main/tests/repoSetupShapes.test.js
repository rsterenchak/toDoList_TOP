import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
    SHAPES_URL,
    SHAPES_FILENAME,
    clearShapesCache,
    parseShapesDoc,
    renderMarkdown,
    stripHtmlComments,
    showRepoSetupModal,
} from '../src/repoSetup.js';

// Tests for the Repo setup shape reference — the settings-menu picker that
// reads SHAPES.md live from the public claude-routine-template repo. Three
// layers here:
//
//   • the parser, driven over a fixture that mirrors the real file's shape
//     (8 sections, the same TEMPLATE / CLI / NO SHAPE mix, the same gotcha
//     counts) so a change to either side shows up as a failing count;
//   • the modal itself, driven in jsdom with a mocked global fetch;
//   • the static contracts — the `[hidden]` guards in style.css, the
//     settings-menu placement, and the no-innerHTML rule for remote text.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const css = readFileSync(resolve(srcDir, 'style.css'), 'utf8');
const repoSetupSrc = readFileSync(resolve(srcDir, 'repoSetup.js'), 'utf8');
const settingsMenuSrc = readFileSync(resolve(srcDir, 'settingsMenu.js'), 'utf8');

// Written as lines rather than a template literal so the fenced code blocks
// can carry real backticks without escaping.
const FIXTURE = [
    '# Project shapes',
    '',
    'How to start a repo for each shape `onboard.sh` resolves.',
    '',
    '<!--',
    '  PARSING CONTRACT — the PWA reads this file live and parses four markers.',
    '    ## <shape-name>          → one picker row',
    '    **Template:** `owner/x`  → TEMPLATE chip',
    '-->',
    '',
    'Every `##` section below is one shape.',
    '',
    '---',
    '',
    '## build-pipeline',
    '',
    'Bundled web app published to `gh-pages`. Angular, React, Vue.',
    '',
    '**No template** — framework scaffolds go stale. Use the CLI.',
    '',
    '**Onboarding adds:** `deploy.yml`, `test.yml`, a manifest generator.',
    'Pages source: `gh-pages`, root.',
    '',
    // Each fence is captioned by the bold marker line above it, and carries
    // ONLY what should be pasted — the file names the target in the caption
    // rather than in a `//` comment inside the block, so a copy is clean.
    '### angular',
    '',
    '**1 · Scaffold** — in the empty repo, both lines',
    '',
    '```bash',
    'npm install -g @angular/cli',
    'ng new my-app --routing --style=css --directory . --skip-git',
    '```',
    '',
    // A bold-opening paragraph with no fence under it is ordinary prose.
    '**2 · Answer the prompts** — say No to SSR, None to AI tools.',
    '',
    // Two edit blocks, one per file — kept separate deliberately, since merging
    // them is what let a `package.json` script get pasted into `angular.json`.
    // This caption wraps across two source lines.
    '**3 · Edit `angular.json`** — inside `projects.<name>.architect.build.options`,',
    'beside `browser` and `tsConfig`',
    '',
    '```jsonc',
    '"outputPath": { "base": "dist", "browser": "" }',
    '```',
    '',
    '**4 · Edit `package.json`** — inside `scripts`',
    '',
    '```jsonc',
    '"build": "ng build --base-href /my-app/",',
    '"test:run": "ng test --no-watch"',
    '```',
    '',
    '**5 · Commit and push**, then Check from the app.',
    '',
    '### react',
    '',
    '**1 · Scaffold** — in the empty repo',
    '',
    '```bash',
    'npm create vite@latest . -- --template react',
    'npm install',
    '```',
    '',
    '**2 · Edit `package.json`** — inside `scripts`',
    '',
    '```jsonc',
    '"test:run": "vitest run"',
    '```',
    '',
    'Vite already outputs to `dist/`. `matchingGame-test` is a working reference.',
    '',
    '### vue',
    '',
    // A bare `**Scaffold**` marker names the block without describing it.
    '**Scaffold**',
    '',
    '```bash',
    'npm create vue@latest .',
    '```',
    '',
    '`npm create vue@latest` is interactive — **choose Vitest** when it asks.',
    '',
    '**Gotchas**',
    '- Edit before preflighting. `test_command` is read straight from',
    '  `package.json`, so preflighting first bakes `npm test` into the report.',
    '- Preflight can NOT verify the `outputPath` edit.',
    '- Add a `404.html` copy of `index.html` if the app routes.',
    '- Commit the lockfile.',
    '',
    '---',
    '',
    '## served-from-source',
    '',
    'Static site with no build step.',
    '',
    '**Template:** `rsterenchak/template-served-from-source`',
    '',
    '**Onboarding adds:** `manifest.yml` (regenerates the source manifest and commits',
    'it to the repo root), `test.yml`. Pages source: `main`, root.',
    '',
    '**Gotchas**',
    '- The absence of a `build` script is what separates this from build-pipeline.',
    '- `"type": "module"` selects the `.cjs` manifest generator.',
    '- Deleting `package.json` still resolves to served-from-source.',
    '- Ships with a `package-lock.json`. Keep it.',
    '',
    '---',
    '',
    '## console',
    '',
    'Cross-platform .NET console app.',
    '',
    '**Template:** `rsterenchak/template-console`',
    '',
    '**Onboarding adds:** `test.yml` (dotnet test on ubuntu), `manifest.yml`,',
    '`run-capture.yml`. Pages source: `main`, root.',
    '',
    '**Gotchas**',
    '- **Exactly one `OutputType=Exe` project.**',
    '- `.csproj`/`.sln` must be within two directories of the root.',
    '- Keep the `.sln` at the root so `WORKING_DIR` stays `.`.',
    '- `Microsoft.NET.Test.Sdk` is the marker for a test project.',
    '',
    '---',
    '',
    '## desktop',
    '',
    'WinForms or WPF. Software II.',
    '',
    '**Template:** `rsterenchak/template-desktop`',
    '',
    '**Onboarding adds:** `test.yml` running on **windows-latest**, `manifest.yml`.',
    'No `run-capture.yml` — a GUI app hangs a headless runner.',
    '',
    '**Gotchas**',
    '- `<UseWindowsForms>true</UseWindowsForms>` is the routing signal.',
    '- Keep testable logic out of the `Form`.',
    '- windows-latest is slower than console.',
    '',
    '---',
    '',
    '## maui',
    '',
    '.NET mobile. Mobile Application Development.',
    '',
    '**No template** — `dotnet new maui` generates a multi-target `.csproj`,',
    '`Platforms/` folders, XAML pages, and resource directories.',
    '',
    // A variant-less CLI section whose body is a numbered sequence, not one
    // scaffold command — the shape that used to lose everything after step 1.
    '**1 · Install the workload** — on Linux this is `maui-android`, NOT `maui`.',
    '',
    '```bash',
    'dotnet workload install maui-android',
    '```',
    '',
    '**2 · Scaffold** — into `src/`, so the solution has somewhere to sit',
    '',
    '```bash',
    'dotnet new maui -n MyApp -o src/MyApp',
    '```',
    '',
    '**3 · Create the solution** — `--format sln` is required',
    '',
    '```bash',
    'dotnet new sln -n MyApp --format sln',
    'dotnet sln add src/MyApp/MyApp.csproj',
    '```',
    '',
    'Put something real in `MyApp.Core` and test it.',
    '',
    '**4 · Commit and push**, then Check from the app.',
    '',
    '**Onboarding adds:** `test.yml` (MAUI Android build on ubuntu), `manifest.yml`.',
    'No Capture card — there is no runnable head.',
    '',
    '**Gotchas**',
    '- Detection routes on the `-android` TFMs.',
    '- **Android head only.** iOS cannot build on ubuntu.',
    '- Keep logic out of the XAML code-behind.',
    '- **Least-proven shape in the pipeline.** `test-maui.yml` has never executed',
    '  against a real project.',
    '',
    '---',
    '',
    '## sql',
    '',
    'Schema and migrations, no application code.',
    '',
    '**Template:** `rsterenchak/template-sql`',
    '',
    '**Onboarding adds:** `manifest.yml` running the generator in SQL mode, which',
    'publishes a table outline. No test workflow. Pages source: `main`, root.',
    '',
    '**Gotchas**',
    '- `.sql` files must be within four directories of the root.',
    '- Keep `CREATE TABLE` statements conventional.',
    '- `.sql` at the repo root is the easy case.',
    '',
    '---',
    '',
    '## repo-only',
    '',
    'Storage repo: notes, research, planning.',
    '',
    '**Template:** `rsterenchak/template-repo-only`',
    '',
    '**Onboarding adds:** the routine, triage, and `TODO.md`. No test, deploy, or',
    'manifest.',
    '',
    '**Gotchas**',
    '- **Do not add a `src/` folder.** It routes the repo to served-from-source.',
    '- No CI gate, so PRs auto-merge with no status check.',
    '',
    '---',
    '',
    '## python',
    '',
    '**No shape exists.** A Python repo with `src/` trips the served-from-source',
    'rule and gets a Node `test.yml` it cannot run.',
    '',
    'Until a shape is added, override to `repo-only` at the shape prompt.',
    '',
].join('\n');

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) { for (let i = 0; i < n; i++) await tick(); }

let realFetch;
let fetchSpy;
let realInnerWidth;

function mockFetchText(text) {
    fetchSpy = vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(text) }));
    globalThis.fetch = fetchSpy;
}

function mockFetchFailure() {
    fetchSpy = vi.fn(() => Promise.reject(new Error('offline')));
    globalThis.fetch = fetchSpy;
}

function setViewportWidth(px) {
    Object.defineProperty(window, 'innerWidth', {
        value: px, writable: true, configurable: true,
    });
}

beforeEach(() => {
    clearShapesCache();
    realFetch = globalThis.fetch;
    realInnerWidth = window.innerWidth;
    mockFetchText(FIXTURE);
    document.body.innerHTML = '';
});

afterEach(() => {
    globalThis.fetch = realFetch;
    setViewportWidth(realInnerWidth);
    clearShapesCache();
    document.body.innerHTML = '';
});

// Open the modal and let the fetch + first render settle.
async function openModal() {
    const handle = showRepoSetupModal();
    await flush();
    return handle;
}

function rowHeads() {
    return Array.from(document.querySelectorAll('#repoSetupList .repoSetupRowHead'));
}

function rowNamed(name) {
    const head = rowHeads().find(function (h) {
        return h.querySelector('.repoSetupRowName').textContent === name;
    });
    return head ? head.parentElement : null;
}


describe('SHAPES.md parser', () => {
    const sections = parseShapesDoc(FIXTURE);

    it('yields one section per `## ` heading, in document order', () => {
        expect(sections.map((s) => s.name)).toEqual([
            'build-pipeline',
            'served-from-source',
            'console',
            'desktop',
            'maui',
            'sql',
            'repo-only',
            'python',
        ]);
    });

    it('labels a section TEMPLATE when it carries a **Template:** line, CLI when it does not', () => {
        const byName = Object.fromEntries(sections.map((s) => [s.name, s.kind]));
        expect(byName['build-pipeline']).toBe('cli');
        expect(byName['maui']).toBe('cli');
        expect(byName['served-from-source']).toBe('template');
        expect(byName['console']).toBe('template');
        expect(byName['desktop']).toBe('template');
        expect(byName['sql']).toBe('template');
        expect(byName['repo-only']).toBe('template');
    });

    it('labels a **No shape exists.** section NO SHAPE rather than CLI', () => {
        // python has no Template line either, so the no-shape check has to run
        // first or it would be mislabelled as a CLI shape.
        const python = sections.find((s) => s.name === 'python');
        expect(python.kind).toBe('none');
        expect(python.copyValue).toBe('');
        expect(python.gotchas).toEqual([]);
        expect(python.adds).toEqual([]);
        expect(python.lead).toContain('No shape exists.');
    });

    it('flags only the least-proven shape, matching case-insensitively', () => {
        // The file writes it sentence-initial ("Least-proven shape…"), so an
        // exact-case test would silently stop flagging maui.
        expect(sections.filter((s) => s.warn).map((s) => s.name)).toEqual(['maui']);
    });

    it('counts each section’s gotcha bullets', () => {
        expect(sections.map((s) => s.gotchas.length)).toEqual([4, 4, 4, 3, 4, 3, 2, 0]);
    });

    it('folds a bullet’s wrapped continuation lines into one gotcha', () => {
        const build = sections.find((s) => s.name === 'build-pipeline');
        expect(build.gotchas[0]).toContain('Edit before preflighting.');
        expect(build.gotchas[0]).toContain('bakes `npm test` into the report.');
    });

    it('takes the copyable value from the Template line for template shapes', () => {
        const served = sections.find((s) => s.name === 'served-from-source');
        expect(served.copyValue).toBe('rsterenchak/template-served-from-source');
    });

    it('reads a variant-less CLI section’s body as a sequence, keeping every block', () => {
        // maui is a numbered setup, not one scaffold command. Reaching for the
        // first fenced block showed step 1 and silently discarded the rest.
        const maui = sections.find((s) => s.name === 'maui');
        expect(maui.variants).toEqual([]);
        expect(maui.parts.map((p) => p.type))
            .toEqual(['prose', 'code', 'code', 'code', 'prose', 'prose']);
        expect(maui.parts.filter((p) => p.type === 'code').map((p) => p.text)).toEqual([
            'dotnet workload install maui-android',
            'dotnet new maui -n MyApp -o src/MyApp',
            ['dotnet new sln -n MyApp --format sln', 'dotnet sln add src/MyApp/MyApp.csproj'].join('\n'),
        ]);
        // Each block carries the `**N · Label**` line above it as its caption.
        expect(maui.parts.filter((p) => p.type === 'code').map((p) => p.label)).toEqual([
            '**1 · Install the workload** — on Linux this is `maui-android`, NOT `maui`.',
            '**2 · Scaffold** — into `src/`, so the solution has somewhere to sit',
            '**3 · Create the solution** — `--format sln` is required',
        ]);
        // The section-level copyable value would have been step 1 alone.
        expect(maui.copyValue).toBe('');
    });

    it('bounds the sequence at the onboarding-adds and gotchas markers', () => {
        // Both own their own surface further down the row, so neither may be
        // absorbed into the trailing block or re-emitted as body prose.
        const maui = sections.find((s) => s.name === 'maui');
        const text = maui.parts.map((p) => p.text).join('\n');
        expect(text).not.toContain('Onboarding adds');
        expect(text).not.toContain('Gotchas');
        expect(text).not.toContain('Least-proven');
        // The lead already renders above the body — it must not appear twice.
        expect(text).not.toContain('.NET mobile. Mobile Application Development.');
        expect(maui.lead).toBe('.NET mobile. Mobile Application Development.');
        expect(maui.parts[0].text).toContain('No template');
        expect(maui.parts[5].text).toBe('**4 · Commit and push**, then Check from the app.');
    });

    it('keeps a single unlabelled block as one plain copyable value', () => {
        // A shape that never had steps is unchanged: one block, no caption, so
        // it stays the section's copyable value rather than becoming a sequence.
        const doc = parseShapesDoc([
            '## simple',
            '',
            'One command and nothing else.',
            '',
            '```bash',
            'npx create-thing .',
            '```',
            '',
            '**Gotchas**',
            '- Commit the lockfile.',
            '',
        ].join('\n'));
        expect(doc[0].parts).toEqual([]);
        expect(doc[0].copyValue).toBe('npx create-thing .');
        expect(doc[0].gotchas).toEqual(['Commit the lockfile.']);
    });

    it('leaves a template section with no sequence of its own', () => {
        // Template shapes copy the repo name and carry no command blocks.
        sections.filter((s) => s.kind === 'template').forEach((s) => {
            expect(s.parts, `${s.name} should carry no sequence`).toEqual([]);
            expect(s.copyValue).not.toBe('');
        });
    });

    it('leaves a variant-carrying shape with no section-level copyable value', () => {
        // build-pipeline's fenced blocks belong to its variants — one scaffold
        // each — so reaching for the first would show Angular's and hide the
        // rest, which is the bug the variants replaced.
        const build = sections.find((s) => s.name === 'build-pipeline');
        expect(build.variants.map((v) => v.name)).toEqual(['angular', 'react', 'vue']);
        expect(build.copyValue).toBe('');
    });

    it('reads the onboarding-adds items as chips, stopping at the end of the sentence', () => {
        const byName = Object.fromEntries(sections.map((s) => [s.name, s.adds]));
        // The trailing "Pages source: …" sentence is prose, not a chip.
        expect(byName['build-pipeline']).toEqual(['deploy.yml', 'test.yml', 'a manifest generator']);
        // A comma inside the parenthetical aside does not split the chip.
        expect(byName['served-from-source']).toEqual([
            'manifest.yml (regenerates the source manifest and commits it to the repo root)',
            'test.yml',
        ]);
        expect(byName['console']).toEqual(['test.yml (dotnet test on ubuntu)', 'manifest.yml', 'run-capture.yml']);
        // A leading "and" is dropped so the last chip reads like the others.
        expect(byName['repo-only']).toEqual(['the routine', 'triage', 'TODO.md']);
        // A comma before a relative pronoun opens a clause about the item just
        // named, not a second item — it folds back into one chip.
        expect(byName['sql']).toEqual([
            'manifest.yml running the generator in SQL mode, which publishes a table outline',
        ]);
    });

    it('reads each section’s lead paragraph', () => {
        const build = parseShapesDoc(FIXTURE).find((s) => s.name === 'build-pipeline');
        expect(build.lead).toBe('Bundled web app published to `gh-pages`. Angular, React, Vue.');
    });

    it('still renders a lead paragraph for a section carrying none of the markers', () => {
        const minimal = parseShapesDoc([
            '# Project shapes',
            '',
            '## mystery',
            '',
            'A shape nobody has documented yet.',
            '',
        ].join('\n'));
        expect(minimal).toHaveLength(1);
        expect(minimal[0].lead).toBe('A shape nobody has documented yet.');
        expect(minimal[0].kind).toBe('cli');
        expect(minimal[0].adds).toEqual([]);
        expect(minimal[0].gotchas).toEqual([]);
    });

    it('ignores a `## ` line inside a fenced code block', () => {
        const withFence = parseShapesDoc([
            '## real',
            '',
            'Lead.',
            '',
            '```bash',
            '## not a heading',
            '```',
            '',
        ].join('\n'));
        expect(withFence.map((s) => s.name)).toEqual(['real']);
    });

    it('reads each variant’s body as prose and fenced blocks in file order', () => {
        const build = sections.find((s) => s.name === 'build-pipeline');
        const angular = build.variants[0];
        // Three blocks — a scaffold and one edit per file — collected in full
        // rather than stopping at the second. The marker lines above the fences
        // are captions, not body prose, so they do not appear as parts; the two
        // prose parts are the fenceless steps 2 and 5.
        expect(angular.parts.map((p) => p.type))
            .toEqual(['code', 'prose', 'code', 'code', 'prose']);
        expect(angular.parts[0].text).toContain('ng new my-app');
        expect(angular.parts[1].text).toContain('Answer the prompts');
        expect(angular.parts[4].text).toContain('Commit and push');
        // A variant may carry only a scaffold — vue has no edits block here.
        const vue = build.variants[2];
        expect(vue.parts.filter((p) => p.type === 'code')).toHaveLength(1);
    });

    it('lifts the marker line above a fence onto the block as its label', () => {
        const build = sections.find((s) => s.name === 'build-pipeline');
        const angular = build.variants[0];
        expect(angular.parts.filter((p) => p.type === 'code').map((p) => p.label)).toEqual([
            '**1 · Scaffold** — in the empty repo, both lines',
            '**3 · Edit `angular.json`** — inside `projects.<name>.architect.build.options`, '
                + 'beside `browser` and `tsConfig`',
            '**4 · Edit `package.json`** — inside `scripts`',
        ]);
        // A bare `**Scaffold**` marker resolves to the generic heading.
        expect(build.variants[2].parts[0].label).toBe('SCAFFOLD');
    });

    it('leaves a bold paragraph that no fence follows as body prose', () => {
        const build = sections.find((s) => s.name === 'build-pipeline');
        const prose = build.variants[0].parts
            .filter((p) => p.type === 'prose')
            .map((p) => p.text);
        // Step 2 opens with a bold run but carries a table's worth of prose
        // rather than a block, and step 5 closes the variant with none.
        expect(prose).toEqual([
            '**2 · Answer the prompts** — say No to SSR, None to AI tools.',
            '**5 · Commit and push**, then Check from the app.',
        ]);
    });

    it('reads the `**File:**` and `**Scaffold**` marker forms as captions too', () => {
        const doc = parseShapesDoc([
            '## shape',
            '',
            'Lead.',
            '',
            '### only',
            '',
            '**Scaffold**',
            '',
            '```bash',
            'npm create thing',
            '```',
            '',
            '**File:** `package.json` → `scripts`',
            '',
            '```jsonc',
            '"test:run": "vitest run"',
            '```',
            '',
        ].join('\n'));
        const blocks = doc[0].variants[0].parts.filter((p) => p.type === 'code');
        expect(blocks.map((p) => p.label))
            .toEqual(['SCAFFOLD', '**File:** `package.json` → `scripts`']);
        // Neither marker survives as body prose.
        expect(doc[0].variants[0].parts.every((p) => p.type === 'code')).toBe(true);
    });

    it('keeps the gotchas out of the last variant', () => {
        // `**Gotchas**` ends the variant region, so vue — the last variant —
        // stops where the gotcha list begins rather than swallowing it.
        const build = sections.find((s) => s.name === 'build-pipeline');
        const vueText = build.variants[2].parts.map((p) => p.text).join('\n');
        expect(vueText).not.toContain('Edit before preflighting');
        expect(vueText).not.toContain('Gotchas');
        expect(build.gotchas).toHaveLength(4);
    });

    it('preserves every fenced block verbatim, carrying no caption text', () => {
        const build = sections.find((s) => s.name === 'build-pipeline');
        const blocks = build.variants[0].parts.filter((p) => p.type === 'code');
        expect(blocks).toHaveLength(3);
        expect(blocks[1].text).toBe('"outputPath": { "base": "dist", "browser": "" }');
        // The third block is the one that used to fall off the end.
        expect(blocks[2].text).toBe([
            '"build": "ng build --base-href /my-app/",',
            '"test:run": "ng test --no-watch"',
        ].join('\n'));
        // The marker names the file above the fence, never inside it — a block
        // that carried its own comment would copy that comment with the code.
        blocks.forEach((block) => {
            expect(block.text).not.toContain('//');
            expect(block.text).not.toContain('**');
        });
    });

    it('preserves blank lines inside a fenced block', () => {
        const doc = parseShapesDoc([
            '## shape',
            '',
            'Lead.',
            '',
            '### only',
            '',
            '```jsonc',
            '"a": 1',
            '',
            '"b": 2',
            '```',
            '',
        ].join('\n'));
        const block = doc[0].variants[0].parts.filter((p) => p.type === 'code')[0];
        expect(block.text).toBe(['"a": 1', '', '"b": 2'].join('\n'));
    });

    it('leaves a section with no `### ` headings free of variants', () => {
        const byName = Object.fromEntries(sections.map((s) => [s.name, s.variants]));
        Object.keys(byName).forEach((name) => {
            if (name === 'build-pipeline') return;
            expect(byName[name], `${name} should carry no variants`).toEqual([]);
        });
    });

    it('ignores a `### ` line inside a fenced code block', () => {
        const withFence = parseShapesDoc([
            '## real',
            '',
            'Lead.',
            '',
            '```bash',
            '### not a variant',
            '```',
            '',
        ].join('\n'));
        expect(withFence[0].variants).toEqual([]);
        expect(withFence[0].copyValue).toBe('### not a variant');
    });

    it('strips HTML comments so the parsing contract never reaches the UI', () => {
        expect(stripHtmlComments(FIXTURE)).not.toContain('PARSING CONTRACT');
        expect(parseShapesDoc(FIXTURE).some((s) => s.name.includes('<shape-name>'))).toBe(false);
    });
});


describe('Repo setup modal', () => {
    it('fetches SHAPES.md from raw.githubusercontent and renders one collapsed row per shape', async () => {
        await openModal();
        expect(fetchSpy).toHaveBeenCalledWith(SHAPES_URL);
        expect(rowHeads()).toHaveLength(8);
        expect(document.getElementById('repoSetupList').hidden).toBe(false);
        expect(document.getElementById('repoSetupStatus').hidden).toBe(true);
        document.querySelectorAll('.repoSetupRowBody').forEach((body) => {
            expect(body.hidden).toBe(true);
        });
        expect(rowHeads().every((h) => h.getAttribute('aria-expanded') === 'false')).toBe(true);
    });

    it('renders the TEMPLATE / CLI / NO SHAPE label and the warning glyph', async () => {
        await openModal();
        const label = (name) => rowNamed(name).querySelector('.repoSetupRowLabel');
        expect(label('served-from-source').textContent).toBe('TEMPLATE');
        expect(label('build-pipeline').textContent).toBe('CLI');
        expect(label('python').textContent).toBe('NO SHAPE');
        expect(rowNamed('maui').querySelector('.repoSetupRowWarn')).not.toBeNull();
        expect(rowNamed('sql').querySelector('.repoSetupRowWarn')).toBeNull();
    });

    it('expands a row on tap and keeps only one row expanded at a time', async () => {
        await openModal();
        const first = rowNamed('build-pipeline');
        const second = rowNamed('console');
        first.querySelector('.repoSetupRowHead').click();
        expect(first.querySelector('.repoSetupRowBody').hidden).toBe(false);
        expect(first.querySelector('.repoSetupRowHead').getAttribute('aria-expanded')).toBe('true');

        second.querySelector('.repoSetupRowHead').click();
        expect(second.querySelector('.repoSetupRowBody').hidden).toBe(false);
        expect(first.querySelector('.repoSetupRowBody').hidden).toBe(true);
        expect(first.querySelector('.repoSetupRowHead').getAttribute('aria-expanded')).toBe('false');

        // Tapping the open row again closes it.
        second.querySelector('.repoSetupRowHead').click();
        expect(second.querySelector('.repoSetupRowBody').hidden).toBe(true);
    });

    it('renders the lead paragraph, the copyable value, and the onboarding chips in the expanded body', async () => {
        await openModal();
        const row = rowNamed('served-from-source');
        row.querySelector('.repoSetupRowHead').click();
        expect(row.querySelector('.repoSetupLead').textContent).toContain('Static site with no build step.');
        expect(row.querySelector('.repoSetupCopyValue').textContent)
            .toBe('rsterenchak/template-served-from-source');
        const chips = Array.from(row.querySelectorAll('.repoSetupChip')).map((c) => c.textContent);
        expect(chips).toContain('test.yml');
    });

    it('shows the first two gotchas with a SHOW N MORE control that reveals the rest', async () => {
        await openModal();
        const row = rowNamed('build-pipeline');
        row.querySelector('.repoSetupRowHead').click();
        const gotchas = Array.from(row.querySelectorAll('.repoSetupGotcha'));
        expect(gotchas).toHaveLength(4);
        expect(gotchas.filter((g) => !g.hidden)).toHaveLength(2);

        const more = row.querySelector('.repoSetupGotchaMore');
        expect(more.textContent).toBe('SHOW 2 MORE');
        more.click();
        expect(gotchas.every((g) => !g.hidden)).toBe(true);
        expect(more.hidden).toBe(true);
    });

    it('omits the SHOW N MORE control when a shape has two gotchas or fewer', async () => {
        await openModal();
        const row = rowNamed('repo-only');
        row.querySelector('.repoSetupRowHead').click();
        expect(row.querySelectorAll('.repoSetupGotcha')).toHaveLength(2);
        expect(row.querySelector('.repoSetupGotchaMore')).toBeNull();
    });

    it('shows an inline error with a retry control on fetch failure, not an empty modal', async () => {
        mockFetchFailure();
        await openModal();
        const error = document.getElementById('repoSetupError');
        expect(error.hidden).toBe(false);
        expect(document.getElementById('repoSetupList').hidden).toBe(true);
        expect(error.textContent).toContain(SHAPES_FILENAME);
        expect(document.getElementById('repoSetupRetry')).not.toBeNull();

        // The failure isn't cached, so retry is a genuine second attempt.
        mockFetchText(FIXTURE);
        document.getElementById('repoSetupRetry').click();
        await flush();
        expect(document.getElementById('repoSetupError').hidden).toBe(true);
        expect(rowHeads()).toHaveLength(8);
    });

    it('caches the document for the session so re-opening does not re-fetch', async () => {
        await openModal();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        document.getElementById('repoSetupClose').click();
        await openModal();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(rowHeads()).toHaveLength(8);
    });

    it('swaps in the full document from VIEW FULL and returns from the back control', async () => {
        setViewportWidth(1280);
        await openModal();
        const viewFull = document.getElementById('repoSetupViewFull');
        expect(viewFull.hidden).toBe(false);
        expect(document.querySelector('#repoSetupFooter .repoSetupSource').textContent)
            .toBe(SHAPES_FILENAME);

        viewFull.click();
        const full = document.getElementById('repoSetupFull');
        expect(full.hidden).toBe(false);
        expect(viewFull.hidden).toBe(true);
        expect(full.textContent).toContain('Project shapes');
        // The contract comment is documentation for the file's editor, not
        // content — it must never render.
        expect(full.textContent).not.toContain('PARSING CONTRACT');
        // Above 1024px the document reads below the picker rather than
        // replacing it.
        expect(document.getElementById('repoSetupList').hidden).toBe(false);

        document.getElementById('repoSetupFullBack').click();
        expect(full.hidden).toBe(true);
        expect(viewFull.hidden).toBe(false);
        expect(document.getElementById('repoSetupList').hidden).toBe(false);
    });

    it('replaces the picker with the full document below 1024px', async () => {
        setViewportWidth(800);
        await openModal();
        document.getElementById('repoSetupViewFull').click();
        expect(document.getElementById('repoSetupFull').hidden).toBe(false);
        expect(document.getElementById('repoSetupList').hidden).toBe(true);

        document.getElementById('repoSetupFullBack').click();
        expect(document.getElementById('repoSetupList').hidden).toBe(false);
    });

    it('closes on the × button, the backdrop, and Escape', async () => {
        await openModal();
        document.getElementById('repoSetupClose').click();
        expect(document.getElementById('repoSetupBackdrop')).toBeNull();

        await openModal();
        document.getElementById('repoSetupBackdrop').click();
        expect(document.getElementById('repoSetupBackdrop')).toBeNull();

        await openModal();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.getElementById('repoSetupBackdrop')).toBeNull();
    });
});


describe('framework variants in an expanded row', () => {
    // Open build-pipeline and hand back its variant control.
    async function openVariantRow() {
        await openModal();
        const row = rowNamed('build-pipeline');
        row.querySelector('.repoSetupRowHead').click();
        return row;
    }

    function segs(row) {
        return Array.from(row.querySelectorAll('.repoSetupVariantSeg'));
    }

    function bodies(row) {
        return Array.from(row.querySelectorAll('.repoSetupVariantBody'));
    }

    it('renders one segment per variant in file order, the first selected', async () => {
        const row = await openVariantRow();
        expect(segs(row).map((s) => s.textContent)).toEqual(['angular', 'react', 'vue']);
        expect(segs(row).map((s) => s.getAttribute('aria-checked')))
            .toEqual(['true', 'false', 'false']);
        expect(bodies(row).map((b) => b.hidden)).toEqual([false, true, true]);
        expect(row.querySelector('.repoSetupVariantControl').getAttribute('role'))
            .toBe('radiogroup');
    });

    it('swaps the body below when another variant is selected', async () => {
        const row = await openVariantRow();
        segs(row)[1].click();
        expect(bodies(row).map((b) => b.hidden)).toEqual([true, false, true]);
        expect(segs(row).map((s) => s.getAttribute('aria-checked')))
            .toEqual(['false', 'true', 'false']);
        expect(segs(row)[1].classList.contains('selected')).toBe(true);
        expect(bodies(row)[1].textContent).toContain('npm create vite@latest');
        expect(bodies(row)[1].textContent).not.toContain('ng new my-app');
    });

    const labelsIn = (row, idx) => Array.from(
        bodies(row)[idx].querySelectorAll('.repoSetupVariantLabel'),
    ).map((l) => l.textContent);

    it('captions each block from the marker line above its fence', async () => {
        const row = await openVariantRow();
        // angular carries three blocks — the scaffold and one edit per file —
        // each captioned by its own marker rather than left anonymous. The
        // markup markers are gone from the caption: the bold run and the
        // backticked paths render as nodes.
        expect(labelsIn(row, 0)).toEqual([
            '1 · Scaffold — in the empty repo, both lines',
            '3 · Edit angular.json — inside projects.<name>.architect.build.options, '
                + 'beside browser and tsConfig',
            '4 · Edit package.json — inside scripts',
        ]);
        expect(labelsIn(row, 1)).toEqual([
            '1 · Scaffold — in the empty repo',
            '2 · Edit package.json — inside scripts',
        ]);
        // A bare `**Scaffold**` marker renders as the generic heading.
        expect(labelsIn(row, 2)).toEqual(['SCAFFOLD']);
    });

    it('renders a caption’s backticked paths as code, inside its bold run too', async () => {
        const row = await openVariantRow();
        const caption = bodies(row)[0].querySelectorAll('.repoSetupVariantLabel')[1];
        expect(Array.from(caption.querySelectorAll('code')).map((c) => c.textContent))
            .toEqual([
                'angular.json',
                'projects.<name>.architect.build.options',
                'browser',
                'tsConfig',
            ]);
        expect(caption.querySelector('strong').textContent).toBe('3 · Edit angular.json');
    });

    it('never renders a marker line as body prose', async () => {
        const row = await openVariantRow();
        const prose = Array.from(bodies(row)[0].querySelectorAll('.repoSetupVariantProse'))
            .map((p) => p.textContent);
        // Steps 2 and 5 carry no block, so they stay prose; every captioned
        // step appears once, above its fence, and not a second time here.
        expect(prose).toEqual([
            '2 · Answer the prompts — say No to SSR, None to AI tools.',
            '5 · Commit and push, then Check from the app.',
        ]);
    });

    it('falls back to SCAFFOLD then EDITS with no marker, and assumes no block count', async () => {
        mockFetchText([
            '## shape',
            '',
            'Lead.',
            '',
            '### only',
            '',
            '```bash',
            'npm create thing',
            '```',
            '',
            '```jsonc',
            '"build": "thing build"',
            '```',
            '',
            '**File:** `other.json`',
            '',
            '```jsonc',
            '"x": 1',
            '```',
            '',
            '```jsonc',
            '"y": 2',
            '```',
            '',
        ].join('\n'));
        await openModal();
        const row = rowNamed('shape');
        row.querySelector('.repoSetupRowHead').click();
        expect(labelsIn(row, 0)).toEqual(['SCAFFOLD', 'EDITS', 'File: other.json', 'EDITS']);
        expect(bodies(row)[0].querySelectorAll('.repoSetupVariantBlock')).toHaveLength(4);
    });

    it('no longer reads a leading `//` comment as a block label', async () => {
        // The comment path is gone rather than kept as a fallback: a block that
        // still carried one would be labelled from it AND copy it, which is the
        // dirty copy the marker line exists to end.
        mockFetchText([
            '## shape',
            '',
            'Lead.',
            '',
            '### only',
            '',
            '```bash',
            'npm create thing',
            '```',
            '',
            '```jsonc',
            '// legacy.json → scripts',
            '"x": 1',
            '```',
            '',
        ].join('\n'));
        await openModal();
        const row = rowNamed('shape');
        row.querySelector('.repoSetupRowHead').click();
        expect(labelsIn(row, 0)).toEqual(['SCAFFOLD', 'EDITS']);
        // The fence is still reproduced verbatim — only the labelling changed.
        expect(bodies(row)[0].querySelectorAll('.repoSetupCopyValue')[1].textContent)
            .toContain('// legacy.json → scripts');
    });

    it('gives each block its own copy control writing the block’s raw text', async () => {
        const writeText = vi.fn(() => Promise.resolve());
        const priorClipboard = navigator.clipboard;
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        try {
            const row = await openVariantRow();
            const blocks = Array.from(bodies(row)[0].querySelectorAll('.repoSetupVariantBlock'));
            // Every block gets its own control — the two edits go to different
            // files, so there is no combined copy that could paste one into the
            // other.
            expect(blocks).toHaveLength(3);

            blocks[0].querySelector('.repoSetupCopyBtn').click();
            expect(writeText).toHaveBeenLastCalledWith([
                'npm install -g @angular/cli',
                'ng new my-app --routing --style=css --directory . --skip-git',
            ].join('\n'));

            blocks[1].querySelector('.repoSetupCopyBtn').click();
            const copied = writeText.mock.calls[1][0];
            // The fence contents verbatim and nothing else — no caption, no
            // marker line, nothing that would have to be deleted after pasting.
            expect(copied).toBe('"outputPath": { "base": "dist", "browser": "" }');
            expect(copied).not.toContain('Edit');
            expect(copied).not.toContain('package.json');

            blocks[2].querySelector('.repoSetupCopyBtn').click();
            expect(writeText).toHaveBeenLastCalledWith([
                '"build": "ng build --base-href /my-app/",',
                '"test:run": "ng test --no-watch"',
            ].join('\n'));
        } finally {
            Object.defineProperty(navigator, 'clipboard', {
                value: priorClipboard, configurable: true,
            });
        }
    });

    it('keeps the chips above the control and the gotchas below it', async () => {
        const row = await openVariantRow();
        const children = Array.from(row.querySelector('.repoSetupRowBody').children);
        const indexOf = (selector) => children.findIndex((c) => c.matches(selector));
        expect(indexOf('.repoSetupLead')).toBeGreaterThan(-1);
        expect(indexOf('.repoSetupChips')).toBeLessThan(indexOf('.repoSetupVariants'));
        expect(indexOf('.repoSetupVariants')).toBeLessThan(indexOf('.repoSetupGotchas'));
        // The section's blocks belong to its variants, so no section-level
        // copyable value is rendered alongside them.
        expect(row.querySelector('.repoSetupRowBody > .repoSetupCopy')).toBeNull();
    });

    it('renders a variant-free shape’s sequence with no segmented control above it', async () => {
        await openModal();
        const row = rowNamed('maui');
        row.querySelector('.repoSetupRowHead').click();
        // Nothing to switch between, so the control never mounts — but every
        // step renders, each with its caption and its own copy button.
        expect(row.querySelector('.repoSetupVariants')).toBeNull();
        expect(row.querySelector('.repoSetupVariantControl')).toBeNull();
        const steps = row.querySelector('.repoSetupSteps');
        expect(steps).not.toBeNull();
        expect(steps.querySelectorAll('.repoSetupVariantBlock')).toHaveLength(3);
        expect(steps.querySelectorAll('.repoSetupCopyBtn')).toHaveLength(3);
        expect(Array.from(steps.querySelectorAll('.repoSetupVariantLabel')).map((l) => l.textContent))
            .toEqual([
                '1 · Install the workload — on Linux this is maui-android, NOT maui.',
                '2 · Scaffold — into src/, so the solution has somewhere to sit',
                '3 · Create the solution — --format sln is required',
            ]);
        expect(Array.from(steps.querySelectorAll('.repoSetupCopyValue')).map((v) => v.textContent))
            .toEqual([
                'dotnet workload install maui-android',
                'dotnet new maui -n MyApp -o src/MyApp',
                ['dotnet new sln -n MyApp --format sln', 'dotnet sln add src/MyApp/MyApp.csproj'].join('\n'),
            ]);
        // No section-level copyable value competing with the sequence.
        expect(row.querySelector('.repoSetupRowBody > .repoSetupCopy')).toBeNull();
        expect(row.querySelectorAll('.repoSetupGotcha')).toHaveLength(4);
    });

    it('keeps the chips above the sequence and the gotchas below it', async () => {
        await openModal();
        const row = rowNamed('maui');
        row.querySelector('.repoSetupRowHead').click();
        const children = Array.from(row.querySelector('.repoSetupRowBody').children);
        const indexOf = (selector) => children.findIndex((c) => c.matches(selector));
        expect(indexOf('.repoSetupLead')).toBe(0);
        expect(indexOf('.repoSetupChips')).toBeLessThan(indexOf('.repoSetupSteps'));
        expect(indexOf('.repoSetupSteps')).toBeLessThan(indexOf('.repoSetupGotchas'));
    });

    it('renders a single unlabelled block as one plain copyable value, as before', async () => {
        mockFetchText([
            '## simple',
            '',
            'One command and nothing else.',
            '',
            '```bash',
            'npx create-thing .',
            '```',
            '',
        ].join('\n'));
        await openModal();
        const row = rowNamed('simple');
        row.querySelector('.repoSetupRowHead').click();
        expect(row.querySelector('.repoSetupSteps')).toBeNull();
        expect(row.querySelector('.repoSetupVariants')).toBeNull();
        expect(row.querySelector('.repoSetupRowBody > .repoSetupCopy')).not.toBeNull();
        expect(row.querySelector('.repoSetupCopyValue').textContent).toBe('npx create-thing .');
    });

    it('gives each step in a sequence its own copy control writing that block’s raw text', async () => {
        const writeText = vi.fn(() => Promise.resolve());
        const priorClipboard = navigator.clipboard;
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        try {
            await openModal();
            const row = rowNamed('maui');
            row.querySelector('.repoSetupRowHead').click();
            const blocks = Array.from(row.querySelectorAll('.repoSetupSteps .repoSetupVariantBlock'));
            blocks[2].querySelector('.repoSetupCopyBtn').click();
            // The fence contents verbatim — the caption lives in its own node,
            // so nothing has to be deleted after pasting.
            expect(writeText).toHaveBeenLastCalledWith(
                ['dotnet new sln -n MyApp --format sln', 'dotnet sln add src/MyApp/MyApp.csproj'].join('\n'),
            );
            blocks[0].querySelector('.repoSetupCopyBtn').click();
            expect(writeText).toHaveBeenLastCalledWith('dotnet workload install maui-android');
        } finally {
            Object.defineProperty(navigator, 'clipboard', {
                value: priorClipboard, configurable: true,
            });
        }
    });
});


describe('markdown reader', () => {
    it('renders headings, paragraphs, lists, fenced code, bold, and inline code as nodes', () => {
        const host = document.createElement('div');
        renderMarkdown(host, [
            '# Title',
            '',
            'A paragraph with `code` and **bold**.',
            '',
            '- first bullet',
            '- second bullet',
            '',
            '```bash',
            'echo hi',
            '```',
            '',
        ].join('\n'));

        expect(host.querySelector('.repoSetupDocH--1').textContent).toBe('Title');
        expect(host.querySelector('.repoSetupDocP code').textContent).toBe('code');
        expect(host.querySelector('.repoSetupDocP strong').textContent).toBe('bold');
        expect(host.querySelectorAll('.repoSetupDocList li')).toHaveLength(2);
        expect(host.querySelector('.repoSetupDocPre code').textContent).toBe('echo hi');
    });

    it('renders remote angle brackets as text, never as markup', () => {
        const host = document.createElement('div');
        renderMarkdown(host, 'A line with <img src=x onerror=boom> in it.');
        expect(host.querySelector('img')).toBeNull();
        expect(host.textContent).toContain('<img src=x onerror=boom>');
    });
});


describe('static contracts', () => {
    it('never assigns innerHTML in repoSetup.js — the document is remote text', () => {
        expect(repoSetupSrc).not.toMatch(/\.innerHTML\s*=/);
        expect(repoSetupSrc).not.toMatch(/insertAdjacentHTML/);
    });

    it('writes no inline styles — all styling lives in style.css', () => {
        expect(repoSetupSrc).not.toMatch(/\.style\.[a-zA-Z]+\s*=/);
        expect(repoSetupSrc).not.toMatch(/setAttribute\(\s*['"]style['"]/);
    });

    it('guards every toggled element with an explicit [hidden] display rule', () => {
        [
            '#repoSetupList[hidden]',
            '.repoSetupRowBody[hidden]',
            '#repoSetupFull[hidden]',
            '#repoSetupError[hidden]',
            '#repoSetupStatus[hidden]',
            '.repoSetupGotcha[hidden]',
            '.repoSetupGotchaMore[hidden]',
            '.repoSetupGhostBtn[hidden]',
            '.repoSetupVariants[hidden]',
            '.repoSetupVariantControl[hidden]',
            '.repoSetupVariantBody[hidden]',
            '.repoSetupVariantBlock[hidden]',
            '.repoSetupSteps[hidden]',
        ].forEach((selector) => {
            const idx = css.indexOf(selector);
            expect(idx, `${selector} missing from style.css`).toBeGreaterThan(-1);
            expect(css.slice(idx, idx + 200)).toMatch(/display:\s*none\s*!important/);
        });
    });

    it('adds a Repo setup section to the settings menu immediately before Configure inject', () => {
        expect(settingsMenuSrc).toMatch(/import\s*\{\s*showRepoSetupModal\s*\}\s*from\s*'\.\/repoSetup\.js'/);
        const headingIdx = settingsMenuSrc.indexOf("repoSetupHeading.textContent = 'Repo setup'");
        const itemIdx = settingsMenuSrc.indexOf("buildSettingsMenuItem(\n            'Shape reference'");
        const injectIdx = settingsMenuSrc.indexOf("buildSettingsMenuItem(\n            'Configure inject'");
        expect(headingIdx).toBeGreaterThan(-1);
        expect(itemIdx).toBeGreaterThan(-1);
        expect(injectIdx).toBeGreaterThan(-1);
        expect(headingIdx).toBeLessThan(itemIdx);
        expect(itemIdx).toBeLessThan(injectIdx);
        // The section brings its own divider + heading, matching HELP / DATA.
        const sectionSlice = settingsMenuSrc.slice(headingIdx - 400, headingIdx);
        expect(sectionSlice).toContain('buildSettingsMenuDivider()');
    });
});
