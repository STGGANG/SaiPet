/** ZIP keeps each image once, without changing its pixels. External URLs stay URLs. */
import { uploadServerImage, parseImageUrl, imageUrl, collectImageReferences } from "./server-storage.js";
const pendingImages = new WeakMap();
const parsedFiles = new WeakMap();
let zipPromise;
async function zipLibrary() {
    zipPromise ||= import("/lib/jszip.min.js").then(() => {
        if (!globalThis.JSZip) throw new Error("실리태번의 ZIP 라이브러리를 불러올 수 없습니다.");
        return globalThis.JSZip;
    });
    return zipPromise;
}
const mimeExtension = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
function fromDataUrl(value) {
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([\s\S]+)$/.exec(value);
    if (!match) throw new Error("지원하지 않는 이미지 형식입니다.");
    return { mime: match[1], bytes: Uint8Array.from(atob(match[2]), c => c.charCodeAt(0)) };
}
async function asDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
export async function presetZip(data) {
    const JSZip = await zipLibrary(), zip = new JSZip(), files = new Map();
    function visit(value) {
        if (typeof value === "string" && value.startsWith("data:image/")) {
            if (!files.has(value)) {
                const { mime, bytes } = fromDataUrl(value);
                const name = "images/" + files.size + "." + mimeExtension[mime];
                zip.file(name, bytes); files.set(value, "saipet-file:" + name);
            }
            return files.get(value);
        }
        if (Array.isArray(value)) return value.map(visit);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visit(v)]));
        return value;
    }
    zip.file("preset.json", JSON.stringify(visit(data)));
    return zip.generateAsync({ type: "blob", compression: "STORE" });
}
export async function backupZip(archive) {
    const JSZip = await zipLibrary(), zip = new JSZip(), manifest = structuredClone(archive);
    manifest.imageFiles = true; manifest.images = {};
    for (const [id, image] of Object.entries(archive.images || {})) {
        let bytes, mime;
        if (typeof image === "string") ({ bytes, mime } = fromDataUrl(image));
        else {
            mime = image.mime;
            if (!mimeExtension[mime]) throw new Error("지원하지 않는 백업 이미지입니다.");
            const response = await fetch(imageUrl(id, mimeExtension[mime]), { credentials: "same-origin", cache: "no-cache", signal: AbortSignal.timeout(120000) });
            if (!response.ok) throw new Error("백업 이미지 읽기 실패: " + response.status);
            bytes = new Uint8Array(await response.arrayBuffer());
        }
        const name = "images/" + id + "." + mimeExtension[mime];
        zip.file(name, bytes); manifest.images[id] = { file: name, mime };
    }
    zip.file("backup.json", JSON.stringify(manifest));
    return zip.generateAsync({ type: "blob", compression: "STORE" });
}
export function readPortableFile(file, kind = "preset") {
    let reads = parsedFiles.get(file);
    if (!reads) { reads = new Map(); parsedFiles.set(file, reads); }
    if (!reads.has(kind)) reads.set(kind, parsePortableFile(file, kind));
    return reads.get(kind);
}
async function parsePortableFile(file, kind) {
    const limit = kind === "backup" ? 600 * 1024 * 1024 : 96 * 1024 * 1024;
    if (file.size > limit) throw new Error("파일 용량이 허용 범위를 넘습니다.");
    if (!file.name?.toLowerCase().endsWith(".zip")) return JSON.parse(await file.text());
    const JSZip = await zipLibrary(), zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entries = Object.values(zip.files).filter(f => !f.dir);
    const allowed = /^(?:preset|backup)\.json$|^images\/[a-zA-Z0-9_-]+\.(?:png|jpg|gif|webp)$/;
    let total = 0;
    if (entries.length > 1025) throw new Error("ZIP 파일 항목이 너무 많습니다.");
    for (const entry of entries) {
        const size = entry._data?.uncompressedSize;
        if (!allowed.test(entry.name) || (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name)
            || !Number.isSafeInteger(size) || size < 0 || size > (entry.name.endsWith(".json") ? 68 : 20) * 1024 * 1024) throw new Error("ZIP 구성이나 이미지 크기가 올바르지 않습니다.");
        total += size;
    }
    if (total > limit) throw new Error("압축 해제한 데이터가 너무 큽니다.");
    const json = zip.file(kind + ".json");
    if (!json) throw new Error("SaiPet " + kind + " 파일이 없습니다.");
    const manifest = JSON.parse(await json.async("string"));
    if (kind === "backup") {
        const pending = [];
        for (const [id, meta] of Object.entries(manifest.images || {})) {
            if (!/^[a-f0-9]{64}$/.test(id) || !mimeExtension[meta?.mime] || !allowed.test(meta?.file || "")) throw new Error("백업 이미지 정보가 올바르지 않습니다.");
            const entry = zip.file(meta.file);
            if (!entry) throw new Error("백업 이미지가 누락됐습니다.");
            pending.push({ id, entry, mime: meta.mime });
            manifest.images[id] = { stored: true };
        }
        pendingImages.set(manifest, pending);
        return manifest;
    }
    async function visit(value) {
        if (typeof value === "string" && value.startsWith("saipet-file:")) {
            const name = value.slice(12), entry = zip.file(name);
            if (!allowed.test(name) || !entry) throw new Error("프리셋 이미지가 누락됐습니다.");
            const mime = Object.entries(mimeExtension).find(([, ext]) => name.endsWith("." + ext))?.[0];
            return asDataUrl(new Blob([await entry.async("uint8array")], { type: mime }));
        }
        if (Array.isArray(value)) return Promise.all(value.map(visit));
        if (value && typeof value === "object") {
            const out = {};
            for (const [key, child] of Object.entries(value)) {
                if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("허용하지 않는 데이터 항목입니다.");
                out[key] = await visit(child);
            }
            return out;
        }
        return value;
    }
    return visit(manifest);
}
/** Stages images only; selected data is committed later by the restore endpoint. */
export async function prepareBackupImages(archive, categories = archive.categories) {
    const fields = {
        presets: ["savedPresets"], activeSettings: ["activeImages", "secondPetData"],
        customSpeeches: ["customSpeeches"], logs: ["conversationLog"], journals: ["journalEntries"],
        reminders: ["reminders"], memos: ["personalMemos"], house: ["house", "houseData"],
    };
    const selected = {};
    for (const category of categories) {
        if (category === "activeSettings") selected.smallSettings = archive.smallSettings;
        const keys = category === "otherData"
            ? Object.keys(archive.data).filter(key => !Object.values(fields).flat().includes(key))
            : fields[category] || [];
        for (const key of keys) selected[key] = archive.data[key];
    }
    const references = collectImageReferences(selected);
    for (const image of pendingImages.get(archive) || []) {
        if (image.done || !references.has(image.id)) continue;
        const url = await uploadServerImage(await asDataUrl(new Blob([await image.entry.async("uint8array")], { type: image.mime })));
        if (parseImageUrl(url)?.id !== image.id) throw new Error("백업 이미지의 내용이 일치하지 않습니다.");
        image.done = true;
    }
}
export function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

