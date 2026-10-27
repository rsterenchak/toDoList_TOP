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
} from '../src/entryScreenshot.js';

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
