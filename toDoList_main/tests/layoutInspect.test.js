import { describe, it, expect, beforeEach } from 'vitest';
import { serializeLayout } from '../src/layoutInspect.js';

// Override getBoundingClientRect for a node so we can assert rounding —
// jsdom otherwise reports an all-zero rect for every element.
function stubRect(el, rect) {
    el.getBoundingClientRect = () => ({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.y,
        left: rect.x,
        right: rect.x + rect.width,
        bottom: rect.y + rect.height,
    });
}

describe('serializeLayout', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('returns found:false with the selector when nothing matches', () => {
        const result = serializeLayout('#does-not-exist');
        expect(result).toEqual({ found: false, selector: '#does-not-exist' });
    });

    it('returns found:true and echoes the selector when matched', () => {
        document.body.innerHTML = '<div id="target"></div>';
        const result = serializeLayout('#target');
        expect(result.found).toBe(true);
        expect(result.selector).toBe('#target');
    });

    it('captures tag, id, and an abbreviated class list for the node', () => {
        document.body.innerHTML =
            '<section id="target" class="a b c"></section>';
        const { node } = serializeLayout('#target');
        expect(node.tag).toBe('section');
        expect(node.id).toBe('target');
        expect(node.classes).toEqual(['a', 'b', 'c']);
    });

    it('reports null id for an element without one', () => {
        document.body.innerHTML = '<div class="x"><span class="child"></span></div>';
        const { node } = serializeLayout('.x .child');
        expect(node.id).toBeNull();
    });

    it('caps the class list at 8 entries to keep the payload small', () => {
        document.body.innerHTML =
            '<div id="target" class="c1 c2 c3 c4 c5 c6 c7 c8 c9 c10"></div>';
        const { node } = serializeLayout('#target');
        expect(node.classes).toHaveLength(8);
        expect(node.classes[0]).toBe('c1');
        expect(node.classes[7]).toBe('c8');
    });

    it('rounds the bounding box coordinates', () => {
        document.body.innerHTML = '<div id="target"></div>';
        stubRect(document.getElementById('target'), {
            x: 10.6,
            y: 20.2,
            width: 100.4,
            height: 50.9,
        });
        const { node } = serializeLayout('#target');
        expect(node.box).toEqual({ x: 11, y: 20, width: 100, height: 51 });
    });

    it('emits only the whitelisted computed style properties', () => {
        document.body.innerHTML = '<div id="target"></div>';
        const { node } = serializeLayout('#target');
        const expectedKeys = [
            'display', 'position', 'top', 'left', 'right', 'bottom',
            'flex-direction', 'justify-content', 'align-items', 'gap',
            'padding', 'margin', 'width', 'height',
            'font-size', 'line-height', 'text-align', 'overflow',
        ].sort();
        expect(Object.keys(node.style).sort()).toEqual(expectedKeys);
    });

    it('reports computed values that reflect runtime inline styles', () => {
        document.body.innerHTML = '<div id="target"></div>';
        const el = document.getElementById('target');
        el.style.display = 'flex';
        el.style.justifyContent = 'space-between';
        const { node } = serializeLayout('#target');
        expect(node.style.display).toBe('flex');
        expect(node.style['justify-content']).toBe('space-between');
    });

    it('snapshots the parent (one level up)', () => {
        document.body.innerHTML =
            '<div id="wrap"><p id="target"></p></div>';
        const { parent } = serializeLayout('#target');
        expect(parent.tag).toBe('div');
        expect(parent.id).toBe('wrap');
    });

    it('only walks direct children, not grandchildren', () => {
        document.body.innerHTML =
            '<ul id="target">' +
            '<li id="a"><span id="deep"></span></li>' +
            '<li id="b"></li>' +
            '</ul>';
        const { children } = serializeLayout('#target');
        expect(children).toHaveLength(2);
        expect(children.map((c) => c.id)).toEqual(['a', 'b']);
    });

    it('returns an empty children array for a leaf element', () => {
        document.body.innerHTML = '<div id="target"></div>';
        const { children } = serializeLayout('#target');
        expect(children).toEqual([]);
    });

    it('does not mutate the DOM', () => {
        document.body.innerHTML =
            '<div id="target" class="x"><span></span></div>';
        const before = document.body.innerHTML;
        serializeLayout('#target');
        expect(document.body.innerHTML).toBe(before);
    });

    it('produces a JSON-serializable result', () => {
        document.body.innerHTML =
            '<div id="wrap"><div id="target" class="a"><span></span></div></div>';
        const result = serializeLayout('#target');
        expect(() => JSON.stringify(result)).not.toThrow();
    });
});
