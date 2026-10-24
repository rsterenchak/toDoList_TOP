import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/chatMarkdown.js';

// The chat's dependency-free markdown renderer: each construct the model emits
// becomes the right element, nesting holds, and the model's text can never
// inject markup.

function render(md) {
    const host = document.createElement('div');
    host.appendChild(renderMarkdown(md));
    return host;
}

describe('renderMarkdown', () => {
    it('renders paragraphs, keeping single newlines as line breaks', () => {
        const host = render('First line\nsecond line\n\nNext para');
        const ps = host.querySelectorAll(':scope > p');
        expect(ps).toHaveLength(2);
        expect(ps[0].querySelector('br')).toBeTruthy();
        expect(ps[0].textContent).toBe('First linesecond line');
        expect(ps[1].textContent).toBe('Next para');
    });

    it('maps # / ## / ### to h3 / h4 / h5', () => {
        const host = render('# One\n## Two\n### Three');
        expect(host.querySelector('h3').textContent).toBe('One');
        expect(host.querySelector('h4').textContent).toBe('Two');
        expect(host.querySelector('h5').textContent).toBe('Three');
        expect(host.querySelector('h1, h2')).toBe(null);
    });

    it('renders bold, italic and inline code', () => {
        const host = render('A **bold** and *italic* and _also_ and `code()` word');
        expect(host.querySelector('strong').textContent).toBe('bold');
        expect(Array.from(host.querySelectorAll('em')).map((e) => e.textContent)).toEqual(['italic', 'also']);
        expect(host.querySelector('code').textContent).toBe('code()');
        expect(host.textContent).not.toContain('**');
    });

    it('leaves intraword underscores alone', () => {
        const host = render('snake_case_name stays');
        expect(host.querySelector('em')).toBe(null);
        expect(host.textContent).toBe('snake_case_name stays');
    });

    it('renders unordered and ordered lists', () => {
        const host = render('- one\n- two\n\n3. three\n4. four');
        expect(host.querySelectorAll('ul > li')).toHaveLength(2);
        const ol = host.querySelector('ol');
        expect(ol.querySelectorAll('li')).toHaveLength(2);
        expect(ol.getAttribute('start')).toBe('3');
    });

    it('nests lists to three levels with an indent stack', () => {
        const host = render('- a\n  - b\n    - c\n      - d\n- e');
        const top = host.querySelector(':scope > ul');
        expect(top.children).toHaveLength(2);
        const level2 = top.children[0].querySelector(':scope > ul');
        expect(level2.children[0].firstChild.textContent).toBe('b');
        const level3 = level2.children[0].querySelector(':scope > ul');
        expect(Array.from(level3.children).map((li) => li.textContent)).toEqual(['c', 'd']);
        expect(top.children[1].textContent).toBe('e');
    });

    it('renders an ordered list with nested bullets', () => {
        const host = render('1. Step\n   - detail\n2. Next');
        const ol = host.querySelector(':scope > ol');
        expect(ol.children).toHaveLength(2);
        expect(ol.children[0].querySelector('ul > li').textContent).toBe('detail');
    });

    it('renders a fenced code block with a language label and Copy button', () => {
        const host = render('Before\n```js\nconst a = 1;\n  indented();\n```\nAfter');
        const code = host.querySelector('pre > code');
        expect(code.getAttribute('data-lang')).toBe('js');
        expect(code.textContent).toBe('const a = 1;\n  indented();');
        expect(host.querySelector('.claudeMdCodeLang').textContent).toBe('js');
        expect(host.querySelector('.claudeMdCodeCopy').textContent).toBe('Copy');
        expect(Array.from(host.querySelectorAll(':scope > p')).map((p) => p.textContent)).toEqual(['Before', 'After']);
    });

    it('does not parse markdown inside a fence', () => {
        const host = render('```\n- not a list\n**not bold**\n```');
        expect(host.querySelector('ul, strong')).toBe(null);
        expect(host.querySelector('pre code').textContent).toBe('- not a list\n**not bold**');
    });

    it('keeps a list whole around a fence indented inside an item', () => {
        const host = render('1. Run this:\n   ```sh\n   npm test\n   ```\n2. Then this');
        const ol = host.querySelector(':scope > ol');
        expect(host.querySelectorAll(':scope > ol')).toHaveLength(1);
        expect(ol.children).toHaveLength(2);
        expect(ol.children[0].querySelector('pre code').textContent).toBe('npm test');
        expect(ol.children[1].textContent).toBe('Then this');
    });

    it('renders blockquotes and horizontal rules', () => {
        const host = render('> quoted **text**\n> more\n\n---\n\nafter');
        const quote = host.querySelector('blockquote');
        expect(quote.querySelector('strong').textContent).toBe('text');
        expect(host.querySelector('hr')).toBeTruthy();
    });

    it('renders links with target=_blank and rel=noopener', () => {
        const host = render('See [the docs](https://example.com/a).');
        const a = host.querySelector('a');
        expect(a.getAttribute('href')).toBe('https://example.com/a');
        expect(a.getAttribute('target')).toBe('_blank');
        expect(a.getAttribute('rel')).toBe('noopener');
        expect(a.textContent).toBe('the docs');
    });

    it('refuses non-web link schemes', () => {
        const host = render('[click](javascript:alert(1))');
        expect(host.querySelector('a')).toBe(null);
    });

    it('escapes markup in prose — <script> renders as text', () => {
        const host = render('Hi <script>window.__pwned = 1</script> and <b>bold</b>');
        expect(host.querySelector('script, b')).toBe(null);
        expect(host.textContent).toContain('<script>window.__pwned = 1</script>');
        expect(window.__pwned).toBeUndefined();
    });

    it('escapes markup inside list items, headings and code', () => {
        const host = render('# <img src=x onerror=alert(1)>\n- <i>x</i>\n\n`<b>`');
        expect(host.querySelector('img, i, b')).toBe(null);
        expect(host.querySelector('h3').textContent).toBe('<img src=x onerror=alert(1)>');
    });

    it('falls unknown constructs through as paragraphs', () => {
        const host = render('| a | b |\n|---|---|');
        expect(host.querySelector('table')).toBe(null);
        expect(host.querySelector('p').textContent).toContain('| a | b |');
    });
});
