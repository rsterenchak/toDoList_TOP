// Mobile Settings modal extracted from main.js (a behaviour-preserving move).
// showSettingsModal builds the mobile Settings dialog (View / Appearance /
// About / Help / Data / Account sections) with the three-way close required by
// CLAUDE.md. Module singletons it uses (drawer-row factories, listLogic, the
// changelog/tour/export/import helpers, supabase, etc.) are imported directly
// the same way main.js imports them; the pieces defined inside main.js — the
// two main-local toggle builders, wireDismissable, the #drawerSettingsBtn node,
// and the top-level view/import/seed helpers — arrive as factory deps so the
// returned showSettingsModal body is identical to the inline original.
import { listLogic } from './listLogic.js';
import {
    createDrawerInfoRow,
    createDrawerActionRow,
    buildShowCompletedToggle,
    buildDarkThemeToggle,
} from './drawerRows.js';
import { paintAboutVersionUpdateCue } from './aboutVersionCue.js';
import { openChangelogMobileSheet } from './mobileSheets.js';
import { startWelcomeCarousel, isMobileCarouselViewport } from './welcomeCarousel.js';
import { startCoachmarkTour } from './coachmark.js';
import { exportToJson, openImportPicker } from './jsonImportExport.js';
import { showInjectSettingsModal } from './inject.js';
import { wipeLocalUserDataOnSignOut } from './migration.js';
import { supabase } from './supabaseClient.js';

export function createSettingsModal({
    buildExpandAllToggle,
    buildCompanionToggle,
    wireDismissable,
    drawerSettingsBtn,
    applyActiveView,
    rebuildAfterImport,
    seedSampleTodosIntoActiveProjectIfEmpty,
}) {
    // Settings modal — three-way close (X button, backdrop, Escape) per
    // CLAUDE.md. Lives in the same DOM at all viewports but only reachable
    // via #drawerSettingsBtn, which is itself drawer-bound and therefore
    // mobile-only via CSS.
    function showSettingsModal() {
        const prior = document.getElementById('settingsModalBackdrop');
        if (prior && prior.parentNode) prior.parentNode.removeChild(prior);
        let close; // assigned below via wireDismissable; action rows close over it

        const backdrop = document.createElement('div');
        backdrop.id = 'settingsModalBackdrop';

        const dialog = document.createElement('div');
        dialog.id = 'settingsModal';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'settingsModalTitle');

        const header = document.createElement('div');
        header.id = 'settingsModalHeader';

        const title = document.createElement('div');
        title.id = 'settingsModalTitle';
        title.textContent = 'Settings';

        const closeX = document.createElement('button');
        closeX.id = 'settingsModalClose';
        closeX.type = 'button';
        closeX.setAttribute('aria-label', 'Close settings');
        closeX.textContent = '×';

        header.appendChild(title);
        header.appendChild(closeX);

        const body = document.createElement('div');
        body.id = 'settingsModalBody';

        const viewSection = document.createElement('section');
        viewSection.id = 'settingsViewSection';
        viewSection.className = 'settingsSection';
        const viewHeading = document.createElement('div');
        viewHeading.className = 'settingsSectionHeading';
        viewHeading.textContent = 'View';
        viewSection.appendChild(viewHeading);
        viewSection.appendChild(buildShowCompletedToggle().row);
        viewSection.appendChild(buildExpandAllToggle().row);

        const appearanceSection = document.createElement('section');
        appearanceSection.id = 'settingsAppearanceSection';
        appearanceSection.className = 'settingsSection';
        const appearanceHeading = document.createElement('div');
        appearanceHeading.className = 'settingsSectionHeading';
        appearanceHeading.textContent = 'Appearance';
        appearanceSection.appendChild(appearanceHeading);
        appearanceSection.appendChild(buildDarkThemeToggle().row);
        appearanceSection.appendChild(buildCompanionToggle().row);

        // About section — surfaces the version label + live project count
        // that used to live in #footBar / #drawerFooter on mobile. Two
        // info rows, both built from createDrawerInfoRow so the muted-pill
        // value chrome matches the OFF state of the toggle pills above.
        // The project-count valueGetter reads listLogic.listProjectsArray()
        // on every modal open, so the count stays live without an explicit
        // refresh wire.
        const aboutSection = document.createElement('section');
        aboutSection.id = 'settingsAboutSection';
        aboutSection.className = 'settingsSection';
        const aboutHeading = document.createElement('div');
        aboutHeading.className = 'settingsSectionHeading';
        aboutHeading.textContent = 'About';
        aboutSection.appendChild(aboutHeading);
        aboutSection.appendChild(createDrawerInfoRow('Version', function() {
            return 'v1.1';
        }).row);
        aboutSection.appendChild(createDrawerInfoRow('Projects', function() {
            const count = listLogic.listProjectsArray().length;
            return count + (count === 1 ? ' Project' : ' Projects');
        }).row);
        // Service-worker update cue. When a new worker is waiting, the
        // Version row gains a tappable "Update available" pill that
        // routes to applyPendingUpdate (the same skipWaiting + reload
        // path the desktop footer uses). The row is the first
        // .drawerInfoRow child of the About section; paintAboutVersionUpdateCue
        // toggles the pill in lockstep with the appUpdateAvailable event.
        const versionRow = aboutSection.querySelector('.drawerInfoRow');
        // Hovering the Version row surfaces the full build string the
        // abbreviated "v1.1" pill stands in for (matches the desktop
        // footer's "task management v1.1" label).
        if (versionRow) versionRow.setAttribute('title', 'task management v1.1');
        paintAboutVersionUpdateCue(versionRow);

        // Tap the Version row to open the changelog (mobile parity for the
        // desktop footer's #footVersion).
        if (versionRow) {
            versionRow.classList.add('drawerInfoRow--tappable');
            versionRow.setAttribute('role', 'button');
            versionRow.setAttribute('tabindex', '0');
            versionRow.setAttribute('aria-haspopup', 'dialog');
            versionRow.setAttribute('aria-label', 'Open changelog');
            const versionChevron = document.createElement('span');
            versionChevron.className = 'drawerActionChevron';
            versionChevron.setAttribute('aria-hidden', 'true');
            versionChevron.textContent = '›';
            versionRow.appendChild(versionChevron);
            function openChangelogFromVersionRow() {
                close();
                openChangelogMobileSheet();
            }
            versionRow.addEventListener('click', openChangelogFromVersionRow);
            versionRow.addEventListener('keydown', function(event) {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openChangelogFromVersionRow();
                }
            });
        }

        // HELP section — single Replay welcome tour entry that dispatches
        // by viewport. On touch / narrow viewports the carousel runs; on
        // mouse / wide viewports the desktop spotlight tour runs. Tapping
        // closes the settings modal first so the flow lands on a clean
        // surface. Replay never re-seeds the sample project.
        const helpSection = document.createElement('section');
        helpSection.id = 'settingsHelpSection';
        helpSection.className = 'settingsSection';
        const helpHeading = document.createElement('div');
        helpHeading.className = 'settingsSectionHeading';
        helpHeading.textContent = 'Help';
        helpSection.appendChild(helpHeading);
        const replayRow = createDrawerActionRow('Replay welcome tour', function() {
            close();
            applyActiveView('projects');
            if (listLogic.listProjectsArray().length === 0) {
                listLogic.seedSampleProject({ force: true });
                rebuildAfterImport();
            } else {
                // Active project may hold only the blank placeholder.
                // The desktop coachmark steps for #duePill and
                // #descToggle need a real titled row to anchor against,
                // so seed starter todos into it.
                seedSampleTodosIntoActiveProjectIfEmpty();
            }
            // rAF defer so the data-view flip and any re-render have a
            // layout pass before the tour reads bounding rects for the
            // spotlight cut-out.
            requestAnimationFrame(function() {
                if (isMobileCarouselViewport()) startWelcomeCarousel();
                else startCoachmarkTour();
            });
        });
        helpSection.appendChild(replayRow);

        // Data section — manual JSON export / import. Export downloads
        // the user's Supabase dataset; Import reads such a file back,
        // shows a destructive confirmation, and replaces the user's data
        // on confirm. Mirrors the desktop settings menu's Data section.
        const dataSection = document.createElement('section');
        dataSection.id = 'settingsDataSection';
        dataSection.className = 'settingsSection';
        const dataHeading = document.createElement('div');
        dataHeading.className = 'settingsSectionHeading';
        dataHeading.textContent = 'Data';
        dataSection.appendChild(dataHeading);
        const exportRow = createDrawerActionRow('Export to JSON', function() {
            close();
            exportToJson();
        });
        dataSection.appendChild(exportRow);
        const importRow = createDrawerActionRow('Import from JSON', function() {
            close();
            openImportPicker(rebuildAfterImport);
        });
        dataSection.appendChild(importRow);
        // Configure inject — mirrors the desktop ghost menu row. Lives in
        // the Data section alongside Export/Import so the per-device
        // Worker URL + shared secret are reachable from a phone too.
        const injectRow = createDrawerActionRow('Configure inject', function() {
            close();
            showInjectSettingsModal();
        });
        dataSection.appendChild(injectRow);

        // Account section — Phase 4 auth gate's sign-out exit. Mirrors
        // the HELP / About section pattern at the same heading typography
        // so the row chrome reads consistently. Tap closes the modal first
        // so the auth modal lands on a clean surface when the app-level
        // onAuthStateChange listener re-renders it.
        const accountSection = document.createElement('section');
        accountSection.id = 'settingsAccountSection';
        accountSection.className = 'settingsSection';
        const accountHeading = document.createElement('div');
        accountHeading.className = 'settingsSectionHeading';
        accountHeading.textContent = 'Account';
        accountSection.appendChild(accountHeading);
        const signOutRow = createDrawerActionRow('Sign out', function() {
            close();
            wipeLocalUserDataOnSignOut().then(function() { supabase.auth.signOut(); });
        });
        accountSection.appendChild(signOutRow);

        body.appendChild(viewSection);
        body.appendChild(appearanceSection);
        body.appendChild(aboutSection);
        body.appendChild(helpSection);
        body.appendChild(dataSection);
        body.appendChild(accountSection);

        dialog.appendChild(header);
        dialog.appendChild(body);
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);

        const previouslyFocused = document.activeElement;
        closeX.focus();
        drawerSettingsBtn.setAttribute('aria-expanded', 'true');

        // Keep the About-section version row's update cue in sync while
        // the modal is open. The handler reference is held so close() can
        // remove it without leaking across reopen cycles.
        function onAppUpdateAvailableForModal() {
            paintAboutVersionUpdateCue(versionRow);
        }
        document.addEventListener('appUpdateAvailable', onAppUpdateAvailableForModal);

        // Three-way close (× / backdrop / Escape) plus focus restore to the
        // element that was focused before the modal opened, wired through the
        // shared helper. The helper's guarded close() is also invoked directly
        // by the action rows above (Export, Import, Sign out, …) so they dismiss
        // the modal before running.
        const settingsDismiss = wireDismissable({
            onClose: function() {
                document.removeEventListener('appUpdateAvailable', onAppUpdateAvailableForModal);
                if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
                drawerSettingsBtn.setAttribute('aria-expanded', 'false');
            },
            closeBtn: closeX,
            backdrop: backdrop,
            restoreFocusTo: previouslyFocused,
        });
        close = settingsDismiss.close;
    }

    return { showSettingsModal };
}
