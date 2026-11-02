import { EXTENSION_BASE_PATH, DEFAULT_SPRITES } from "./constants.js";

const STOCK_NAMES = "idle|happy|sad|excited|surprised|nervous|confident|shy|sleeping|thinking|angry|dragging|walking";
// v1 shipped these as PNG. A relative path, this extension's own absolute path or a full
// link copied from a browser (any host or extension folder name) all map to the WebP.
const STOCK_IMAGE = new RegExp(`^(images/(?:${STOCK_NAMES}))\\.png([?#].*)?$`, "i");
const STOCK_LINK = new RegExp(`^(?:(?:https?:)?//[^/?#]+)?(?:/[^?#]*?)?/scripts/extensions/third-party/[^/?#]+/(images/(?:${STOCK_NAMES}))\\.png([?#].*)?$`, "i");

export function resolveSpriteSource(sprite) {
    if (typeof sprite !== "string") return "";
    const ownAbsolute = sprite.startsWith(EXTENSION_BASE_PATH);
    const relative = ownAbsolute ? sprite.slice(EXTENSION_BASE_PATH.length) : sprite;
    const stock = STOCK_IMAGE.exec(relative) || STOCK_LINK.exec(sprite);
    if (stock) return `${EXTENSION_BASE_PATH}${stock[1].toLowerCase()}.webp${stock[2] || ""}`;
    if (/^(?:data:|blob:|https?:|\/)/i.test(sprite)) return sprite;
    return `${EXTENSION_BASE_PATH}${sprite}`;
}

export function idleSprite(character) {
    const sprite = character?.appearance?.customSprites?.idle;
    return resolveSpriteSource(typeof sprite === "string" && sprite ? sprite : DEFAULT_SPRITES.idle);
}

/** Same fallback order as the on-screen pet: the mood image, then custom idle, then the stock mood image. */
export function moodSprite(character, mood) {
    const sprites = character?.appearance?.customSprites || {};
    const own = Object.hasOwn(sprites, mood) && typeof sprites[mood] === "string" ? sprites[mood] : "";
    const custom = Object.values(sprites).some(Boolean);
    const pick = own || (custom && sprites.idle) || (Object.hasOwn(DEFAULT_SPRITES, mood) ? DEFAULT_SPRITES[mood] : DEFAULT_SPRITES.idle);
    return resolveSpriteSource(pick);
}
