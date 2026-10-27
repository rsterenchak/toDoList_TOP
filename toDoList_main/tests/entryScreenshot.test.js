import { vi } from 'vitest';

// jsdom decodes no images and has no canvas, so the prep step is stubbed: every
// picked file preps to a tiny PNG of known size. base64ByteLength stays real.
vi.mock('../src/imagePrep.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        prepareImage: vi.fn(async () => ({ media_type: 'image/png', data: 'iVBORw0KGgo=' })),
        downscaleImage: vi.fn(async () => ({ media_type: 'image/jpeg', data: '/9j/4AAQ' })),
        readImageSize: vi.fn(async () => ({ width: 640, height: 480 })),
    };
});

import { toDo } from '../src/toDo.js';
import { initInjectConfig, makeInjectButton } from '../src/inject.js';
import { listLogic } from '../src/listLogic.js';
import { prepareImage, downscaleImage } from '../src/imagePrep.js';
import {
    setScreenshotLine,
    stripScreenshotLine,
    hasScreenshotLine,
    screenshotPath,
    stageEntryScreenshot,
    removeEntryScreenshot,
    getEntryScreenshot,
    buildScreenshotRow,
    refreshScreenshotRow,
    wireScreenshotRow,
    isScreenshotPickInFlight,
    SCREENSHOT_PICK_RETURN_MS,
} from '../src/entryScreenshot.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// A todo's entry carries ONE screenshot that Inject commits beside it. The
// `- Screenshot: docs/context/<entryId>.<ext>` line is the Worker's contract, so
// these pin the line edits, the in-memory stage, and the inject POST body.

function file() {
    return new File(['x'], 'shot.png', { type: 'image/png' });
}

describe('entry screenshot — the `- Screenshot:` line', () => {
    it('appends the line inside the block, matching the sub-bullet indent', () => {
        const text = '  - Type: feature\n  - Description: thing\n';
        expect(setScreenshotLine(text, 'docs/context/a.png'))
            .toBe('  - Type: feature\n  - Description: thing\n  - Screenshot: docs/context/a.png\n');
    });

    it('lands before a `- Completed:` line when there is one', () => {
        const text = '  - Type: bug\n  - Completed: 2026-10-01';
        expect(setScreenshotLine(text, 'docs/context/a.jpg'))
            .toBe('  - Type: bug\n  - Screenshot: docs/context/a.jpg\n  - Completed: 2026-10-01');
    });

    it('replaces an existing line in place rather than adding a second', () => {
        const text = '  - Type: bug\n  - Screenshot: docs/context/old.png\n  - File: `a.js`';
        const out = setScreenshotLine(text, 'docs/context/new.webp');
        expect(out).toBe('  - Type: bug\n  - Screenshot: docs/context/new.webp\n  - File: `a.js`');
        expect(out.match(/Screenshot:/g)).toHaveLength(1);
    });

    it('writes just the line into an empty description', () => {
        expect(setScreenshotLine('', 'docs/context/a.png')).toBe('  - Screenshot: docs/context/a.png');
    });

    it('strips the line and leaves the rest of the entry untouched', () => {
        const text = '  - Type: bug\n  - Screenshot: docs/context/a.png\n  - File: `a.js`';
        expect(stripScreenshotLine(text)).toBe('  - Type: bug\n  - File: `a.js`');
        expect(hasScreenshotLine(text)).toBe(true);
        expect(hasScreenshotLine(stripScreenshotLine(text))).toBe(false);
    });

    it('keys the committed path by entry id and media type', () => {
        expect(screenshotPath('abc', 'image/jpeg')).toBe('docs/context/abc.jpg');
        expect(screenshotPath('abc', 'image/png')).toBe('docs/context/abc.png');
        expect(screenshotPath('abc', 'image/webp')).toBe('docs/context/abc.webp');
    });
});

describe('entry screenshot — stage and remove', () => {
    let editSpy;
    beforeEach(() => {
        editSpy = vi.spyOn(listLogic, 'editToDoItem').mockImplementation(() => {});
    });
    afterEach(() => { editSpy.mockRestore(); });

    it('mints an entry id, stages the image and writes the line through listLogic', async () => {
        const item = toDo('Shot', '  - Type: bug', '', null, 0);
        item.id = 'todo-shot-1';
        const record = await stageEntryScreenshot(item, file(), { projectName: 'P' });

        expect(item.entryId).toBeTruthy();
        expect(record).toMatchObject({ media_type: 'image/png', width: 640, height: 480 });
        expect(getEntryScreenshot(item)).toBe(record);
        expect(item.desc).toContain('- Screenshot: docs/context/' + item.entryId + '.png');
        expect(editSpy).toHaveBeenCalledWith('P', item);
        removeEntryScreenshot(item, { projectName: 'P' });
    });

    it('keeps an existing entry id so the path matches the injected marker', async () => {
        const item = toDo('Shot', '', '', null, 0);
        item.id = 'todo-shot-2';
        item.entryId = 'fixed-id';
        await stageEntryScreenshot(item, file());
        expect(item.desc).toContain('docs/context/fixed-id.png');
        removeEntryScreenshot(item);
    });

    it('re-encodes a format the Worker rejects (gif) to JPEG', async () => {
        prepareImage.mockResolvedValueOnce({ media_type: 'image/gif', data: 'R0lGOD' });
        const item = toDo('Gif', '', '', null, 0);
        item.id = 'todo-shot-3';
        item.entryId = 'gif-id';
        const record = await stageEntryScreenshot(item, file());
        expect(downscaleImage).toHaveBeenCalled();
        expect(record.media_type).toBe('image/jpeg');
        expect(item.desc).toContain('docs/context/gif-id.jpg');
        removeEntryScreenshot(item);
    });

    it('remove drops the stage and the line', async () => {
        const item = toDo('Shot', '  - Type: bug', '', null, 0);
        item.id = 'todo-shot-4';
        await stageEntryScreenshot(item, file());
        removeEntryScreenshot(item);
        expect(getEntryScreenshot(item)).toBeNull();
        expect(hasScreenshotLine(item.desc)).toBe(false);
        expect(item.desc).toBe('  - Type: bug');
    });

    it('deleting the line from the live text clears the staged image', async () => {
        const item = toDo('Shot', '  - Type: bug', '', null, 0);
        item.id = 'todo-shot-5';
        await stageEntryScreenshot(item, file());
        const host = document.createElement('div');
        host.appendChild(buildScreenshotRow());

        refreshScreenshotRow(host, item, item.desc);
        expect(host.querySelector('.descScreenshotRow--staged')).toBeTruthy();
        expect(host.querySelector('.descScreenshotPath').textContent)
            .toBe('docs/context/' + item.entryId + '.png');
        expect(host.querySelector('.descScreenshotSize').textContent).toMatch(/^640×480 · \d+ KB$/);
        expect(host.querySelector('img')).toBeNull();

        refreshScreenshotRow(host, item, stripScreenshotLine(item.desc));
        expect(getEntryScreenshot(item)).toBeNull();
        expect(host.querySelector('.descScreenshotIdle').hidden).toBe(false);
        expect(host.querySelector('.descScreenshotStaged').hidden).toBe(true);
    });
});

describe('entry screenshot — Inject', () => {
    let fetchSpy;
    let realFetch;
    let stampSpy;
    let editSpy;

    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        realFetch = globalThis.fetch;
        fetchSpy = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
        globalThis.fetch = fetchSpy;
        stampSpy = vi.spyOn(listLogic, 'stampTodoEntryId').mockReturnValue({ ok: true });
        editSpy = vi.spyOn(listLogic, 'editToDoItem').mockImplementation(() => {});
    });

    afterEach(() => {
        globalThis.fetch = realFetch;
        stampSpy.mockRestore();
        editSpy.mockRestore();
        const toast = document.getElementById('injectToast');
        if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
        localStorage.clear();
    });

    function clickReady(btn) {
        btn.dataset.state = 'ready';
        btn.disabled = false;
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    function postedBody() {
        return JSON.parse(fetchSpy.mock.calls[0][1].body);
    }

    it('carries the staged screenshot on the POST, then clears the stage but keeps the line', async () => {
        const item = toDo('With shot', '  - Type: bug', '', null, 0);
        item.id = 'todo-inject-1';
        await stageEntryScreenshot(item, file());

        await clickReady(makeInjectButton(item, {}));

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const body = postedBody();
        expect(body.screenshot).toEqual({ media_type: 'image/png', data: 'iVBORw0KGgo=' });
        expect(body.entry).toContain('docs/context/' + item.entryId + '.png');
        expect(getEntryScreenshot(item)).toBeNull();
        expect(hasScreenshotLine(item.desc)).toBe(true);
    });

    it('sends no screenshot field when nothing is staged', async () => {
        const item = toDo('No shot', '  - Type: bug', '', null, 0);
        item.id = 'todo-inject-2';

        await clickReady(makeInjectButton(item, {}));

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect('screenshot' in postedBody()).toBe(false);
    });

    it('refuses to post a `- Screenshot:` line with nothing staged (a reload lost it)', async () => {
        const item = toDo('Lost shot', '  - Type: bug\n  - Screenshot: docs/context/x.png', '', null, 0);
        item.id = 'todo-inject-3';

        await clickReady(makeInjectButton(item, {}));

        expect(fetchSpy).not.toHaveBeenCalled();
        const toast = document.getElementById('injectToast');
        expect(toast.textContent).toContain('Reattach the screenshot or remove its line');
    });
});

describe('entry screenshot — surviving the pick and a reopen', () => {
    let editSpy;
    beforeEach(() => {
        editSpy = vi.spyOn(listLogic, 'editToDoItem').mockImplementation(() => {});
    });
    afterEach(() => { editSpy.mockRestore(); vi.useRealTimers(); });

    function mountRow(item, textareaValue) {
        const row = buildScreenshotRow();
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.click = vi.fn();
        const textarea = document.createElement('textarea');
        textarea.value = textareaValue;
        row.appendChild(fileInput);
        wireScreenshotRow(row, { item, fileInput, textarea, projectName: 'P' });
        return { row, fileInput, textarea };
    }

    it('wiring against a not-yet-filled textarea keeps the staged record item.desc names', async () => {
        const item = toDo('Shot', '  - Type: bug', '', null, 0);
        item.id = 'todo-reopen-1';
        await stageEntryScreenshot(item, file());
        const { row } = mountRow(item, '');
        expect(getEntryScreenshot(item)).toBeTruthy();
        expect(row.classList.contains('descScreenshotRow--staged')).toBe(true);
        expect(row.querySelector('.descScreenshotPath').textContent)
            .toBe('docs/context/' + item.entryId + '.png');
        removeEntryScreenshot(item);
    });

    it('a later textarea input that drops the line still clears the stage', async () => {
        const item = toDo('Shot', '  - Type: bug', '', null, 0);
        item.id = 'todo-reopen-2';
        await stageEntryScreenshot(item, file());
        const { row } = mountRow(item, item.desc);
        refreshScreenshotRow(row, item, stripScreenshotLine(item.desc));
        expect(getEntryScreenshot(item)).toBeNull();
    });

    it('flags a pick in flight from the idle click until change or cancel', () => {
        const item = toDo('Shot', '', '', null, 0);
        item.id = 'todo-pick-1';
        const { row, fileInput } = mountRow(item, '');
        expect(isScreenshotPickInFlight()).toBe(false);

        row.querySelector('.descScreenshotIdle').click();
        expect(fileInput.click).toHaveBeenCalled();
        expect(isScreenshotPickInFlight()).toBe(true);
        fileInput.dispatchEvent(new Event('change'));
        expect(isScreenshotPickInFlight()).toBe(false);

        row.querySelector('.descScreenshotIdle').click();
        expect(isScreenshotPickInFlight()).toBe(true);
        fileInput.dispatchEvent(new Event('cancel'));
        expect(isScreenshotPickInFlight()).toBe(false);
    });

    it('a dismissed pick with no cancel clears itself shortly after the page returns', () => {
        vi.useFakeTimers();
        const item = toDo('Shot', '', '', null, 0);
        item.id = 'todo-pick-2';
        const { row } = mountRow(item, '');
        row.querySelector('.descScreenshotIdle').click();
        expect(isScreenshotPickInFlight()).toBe(true);

        document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(SCREENSHOT_PICK_RETURN_MS - 1);
        expect(isScreenshotPickInFlight()).toBe(true);
        vi.advanceTimersByTime(1);
        expect(isScreenshotPickInFlight()).toBe(false);
    });

    it('a rehydrateUnlessEditing-style guard skips while a pick is in flight', () => {
        const hydrate = vi.fn();
        const rehydrate = () => { if (isScreenshotPickInFlight()) return; hydrate(); };
        const item = toDo('Shot', '', '', null, 0);
        item.id = 'todo-pick-3';
        const { row, fileInput } = mountRow(item, '');

        row.querySelector('.descScreenshotIdle').click();
        rehydrate();
        expect(hydrate).not.toHaveBeenCalled();
        fileInput.dispatchEvent(new Event('change'));
        rehydrate();
        expect(hydrate).toHaveBeenCalledTimes(1);
    });

    it('index.js rehydrateUnlessEditing returns early on a pick in flight', () => {
        const here = dirname(fileURLToPath(import.meta.url));
        const src = readFileSync(resolve(here, '../src/index.js'), 'utf8');
        expect(src).toMatch(/import \{ isScreenshotPickInFlight \} from '\.\/entryScreenshot\.js';/);
        const body = src.slice(src.indexOf('function rehydrateUnlessEditing()'));
        const fn = body.slice(0, body.indexOf('\n}\n'));
        expect(fn).toMatch(/if \(isScreenshotPickInFlight\(\)\) return;/);
        expect(fn.indexOf('isScreenshotPickInFlight')).toBeLessThan(fn.indexOf('hydrateFromSupabase'));
    });

    it('toDoRow.js fills the textarea before mounting the screenshot row', () => {
        const here = dirname(fileURLToPath(import.meta.url));
        const src = readFileSync(resolve(here, '../src/toDoRow.js'), 'utf8');
        const fill = src.indexOf('descInput.value = item["desc"] || "";');
        const mount = src.indexOf('mountDescScreenshotRow(descSibling, footer, descInput, item, projectName, injectBtn);');
        expect(fill).toBeGreaterThan(-1);
        expect(mount).toBeGreaterThan(fill);
    });
});

describe('entry screenshot — pasting an image into the description', () => {
    let editSpy;
    beforeEach(() => {
        editSpy = vi.spyOn(listLogic, 'editToDoItem').mockImplementation(() => {});
    });
    afterEach(() => { editSpy.mockRestore(); });

    function mountRow(item, textarea) {
        const row = buildScreenshotRow();
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        row.appendChild(fileInput);
        wireScreenshotRow(row, { item, fileInput, textarea, projectName: 'P' });
        return row;
    }

    function paste(target, clipboardData) {
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: clipboardData });
        target.dispatchEvent(event);
        return event;
    }

    it('stages a pasted image file and keeps any filename out of the text', async () => {
        const item = toDo('Paste', '  - Type: bug', '', null, 0);
        item.id = 'todo-paste-1';
        const textarea = document.createElement('textarea');
        textarea.value = item.desc;
        const row = mountRow(item, textarea);

        const event = paste(textarea, { files: [file()], items: [] });
        expect(event.defaultPrevented).toBe(true);
        await row.screenshotStagePromise;

        expect(getEntryScreenshot(item)).toBeTruthy();
        expect(row.classList.contains('descScreenshotRow--staged')).toBe(true);
        expect(textarea.value).toContain('- Screenshot: docs/context/' + item.entryId + '.png');
        expect(textarea.value).not.toContain('shot.png');
        expect(textarea.value).not.toContain('data:');
        removeEntryScreenshot(item);
    });

    it('falls back to clipboard items when files is empty', async () => {
        const item = toDo('Paste', '', '', null, 0);
        item.id = 'todo-paste-2';
        const textarea = document.createElement('textarea');
        const row = mountRow(item, textarea);
        const f = file();
        const event = paste(textarea, {
            files: [],
            items: [{ kind: 'string', type: 'text/plain' }, { kind: 'file', type: 'image/png', getAsFile: () => f }],
        });
        expect(event.defaultPrevented).toBe(true);
        await row.screenshotStagePromise;
        expect(getEntryScreenshot(item)).toBeTruthy();
        removeEntryScreenshot(item);
    });

    it('does not intercept a text-only paste', () => {
        const item = toDo('Paste', '', '', null, 0);
        item.id = 'todo-paste-3';
        const textarea = document.createElement('textarea');
        const row = mountRow(item, textarea);
        const event = paste(textarea, {
            files: [],
            items: [{ kind: 'string', type: 'text/plain' }],
            getData: () => 'hello',
        });
        expect(event.defaultPrevented).toBe(false);
        expect(row.screenshotStagePromise).toBeUndefined();
        expect(getEntryScreenshot(item)).toBeNull();
    });

    it('re-wiring on every open attaches one paste listener and replaces the staged image', async () => {
        const item = toDo('Paste', '', '', null, 0);
        item.id = 'todo-paste-4';
        const textarea = document.createElement('textarea');
        const first = mountRow(item, textarea);
        const second = mountRow(item, textarea);
        const spy = vi.spyOn(listLogic, 'editToDoItem');
        spy.mockClear();

        paste(textarea, { files: [file()], items: [] });
        expect(first.screenshotStagePromise).toBeUndefined();
        await second.screenshotStagePromise;
        const firstRecord = getEntryScreenshot(item);
        expect(firstRecord).toBeTruthy();
        const stagesAfterOne = spy.mock.calls.length;

        prepareImage.mockResolvedValueOnce({ media_type: 'image/webp', data: 'UklGRg==' });
        paste(textarea, { files: [file()], items: [] });
        await second.screenshotStagePromise;
        expect(spy.mock.calls.length).toBe(stagesAfterOne * 2);
        expect(getEntryScreenshot(item)).not.toBe(firstRecord);
        expect(textarea.value.match(/Screenshot:/g)).toHaveLength(1);
        expect(textarea.value).toContain('docs/context/' + item.entryId + '.webp');
        removeEntryScreenshot(item);
    });
});
