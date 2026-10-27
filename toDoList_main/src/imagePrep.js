// Client-side image prep shared by the chat composer's image attach and the
// description panel's screenshot row: read a picked File to base64, and
// downscale + re-encode it (canvas → JPEG, longest side ≤ 1568px) when it is
// over a byte budget, so a phone screenshot never trips the Worker's cap.
//
// Every helper resolves rather than rejects on an unusable canvas or image, so
// a caller can always fall back to the original bytes; the Worker enforces the
// same caps as a backstop.

// Default byte budget — the Worker's 5MB/image cap on chat turns. Callers with a
// tighter cap (the inject screenshot's 1.5MB) pass their own.
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_MAX_DIMENSION = 1568;

// Read a File to a `data:` URL via FileReader, resolving the URL string.
export function readFileAsDataURL(file) {
    return new Promise(function(resolve, reject) {
        const reader = new FileReader();
        reader.onload = function() { resolve(String(reader.result || '')); };
        reader.onerror = function() { reject(reader.error || new Error('read failed')); };
        try { reader.readAsDataURL(file); } catch (e) { reject(e); }
    });
}

// Split a base64 `data:` URL into { media_type, data }, or null if it isn't one.
export function parseImageDataUrl(url) {
    const m = /^data:([^;,]+);base64,([\s\S]+)$/.exec(String(url || ''));
    if (!m) return null;
    return { media_type: m[1], data: m[2] };
}

// Approximate decoded byte length of a base64 string (used to compare against
// the byte cap without decoding).
export function base64ByteLength(b64) {
    const s = String(b64 || '');
    if (!s) return 0;
    let padding = 0;
    if (s.charAt(s.length - 1) === '=') padding = s.charAt(s.length - 2) === '=' ? 2 : 1;
    return Math.floor(s.length * 3 / 4) - padding;
}

// Downscale + re-encode an image so its base64 payload lands under `maxBytes`
// (default the 5MB chat cap). Loads the source into an <img>, draws it into a
// <canvas> at a reduced size, and re-encodes as JPEG (much smaller than PNG for
// photos/screenshots, which are the only things that exceed the cap), shrinking
// further across a bounded set of attempts until under budget. Resolves
// { media_type, data } or null when the canvas isn't usable (e.g. no 2d
// context) so the caller can fall back to the original bytes.
export function downscaleImage(dataUrl, maxBytes) {
    const budget = maxBytes || IMAGE_MAX_BYTES;
    return new Promise(function(resolve) {
        let img;
        try { img = new Image(); } catch (e) { resolve(null); return; }
        img.onload = function() {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext && canvas.getContext('2d');
                const width = img.naturalWidth || img.width;
                const height = img.naturalHeight || img.height;
                if (!ctx || !width || !height) { resolve(null); return; }
                let scale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(width, height));
                let quality = 0.85;
                for (let attempt = 0; attempt < 6; attempt++) {
                    const w = Math.max(1, Math.round(width * scale));
                    const h = Math.max(1, Math.round(height * scale));
                    canvas.width = w;
                    canvas.height = h;
                    ctx.clearRect(0, 0, w, h);
                    ctx.drawImage(img, 0, 0, w, h);
                    const out = canvas.toDataURL('image/jpeg', quality);
                    const parsed = parseImageDataUrl(out);
                    if (parsed && base64ByteLength(parsed.data) <= budget) {
                        resolve(parsed);
                        return;
                    }
                    scale *= 0.75;
                    quality = Math.max(0.5, quality - 0.1);
                }
                resolve(null);
            } catch (e) { resolve(null); }
        };
        img.onerror = function() { resolve(null); };
        img.src = dataUrl;
    });
}

// Read one picked File into a staged image { media_type, data }. Images already
// under `maxBytes` (default the 5MB chat cap) keep their original bytes
// (preserves animated GIFs and avoids a needless re-encode); oversized ones are
// downscaled, falling back to the raw bytes if the canvas path can't run.
// Returns null for an unreadable/unparsable file.
export async function prepareImage(file, maxBytes) {
    const budget = maxBytes || IMAGE_MAX_BYTES;
    const dataUrl = await readFileAsDataURL(file);
    const parsed = parseImageDataUrl(dataUrl);
    if (!parsed) return null;
    if (base64ByteLength(parsed.data) <= budget) return parsed;
    const shrunk = await downscaleImage(dataUrl, budget);
    return shrunk || parsed;
}

// Resolve an image `data:` URL's natural { width, height }, or zeros when the
// image can't be decoded (or never loads — bounded by a short timeout so a
// caller rendering a size readout is never left waiting).
export function readImageSize(dataUrl) {
    return new Promise(function(resolve) {
        let img;
        try { img = new Image(); } catch (e) { resolve({ width: 0, height: 0 }); return; }
        const timer = setTimeout(function() { resolve({ width: 0, height: 0 }); }, 2000);
        img.onload = function() {
            clearTimeout(timer);
            resolve({ width: img.naturalWidth || img.width || 0, height: img.naturalHeight || img.height || 0 });
        };
        img.onerror = function() {
            clearTimeout(timer);
            resolve({ width: 0, height: 0 });
        };
        img.src = dataUrl;
    });
}
