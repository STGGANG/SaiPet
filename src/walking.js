import { DEFAULT_WALK_SPRITE } from "./constants.js";
import { resolveSpriteSource } from "./sprite-paths.js";

const decoded = new Map();
/** Decoded once per URL; each walk inserts its own copy, so two pets can share one sprite. */
function decodedImage(url) {
    if (!decoded.has(url)) {
        if (decoded.size >= 8) decoded.delete(decoded.keys().next().value);
        const image = new Image();
        image.src = url; image.alt = ""; image.draggable = false;
        decoded.set(url, image.decode().then(() => image, error => { decoded.delete(url); throw error; }));
    }
    return decoded.get(url);
}

/** Only active walks own a timer. Decoded images are swapped at 3.3 fps. */
export function stopWalkVisual(node) {
    const running = node?._saipetWalkVisual;
    if (!running) return;
    clearTimeout(running.end); clearInterval(running.frames);
    running.cancelled = true;
    if (running.art.contains(running.image)) running.art.replaceChildren(...running.original);
    node.classList.remove("walking", "saipet-walk-frames");
    node._saipetWalkVisual = null;
}

export function startWalkVisual(node, settings, duration = 2500) {
    stopWalkVisual(node);
    const art = node?.querySelector(".st-pet-sprite, .stvp-house-pet-art");
    if (!art || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    const walk = settings?.walk || {};
    const custom = Object.values(settings?.appearance?.customSprites || {}).some(Boolean);
    const source = walk.walkSprite || (custom ? art.querySelector("img")?.getAttribute("src") : DEFAULT_WALK_SPRITE);
    const frames = walk.animationMode === "frames" && walk.walkSprite && walk.walkSprite2;
    const running = { art, original: [...art.childNodes], image: null, cancelled: false };
    node._saipetWalkVisual = running;
    node.classList.add("walking");
    running.end = setTimeout(() => stopWalkVisual(node), duration);
    if (!source) return;
    const urls = [source, ...(frames ? [walk.walkSprite2] : [])].map(resolveSpriteSource);
    Promise.all(urls.map(decodedImage)).then(templates => {
        if (running.cancelled || !node.isConnected || node._saipetWalkVisual !== running) return;
        const images = templates.map(template => template.cloneNode());
        running.image = images[0]; art.replaceChildren(running.image);
        if (frames) {
            node.classList.add("saipet-walk-frames");
            let index = 0;
            running.frames = setInterval(() => {
                if (!node.isConnected) { stopWalkVisual(node); return; }
                index = 1 - index;
                const next = images[index]; art.replaceChildren(next); running.image = next;
            }, 300);
        }
    }).catch(() => { /* Keep the existing image and procedural motion on load failure. */ });
}
