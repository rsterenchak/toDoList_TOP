import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Collapsing the tab bar to STREAM + STRUCTURE removed the AGENT desktop pill and
// mobile AGENT tab — the only two surfaces that painted the "agent is working"
// dot. The persistent working watch (startAgentWorkingWatch) still toggles the
// `body.agentWorking` class, so rather than retire it the dot was RELOCATED onto
// the surviving STREAM surfaces: the desktop STREAM pill and the mobile STREAM
// tab. These guards assert the marker is wired into both surfaces and that its
// CSS is keyed off `body.agentWorking`, reusing the shared agentDotBreathe
// keyframes. jsdom does not compute layout from stylesheets, so this is a
// source/structure guard, not a computed-visibility one.
const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');

describe('agent-working dot relocated onto the STREAM surfaces', () => {
    it('main.js appends an agentWorkingMarker to the desktop STREAM pill', () => {
        const main = read('main.js');
        // The marker span is built and appended to viewPillProjects (the STREAM
        // pill), carrying aria-hidden like the sibling no-repo marker.
        expect(main).toMatch(/viewPillProjectsWorkingDot[\s\S]{0,160}agentWorkingMarker/);
        expect(main).toMatch(/viewPillProjectsWorkingDot\.setAttribute\(\s*['"]aria-hidden['"]/);
        expect(main).toMatch(/viewPillProjects\.appendChild\(\s*viewPillProjectsWorkingDot\s*\)/);
    });

    it('mobileUtilitySheet.js appends an agentWorkingMarker to the mobile STREAM tab', () => {
        const mobile = read('mobileUtilitySheet.js');
        expect(mobile).toMatch(/mobileTabProjectsWorkingDot[\s\S]{0,160}agentWorkingMarker/);
        expect(mobile).toMatch(/mobileTabProjectsWorkingDot\.setAttribute\(\s*['"]aria-hidden['"]/);
        expect(mobile).toMatch(/mobileTabProjects\.appendChild\(\s*mobileTabProjectsWorkingDot\s*\)/);
    });

    it('style.css hides the marker by default and reveals it on both STREAM surfaces under body.agentWorking', () => {
        const css = read('style.css');
        // Hidden by default.
        expect(css).toMatch(/\.agentWorkingMarker\s*\{\s*display:\s*none;\s*\}/);
        // Revealed only while the working watch has set body.agentWorking — on the
        // desktop STREAM pill and the mobile STREAM tab.
        expect(css).toMatch(/body\.agentWorking\s+#viewPillProjects\s+\.agentWorkingMarker\s*\{/);
        expect(css).toMatch(/body\.agentWorking\s+#mobileTabProjects\s+\.agentWorkingMarker\s*\{/);
    });

    it('style.css reuses the shared agentDotBreathe keyframes, gated behind prefers-reduced-motion', () => {
        const css = read('style.css');
        // The breathing pulse is added only under prefers-reduced-motion:
        // no-preference, matching the header status pill's dot — and it reuses the
        // shared keyframes rather than defining a second set.
        const gateIdx = css.indexOf('@media (prefers-reduced-motion: no-preference)');
        expect(gateIdx).toBeGreaterThan(-1);
        expect(css).toMatch(/body\.agentWorking\s+#viewPillProjects\s+\.agentWorkingMarker[\s\S]{0,220}animation:\s*agentDotBreathe/);
        // The keyframes themselves are still defined once (shared with the Agent
        // board header status pill's dot — must NOT be removed).
        expect(css).toMatch(/@keyframes\s+agentDotBreathe/);
    });
});
