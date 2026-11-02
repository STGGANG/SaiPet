/** Binds the file store to this SillyTavern server; everything else lives in the browser modules. */
import { getRequestHeaders } from "../../../../../script.js";
import { configureFileApi } from "./file-api.js";

configureFileApi({ headers: getRequestHeaders });

export { parseImageUrl, imageUrl, collectImageReferences } from "./file-api.js";
export {
    getServerData, getServerRevision, putServerData, uploadServerImage, readServerImageAsDataUrl,
    previewUnusedServerImages, cleanupUnusedServerImages, listTrashedServerImages,
    restoreTrashedServerImages, purgeTrashedServerImages, getServerUsage,
} from "./file-store.js";
export {
    exportServerBackup, previewServerBackup, restoreServerBackup, listServerRestoreHistory, restoreServerHistorySnapshot,
} from "./file-backup.js";
export { importPluginData } from "./file-migration.js";
