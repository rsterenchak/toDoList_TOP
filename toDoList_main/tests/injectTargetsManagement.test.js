import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Source-inspection tests for the inject targets management feature —
// the new collapsible Connection section, the Inject targets list, the
// add/edit sub-modal, and the Supabase CRUD wiring. Follows the pattern
// in injectToTodoMd.test.js since instantiating the full modal flow
// against jsdom + Supabase stub is out of scope for these tests.

describe('inject targets — inject.js Supabase wiring', () => {

    const inject = read('inject.js');

    it('imports the shared Supabase client', () => {
        expect(inject).toMatch(
            /import\s*\{[^}]*\bsupabase\b[^}]*\}\s*from\s*['"]\.\/supabaseClient\.js['"]/
        );
    });

    it('loads targets via from(\'inject_targets\').select().order(\'created_at\')', () => {
        expect(inject).toMatch(
            /\.from\(\s*['"]inject_targets['"]\s*\)[\s\S]{0,80}\.select\(\s*\)[\s\S]{0,80}\.order\(\s*['"]created_at['"]\s*\)/
        );
    });

    it('insert sets nickname, repo, file_path, and user_id from the current session', () => {
        expect(inject).toMatch(
            /\.from\(\s*['"]inject_targets['"]\s*\)\s*\.insert\s*\(/
        );
        expect(inject).toMatch(/nickname:\s*values\.nickname/);
        expect(inject).toMatch(/repo:\s*values\.repo/);
        expect(inject).toMatch(/file_path:\s*values\.file_path/);
        expect(inject).toMatch(/user_id:\s*session\.user\.id/);
    });

    it('update writes by id via .update().eq(\'id\', id)', () => {
        expect(inject).toMatch(
            /\.from\(\s*['"]inject_targets['"]\s*\)[\s\S]{0,200}\.update\(\s*\{[\s\S]{0,200}\}\s*\)\s*\.eq\(\s*['"]id['"]\s*,\s*id\s*\)/
        );
    });

    it('delete removes by id via .delete().eq(\'id\', id)', () => {
        expect(inject).toMatch(
            /\.from\(\s*['"]inject_targets['"]\s*\)[\s\S]{0,80}\.delete\(\s*\)\s*\.eq\(\s*['"]id['"]\s*,\s*id\s*\)/
        );
    });

    it('detects a duplicate-nickname error from the DB unique constraint', () => {
        // Either Postgres unique_violation code 23505 or a message that
        // contains "duplicate" / "unique" — the unique constraint on
        // (user_id, nickname) is the source of truth.
        expect(inject).toMatch(/['"]23505['"]/);
        expect(inject).toMatch(/duplicate-nickname/);
    });
});

describe('inject targets — validation rules', () => {

    const inject = read('inject.js');

    it('validates that repo matches owner/name shape (no whitespace, exactly one slash)', () => {
        // The regex must require a non-whitespace non-slash owner, a
        // single slash, then a non-whitespace non-slash name.
        expect(inject).toMatch(/\/\^\[\^\\s\/\]\+\\\/\[\^\\s\/\]\+\$\//);
    });

    it('flags nickname and file_path as required', () => {
        expect(inject).toMatch(/errors\.nickname\s*=\s*['"]Nickname is required['"]/);
        expect(inject).toMatch(/errors\.file_path\s*=\s*['"]File path is required['"]/);
    });
});

describe('inject targets — settings modal sections', () => {

    const inject = read('inject.js');

    it('renders a Connection section with collapse / edit affordance', () => {
        expect(inject).toMatch(/['"]injectConnectionSection['"]/);
        expect(inject).toMatch(/['"]Connection \(this device\)['"]/);
        expect(inject).toMatch(/['"]injectConnectionEditBtn['"]/);
        expect(inject).toMatch(/injectSettingsSection--collapsed/);
    });

    it('auto-collapses Connection when configured and last test was OK', () => {
        // shouldAutoCollapse must require both isInjectConfigured() AND
        // the last test result being 'ok'.
        expect(inject).toMatch(/function\s+shouldAutoCollapse\s*\(/);
        expect(inject).toMatch(/isInjectConfigured\(\)[\s\S]{0,200}lt\.result\s*===\s*['"]ok['"]/);
    });

    it('edit icon re-expands the Connection section', () => {
        expect(inject).toMatch(/editBtn\.addEventListener\(\s*['"]click['"][\s\S]{0,200}setConnectionCollapsed\(\s*false\s*\)/);
    });

    it('renders an Inject targets section with empty-state copy', () => {
        expect(inject).toMatch(/['"]injectTargetsSection['"]/);
        expect(inject).toMatch(/['"]Inject targets['"]/);
        expect(inject).toMatch(/No targets defined yet — add one to start routing/);
    });

    it('renders an "+ Add target" button that opens the sub-modal', () => {
        expect(inject).toMatch(/['"]injectAddTargetBtn['"]/);
        expect(inject).toMatch(/\+ Add target/);
        expect(inject).toMatch(/showInjectTargetSubModal\s*\(\s*\{[\s\S]{0,200}target:\s*null/);
    });
});

describe('inject targets — sub-modal shell', () => {

    const inject = read('inject.js');

    it('mounts under #injectTargetSubBackdrop / #injectTargetSubModal', () => {
        expect(inject).toMatch(/['"]injectTargetSubBackdrop['"]/);
        expect(inject).toMatch(/['"]injectTargetSubModal['"]/);
    });

    it('renders three text inputs — nickname, repo, file path', () => {
        expect(inject).toMatch(/['"]injectTargetNicknameInput['"]/);
        expect(inject).toMatch(/['"]injectTargetRepoInput['"]/);
        expect(inject).toMatch(/['"]injectTargetFilePathInput['"]/);
    });

    it('repo input shows the owner/repository placeholder', () => {
        expect(inject).toMatch(/['"]owner\/repository['"]/);
    });

    it('file path defaults to TODO.md on the add flow and shows the existing value on edit', () => {
        // The makeField call for filePath passes 'TODO.md' as the
        // initial-when-no-existing default; edit existing.file_path
        // takes precedence.
        expect(inject).toMatch(/existing\s*\?\s*existing\.file_path\s*:\s*['"]TODO\.md['"]/);
    });

    it('Save validates client-side before writing to Supabase', () => {
        expect(inject).toMatch(/validateTargetForm\s*\(/);
    });

    it('closes 3 ways — X, backdrop, Escape — with Escape only closing the sub-modal', () => {
        expect(inject).toMatch(/closeX\.addEventListener\(\s*['"]click['"]\s*,\s*close\s*\)/);
        // The sub-modal close function is named `close` inside the
        // sub-modal scope; the backdrop handler must invoke it on a
        // backdrop-target click.
        expect(inject).toMatch(/backdrop\.addEventListener\(\s*['"]click['"]\s*,\s*function\s*\(\s*event\s*\)\s*\{\s*if\s*\(\s*event\.target\s*===\s*backdrop\s*\)\s*close\(\)/);
        // stopPropagation on Escape so the parent's Escape handler
        // doesn't also fire and close the settings modal underneath.
        expect(inject).toMatch(/event\.key\s*===\s*['"]Escape['"][\s\S]{0,200}event\.stopPropagation\s*\(\s*\)/);
    });

    it('all sub-modal text inputs use 16px font-size to avoid iOS Safari auto-zoom', () => {
        const css = read('style.css');
        expect(css).toMatch(/\.injectTargetSubInput[\s\S]{0,200}font-size:\s*16px/);
    });
});

describe('inject targets — save-time allowlist check', () => {

    const inject = read('inject.js');

    it('onSave calls fetchAllowedRepos after the synchronous shape validation', () => {
        // The async allowlist gate lives in onSave, after validateTargetForm
        // returns clean and before the Supabase write.
        expect(inject).toMatch(
            /validateTargetForm\s*\([\s\S]{0,1000}await\s+fetchAllowedRepos\s*\(\s*\)/
        );
    });

    it('blocks the write when the allowlist resolves without values.repo', () => {
        // Match against result.repos.some(r => r.repo === values.repo) per
        // the implementation note, and abort (return) when absent.
        expect(inject).toMatch(
            /\.repos\.some\(\s*\(?\s*r\s*\)?\s*=>\s*r\.repo\s*===\s*values\.repo\s*\)/
        );
    });

    it('surfaces the allowlist failure as an inline repo-field error', () => {
        expect(inject).toMatch(
            /setError\(\s*repoField\s*,\s*['"]Not in the Worker allowlist[^'"]*['"]\s*\)/
        );
    });

    it('re-enables Save on a blocked result so the user can retry', () => {
        // The blocked path must clear saveBtn.disabled before returning so
        // Save is never left stuck disabled.
        expect(inject).toMatch(
            /Not in the Worker allowlist[\s\S]{0,400}saveBtn\.disabled\s*=\s*false/
        );
    });

    it('skips the check (allows save) when fetchAllowedRepos returns null', () => {
        // The guard must be conditional on a truthy allow result, so a null
        // (Worker-unreachable) return falls through to the write.
        expect(inject).toMatch(
            /if\s*\(\s*allow(?:ed)?\b[\s\S]{0,160}\.repos\.some/
        );
    });
});

describe('inject targets — destructive delete confirmation', () => {

    const inject = read('inject.js');

    it('trash icon routes through showConfirmModal with the nickname-mentioning copy', () => {
        expect(inject).toMatch(/showConfirmModal\s*\(\s*\{[\s\S]{0,400}Delete target[\s\S]{0,200}Projects routing to it will become unrouted/);
    });

    it('confirmed delete calls deleteInjectTarget on the target id', () => {
        expect(inject).toMatch(/deleteInjectTarget\s*\(\s*target\.id\s*\)/);
    });
});

describe('inject targets — sub-modal registered in global modal-open guard', () => {

    const modals = read('modals.js');

    it('isAnyModalOrPopoverOpen lists injectTargetSubBackdrop', () => {
        expect(modals).toMatch(
            /isAnyModalOrPopoverOpen[\s\S]*injectTargetSubBackdrop/
        );
    });
});

// The chat workspace menu projects its repo list from the inject-targets cache,
// so inject.js must expose that cache and announce mutations to it. These pin
// the accessor exports and the change-event wiring the menu depends on.
describe('inject targets — workspace-source exports and change event', () => {

    const inject = read('inject.js');

    it('exports getCachedTargets so the chat menu can read the targets cache', () => {
        expect(inject).toMatch(/export\s+function\s+getCachedTargets\s*\(/);
    });

    it('exports loadInjectTargets so the chat menu can refresh the cache', () => {
        expect(inject).toMatch(/export\s+async\s+function\s+loadInjectTargets\s*\(/);
    });

    it('defines a coalesced injectTargetsChanged dispatcher', () => {
        // A single in-flight flag coalesces a burst of mutations into one event,
        // dispatched on the document.
        expect(inject).toMatch(/function\s+notifyInjectTargetsChanged\s*\(/);
        expect(inject).toMatch(/injectTargetsChangedPending/);
        expect(inject).toMatch(/dispatchEvent\s*\(\s*new\s+CustomEvent\(\s*['"]injectTargetsChanged['"]/);
    });

    it('insert, update, and delete each notify on a successful write', () => {
        // Insert and update fire the notifier right before returning ok.
        expect(inject).toMatch(
            /\.insert\(\s*row\s*\)[\s\S]{0,200}notifyInjectTargetsChanged\s*\(\s*\)[\s\S]{0,40}return\s*\{\s*ok:\s*true/
        );
        expect(inject).toMatch(
            /\.update\([\s\S]{0,400}notifyInjectTargetsChanged\s*\(\s*\)[\s\S]{0,40}return\s*\{\s*ok:\s*true/
        );
        // Four call sites total: the three target mutations (insert, update,
        // delete) plus the per-project routing-assignment handler, which
        // notifies so the sidebar inject bolts re-evaluate live. All are
        // distinct from the single `function notifyInjectTargetsChanged()` def.
        const calls = inject.match(/notifyInjectTargetsChanged\(\);/g) || [];
        expect(calls.length).toBe(4);
    });
});
