// On app launch restoreFromStorage auto-selects a project to render. The
// default must be the FIRST project in the sidebar's display order (the top
// of the reorderable list, which listProjectsArray returns), NOT the last.
// The in-session re-render path (opts.selectProject, used by the Supabase
// re-hydrate) must still preserve whichever project was active.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(resolve(here, '../src/main.js'), 'utf8');

describe('launch selects the first project, not the last', () => {
    const fnIdx = main.indexOf('function restoreFromStorage');
    // The auto-select block lives near the tail of restoreFromStorage, well
    // past the long per-project render loop, so anchor on its comment rather
    // than a fixed-size slice from the function head.
    const selIdx = main.indexOf('auto-select the FIRST project', fnIdx);
    const slice = main.slice(selIdx, selIdx + 1500);

    it('restoreFromStorage exists', () => {
        expect(fnIdx).toBeGreaterThan(-1);
        expect(selIdx).toBeGreaterThan(fnIdx);
    });

    it('the cold-boot default target is the first project (savedProjects[0])', () => {
        // The default branch of the targetProject ternary must point at index
        // 0 of the ordered projects array.
        expect(slice).toMatch(/:\s*savedProjects\[0\]/);
    });

    it('does NOT default to the last project (savedProjects.length - 1)', () => {
        const targetIdx = slice.indexOf('const targetProject');
        const targetSlice = slice.slice(targetIdx, targetIdx + 200);
        expect(targetSlice).not.toMatch(/savedProjects\[savedProjects\.length\s*-\s*1\]/);
    });

    it('the fallback project row is the first child, not the last', () => {
        // When honorSelect did not resolve a row, the fallback child must be
        // the first projChild so it matches the first-project default.
        expect(slice).toMatch(/targetChild\s*=\s*allProjChildren\[0\]/);
        expect(slice).not.toMatch(/targetChild\s*=\s*allProjChildren\[allProjChildren\.length\s*-\s*1\]/);
    });

    it('still honours opts.selectProject for in-session re-renders', () => {
        // The preserve-active-project path must remain intact so a Supabase
        // re-hydrate does not snap the user back to the first project.
        expect(slice).toMatch(/honorSelect\s*\n?\s*\?\s*opts\.selectProject/);
    });

    it('falls back to the empty state when no saved projects exist', () => {
        // With zero projects the function must take the early-return branch
        // — render the empty state and skip the auto-select block — so a
        // fresh install does not throw on savedProjects[0] of an empty array.
        const earlyIdx = main.indexOf('if (savedProjects.length === 0)', fnIdx);
        expect(earlyIdx).toBeGreaterThan(fnIdx);
        expect(earlyIdx).toBeLessThan(selIdx);
        const earlySlice = main.slice(earlyIdx, earlyIdx + 400);
        expect(earlySlice).toMatch(/updateEmptyState/);
        expect(earlySlice).toMatch(/\breturn\b/);
    });
});
