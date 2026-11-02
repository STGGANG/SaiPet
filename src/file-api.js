/** SillyTavern's built-in user-file API. Every SaiPet file lives in user/files/ with a saipet_ prefix. */
const FILES_ROOT = "user/files/";
export const IMAGE_TYPES = Object.freeze({ png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" });
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const imageIdPattern = /^[a-f0-9]{64}$/;
const IMAGE_URL = /^\/user\/files\/saipet_img_([a-f0-9]{64})\.(png|jpg|gif|webp)$/;
const IMAGE_REFERENCE = /\/user\/files\/saipet_img_([a-f0-9]{64})\.(?:png|jpg|gif|webp)(?![A-Za-z0-9])/g;
const SAFE_NAME = /^[a-zA-Z0-9_\-.]+$/;

let api = { fetch: (...args) => globalThis.fetch(...args), headers: () => ({}) };

/** Binds the transport: SillyTavern's request headers in the browser, a fake fetch in tests. */
export function configureFileApi(next) {
    api = { ...api, ...next };
}

export class StorageError extends Error {
    constructor(code, status = 400, extra = {}) {
        super(code);
        this.status = status;
        Object.assign(this, extra);
    }
}

export const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function request(path, init = {}, timeout = 30000) {
    return api.fetch(path, {
        credentials: "same-origin",
        signal: AbortSignal.timeout(timeout),
        ...init,
        headers: { ...api.headers(), ...(init.headers || {}) },
    });
}

function toBase64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
    return btoa(binary);
}

export function fromBase64(text) {
    return Uint8Array.from(atob(text), char => char.charCodeAt(0));
}

export const byteLength = text => new TextEncoder().encode(text).length;

export async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function uploadFile(name, content) {
    if (!SAFE_NAME.test(name) || name.startsWith(".")) throw new StorageError("invalid_file_name", 500);
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const response = await request("/api/files/upload", {
        method: "POST", body: JSON.stringify({ name, data: toBase64(bytes) }),
    }, 120000);
    if (!response.ok) throw new StorageError(`file_upload_failed_${response.status}`, response.status);
    const result = await response.json().catch(() => null);
    if (String(result?.path || "").replace(/^\/+/, "") !== FILES_ROOT + name) throw new StorageError("unexpected_upload_path", 502);
}

export async function deleteFile(name) {
    const response = await request("/api/files/delete", { method: "POST", body: JSON.stringify({ path: FILES_ROOT + name }) });
    if (!response.ok && response.status !== 404) throw new StorageError(`file_delete_failed_${response.status}`, response.status);
    return response.ok;
}

/** A JSON file, or null when it does not exist. Files with fixed names are always fetched fresh. */
export async function readJsonFile(name, { fresh = false } = {}) {
    const response = await request(`/${FILES_ROOT}${name}${fresh ? `?v=${Date.now()}` : ""}`,
        { cache: fresh ? "no-store" : "no-cache" });
    if (response.status === 404) return null;
    if (!response.ok) throw new StorageError(`file_read_failed_${response.status}`, response.status);
    try {
        return await response.json();
    } catch {
        throw new StorageError("invalid_data_file", 500);
    }
}

export function sniffImageType(bytes) {
    const ascii = (from, to) => String.fromCharCode(...bytes.subarray(from, to));
    if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) return "png";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
    if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "gif";
    if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
    return null;
}

export function decodeImage(dataUrl, { trustBytes = false } = {}) {
    if (typeof dataUrl !== "string") throw new StorageError("invalid_image");
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(dataUrl);
    if (!match) throw new StorageError("unsupported_image", 415);
    if (match[2].length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4) throw new StorageError("image_too_large", 413);
    let bytes;
    try {
        bytes = fromBase64(match[2]);
    } catch {
        throw new StorageError("invalid_image");
    }
    if (bytes.length > MAX_IMAGE_BYTES) throw new StorageError("image_too_large", 413);
    const extension = sniffImageType(bytes);
    // Old v1 data labelled images by file extension; the bytes are what matter for those.
    if (!extension || (!trustBytes && IMAGE_TYPES[extension] !== match[1].toLowerCase())) {
        throw new StorageError("unsupported_image", 415);
    }
    return { bytes, extension };
}

export const imageFileName = (id, extension) => `saipet_img_${id}.${extension}`;
export const imageUrl = (id, extension) => `/${FILES_ROOT}${imageFileName(id, extension)}`;

export function isServerImageUrl(value) {
    return typeof value === "string" && IMAGE_URL.test(value);
}

export function parseImageUrl(value) {
    const match = typeof value === "string" ? IMAGE_URL.exec(value) : null;
    return match ? { id: match[1], extension: match[2] } : null;
}

/** Every stored image an object graph refers to, as a set of IDs. */
export function collectImageReferences(value, ids = new Set()) {
    if (value === undefined) return ids;
    for (const match of JSON.stringify(value).matchAll(IMAGE_REFERENCE)) ids.add(match[1]);
    return ids;
}

export function rejectUnsafeKeys(value) {
    const queue = [value];
    let nodes = 0;
    while (queue.length) {
        const item = queue.pop();
        if (++nodes > 200_000) throw new StorageError("data_too_complex", 413);
        if (item && typeof item === "object") {
            for (const key of Object.keys(item)) {
                if (["__proto__", "prototype", "constructor"].includes(key)) throw new StorageError("unsafe_key");
                queue.push(item[key]);
            }
        }
    }
}

export function randomId() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
