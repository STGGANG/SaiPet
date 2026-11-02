/**
 * SaiPet data in SillyTavern's user files, with no server plugin.
 *
 * saipet_manifest.json               revision, which file holds each part, restore history
 * saipet_<part>_<n>_<writer>.json    one part of the data (presets, logs, journals, house, core); a new name per write
 * saipet_images.json                 index of uploaded images (id → ext, bytes, uploadedAt, trashedAt)
 * saipet_img_<sha256>.<ext>          uploaded sprites and house images
 * saipet_history_<id>.json           the data as it was just before a restore
 *
 * A save uploads only the parts that changed, then the manifest; readers follow the
 * manifest, so they never see a mix. The file API has no compare-and-swap, so the
 * manifest is re-read right before and after writing it to catch another device, and
 * part files carry the writer's id so two devices never overwrite each other's upload.
 */
import {
    StorageError, isObject, byteLength, uploadFile, deleteFile, readJsonFile, randomId, request,
    sha256Hex, decodeImage, imageFileName, imageUrl, isServerImageUrl, collectImageReferences,
    rejectUnsafeKeys, IMAGE_TYPES,
} from "./file-api.js";

export const SCHEMA_VERSION = 1;
export const MAX_DATA_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_FILES = 1024;
const MAX_IMAGE_TOTAL_BYTES = 512 * 1024 * 1024;
export const HISTORY_LIMIT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_UNUSED_IMAGE_AGE_MS = DAY_MS;
const IMAGE_TRASH_RETENTION_MS = 7 * DAY_MS;
const IMAGE_TRASH_EXPIRY_MS = 30 * DAY_MS;
const MANIFEST_FILE = "saipet_manifest.json";
const INDEX_FILE = "saipet_images.json";
const MANIFEST_FORMAT = "saipet-manifest-v1";
const PART_FORMAT = "saipet-part-v1";
const INDEX_FORMAT = "saipet-images-v1";
const PART_KEYS = Object.freeze({
    presets: ["savedPresets"], logs: ["conversationLog"], journals: ["journalEntries"], house: ["house", "houseData"],
});
const PART_NAMES = Object.freeze([...Object.keys(PART_KEYS), "core"]);
const partFile = (name, revision) => `saipet_${name}_${revision}_${writerId()}.json`;
const partFilePattern = name => new RegExp(`^saipet_${name}_[1-9]\\d*_[a-z0-9]{8}\\.json$`);
export const historyFile = id => `saipet_history_${id}.json`;
const historyIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const imageIdPattern = /^[a-f0-9]{64}$/;
/** Replaceable in tests. */
export const clock = { now: () => Date.now() };
const now = () => clock.now();

// Part contents last seen, by part revision, so a save compares and uploads only what changed.
const cache = { parts: {} };
let chain = Promise.resolve();

export function resetStoreCache() {
    cache.parts = {};
}

let sessionWriter = "";
/** Stable per browser profile, so a save this device could not finish is overwritten by its next one. */
function writerId() {
    try {
        if (typeof window === "undefined") throw new Error("no window");
        const stored = localStorage.getItem("saipet-writer");
        if (/^[a-z0-9]{8}$/.test(stored)) return stored;
        const fresh = randomId().replace(/[^a-z0-9]/g, "").slice(0, 8).padEnd(8, "0");
        localStorage.setItem("saipet-writer", fresh);
        return fresh;
    } catch {
        sessionWriter ||= randomId().replace(/[^a-z0-9]/g, "").slice(0, 8).padEnd(8, "0");
        return sessionWriter;
    }
}

function conflict(revision) {
    return new StorageError("conflict", 409, { revision });
}

/** Serialises writes in this tab, and across tabs of the same browser when Web Locks exist. */
export function locked(work) {
    const run = () => (globalThis.navigator?.locks ? navigator.locks.request("saipet-files", work) : work());
    const result = chain.then(run);
    chain = result.catch(() => {});
    return result;
}

function splitData(data) {
    const parts = Object.fromEntries(PART_NAMES.map(name => [name, {}]));
    const owner = {};
    for (const [name, keys] of Object.entries(PART_KEYS)) for (const key of keys) owner[key] = name;
    for (const [key, value] of Object.entries(data)) parts[owner[key] || "core"][key] = value;
    return parts;
}

/** Whether the data, written as one JSON text, would pass MAX_DATA_BYTES; worked out from its part texts. */
function exceedsDataLimit(partJsons) {
    const filled = partJsons.filter(json => json !== "{}");
    // A UTF-16 unit is at most 3 UTF-8 bytes, so ordinary data needs no encoding at all.
    if (filled.reduce((sum, json) => sum + json.length, 0) * 3 <= MAX_DATA_BYTES) return false;
    // One object: each part loses its braces, and the parts are joined by commas.
    return filled.reduce((sum, json) => sum + byteLength(json), 0) - filled.length + 1 > MAX_DATA_BYTES;
}

function validManifest(file) {
    return file.format === MANIFEST_FORMAT && file.schemaVersion === SCHEMA_VERSION
        && Number.isSafeInteger(file.revision) && file.revision >= 1 && typeof file.token === "string"
        && isObject(file.parts) && Object.entries(file.parts).every(([name, part]) => PART_NAMES.includes(name) && isObject(part)
            && Number.isSafeInteger(part.revision) && part.revision >= 1 && typeof part.file === "string" && partFilePattern(name).test(part.file))
        && Array.isArray(file.keys) && file.keys.every(key => typeof key === "string")
        && Array.isArray(file.history) && file.history.every(entry => isObject(entry) && historyIdPattern.test(entry.id));
}

async function readManifest() {
    const file = await readJsonFile(MANIFEST_FILE, { fresh: true });
    if (!file) return { revision: 0, token: "", parts: {}, keys: [], history: [] };
    if (!isObject(file) || !validManifest(file)) throw new StorageError("invalid_data_file", 500);
    return file;
}

async function readPart(name, { revision, file: fileName }) {
    const cached = cache.parts[name];
    if (cached?.file === fileName) return cached.json;
    const file = await readJsonFile(fileName);
    if (!file) return null;
    if (!isObject(file) || file.format !== PART_FORMAT || file.part !== name || file.revision !== revision || !isObject(file.data)) {
        throw new StorageError("invalid_data_file", 500);
    }
    rejectUnsafeKeys(file.data);
    const json = JSON.stringify(file.data);
    cache.parts[name] = { revision, file: fileName, json };
    return json;
}

/** The manifest and the data it describes. A part deleted by a save that just finished is re-read via the new manifest. */
export async function loadData() {
    for (let attempt = 0; ; attempt++) {
        const manifest = await readManifest();
        if (!manifest.revision) return { manifest, data: null };
        const merged = {};
        let missing = false;
        for (const [name, part] of Object.entries(manifest.parts)) {
            const json = await readPart(name, part);
            if (json === null) { missing = true; break; }
            Object.assign(merged, JSON.parse(json));
        }
        if (!missing) {
            const data = {};
            for (const key of [...manifest.keys, ...Object.keys(merged)]) if (Object.hasOwn(merged, key)) data[key] = merged[key];
            return { manifest, data };
        }
        if (attempt >= 2) throw new StorageError("data_part_missing", 500);
    }
}

export async function getServerData() {
    const { manifest, data } = await loadData();
    return { schemaVersion: SCHEMA_VERSION, revision: manifest.revision, data };
}

export async function getServerRevision() {
    return (await readManifest()).revision;
}

/** Writes the data as the next revision. Call with the lock held. */
export async function commitData(data, revision, { history } = {}) {
    const split = splitData(data);
    // Each part is serialised once: for the size check, the comparison and the upload.
    const jsons = Object.fromEntries(PART_NAMES.map(name => [name, JSON.stringify(split[name])]));
    if (exceedsDataLimit(Object.values(jsons))) throw new StorageError("data_too_large", 413);
    const manifest = await readManifest();
    if (manifest.revision !== revision) throw conflict(manifest.revision);
    const next = {
        format: MANIFEST_FORMAT, schemaVersion: SCHEMA_VERSION, revision: revision + 1, token: randomId(),
        parts: { ...manifest.parts }, keys: Object.keys(data), history: history ?? manifest.history,
        writtenAt: new Date().toISOString(),
    };
    const written = {};
    for (const name of PART_NAMES) {
        const json = jsons[name];
        const current = manifest.parts[name];
        if (current === undefined) {
            if (json === "{}") continue;
        } else if (json === "{}") {
            delete next.parts[name];
            continue;
        } else if (await readPart(name, current) === json) {
            continue;
        }
        const partRevision = (current?.revision ?? 0) + 1;
        const file = partFile(name, partRevision);
        await uploadFile(file, `{"format":${JSON.stringify(PART_FORMAT)},"part":${JSON.stringify(name)},"revision":${partRevision},"data":${json}}`);
        written[name] = { revision: partRevision, file, json };
        next.parts[name] = { revision: partRevision, file };
    }
    const discard = async () => {
        for (const name of Object.keys(written)) delete cache.parts[name];
        await Promise.all(Object.values(written).map(part => deleteFile(part.file).catch(() => {})));
    };
    const latest = await readManifest();
    if (latest.revision !== revision) {
        await discard();
        throw conflict(latest.revision);
    }
    await uploadFile(MANIFEST_FILE, JSON.stringify(next));
    const check = await readManifest();
    if (check.revision !== next.revision || check.token !== next.token) {
        await discard();
        throw conflict(check.revision);
    }
    Object.assign(cache.parts, written);
    const superseded = PART_NAMES.filter(name => manifest.parts[name] && manifest.parts[name].file !== next.parts[name]?.file);
    await Promise.all(superseded.map(name => deleteFile(manifest.parts[name].file).catch(() => {})));
    return { ok: true, revision: next.revision };
}

export function putServerData(data, revision) {
    if (!isObject(data) || !Number.isSafeInteger(revision) || revision < 0) {
        return Promise.reject(new StorageError("invalid_data"));
    }
    return locked(() => commitData(data, revision));
}

/* Image index */

function validIndexEntry(entry) {
    return isObject(entry) && Object.hasOwn(IMAGE_TYPES, entry.ext) && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0
        && Number.isSafeInteger(entry.uploadedAt) && (entry.trashedAt === undefined || Number.isSafeInteger(entry.trashedAt));
}

export async function readIndex() {
    const file = await readJsonFile(INDEX_FILE, { fresh: true });
    if (!file) return { revision: 0, token: "", images: {} };
    if (!isObject(file) || file.format !== INDEX_FORMAT || !Number.isSafeInteger(file.revision) || !isObject(file.images)
        || !Object.entries(file.images).every(([id, entry]) => imageIdPattern.test(id) && validIndexEntry(entry))) {
        throw new StorageError("invalid_image_index", 500);
    }
    return file;
}

/** Reads the index, applies `mutate(images)`, and writes it back; retried when another device wrote meanwhile. */
export async function updateIndex(mutate) {
    for (let attempt = 0; ; attempt++) {
        const index = await readIndex();
        const result = await mutate(index.images);
        if (result?.unchanged) return result;
        const next = { format: INDEX_FORMAT, revision: index.revision + 1, token: randomId(), images: index.images };
        await uploadFile(INDEX_FILE, JSON.stringify(next));
        const check = await readIndex();
        if (check.revision === next.revision && check.token === next.token) return result;
        if (attempt >= 2) throw conflict(check.revision);
    }
}

const live = images => Object.values(images).filter(entry => entry.trashedAt === undefined);
const sum = (items, key) => items.reduce((total, item) => total + (item[key] || 0), 0);

function assertImageQuota(images, added, addedBytes) {
    const current = live(images);
    if (current.length + added > MAX_IMAGE_FILES || sum(current, "bytes") + addedBytes > MAX_IMAGE_TOTAL_BYTES) {
        throw new StorageError("image_quota_exceeded", 413);
    }
}

/** Stores image bytes once (deduplicated by SHA-256) and returns the served URL. Call with the lock held. */
export async function storeImage(bytes, extension, id) {
    await updateIndex(async images => {
        const entry = images[id];
        if (entry && entry.trashedAt === undefined) {
            // A re-upload counts as a fresh upload for the unused-image grace period.
            entry.uploadedAt = now();
            return;
        }
        if (!entry) assertImageQuota(images, 1, bytes.length);
        await uploadFile(imageFileName(id, extension), bytes);
        images[id] = { ext: extension, bytes: bytes.length, uploadedAt: now() };
    });
    return imageUrl(id, extension);
}

export async function uploadServerImage(dataUrl) {
    const { bytes, extension } = decodeImage(dataUrl);
    const id = await sha256Hex(bytes);
    return locked(() => storeImage(bytes, extension, id));
}

export async function readServerImageAsDataUrl(url) {
    if (!isServerImageUrl(url)) return url;
    const response = await request(url, { cache: "no-cache" }, 120000);
    if (!response.ok) throw new Error(`Cannot read preset image: HTTP ${response.status}`);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error("Cannot read image"));
        reader.readAsDataURL(blob);
    });
}

/* Unused images and the trash */

export async function readRestoreSnapshot(id) {
    if (typeof id !== "string" || !historyIdPattern.test(id)) throw new StorageError("invalid_history_id");
    const snapshot = await readJsonFile(historyFile(id));
    if (!snapshot) throw new StorageError("restore_snapshot_not_found", 404);
    if (!isObject(snapshot) || snapshot.schemaVersion !== SCHEMA_VERSION || !Number.isSafeInteger(snapshot.revision)
        || snapshot.revision < 0 || (snapshot.data !== null && !isObject(snapshot.data))
        || (snapshot.smallSettings !== null && !isObject(snapshot.smallSettings))) {
        throw new StorageError("invalid_restore_history", 500);
    }
    return snapshot;
}

async function protectedImageIds() {
    const { manifest, data } = await loadData();
    const ids = collectImageReferences(data);
    const historyIds = new Set();
    for (const entry of manifest.history) {
        const snapshot = await readRestoreSnapshot(entry.id);
        collectImageReferences(snapshot.data, historyIds);
        collectImageReferences(snapshot.smallSettings, historyIds);
    }
    for (const id of historyIds) ids.add(id);
    return { revision: manifest.revision, ids, data: data ?? {}, historyIds };
}

async function listUnusedImages(images) {
    const { revision, ids: protectedIds, data, historyIds } = await protectedImageIds();
    const usedSummary = {
        presets: collectImageReferences(data.savedPresets).size,
        active: collectImageReferences(data.activeImages).size,
        secondPet: collectImageReferences(data.secondPetData).size,
        house: collectImageReferences([data.house, data.houseData]).size,
        history: historyIds.size,
        total: protectedIds.size,
    };
    const time = now();
    const unused = Object.entries(images)
        .filter(([id, entry]) => entry.trashedAt === undefined && !protectedIds.has(id))
        .map(([id, entry]) => ({ id, bytes: entry.bytes, url: imageUrl(id, entry.ext), eligible: time - entry.uploadedAt >= MIN_UNUSED_IMAGE_AGE_MS }))
        .sort((a, b) => a.id.localeCompare(b.id));
    return { revision, unused, usedSummary, eligibleBytes: sum(unused.filter(item => item.eligible), "bytes") };
}

export function previewUnusedServerImages() {
    return locked(async () => listUnusedImages((await readIndex()).images));
}

function trashEntries(images, time = now()) {
    return Object.entries(images)
        .filter(([, entry]) => entry.trashedAt !== undefined)
        .map(([id, entry]) => ({
            id, bytes: entry.bytes, url: imageUrl(id, entry.ext),
            deletedAt: new Date(entry.trashedAt).toISOString(),
            purgeEligible: time - entry.trashedAt >= IMAGE_TRASH_RETENTION_MS,
            expiresAt: new Date(entry.trashedAt + IMAGE_TRASH_EXPIRY_MS).toISOString(),
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
}

async function expireTrashedImages() {
    const time = now();
    let purged = 0;
    await updateIndex(async images => {
        const expired = Object.entries(images).filter(([, entry]) => entry.trashedAt !== undefined && time - entry.trashedAt >= IMAGE_TRASH_EXPIRY_MS);
        if (!expired.length) return { unchanged: true };
        const protectedImages = await protectedImageIds();
        for (const [id, entry] of expired) {
            if (protectedImages.ids.has(id)) continue;
            await deleteFile(imageFileName(id, entry.ext));
            delete images[id];
            purged++;
        }
        return purged ? {} : { unchanged: true };
    });
    return purged;
}

function validIds(ids, allowEmpty = false) {
    return Array.isArray(ids) && (allowEmpty || ids.length) && ids.length <= MAX_IMAGE_FILES
        && ids.every(id => typeof id === "string" && imageIdPattern.test(id)) && new Set(ids).size === ids.length;
}

export function cleanupUnusedServerImages(revision, ids) {
    if (!Number.isSafeInteger(revision) || revision < 0 || !validIds(ids)) {
        return Promise.reject(new StorageError("invalid_cleanup_request"));
    }
    return locked(async () => {
        let movedBytes = 0;
        await updateIndex(async images => {
            const preview = await listUnusedImages(images);
            if (preview.revision !== revision) throw conflict(preview.revision);
            const eligible = new Map(preview.unused.filter(item => item.eligible).map(item => [item.id, item]));
            if (ids.some(id => !eligible.has(id))) throw new StorageError("image_in_use_or_too_recent", 409);
            const time = now();
            movedBytes = 0;
            for (const id of ids) {
                images[id].trashedAt = time;
                movedBytes += images[id].bytes;
            }
        });
        await expireTrashedImages();
        return { ok: true, moved: ids.length, movedBytes, recoverableForDays: IMAGE_TRASH_RETENTION_MS / DAY_MS };
    });
}

export function listTrashedServerImages() {
    return locked(async () => {
        await expireTrashedImages();
        return { images: trashEntries((await readIndex()).images), autoPurgeDays: IMAGE_TRASH_EXPIRY_MS / DAY_MS };
    });
}

export function restoreTrashedServerImages(ids) {
    if (!validIds(ids)) return Promise.reject(new StorageError("invalid_image_ids"));
    return locked(async () => {
        let restored = 0;
        await updateIndex(images => {
            restored = 0;
            for (const id of ids) {
                const entry = images[id];
                if (!entry || entry.trashedAt === undefined) throw new StorageError("image_not_in_trash", 404);
                assertImageQuota(images, 1, entry.bytes);
                delete entry.trashedAt;
                entry.uploadedAt = now();
                restored++;
            }
        });
        return { ok: true, restored };
    });
}

export function purgeTrashedServerImages(ids) {
    if (!validIds(ids, true)) return Promise.reject(new StorageError("invalid_image_ids"));
    return locked(async () => {
        let freedBytes = 0;
        await updateIndex(async images => {
            if (!ids.length) return { unchanged: true };
            const eligible = new Set(trashEntries(images).filter(item => item.purgeEligible).map(item => item.id));
            if (ids.some(id => !eligible.has(id))) throw new StorageError("image_trash_retention_active", 409);
            const protectedImages = await protectedImageIds();
            if (ids.some(id => protectedImages.ids.has(id))) throw new StorageError("image_in_use", 409);
            freedBytes = 0;
            for (const id of ids) {
                await deleteFile(imageFileName(id, images[id].ext));
                freedBytes += images[id].bytes;
                delete images[id];
            }
        });
        return { ok: true, purged: ids.length, freedBytes };
    });
}

export async function getServerUsage() {
    const { manifest } = await loadData();
    const images = (await readIndex()).images;
    const trashed = Object.values(images).filter(entry => entry.trashedAt !== undefined);
    const usage = {
        dataBytes: Object.keys(manifest.parts).reduce((total, name) => total + byteLength(cache.parts[name]?.json ?? ""), 0),
        imageBytes: sum(live(images), "bytes"), imageCount: live(images).length,
        trashBytes: sum(trashed, "bytes"), trashCount: trashed.length,
        historyBytes: sum(manifest.history, "bytes"), historyCount: manifest.history.length,
    };
    return { ...usage, totalBytes: usage.dataBytes + usage.imageBytes + usage.trashBytes + usage.historyBytes,
        imageQuotaBytes: MAX_IMAGE_TOTAL_BYTES, imageQuotaFiles: MAX_IMAGE_FILES };
}

