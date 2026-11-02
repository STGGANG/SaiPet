/** Private backups (export, preview, restore) and the restore history, on the file store. */
import {
    StorageError, isObject, byteLength, uploadFile, deleteFile, randomId, sha256Hex, decodeImage,
    collectImageReferences, rejectUnsafeKeys, imageIdPattern, IMAGE_TYPES, MAX_IMAGE_BYTES,
} from "./file-api.js";
import {
    SCHEMA_VERSION, MAX_DATA_BYTES, HISTORY_LIMIT, historyFile, locked, loadData, commitData,
    readIndex, updateIndex, storeImage, readRestoreSnapshot, clock,
} from "./file-store.js";

const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 72 * 1024 * 1024;
const MAX_SMALL_SETTINGS_BYTES = 4 * 1024 * 1024;
const BACKUP_CATEGORIES = Object.freeze({
    presets: ["savedPresets"],
    activeSettings: ["secondPetData", "activeImages"],
    customSpeeches: ["customSpeeches"],
    logs: ["conversationLog"],
    journals: ["journalEntries"],
    reminders: ["reminders"],
    memos: ["personalMemos"],
    house: ["house", "houseData"],
    otherData: [],
});
const BACKUP_CATEGORY_NAMES = Object.keys(BACKUP_CATEGORIES);
const knownKeys = new Set(Object.values(BACKUP_CATEGORIES).flat());
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function conflict(revision) {
    return new StorageError("conflict", 409, { revision });
}

function validateCategories(categories) {
    if (!Array.isArray(categories) || !categories.length || categories.length > BACKUP_CATEGORY_NAMES.length
        || categories.some(name => !BACKUP_CATEGORY_NAMES.includes(name)) || new Set(categories).size !== categories.length) {
        throw new StorageError("invalid_backup_categories");
    }
    return categories;
}

function categoryKeys(data, category) {
    return category === "otherData" ? Object.keys(data).filter(key => !knownKeys.has(key)) : BACKUP_CATEGORIES[category];
}

function selectDataCategories(data, categories) {
    const selected = {};
    for (const category of categories) {
        for (const key of categoryKeys(data, category)) if (Object.hasOwn(data, key)) selected[key] = structuredClone(data[key]);
    }
    return selected;
}

function selectedKeys(archiveData, categories) {
    return categories.flatMap(category => categoryKeys(archiveData, category).filter(key => Object.hasOwn(archiveData, key)));
}

function validateSmallSettings(value) {
    if (!isObject(value)) throw new StorageError("invalid_current_small_settings");
    rejectUnsafeKeys(value);
    if (byteLength(JSON.stringify(value)) > MAX_SMALL_SETTINGS_BYTES) throw new StorageError("small_settings_too_large", 413);
}

/** Checks an archive and returns the images it embeds, decoded and hash-checked. */
async function validateArchive(archive) {
    if (!isObject(archive) || archive.kind !== "saipet-backup" || archive.version !== BACKUP_VERSION
        || !isObject(archive.data) || !isObject(archive.images) || !isObject(archive.smallSettings) || typeof archive.createdAt !== "string") {
        throw new StorageError("invalid_backup");
    }
    validateCategories(archive.categories);
    if (byteLength(JSON.stringify(archive)) > MAX_BACKUP_BYTES) throw new StorageError("backup_too_large", 413);
    rejectUnsafeKeys(archive);
    const expected = new Set(selectedKeys(archive.data, archive.categories));
    if (Object.keys(archive.data).some(key => !expected.has(key))) throw new StorageError("invalid_backup_data");
    const shapes = {
        savedPresets: Array.isArray, secondPetData: value => value === null || isObject(value), activeImages: isObject,
        customSpeeches: isObject, conversationLog: isObject, journalEntries: isObject, reminders: Array.isArray,
        personalMemos: Array.isArray, house: value => value === null || isObject(value), houseData: value => value === null || isObject(value),
    };
    for (const [key, validate] of Object.entries(shapes)) {
        if (Object.hasOwn(archive.data, key) && !validate(archive.data[key])) throw new StorageError("invalid_backup_data");
    }
    if (Object.hasOwn(archive.data, "savedPresets")) {
        const seen = new Set();
        for (const preset of archive.data.savedPresets) {
            if (!isObject(preset) || typeof preset.id !== "string" || !preset.id || seen.has(preset.id)) throw new StorageError("invalid_backup_presets");
            for (const key of ["appearance", "personality", "customSpeeches"]) {
                if (Object.hasOwn(preset, key) && !isObject(preset[key])) throw new StorageError("invalid_backup_presets");
            }
            seen.add(preset.id);
        }
    }
    const hasSmall = Object.keys(archive.smallSettings).length > 0;
    if (!archive.categories.includes("activeSettings") && hasSmall) throw new StorageError("unexpected_small_settings");
    if (archive.categories.includes("activeSettings") && !hasSmall) throw new StorageError("small_settings_required");
    const required = collectImageReferences(archive.data);
    collectImageReferences(archive.smallSettings, required);
    const pending = new Map();
    for (const [id, dataUrl] of Object.entries(archive.images)) {
        if (!imageIdPattern.test(id) || !required.has(id)) throw new StorageError("invalid_backup_image");
        if (archive.imageFiles === true && isObject(dataUrl) && dataUrl.stored === true) continue;
        const image = decodeImage(dataUrl);
        if (await sha256Hex(image.bytes) !== id) throw new StorageError("backup_image_hash_mismatch");
        pending.set(id, image);
    }
    if (required.size !== Object.keys(archive.images).length) throw new StorageError("backup_image_missing");
    return pending;
}

function backupImageIds(archive, categories) {
    const ids = collectImageReferences(selectDataCategories(archive.data, categories));
    if (categories.includes("activeSettings")) collectImageReferences(archive.smallSettings, ids);
    return ids;
}

/** Images the archive marks as already stored must still be on this server. */
async function validateStoredImages(archive, categories, images) {
    if (archive.imageFiles !== true) return;
    const selected = backupImageIds(archive, categories);
    for (const [id, value] of Object.entries(archive.images)) {
        if (selected.has(id) && isObject(value) && value.stored === true && !images[id]) throw new StorageError("backup_image_missing");
    }
}

const presetLabel = preset => (typeof preset.name === "string" && preset.name.trim() ? preset.name : String(preset.id ?? ""));
const presetContentKey = preset => JSON.stringify({ ...preset, id: undefined });

function applyRestore(currentData, archiveData, categories, mode) {
    if (!["merge", "replace"].includes(mode)) throw new StorageError("invalid_restore_mode");
    const next = structuredClone(currentData ?? {});
    const keys = selectedKeys(archiveData, categories);
    const conflicts = [];
    const renamedPresets = [];
    const removedPresetNames = [];
    const existing = Array.isArray(next.savedPresets) ? next.savedPresets : [];
    const incoming = Array.isArray(archiveData.savedPresets) ? archiveData.savedPresets : [];
    if (mode === "merge" && categories.includes("presets")) {
        const ids = new Map(existing.map(preset => [preset?.id, preset]));
        if (incoming.some(preset => !isObject(preset) || typeof preset.id !== "string" || !preset.id)) throw new StorageError("invalid_backup_presets");
        // A same-ID preset with different content is added as a named copy so
        // neither the local edit nor the backup version is lost.
        const contentKeys = new Set(existing.filter(isObject).map(presetContentKey));
        const seen = new Set();
        for (const preset of incoming) {
            if (seen.has(preset.id)) throw new StorageError("duplicate_backup_preset");
            seen.add(preset.id);
            if (!ids.has(preset.id)) { existing.push(structuredClone(preset)); continue; }
            if (sameJson(ids.get(preset.id), preset)) continue;
            const copy = { ...structuredClone(preset), name: `${typeof preset.name === "string" ? preset.name.trim() : ""} (백업)`.trim() };
            if (contentKeys.has(presetContentKey(copy))) continue;
            copy.id = `preset_${Date.now()}_${randomId()}`;
            existing.push(copy);
            renamedPresets.push(copy.name);
        }
        next.savedPresets = existing;
    }
    if (mode === "replace" && categories.includes("presets")) {
        const incomingIds = new Set(incoming.map(preset => preset?.id));
        for (const preset of existing) if (isObject(preset) && !incomingIds.has(preset.id)) removedPresetNames.push(presetLabel(preset));
    }
    for (const key of keys) {
        if (mode === "merge" && key === "savedPresets") continue;
        if (mode === "merge" && Object.hasOwn(next, key) && !sameJson(next[key], archiveData[key])) conflicts.push(key);
        else next[key] = structuredClone(archiveData[key]);
    }
    if (mode === "replace") {
        for (const category of categories) {
            for (const key of categoryKeys(next, category)) if (!Object.hasOwn(archiveData, key)) delete next[key];
        }
    }
    return { data: next, conflicts, renamedPresets, removedPresetNames };
}

function countNestedLists(value) {
    if (Array.isArray(value)) return value.length;
    if (!isObject(value)) return 0;
    const queue = [value];
    let total = 0;
    let nodes = 0;
    while (queue.length) {
        if (++nodes > 200_000) throw new StorageError("data_too_complex", 413);
        for (const child of Object.values(queue.pop())) {
            if (Array.isArray(child)) total += child.length;
            else if (isObject(child)) queue.push(child);
        }
    }
    return total;
}

function previewItemCount(key, value) {
    if (["savedPresets", "reminders", "personalMemos"].includes(key)) return { count: Array.isArray(value) ? value.length : 0, unit: "items" };
    if (["conversationLog", "journalEntries", "customSpeeches"].includes(key)) return { count: countNestedLists(value), unit: "entries" };
    if (key === "house" || key === "houseData") return { count: Array.isArray(value?.furniture) ? value.furniture.length : 0, unit: "furniture" };
    return null;
}

function previewRestoreEffects(currentData, archiveData, categories, mode, currentSmallSettings, archiveSmallSettings) {
    const current = currentData ?? {};
    const keys = new Set(selectedKeys(archiveData, categories));
    for (const category of categories) for (const key of categoryKeys(current, category)) keys.add(key);
    const replacedKeys = [];
    const removedKeys = [];
    const addedKeys = [];
    const counts = {};
    for (const key of keys) {
        const hasCurrent = Object.hasOwn(current, key);
        const hasIncoming = Object.hasOwn(archiveData, key);
        if (mode === "replace") {
            if (hasCurrent && !hasIncoming) removedKeys.push(key);
            else if (hasCurrent && hasIncoming && !sameJson(current[key], archiveData[key])) replacedKeys.push(key);
            else if (!hasCurrent && hasIncoming) addedKeys.push(key);
        } else if (!hasCurrent && hasIncoming) {
            addedKeys.push(key);
        }
        const currentCount = previewItemCount(key, current[key]);
        const incomingCount = previewItemCount(key, archiveData[key]);
        if (currentCount || incomingCount) {
            counts[key] = { current: currentCount?.count ?? 0, incoming: incomingCount?.count ?? 0, unit: currentCount?.unit ?? incomingCount.unit };
        }
    }
    if (mode === "replace" && categories.includes("activeSettings") && !sameJson(currentSmallSettings, archiveSmallSettings)) replacedKeys.push("smallSettings");
    return { replacedKeys, removedKeys, addedKeys, counts };
}

function restorePlan(currentData, archive, categories, mode, currentSmallSettings) {
    if (categories.includes("activeSettings") && !isObject(currentSmallSettings)) throw new StorageError("current_small_settings_required");
    if (currentSmallSettings !== undefined) validateSmallSettings(currentSmallSettings);
    const result = applyRestore(currentData, archive.data, categories, mode);
    if (categories.includes("activeSettings") && mode === "merge" && !sameJson(currentSmallSettings, archive.smallSettings)) result.conflicts.push("smallSettings");
    return {
        ...result, categories, imageIds: backupImageIds(archive, categories),
        incomingPresetCount: categories.includes("presets") ? (archive.data.savedPresets?.length ?? 0) : 0,
    };
}

async function prepareRestore(archive, categories, mode, currentSmallSettings) {
    const pending = await validateArchive(archive);
    validateCategories(categories);
    if (categories.some(name => !archive.categories.includes(name))) throw new StorageError("backup_category_unavailable");
    const images = (await readIndex()).images;
    await validateStoredImages(archive, categories, images);
    const current = await loadData();
    const plan = restorePlan(current.data, archive, categories, mode, currentSmallSettings);
    return { pending, current, plan };
}

/** The archive, with every referenced image as {mime, bytes}; the ZIP writer adds the files. */
export async function exportServerBackup(categories, smallSettings) {
    validateCategories(categories);
    const { manifest, data } = await loadData();
    const selected = selectDataCategories(data ?? {}, categories);
    const selectedSmall = categories.includes("activeSettings") ? smallSettings : {};
    if (categories.includes("activeSettings") && (!isObject(selectedSmall) || !Object.keys(selectedSmall).length)) throw new StorageError("small_settings_required");
    validateSmallSettings(selectedSmall);
    const references = collectImageReferences(selected);
    collectImageReferences(selectedSmall, references);
    const index = (await readIndex()).images;
    const images = {};
    for (const id of references) {
        const entry = index[id];
        if (!entry) throw new StorageError("referenced_image_missing", 409);
        if (entry.bytes > MAX_IMAGE_BYTES) throw new StorageError("image_too_large", 413);
        images[id] = { mime: IMAGE_TYPES[entry.ext], bytes: entry.bytes };
    }
    const archive = {
        kind: "saipet-backup", version: BACKUP_VERSION, createdAt: new Date().toISOString(),
        sourceRevision: manifest.revision, categories, data: selected, smallSettings: selectedSmall, images, imageFiles: true,
    };
    if (byteLength(JSON.stringify(archive)) > MAX_BACKUP_BYTES) throw new StorageError("backup_too_large", 413);
    return archive;
}

export async function previewServerBackup(archive, categories, mode, currentSmallSettings) {
    const { current, plan } = await prepareRestore(archive, categories, mode, currentSmallSettings);
    const effects = previewRestoreEffects(current.data, archive.data, categories, mode, currentSmallSettings, archive.smallSettings);
    return {
        revision: current.manifest.revision, categories, mode,
        conflicts: plan.conflicts, incomingPresetCount: plan.incomingPresetCount,
        renamedPresets: plan.renamedPresets, removedPresetNames: plan.removedPresetNames,
        imageCount: plan.imageIds.size, smallSettingsIncluded: categories.includes("activeSettings"),
        ...effects,
    };
}

/** Records the current data before a restore; returns the manifest history entry. */
async function writeRestoreSnapshot(current, smallSettings) {
    const id = randomId();
    const createdAt = new Date().toISOString();
    const json = JSON.stringify({
        schemaVersion: SCHEMA_VERSION, revision: current.manifest.revision, data: current.data,
        smallSettings: isObject(smallSettings) ? smallSettings : null, createdAt,
    });
    const bytes = byteLength(json);
    if (bytes > MAX_DATA_BYTES + MAX_SMALL_SETTINGS_BYTES) throw new StorageError("restore_snapshot_too_large", 413);
    await uploadFile(historyFile(id), json);
    return { id, createdAt, revision: current.manifest.revision, hasSmallSettings: isObject(smallSettings), bytes };
}

/** Commits restored data with a fresh snapshot in front of the history; drops snapshots beyond the limit. */
async function commitRestore(current, data, smallSettings) {
    const snapshot = await writeRestoreSnapshot(current, smallSettings);
    const history = [snapshot, ...current.manifest.history];
    const result = await commitData(data, current.manifest.revision, { history: history.slice(0, HISTORY_LIMIT) });
    await Promise.all(history.slice(HISTORY_LIMIT).map(entry => deleteFile(historyFile(entry.id)).catch(() => {})));
    return { ...result, recoveryId: snapshot.id };
}

/** Any referenced image that sits in the trash is taken back out. */
async function reviveImages(ids) {
    await updateIndex(images => {
        const trashed = [...ids].filter(id => images[id]?.trashedAt !== undefined);
        for (const id of trashed) {
            delete images[id].trashedAt;
            images[id].uploadedAt = clock.now();
        }
        return trashed.length ? {} : { unchanged: true };
    });
}

export function restoreServerBackup(archive, categories, mode, revision, currentSmallSettings) {
    if (!Number.isSafeInteger(revision) || revision < 0) return Promise.reject(new StorageError("invalid_revision"));
    return locked(async () => {
        const { pending, current, plan } = await prepareRestore(archive, categories, mode, currentSmallSettings);
        if (current.manifest.revision !== revision) throw conflict(current.manifest.revision);
        if (plan.conflicts.length) throw new StorageError("restore_conflicts", 409, { conflicts: plan.conflicts, revision });
        let restoredImages = 0;
        for (const [id, image] of pending) {
            if (!plan.imageIds.has(id)) continue;
            await storeImage(image.bytes, image.extension, id);
            restoredImages++;
        }
        await reviveImages(plan.imageIds);
        const result = await commitRestore(current, plan.data, currentSmallSettings);
        return {
            ok: true, revision: result.revision, restoredCategories: categories, restoredImages,
            renamedPresets: plan.renamedPresets,
            smallSettings: categories.includes("activeSettings") ? archive.smallSettings : null,
            recoveryId: result.recoveryId,
        };
    });
}

export async function listServerRestoreHistory() {
    const { manifest } = await loadData();
    const snapshots = manifest.history.map(({ id, createdAt, revision, hasSmallSettings }) => ({ id, createdAt, revision, hasSmallSettings: Boolean(hasSmallSettings) }));
    snapshots.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return { snapshots };
}

export function restoreServerHistorySnapshot(id, revision, currentSmallSettings) {
    if (!Number.isSafeInteger(revision) || revision < 0) return Promise.reject(new StorageError("invalid_revision"));
    if (!isObject(currentSmallSettings)) return Promise.reject(new StorageError("current_small_settings_required"));
    return locked(async () => {
        validateSmallSettings(currentSmallSettings);
        const current = await loadData();
        if (current.manifest.revision !== revision) throw conflict(current.manifest.revision);
        if (!current.manifest.history.some(entry => entry.id === id)) throw new StorageError("restore_snapshot_not_found", 404);
        const snapshot = await readRestoreSnapshot(id);
        const references = collectImageReferences(snapshot.data);
        collectImageReferences(snapshot.smallSettings, references);
        const images = (await readIndex()).images;
        if ([...references].some(imageId => !images[imageId])) throw new StorageError("referenced_image_missing", 409);
        await reviveImages(references);
        const result = await commitRestore(current, snapshot.data ?? {}, currentSmallSettings);
        return { ok: true, revision: result.revision, smallSettings: snapshot.smallSettings, recoveryId: result.recoveryId };
    });
}
