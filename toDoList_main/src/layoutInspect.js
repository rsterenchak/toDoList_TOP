// Serialize a live element's computed layout for the Claude sheet's iterate
// flow. The point is to capture what the browser is *actually* rendering —
// computed values reflect the runtime inline styles main.js sets, which is
// what makes a snapshot diagnostic against the static stylesheet.
//
// Pure: no DOM mutation, no network. Given a selector, return a compact,
// JSON-serializable snapshot of a bounded subtree (the element, its parent,
// and its direct children).

// Only these computed properties are emitted — a curated whitelist keeps the
// payload small instead of dumping the entire computed style.
const STYLE_PROPS = [
    'display',
    'position',
    'top',
    'left',
    'right',
    'bottom',
    'flex-direction',
    'justify-content',
    'align-items',
    'gap',
    'padding',
    'margin',
    'width',
    'height',
    'font-size',
    'line-height',
    'text-align',
    'overflow',
];

// Cap the class list so a node with many utility classes can't bloat the payload.
const MAX_CLASSES = 8;

function abbreviatedClasses(el) {
    const tokens = el.classList ? Array.from(el.classList) : [];
    return tokens.slice(0, MAX_CLASSES);
}

function computedStyles(el) {
    const view = el.ownerDocument && el.ownerDocument.defaultView;
    const getCS = view && view.getComputedStyle;
    const style = {};
    if (!getCS) return style;
    const cs = view.getComputedStyle(el);
    for (const prop of STYLE_PROPS) {
        style[prop] = cs.getPropertyValue(prop);
    }
    return style;
}

function snapshotNode(el) {
    if (!el || el.nodeType !== 1) return null;
    const rect = el.getBoundingClientRect();
    return {
        tag: el.tagName ? el.tagName.toLowerCase() : '',
        id: el.id || null,
        classes: abbreviatedClasses(el),
        box: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
        },
        style: computedStyles(el),
    };
}

export function serializeLayout(selector) {
    const el = document.querySelector(selector);
    if (!el) return { found: false, selector };

    return {
        found: true,
        selector,
        node: snapshotNode(el),
        parent: snapshotNode(el.parentElement),
        children: Array.from(el.children).map(snapshotNode),
    };
}
