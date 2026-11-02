/** One-time import from the retired SaiPet server plugin, for installs that still run it. */
import { StorageError, isObject, rejectUnsafeKeys, request, sha256Hex, sniffImageType, MAX_IMAGE_BYTES } from "./file-api.js";
import { locked, storeImage } from "./file-store.js";

const PLUGIN_BASE = "/api/plugins/saipet";
const PLUGIN_IMAGE_REFERENCE = /\/api\/plugins\/saipet\/images\/([a-f0-9]{64})(?![a-f0-9])/g;

/**
 * The plugin's data with every image copied into user files and references rewritten,
 * or null when no plugin answers. The plugin's own files are never changed.
 */
export async function importPluginData() {
    let body;
    try {
        const response = await request(`${PLUGIN_BASE}/data`);
        if (!response.ok) return null;
        body = await response.json();
    } catch {
        return null;
    }
    if (body?.schemaVersion !== 1 || !isObject(body.data)) return null;
    rejectUnsafeKeys(body.data);
    const json = JSON.stringify(body.data);
    const ids = new Set([...json.matchAll(PLUGIN_IMAGE_REFERENCE)].map(match => match[1]));
    const urls = {};
    await locked(async () => {
        for (const id of ids) {
            const response = await request(`${PLUGIN_BASE}/images/${id}`, {}, 120000);
            if (!response.ok) throw new StorageError(`plugin_image_unreadable_${response.status}`, response.status);
            const bytes = new Uint8Array(await response.arrayBuffer());
            const extension = sniffImageType(bytes);
            if (!extension || bytes.length > MAX_IMAGE_BYTES || await sha256Hex(bytes) !== id) throw new StorageError("plugin_image_invalid", 500);
            urls[id] = await storeImage(bytes, extension, id);
        }
    });
    return { data: JSON.parse(json.replace(PLUGIN_IMAGE_REFERENCE, (match, id) => urls[id] ?? match)), imageCount: ids.size };
}
