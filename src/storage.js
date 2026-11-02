import { settingsAfterReset } from "./reset-scopes.js";
import { characterId, migrateCharacterHistory } from "./character-identity.js";
import { fillDefaults, validatePreset, SHARED_FILE_LIMIT } from "./data-validation.js";

import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";
import { EXTENSION_NAME, DEFAULT_SETTINGS, DEFAULT_PERSONALITY_PROMPT } from "./constants.js";
import { state } from "./state.js";
import { getServerData, getServerRevision, putServerData, uploadServerImage, readServerImageAsDataUrl, importPluginData, collectImageReferences, previewUnusedServerImages, cleanupUnusedServerImages, listTrashedServerImages, restoreTrashedServerImages, purgeTrashedServerImages, exportServerBackup, previewServerBackup, restoreServerBackup, listServerRestoreHistory, restoreServerHistorySnapshot } from "./server-storage.js";
import { mergeServerData } from "./merge-data.js";
import { IMAGE_TYPES, isObject, rejectUnsafeKeys, sniffImageType } from "./file-api.js";

// Large user-created data lives in per-user files on the SillyTavern server.
// state.settings retains the familiar shape in memory, so the rest of SaiPet can
// keep reading it synchronously. Only a small projection goes to ST settings.
let storageMode = "legacy";
let storageError = "";
let serverConnected = false;
let serverRevision = 0;
let lastServerJson = "";
let lastServerData = null;
let lastSmallJson = "";
let saveTimer = null;
let saveChain = Promise.resolve();
let serverConflict = false;
let lastRemoteCheck = 0;
let lastSavedAt = 0;
let saving = false;

function getServerPayload(settings = state.settings) {
    return {
        savedPresets: settings.savedPresets || [],
        pairRelationships: settings.pairRelationships || {},
        conversationLog: settings.conversationLog || structuredClone(DEFAULT_SETTINGS.conversationLog),
        journalEntries: {
            identityVersion: settings.petJournal?.identityVersion,
            dreams: settings.petJournal?.dreams || {},
            diaries: settings.petJournal?.diaries || {},
        },
        customSpeeches: settings.customSpeeches || structuredClone(DEFAULT_SETTINGS.customSpeeches),
        reminders: settings.reminders || [],
        personalMemos: settings.personality?.personalMemos || [],
        secondPetData: settings.multiPet?.secondPetData || null,
        activeImages: {
            customSprites: settings.appearance?.customSprites || {},
            walkSprite: settings.walk?.walkSprite || null,
            walkSprite2: settings.walk?.walkSprite2 || null,
        },
        house: settings.house || structuredClone(DEFAULT_SETTINGS.house),
    };
}

function stableJson(value) {
    const normalize = item => {
        if (Array.isArray(item)) return item.map(normalize);
        if (item && typeof item === "object") {
            return Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize(item[key])]));
        }
        return item;
    };
    return JSON.stringify(normalize(value));
}

function getSmallSettings(settings = state.settings) {
    const small = { ...settings, _storageVersion: 1 };
    if (small.deviceDisplay?.mobile) {
        small.deviceDisplay = structuredClone(small.deviceDisplay);
        delete small.deviceDisplay.mobile.opacity; // Old mobile override is no longer used.
    }
    delete small.savedPresets;
    delete small.pairRelationships;
    delete small.house;
    delete small.conversationLog;
    delete small.customSpeeches;
    delete small.reminders;
    small.petJournal = { ...settings.petJournal };
    delete small.petJournal.dreams;
    delete small.petJournal.diaries;
    delete small.petJournal.identityVersion;
    small.personality = { ...settings.personality };
    delete small.personality.personalMemos;
    small.multiPet = { ...settings.multiPet };
    delete small.multiPet.secondPetData;
    small.appearance = { ...settings.appearance };
    delete small.appearance.customSprites;
    small.walk = { ...settings.walk };
    delete small.walk.walkSprite;
    delete small.walk.walkSprite2;
    return small;
}

function applyServerPayload(settings, data) {
    if (!data || typeof data !== "object") return;
    settings.savedPresets = Array.isArray(data.savedPresets) ? data.savedPresets : [];
    settings.pairRelationships = data.pairRelationships && typeof data.pairRelationships === "object" && !Array.isArray(data.pairRelationships) ? data.pairRelationships : {};
    settings.conversationLog = data.conversationLog && typeof data.conversationLog === "object"
        ? data.conversationLog : structuredClone(DEFAULT_SETTINGS.conversationLog);
    settings.customSpeeches = data.customSpeeches && typeof data.customSpeeches === "object"
        ? data.customSpeeches : structuredClone(DEFAULT_SETTINGS.customSpeeches);
    settings.reminders = Array.isArray(data.reminders) ? data.reminders : [];
    settings.petJournal = settings.petJournal || structuredClone(DEFAULT_SETTINGS.petJournal);
    settings.petJournal.identityVersion = data.journalEntries?.identityVersion;
    settings.petJournal.dreams = data.journalEntries?.dreams || {};
    settings.petJournal.diaries = data.journalEntries?.diaries || {};
    settings.personality = settings.personality || structuredClone(DEFAULT_SETTINGS.personality);
    settings.personality.personalMemos = Array.isArray(data.personalMemos) ? data.personalMemos : [];
    settings.multiPet = settings.multiPet || structuredClone(DEFAULT_SETTINGS.multiPet);
    settings.multiPet.secondPetData = data.secondPetData || null;
    if (data.activeImages && typeof data.activeImages === "object") {
        settings.appearance = settings.appearance || structuredClone(DEFAULT_SETTINGS.appearance);
        settings.appearance.customSprites = data.activeImages.customSprites || {};
        settings.walk = settings.walk || structuredClone(DEFAULT_SETTINGS.walk);
        settings.walk.walkSprite = data.activeImages.walkSprite || null;
        settings.walk.walkSprite2 = data.activeImages.walkSprite2 || null;
    }
    if (data.house && typeof data.house === "object") {
        settings.house = data.house;
    }
}

function setStorageStatus(mode, error = "") {
    if (storageMode === mode && storageError === error) return;
    storageMode = mode;
    storageError = error;
    document.dispatchEvent(new CustomEvent("saipet-storage-status"));
}

export function getStorageStatus() {
    return { mode: storageMode, error: storageError, lastSavedAt, pending: Boolean(saveTimer) || saving };
}

export const BACKUP_CATEGORIES = Object.freeze([
    "presets", "activeSettings", "customSpeeches", "logs", "journals",
    "reminders", "memos", "house", "otherData",
]);

function requireConnectedStorage() {
    if (!serverConnected || state.storageBlocked) {
        throw new Error("서버 저장소가 연결되지 않았습니다. 연결 상태를 확인하고 새로고침하십시오.");
    }
    if (serverConflict) {
        throw new Error("다른 기기와 저장 내용이 충돌했습니다. 새로고침한 뒤 다시 시도하십시오.");
    }
}

function applyRestoredServerState(serverData, smallSettings) {
    if (serverData?.schemaVersion !== 1 || !Number.isSafeInteger(serverData.revision)
        || (serverData.data !== null && (!serverData.data || typeof serverData.data !== "object"
            || Array.isArray(serverData.data)))
        || !smallSettings || typeof smallSettings !== "object" || Array.isArray(smallSettings)) {
        throw new Error("복원 후 서버 데이터 확인에 실패했습니다.");
    }
    const runtime = fillDefaults(structuredClone(smallSettings), DEFAULT_SETTINGS);
    if (serverData.data) applyServerPayload(runtime, structuredClone(serverData.data));
    if (runtime.currentPresetId && !runtime.savedPresets?.some(preset => preset?.id === runtime.currentPresetId)) {
        runtime.currentPresetId = null;
    }
    const small = getSmallSettings(runtime);
    const previousSmall = extension_settings[EXTENSION_NAME];
    try {
        extension_settings[EXTENSION_NAME] = small;
        saveSettingsDebounced();
    } catch (error) {
        extension_settings[EXTENSION_NAME] = previousSmall;
        throw error;
    }
    Object.keys(state.settings).forEach(key => delete state.settings[key]);
    migrateCharacterHistory(runtime);
    upgradeReminders(runtime);
    Object.assign(state.settings, runtime);
    serverRevision = serverData.revision;
    lastServerData = structuredClone(serverData.data);
    lastServerJson = JSON.stringify(serverData.data);
    lastSmallJson = JSON.stringify(small);
    serverConflict = false;
    state.storageBlocked = false;
    setStorageStatus("server");
    document.dispatchEvent(new CustomEvent("saipet-storage-status"));
    document.dispatchEvent(new CustomEvent("stvp-log-updated"));
    document.dispatchEvent(new CustomEvent("stvp-journal-updated"));
    document.dispatchEvent(new CustomEvent("saipet-backup-restored"));
}

/** v1 reminders stored `repeat` instead of a weekday list. */
function upgradeReminders(settings) {
    for (const reminder of Array.isArray(settings?.reminders) ? settings.reminders : []) {
        if (!reminder || reminder.days || !reminder.repeat) continue;
        reminder.days = reminder.repeat === "daily" ? [0, 1, 2, 3, 4, 5, 6] : reminder.repeat === "weekdays" ? [1, 2, 3, 4, 5] : [];
        delete reminder.repeat;
    }
}

async function replaceLegacyImage(value, cache) {
    if (typeof value !== "string" || !value.startsWith("data:image/")) return value;
    if (cache.has(value)) return cache.get(value);
    const comma = value.indexOf(",");
    const labelled = value.slice(5, value.indexOf(";", 5)).toLowerCase();
    let bytes;
    try {
        bytes = Uint8Array.from(atob(value.slice(comma + 1)), c => c.charCodeAt(0));
    } catch {
        throw new Error("기존 이미지 데이터를 읽을 수 없습니다. 원본 설정은 유지했습니다.");
    }
    // v1 labelled uploads by file extension only; the store checks the real bytes.
    const mime = IMAGE_TYPES[sniffImageType(bytes)] || labelled;
    if (!Object.values(IMAGE_TYPES).includes(mime)) {
        throw new Error(`지원하지 않는 기존 이미지 형식: ${mime}. 원본 설정은 유지했습니다.`);
    }
    const source = mime === labelled ? value : `data:${mime};base64,${value.slice(comma + 1)}`;
    if (!cache.has(source)) {
        let optimized = source;
        // Static legacy/shared images use the same quality policy as new uploads.
        if (typeof Image !== "undefined" && typeof File !== "undefined" && mime !== "image/gif" && bytes.length <= 24 * 1024 * 1024) {
            optimized = await fileToBase64(new File([bytes], "sprite", { type: mime }));
        }
        try {
            cache.set(source, await uploadServerImage(optimized));
        } catch (error) {
            throw new Error(`기존 이미지를 사용자 파일로 옮기지 못했습니다 (${error.message || error}). 해당 이미지를 바꾸거나 지운 뒤 새로고침하십시오. 원본 설정은 유지했습니다.`, { cause: error });
        }
    }
    cache.set(value, cache.get(source));
    return cache.get(value);
}

async function moveSpriteImages(owner, cache) {
    if (!owner || typeof owner !== "object") return;
    const sprites = owner.appearance?.customSprites;
    if (sprites && typeof sprites === "object") {
        for (const mood of Object.keys(sprites)) {
            sprites[mood] = await replaceLegacyImage(sprites[mood], cache);
        }
    }
    if (owner.walk) for (const key of ["walkSprite", "walkSprite2"]) {
        if (owner.walk[key] != null) owner.walk[key] = await replaceLegacyImage(owner.walk[key], cache);
    }
}

async function moveAllLegacyImages(settings) {
    const cache = new Map();
    await moveSpriteImages(settings, cache);
    for (const preset of settings.savedPresets || []) await moveSpriteImages(preset, cache);
    await moveSpriteImages(settings.multiPet?.secondPetData, cache);
    if (settings.house && typeof settings.house === "object") {
        settings.house.wallpaper = await replaceLegacyImage(settings.house.wallpaper, cache);
        settings.house.floor = await replaceLegacyImage(settings.house.floor, cache);
        if (Array.isArray(settings.house.furniture)) {
            for (const item of settings.house.furniture) {
                if (item && typeof item === "object" && "image" in item) {
                    item.image = await replaceLegacyImage(item.image, cache);
                }
            }
        }
    }
    return cache.size > 0;
}

/** Initialize server data before creating the UI. Legacy settings remain intact on failure. */
export async function initializeStorage(legacySettings) {
    state.settings = legacySettings;
    let serverWriteCommitted = false;
    let serverDataObserved = false;
    try {
        const response = await getServerData();
        if (!response || response.schemaVersion !== 1 || !Number.isInteger(response.revision)) {
            throw new Error("SaiPet 저장 파일 응답이 올바르지 않습니다.");
        }

        // An install that still runs the retired server plugin keeps its records: the
        // first start without data in user files copies them over, once.
        let pluginImport = null;
        if (!response.data) {
            pluginImport = await importPluginData();
            if (pluginImport) response.data = pluginImport.data;
        }

        const runtime = structuredClone(legacySettings);
        const hasRemoteData = response.data && typeof response.data === "object";
        const needsActiveImageMigration = hasRemoteData && !Object.hasOwn(response.data, "activeImages");
        const needsHouseMigration = hasRemoteData && !Object.hasOwn(response.data, "house");
        serverDataObserved = Boolean(hasRemoteData);
        if (hasRemoteData) applyServerPayload(runtime, structuredClone(response.data));
        const movedImages = await moveAllLegacyImages(runtime);
        let revision = response.revision;
        let savedData = hasRemoteData ? response.data : null;
        let needsLegacyPresetMerge = false;

        // A pre-migration browser tab may still hold full settings while another
        // device has already migrated. Never silently discard either copy.
        if (hasRemoteData && legacySettings?._storageVersion !== 1) {
            const emptyLegacy = stableJson(getServerPayload(legacySettings)) === stableJson(getServerPayload(DEFAULT_SETTINGS));
            const legacy = structuredClone(legacySettings);
            await moveAllLegacyImages(legacy);
            migrateCharacterHistory(legacy);
            migrateCharacterHistory(runtime);
            const { savedPresets: oldPresets, ...oldOther } = getServerPayload(legacy);
            const { savedPresets: remotePresets, ...remoteOther } = getServerPayload(runtime);
            if (!emptyLegacy && stableJson(oldOther) !== stableJson(remoteOther)) {
                throw new Error("다른 기기에서 먼저 이전한 기록과 현재 설정이 다릅니다. 현재 데이터를 백업한 뒤 새로고침하십시오.");
            }
            const remoteById = new Map(remotePresets.map(preset => [preset?.id, preset]));
            for (const preset of oldPresets) {
                if (!preset?.id) throw new Error("이전 프리셋의 ID가 없어 자동 이전할 수 없습니다.");
                if (remoteById.has(preset.id)) {
                    if (stableJson(remoteById.get(preset.id)) !== stableJson(preset)) {
                        throw new Error("두 기기에서 같은 프리셋을 다르게 수정했습니다. 현재 데이터를 백업한 뒤 새로고침하십시오.");
                    }
                } else {
                    runtime.savedPresets.push(preset);
                    remoteById.set(preset.id, preset);
                    needsLegacyPresetMerge = true;
                }
            }
        }

        // The first write of upgraded v1 data must already carry stable record identities.
        migrateCharacterHistory(runtime);
        upgradeReminders(runtime);
        if (!hasRemoteData || pluginImport || movedImages || needsActiveImageMigration || needsHouseMigration || needsLegacyPresetMerge) {
            let data = getServerPayload(runtime);
            let result;
            try {
                result = await putServerData(data, revision);
            } catch (error) {
                if (error.status !== 409) throw error;
                serverDataObserved = true;
                const latest = await getServerData();
                data = mergeServerData(hasRemoteData ? response.data : {}, data, latest.data || {});
                result = await putServerData(data, latest.revision);
                applyServerPayload(runtime, structuredClone(data));
            }
            serverWriteCommitted = true;
            revision = result.revision;
            const check = await getServerData();
            if (check.revision < revision || !check.data ||
                (check.revision === revision && JSON.stringify(check.data) !== JSON.stringify(data))) {
                throw new Error("새 저장 파일 확인에 실패했습니다. 기존 설정은 유지했습니다.");
            }
            // A later successful write may have landed between PUT and GET.
            // Use the latest revision instead of treating it as failed migration.
            revision = check.revision;
            savedData = check.data;
            applyServerPayload(runtime, structuredClone(savedData));
        }

        migrateCharacterHistory(runtime);
        state.settings = runtime;
        state.storageBlocked = false;
        serverConnected = true;
        serverRevision = revision;
        lastServerJson = JSON.stringify(savedData);
        lastServerData = structuredClone(savedData);
        serverConflict = false;
        const small = getSmallSettings(runtime);
        lastSmallJson = JSON.stringify(small);
        extension_settings[EXTENSION_NAME] = small;
        saveSettingsDebounced();
        setStorageStatus("server", pluginImport ? `이전 저장 플러그인의 기록을 실리태번 사용자 파일로 옮겼습니다 (이미지 ${pluginImport.imageCount}개). 플러그인은 이제 지워도 됩니다.` : "");
    } catch (error) {
        state.settings = legacySettings;
        upgradeReminders(legacySettings);
        serverConnected = false;
        state.storageBlocked = legacySettings?._storageVersion === 1 || serverWriteCommitted || serverDataObserved;
        setStorageStatus(state.storageBlocked ? "blocked" : "legacy", error?.message || String(error));
    }
}

function queueServerSave() {
    if (!serverConnected || serverConflict) return;
    if (saveTimer) clearTimeout(saveTimer);
    const wasIdle = !saveTimer && !saving;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        flushServerData().catch(() => {});
    }, 650);
    if (wasIdle) document.dispatchEvent(new CustomEvent("saipet-storage-saved"));
}

export async function retryServerSave() {
    if (serverConflict) throw new Error("두 기기의 저장 내용이 충돌했습니다. 현재 데이터를 백업한 뒤 새로고침하십시오.");
    if (!serverConnected) throw new Error("저장 공간이 연결되지 않았습니다. 실리태번 연결을 확인하고 새로고침하십시오.");
    await flushServerData();
    state.storageBlocked = false;
    setStorageStatus("server");
    const { activatePet } = await import("../index.js");
    activatePet();
}

/** Wait for any pending server write. Used for important operations such as reset. */
export function flushServerData() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    if (!serverConnected || serverConflict) {
        return Promise.resolve();
    }
    saveChain = saveChain.catch(() => {}).then(async () => {
        const json = JSON.stringify(getServerPayload());
        if (json === lastServerJson) return;
        saving = true;
        try {
            const localData = JSON.parse(json);
            const { result, savedData, merged } = await putWithRetry(localData);
            if (merged) {
                // Keep edits made during the network request as well as remote edits.
                const currentData = JSON.parse(JSON.stringify(getServerPayload()));
                const updatedRuntimeData = mergeServerData(localData, currentData, savedData);
                applyServerPayload(state.settings, structuredClone(updatedRuntimeData));
                for (const name of ["stvp-log-updated", "stvp-journal-updated", "saipet-data-merged"]) document.dispatchEvent(new CustomEvent(name));
            }
            serverRevision = result.revision;
            // `localData` was parsed from `json` and is never shared, so an unmerged save reuses both.
            lastServerData = merged ? structuredClone(savedData) : savedData;
            lastServerJson = merged ? JSON.stringify(savedData) : json;
            lastSavedAt = Date.now();
            saving = false;
            setStorageStatus("server");
            document.dispatchEvent(new CustomEvent("saipet-storage-saved"));
            // Edits made through saveSettings during the request already queued the next save.
            if (merged && JSON.stringify(getServerPayload()) !== lastServerJson) queueServerSave();
        } catch (error) {
            saving = false;
            if (error.status === 409 || error.mergeConflict) serverConflict = true;
            state.storageBlocked = true;
            setStorageStatus(serverConflict ? "conflict" : "error", error?.message || String(error));
            const { deactivatePet } = await import("../index.js");
            deactivatePet();
            throw error;
        }
    });
    return saveChain;
}

const RETRY_DELAYS = [1000, 3000, 8000];
const MERGE_ATTEMPTS = 3;
const isTransient = error => !error.mergeConflict && (error instanceof TypeError
    || ["TimeoutError", "AbortError"].includes(error.name) || error.status >= 500 || [408, 429].includes(error.status));

async function putWithRetry(localData) {
    for (let attempt = 0; ; attempt++) {
        try {
            try {
                return { result: await putServerData(localData, serverRevision), savedData: localData, merged: false };
            } catch (error) {
                if (error.status !== 409) throw error;
            }
            for (let merge = 1; ; merge++) {
                const latest = await getServerData();
                let savedData;
                try {
                    savedData = mergeServerData(lastServerData, localData, latest.data);
                } catch (error) {
                    error.mergeConflict = true;
                    throw error;
                }
                try {
                    return { result: await putServerData(savedData, latest.revision), savedData, merged: true };
                } catch (error) {
                    if (error.status !== 409 || merge >= MERGE_ATTEMPTS) throw error;
                }
            }
        } catch (error) {
            if (!isTransient(error) || attempt >= RETRY_DELAYS.length) throw error;
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
        }
    }
}

/** Unsaved data in the same shape as a backup, so the Data tab can restore it after a reload. */
export function emergencyBackup() {
    const data = structuredClone(getServerPayload());
    const smallSettings = structuredClone(getSmallSettings());
    const images = {};
    for (const id of collectImageReferences({ data, smallSettings })) images[id] = { stored: true };
    return {
        kind: "saipet-backup", version: 1, createdAt: new Date().toISOString(),
        categories: [...BACKUP_CATEGORIES], data, smallSettings, imageFiles: true, images,
    };
}

/** Private backup file: unlike a shared preset it can contain logs and memos. */
export async function createBackup(categories = BACKUP_CATEGORIES) {
    requireConnectedStorage();
    await flushServerData();
    return exportServerBackup(categories, getSmallSettings());
}

/** Inspect an imported backup without changing current settings. */
export async function previewBackup(archive, categories, mode = "merge") {
    requireConnectedStorage();
    await flushServerData();
    return previewServerBackup(archive, categories, mode, getSmallSettings());
}

async function runRestore(operation, smallSettingsForResult) {
    requireConnectedStorage();
    await flushServerData();
    const previousSmall = structuredClone(getSmallSettings());
    const { deactivatePet, activatePet } = await import("../index.js");
    const resumePet = () => {
        try {
            activatePet();
        } catch (error) {
            setStorageStatus("server", `데이터 복원은 완료됐지만 펫 화면을 다시 표시하지 못했습니다: ${error.message || error}`);
        }
    };
    deactivatePet();
    state.storageBlocked = true;
    let committed = null;
    try {
        committed = await operation(previousSmall);
        const latest = await getServerData();
        if (latest?.revision !== committed?.revision) {
            throw new Error("복원 직후 다른 기기에서 저장되어 화면 데이터를 확인할 수 없습니다.");
        }
        const restoredSmall = smallSettingsForResult(committed, previousSmall);
        applyRestoredServerState(latest, restoredSmall);
        resumePet();
        return { ...committed, revision: latest.revision };
    } catch (error) {
        if (!committed) {
            state.storageBlocked = false;
            resumePet();
            throw error;
        }
        let rollbackError = null;
        try {
            if (!committed.recoveryId) throw new Error("복원 전 상태의 ID가 없습니다.");
            const rollback = await restoreServerHistorySnapshot(
                committed.recoveryId, committed.revision, previousSmall,
            );
            const restored = await getServerData();
            if (restored?.revision !== rollback.revision) {
                throw new Error("되돌리기 후 서버 버전이 바뀌었습니다.");
            }
            applyRestoredServerState(restored, rollback.smallSettings || previousSmall);
            resumePet();
        } catch (cause) {
            rollbackError = cause;
        }
        if (!rollbackError) {
            throw new Error(`복원 화면 적용에 실패하여 이전 상태로 되돌렸습니다: ${error.message || error}`);
        }
        state.storageBlocked = true;
        setStorageStatus("blocked",
            `복원은 서버에 기록되었지만 화면 적용과 자동 되돌리기에 실패했습니다. 새로고침 후 백업 복원 기록을 확인하십시오. 원인: ${error.message || error}; 되돌리기: ${rollbackError.message || rollbackError}`);
        throw new Error(storageError);
    }
}

/** Restore only selected categories. Use the revision returned by previewBackup. */
export function restoreBackup(archive, categories, mode, revision) {
    return runRestore(
        currentSmall => restoreServerBackup(archive, categories, mode, revision, currentSmall),
        (result, currentSmall) => categories.includes("activeSettings")
            ? result.smallSettings : currentSmall,
    );
}

export async function listRestoreHistory() {
    requireConnectedStorage();
    return listServerRestoreHistory();
}

export async function getCurrentServerRevision() {
    requireConnectedStorage();
    await flushServerData();
    return serverRevision;
}

/** Return to a state recorded automatically just before an earlier restore. */
export function restoreHistory(id, revision) {
    return runRestore(
        currentSmall => restoreServerHistorySnapshot(id, revision, currentSmall),
        (result, currentSmall) => result.smallSettings || currentSmall,
    );
}

export async function listUnusedImages() {
    requireConnectedStorage();
    await flushServerData();
    return previewUnusedServerImages();
}

export async function cleanupUnusedImages(ids, revision) {
    requireConnectedStorage();
    await flushServerData();
    return cleanupUnusedServerImages(revision, ids);
}

export async function listImageTrash() {
    requireConnectedStorage();
    return listTrashedServerImages();
}

export async function restoreImagesFromTrash(ids) {
    requireConnectedStorage();
    return restoreTrashedServerImages(ids);
}

export async function purgeImageTrash(ids) {
    requireConnectedStorage();
    return purgeTrashedServerImages(ids);
}

/** Upload a sprite once and keep only its short server URL in settings. */
export async function saveImageFile(file, maxSize = 1024, quality = 0.92) {
    const dataUrl = await fileToBase64(file, maxSize, quality);
    return serverConnected ? uploadServerImage(dataUrl) : dataUrl;
}

export function saveSettings() {
    if (state.storageBlocked) return;
    if (serverConnected) {
        const small = getSmallSettings(state.settings);
        const json = JSON.stringify(small);
        if (json !== lastSmallJson) {
            lastSmallJson = json;
            extension_settings[EXTENSION_NAME] = small;
            saveSettingsDebounced();
        }
    } else {
        extension_settings[EXTENSION_NAME] = state.settings;
        saveSettingsDebounced();
    }
    queueServerSave();
}

/** OFF must remain usable even when server storage has paused ordinary edits. */
export function setMasterEnabled(enabled) {
    state.settings.enabled = Boolean(enabled);
    if (state.storageBlocked) {
        // Keep the existing legacy or compact settings intact; change only the switch.
        const stored = extension_settings[EXTENSION_NAME];
        if (stored && typeof stored === "object") {
            stored.enabled = state.settings.enabled;
            saveSettingsDebounced();
        }
        return;
    }
    saveSettings();
}

/** Static images are downscaled to `maxSize` and 4 MB; GIF and animated WebP keep their bytes. */
export function fileToBase64(file, maxSize = 1024, quality = 0.92) {
    const maxOutputBytes = 4 * 1024 * 1024;
    const maxAnimatedBytes = 12 * 1024 * 1024;
    const readDataUrl = () => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
    const keepAnimation = kind => file.size > maxAnimatedBytes
        ? Promise.reject(new Error(`${kind} 애니메이션은 움직임 보존을 위해 12MB 이하만 직접 등록할 수 있습니다. 더 큰 파일은 이미지 URL을 사용하십시오.`))
        : readDataUrl();
    if (file.size > 24 * 1024 * 1024) {
        return Promise.reject(new Error("이미지 원본은 24MB 이하로 올려 주십시오. 큰 애니메이션은 이미지 URL 등록도 가능합니다."));
    }
    if (!file.type.startsWith("image/")) return readDataUrl();
    if (file.type === "image/gif") return keepAnimation("GIF");
    if (file.type === "image/webp") {
        return file.slice(0, 32).arrayBuffer().then(buffer => {
            const header = new Uint8Array(buffer);
            const marker = (offset, text) => [...text].every((char, index) => header[offset + index] === char.charCodeAt(0));
            const animated = marker(0, "RIFF") && marker(8, "WEBP") && marker(12, "VP8X") && Boolean(header[20] & 0x02);
            return animated ? keepAnimation("WebP") : readStaticImage();
        });
    }
    return readStaticImage();

    function readStaticImage() {
        return readDataUrl().then(source => new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                // An already compact original is kept as-is, so its quality is untouched.
                if (Math.max(img.width, img.height) <= maxSize && file.size <= maxOutputBytes) {
                    resolve(source);
                    return;
                }
                const canvas = document.createElement("canvas");
                const context = canvas.getContext("2d");
                if (!context) {
                    reject(new Error("브라우저에서 이미지 크기를 조정할 수 없습니다."));
                    return;
                }
                let longest = Math.min(Math.max(img.width, img.height), maxSize);
                for (let scale = 0; scale < 5; scale++) {
                    const ratio = longest / Math.max(img.width, img.height);
                    canvas.width = Math.max(1, Math.round(img.width * ratio));
                    canvas.height = Math.max(1, Math.round(img.height * ratio));
                    context.clearRect(0, 0, canvas.width, canvas.height);
                    context.drawImage(img, 0, 0, canvas.width, canvas.height);
                    // PNG first; when too large, WebP keeps the transparency.
                    const formats = file.type === "image/png"
                        ? [["image/png", 1], ["image/webp", quality], ["image/webp", 0.85]]
                        : file.type === "image/webp"
                            ? [["image/webp", quality], ["image/webp", 0.85], ["image/webp", 0.75]]
                            : [["image/jpeg", quality], ["image/jpeg", 0.85], ["image/jpeg", 0.75]];
                    for (const [format, compression] of formats) {
                        const result = canvas.toDataURL(format, compression);
                        if (result.startsWith(`data:${format};`) && (result.length * 3 / 4) <= maxOutputBytes) {
                            resolve(result);
                            return;
                        }
                    }
                    longest = Math.max(320, Math.floor(longest * 0.8));
                }
                reject(new Error("이미지를 4MB 이하로 줄일 수 없습니다. 더 작은 파일이나 이미지 URL을 사용하십시오."));
            };
            img.onerror = reject;
            img.src = source;
        }));
    }
}

/** Get a slot's editable character. Global runtime settings always stay at the root. */
export function getCharacterSettings(petId = "primary") {
    if (petId !== "secondary") return state.settings;
    state.settings.multiPet ||= structuredClone(DEFAULT_SETTINGS.multiPet);
    if (!state.settings.multiPet.secondPetData) {
        state.settings.multiPet.secondPetData = {
            ...characterPresetData(DEFAULT_SETTINGS),
            characterId: newPresetId(),
        };
        state.settings.multiPet.secondPetData.personality.name = "새 캐릭터";
    }
    const pet = state.settings.multiPet.secondPetData;
    for (const key of ["appearance", "personality", "customSpeeches", "fallbackMessages", "walk", "speechBubble"]) {
        pet[key] = fillDefaults(pet[key] || {}, DEFAULT_SETTINGS[key]);
    }
    return pet;
}

export function currentPresetId(petId = "primary") {
    return petId === "secondary" ? state.settings.multiPet?.secondPetPresetId : state.settings.currentPresetId;
}

/** Only character fields belong to a preset, including when reading legacy files. */
export function characterPresetData(source) {
    const result = {};
    for (const key of ["appearance", "personality", "customSpeeches", "fallbackMessages", "walk", "speechBubble"]) {
        result[key] = fillDefaults(structuredClone(source[key] || {}), DEFAULT_SETTINGS[key]);
    }
    delete result.appearance.size;
    delete result.appearance.opacity;
    delete result.personality.enabled;
    delete result.walk.enabled;
    delete result.speechBubble.enabled;
    delete result.speechBubble.duration;
    delete result.speechBubble.maxWidth;
    return result;
}

export function hasPresetChanges(petId = "primary") {
    const preset = state.settings.savedPresets?.find(p => p.id === currentPresetId(petId));
    return Boolean(preset && stableJson(characterPresetData(preset)) !== stableJson(characterPresetData(getCharacterSettings(petId))));
}

function newPresetId() {
    const suffix = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
    return `preset_${Date.now()}_${suffix}`;
}

function pairKey() {
    if (!state.settings.multiPet?.secondPetData) return null;
    return JSON.stringify([characterId(state.settings), characterId(state.settings, "secondary")].sort());
}

function pairValues() {
    const mp = state.settings.multiPet || {};
    return {
        visualRelation: mp.visualRelation || "friends",
        visualInteractions: mp.visualInteractions !== false,
        petRelation: mp.petRelation || "",
        dualDirectTalk: Boolean(mp.dualDirectTalk),
        interPetChat: structuredClone(mp.interPetChat || { enabled: false, interval: 5 }),
    };
}

export function rememberPairSettings() {
    const key = pairKey();
    if (!key) return;
    state.settings.pairRelationships ||= {};
    state.settings.pairRelationships[key] = pairValues();
}

export function restorePairSettings() {
    const key = pairKey();
    if (!key) return;
    state.settings.pairRelationships ||= {};
    // First upgrade: preserve the currently selected pair's existing relationship.
    if (!state.settings.pairSettingsVersion) {
        if (!Object.hasOwn(state.settings.pairRelationships, key)) rememberPairSettings();
        state.settings.pairSettingsVersion = 1;
    }
    const saved = state.settings.pairRelationships[key];
    const defaults = DEFAULT_SETTINGS.multiPet;
    Object.assign(state.settings.multiPet, saved ? structuredClone(saved) : {
        visualRelation: defaults.visualRelation || "friends", visualInteractions: defaults.visualInteractions !== false,
        petRelation: "", dualDirectTalk: false, interPetChat: { enabled: false, interval: 5 },
    });
}

function setCharacterPreset(preset, petId, id) {
    const pet = getCharacterSettings(petId);
    const next = characterPresetData(preset);
    for (const key of ["ownerName", "ownerPersona", "personalMemos"]) {
        if (!Object.hasOwn(preset.personality || {}, key)) next.personality[key] = structuredClone(pet.personality[key] ?? DEFAULT_SETTINGS.personality[key]);
    }
    // Preserve shared controls, even for old presets containing those fields.
    next.appearance.size = pet.appearance.size ?? state.settings.appearance.size;
    next.appearance.opacity = pet.appearance.opacity ?? state.settings.appearance.opacity;
    next.personality.enabled = pet.personality.enabled ?? state.settings.personality.enabled;
    next.walk.enabled = pet.walk.enabled ?? state.settings.walk.enabled;
    next.speechBubble.enabled = pet.speechBubble.enabled ?? state.settings.speechBubble.enabled;
    next.speechBubble.duration = pet.speechBubble.duration ?? state.settings.speechBubble.duration;
    next.speechBubble.maxWidth = state.settings.speechBubble.maxWidth ?? DEFAULT_SETTINGS.speechBubble.maxWidth;
    // The same character loaded into both slots becomes a separate copy, so the pet already on screen keeps its memory.
    const other = petId === "secondary" ? characterId(state.settings) : state.settings.multiPet?.secondPetData && characterId(state.settings, "secondary");
    Object.assign(pet, next, { characterId: other === "pet:" + id ? `${id}#${petId}` : id });
    if (petId === "secondary") state.settings.multiPet.secondPetPresetId = preset.id || null;
    else state.settings.currentPresetId = preset.id || null;
}

export function savePreset(name, petId = "primary") {
    restorePairSettings(); rememberPairSettings();
    const presetId = newPresetId();
    const pet = getCharacterSettings(petId);
    const preset = { id: presetId, name, createdAt: new Date().toISOString(), ...characterPresetData(pet) };
    state.settings.savedPresets ||= [];
    state.settings.savedPresets.push(preset);
    pet.characterId = presetId;
    if (petId === "secondary") state.settings.multiPet.secondPetPresetId = presetId;
    else state.settings.currentPresetId = presetId;
    rememberPairSettings();
    saveSettings();
    return presetId;
}

export function loadPreset(presetId, petId = "primary") {
    const preset = state.settings.savedPresets?.find(p => p.id === presetId);
    if (!preset) return false;
    validatePreset(preset);
    restorePairSettings(); rememberPairSettings();
    setCharacterPreset(preset, petId, preset.id);
    restorePairSettings();
    saveSettings();
    return true;
}

export function deletePreset(presetId) {
    if (!state.settings.savedPresets) {
        return false;
    }

    const index = state.settings.savedPresets.findIndex(p => p.id === presetId);

    if (index === -1) {
        return false;
    }

    state.settings.savedPresets.splice(index, 1);

    if (state.settings.currentPresetId === presetId) {
        state.settings.currentPresetId = null;
    }

    if (state.settings.multiPet?.secondPetPresetId === presetId) state.settings.multiPet.secondPetPresetId = null;
    saveSettings();
    return true;
}

export function updatePreset(presetId, petId = "primary") {
    const preset = state.settings.savedPresets?.find(p => p.id === presetId);
    if (!preset) return false;
    Object.assign(preset, characterPresetData(getCharacterSettings(petId)), { updatedAt: new Date().toISOString() });
    // The other active slot is an independent copy. Saving a preset never overwrites it.
    saveSettings();
    return true;
}

const byName = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });

export function getPresetList() {
    return [...(state.settings.savedPresets || [])].sort((a, b) => byName.compare(String(a.name || ""), String(b.name || "")));
}

function stripUserInfo(personality) {
    const { name, prompt, enabled, userRelation } = personality;
    return structuredClone({ name, prompt, enabled, userRelation });
}

export async function exportPreset(presetId, format = "json", petId = "primary") {
    const current = getCharacterSettings(petId);
    let exportData;
    let fileName;

    if (presetId) {
        const preset = state.settings.savedPresets?.find(p => p.id === presetId);
        if (!preset) return false;
        exportData = {
            _type: "SaiPet-Preset",
            _version: 1,
            preset: {
                name: preset.name,
                createdAt: preset.createdAt,
                appearance: structuredClone(preset.appearance),
                personality: stripUserInfo(preset.personality),
                customSpeeches: structuredClone(preset.customSpeeches),
                fallbackMessages: structuredClone(preset.fallbackMessages || {}),
                walk: { walkSprite: preset.walk?.walkSprite || null, walkSprite2: preset.walk?.walkSprite2 || null, animationMode: preset.walk?.animationMode || "motion" },
                speechBubble: structuredClone(preset.speechBubble || current.speechBubble),
            },
        };
        fileName = `saipet-preset-${String(preset.name || "preset").replace(/[^a-zA-Z0-9\u3131-\uD79D]/g, "_")}.json`;
    } else {
        exportData = {
            _type: "SaiPet-Preset",
            _version: 1,
            preset: {
                name: current.personality.name || "Custom",
                createdAt: new Date().toISOString(),
                appearance: structuredClone(current.appearance),
                personality: stripUserInfo(current.personality),
                customSpeeches: structuredClone(current.customSpeeches),
                fallbackMessages: structuredClone(current.fallbackMessages || {}),
                walk: { walkSprite: current.walk?.walkSprite || null, walkSprite2: current.walk?.walkSprite2 || null, animationMode: current.walk?.animationMode || "motion" },
                speechBubble: structuredClone(current.speechBubble),
            },
        };
        fileName = `saipet-preset-${current.personality.name || "custom"}.json`;
    }

    Object.assign(exportData.preset, characterPresetData(exportData.preset));
    exportData.preset.personality = stripUserInfo(exportData.preset.personality);

    // Keep exported presets portable: embed server images in the downloaded file.
    const images = exportData.preset.appearance?.customSprites || {};
    for (const mood of Object.keys(images)) {
        images[mood] = await readServerImageAsDataUrl(images[mood]);
    }
    if (exportData.preset.walk) {
        for (const key of ["walkSprite", "walkSprite2"]) exportData.preset.walk[key] = await readServerImageAsDataUrl(exportData.preset.walk[key]);
    }

    if (format === "zip") {
        const { presetZip, downloadBlob } = await import("./portable-files.js");
        const bundle = await presetZip(exportData);
        if (bundle.size > SHARED_FILE_LIMIT) throw new Error("공유 파일이 96MB를 넘습니다.");
        downloadBlob(bundle, fileName.replace(/\.json$/, ".zip"));
        return true;
    }
    const blob = new Blob([JSON.stringify(exportData)], { type: "application/json" });
    if (blob.size > SHARED_FILE_LIMIT) throw new Error("공유 파일이 96MB를 넘습니다. 이미지 용량을 줄여 주십시오.");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    return true;
}

const PRESET_FIELDS = ["appearance", "personality", "customSpeeches", "fallbackMessages", "walk", "speechBubble"];
function readPresetFile(file) {
    if (file.name?.toLowerCase().endsWith(".zip")) {
        return import("./portable-files.js").then(module => module.readPortableFile(file));
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = event => { try { resolve(JSON.parse(event.target.result)); } catch (error) { reject(error); } };
        reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
        reader.readAsText(file);
    });
}

export async function importPreset(file) {
    try {
        if (file.size > SHARED_FILE_LIMIT) throw new Error("공유 파일은 96MB 이하로 불러올 수 있습니다.");
        const data = await readPresetFile(file);
        const source = data?.preset;
        if ((data?._type !== "SaiPet-Preset" && data?._type !== "ST-Virtual-Pet-Preset")
            || !isObject(source) || !isObject(source.appearance)
            || !isObject(source.personality) || !isObject(source.customSpeeches)) {
            alert("유효하지 않은 프리셋 파일입니다.");
            return false;
        }
        try { rejectUnsafeKeys(source); } catch { throw new Error("허용하지 않는 데이터 항목이 있습니다."); }
        validatePreset(source);
        const preset = {
            id: newPresetId(),
            name: String(source.name || source.personality.name || "가져온 프리셋"),
            ...(source.createdAt ? { createdAt: source.createdAt } : {}),
            importedAt: new Date().toISOString(),
        };
        for (const key of PRESET_FIELDS) if (isObject(source[key])) preset[key] = structuredClone(source[key]);
        const current = state.settings.personality;
        preset.personality.ownerName ||= current.ownerName || "";
        preset.personality.ownerPersona ||= current.ownerPersona || "";
        preset.personality.personalMemos ||= structuredClone(current.personalMemos || []);
        preset.fallbackMessages ||= {};
        preset.walk ||= { walkSprite: null };
        delete preset.walk.enabled;
        preset.speechBubble ||= structuredClone(state.settings.speechBubble);

        // Old portable JSON contains Base64 images. Store them on ST first.
        if (serverConnected) await moveSpriteImages(preset, new Map());
        (state.settings.savedPresets ||= []).push(preset);
        try {
            saveSettings();
            if (serverConnected) await flushServerData();
        } catch (error) {
            const index = state.settings.savedPresets.indexOf(preset);
            if (index >= 0) state.settings.savedPresets.splice(index, 1);
            throw error;
        }
        return true;
    } catch (error) {
        alert("프리셋 가져오기 또는 저장 실패: " + error.message);
        return false;
    }
}

export function resetToDefaultMiyu(petId = "primary") {
    restorePairSettings(); rememberPairSettings();
    const preset = characterPresetData(DEFAULT_SETTINGS);
    preset.personality.prompt = DEFAULT_PERSONALITY_PROMPT;
    const pet = getCharacterSettings(petId);
    for (const key of ["ownerName", "ownerPersona", "personalMemos"]) preset.personality[key] = structuredClone(pet.personality[key]);
    setCharacterPreset(preset, petId, "default");
    restorePairSettings();
    saveSettings();
}

export async function resetAllSettings(scope = "all") {
    if (serverConflict) throw new Error("다른 기기와 저장 충돌이 발생했습니다. 새로고침 후 다시 시도하십시오.");
    const { activatePet, deactivatePet } = await import("../index.js");
    deactivatePet();
    const previousSettings = structuredClone(state.settings);
    const freshSettings = settingsAfterReset(previousSettings, DEFAULT_SETTINGS, scope);

    Object.keys(state.settings).forEach(key => delete state.settings[key]);
    Object.assign(state.settings, freshSettings);

    try {
        if (serverConnected) await flushServerData();
        saveSettings();
        activatePet();
    } catch (error) {
        Object.keys(state.settings).forEach(key => delete state.settings[key]);
        Object.assign(state.settings, previousSettings);
        activatePet();
        throw error;
    }
}

export async function checkRemoteUpdates() {
    if (!serverConnected || state.storageBlocked || Date.now() - lastRemoteCheck < 15000) return;
    lastRemoteCheck = Date.now();
    try {
        const revision = await getServerRevision();
        if (revision !== serverRevision) setStorageStatus("server", "다른 기기에서 저장 내용이 바뀌었습니다. 현재 수정은 저장 충돌 검사를 거치며, 새로고침하면 최신 내용을 불러옵니다.");
    } catch { /* A focus check never blocks ordinary edits. */ }
}
