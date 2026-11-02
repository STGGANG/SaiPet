import { backupZip, readPortableFile, prepareBackupImages, downloadBlob } from "./portable-files.js";
import { getServerUsage } from "./server-storage.js";
import {
    createBackup, previewBackup, restoreBackup, listRestoreHistory, restoreHistory,
    getCurrentServerRevision, listUnusedImages, cleanupUnusedImages,
    listImageTrash, restoreImagesFromTrash, purgeImageTrash, getStorageStatus,
} from "./storage.js";

const $id = id => document.getElementById(id);
const sizeLabel = bytes => bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)}KB`
    : bytes < 1024 ** 3 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${(bytes / 1024 ** 3).toFixed(2)}GB`;
let archive = null;
let preview = null;
let unused = null;
let trash = null;
let selectionVersion = 0;
const fieldLabels = {
    savedPresets: "저장된 프리셋", smallSettings: "현재 펫·화면·AI 설정",
    activeImages: "사용 중인 이미지", secondPetData: "두 번째 펫",
    customSpeeches: "커스텀 대사", conversationLog: "AI 대화 로그",
    journalEntries: "꿈과 일기", reminders: "알림", personalMemos: "개인 메모",
    house: "펫하우스", houseData: "펫하우스(이전 형식)",
};
const errorLabels = {
    conflict: "그사이 저장 내용이 바뀌었습니다. 미리보기를 다시 눌러 주십시오.",
    invalid_backup: "백업 파일 형식이 올바르지 않습니다.",
    backup_category_unavailable: "선택한 항목이 이 백업 파일에 없습니다.",
    referenced_image_missing: "백업에 필요한 이미지 파일이 저장 공간에 없습니다.",
    backup_image_missing: "백업이 가리키는 이미지가 저장 공간에 없습니다. 이미지를 포함한 백업 파일을 사용하십시오.",
    restore_conflicts: "현재 데이터와 겹치는 항목이 있습니다. 덮어쓰기를 선택해 다시 미리보십시오.",
    image_quota_exceeded: "이미지 저장 한도를 넘었습니다. 미사용 이미지를 정리한 뒤 다시 시도하십시오.",
};
const friendlyError = error => errorLabels[error?.message] || error?.message || String(error);

function backupKeyLabel(key) {
    return Object.hasOwn(fieldLabels, key) ? fieldLabels[key] : String(key).replace(/[\r\n\t]/g, " ");
}

function backupCount(count, side) {
    const value = count?.[side];
    if (!Number.isSafeInteger(value) || value < 0) return null;
    const unit = count.unit === "entries" ? "건" : "개";
    return `${count.unit === "furniture" ? "가구 " : ""}${value}${unit}`;
}

function backupEffectLabel(key, counts, effect) {
    const label = backupKeyLabel(key);
    const count = counts?.[key];
    const current = backupCount(count, "current");
    const incoming = backupCount(count, "incoming");
    if (effect === "removed" && current) return `${label} (현재 ${current})`;
    if (effect === "added" && incoming) return `${label} (백업 ${incoming})`;
    if (effect === "replaced" && current && incoming) {
        return `${label} (현재 ${current} → 백업 ${incoming})`;
    }
    return label;
}

function backupEffectLines(keys, counts, effect) {
    return keys.map(key => `- ${backupEffectLabel(key, counts, effect)}`);
}

function formatRestorePreview(plan, chosen, mode) {
    const removed = plan.removedKeys || [];
    const replaced = plan.replacedKeys || [];
    const added = plan.addedKeys || [];
    const conflicts = plan.conflicts || [];
    const counts = plan.counts || {};
    const lines = [
        `선택 ${chosen.length}개 · 백업 프리셋 ${plan.incomingPresetCount || 0}개 · 포함 이미지 ${plan.imageCount || 0}개`,
    ];
    if (mode === "replace") {
        if (removed.length) lines.push("", "⚠ 백업 파일에 없어 현재 저장 내용에서 삭제됩니다:", ...backupEffectLines(removed, counts, "removed"));
        if (replaced.length) lines.push("", "현재 값을 백업 값으로 덮어씁니다:", ...backupEffectLines(replaced, counts, "replaced"));
        if (added.length) lines.push("", "새로 추가됩니다:", ...backupEffectLines(added, counts, "added"));
        if (!removed.length && !replaced.length && !added.length) lines.push("", "현재 저장 내용과 같은 백업입니다.");
    } else {
        lines.push("", "기존 데이터에 합칩니다. 다른 값으로 이미 저장된 항목은 충돌로 표시됩니다.");
        if (added.length) lines.push("새로 추가되는 항목:", ...backupEffectLines(added, counts, "added"));
    }
    const renamed = plan.renamedPresets || [];
    const dropped = plan.removedPresetNames || [];
    if (renamed.length) lines.push("", `지금과 내용이 다른 프리셋 ${renamed.length}개는 '(백업)' 이름으로 따로 추가됩니다: ${renamed.join(", ")}`);
    if (mode === "replace" && dropped.length) lines.push("", `⚠ 지금 있는 프리셋 중 사라지는 것: ${dropped.join(", ")}`);
    if (conflicts.length) {
        lines.push("", `⚠ 충돌: ${conflicts.map(backupKeyLabel).join(", ")}`,
            "덮어쓰기를 선택하거나 복원 범위를 줄여 다시 미리보십시오.");
    } else {
        lines.push("", "복원 가능");
    }
    return lines.join("\n");
}

function formatRestoreConfirmation(plan, chosen, mode) {
    const lines = [`선택한 ${chosen.length}개 항목을 ${mode === "replace" ? "백업 내용으로 덮어쓰기" : "현재 내용에 합치기"} 하시겠습니까?`];
    if (mode === "replace") {
        const removed = plan.removedKeys || [];
        const replaced = plan.replacedKeys || [];
        if (removed.length) lines.push("", "⚠ 백업에 없는 다음 현재 데이터는 삭제됩니다:",
            ...backupEffectLines(removed, plan.counts, "removed"));
        if (replaced.length) lines.push("", "다음 현재 데이터는 덮어씁니다:",
            ...backupEffectLines(replaced, plan.counts, "replaced"));
    }
    return lines.join("\n");
}

function categories() {
    return [...document.querySelectorAll("#stvp-backup-categories input:checked")]
        .map(input => input.dataset.category);
}

function result(id, message, error = false) {
    const element = $id(id);
    element.textContent = message;
    element.classList.toggle("stvp-data-error", error);
}

function invalidatePreview() {
    selectionVersion++;
    preview = null;
    $id("stvp-backup-restore").disabled = true;
    if (archive) result("stvp-backup-preview-result", "선택을 바꿨습니다. 복원 내용을 다시 미리보십시오.");
}

function selectedIds(container) {
    return [...$id(container).querySelectorAll("input:checked")].map(input => input.value);
}

const USED_LABELS = [["presets", "프리셋"], ["active", "지금 펫"], ["secondPet", "두 번째 펫"], ["house", "펫하우스"], ["history", "복원 기록"]];

function renderUsedSummary(summary) {
    const box = $id("stvp-image-used-summary");
    box.hidden = !summary?.total;
    if (!summary?.total) return;
    box.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = `사용 중인 이미지 ${summary.total}개는 그대로 둡니다`;
    box.append(title);
    for (const [key, label] of USED_LABELS) {
        if (!summary[key]) continue;
        const chip = document.createElement("span");
        chip.textContent = `${label} ${summary[key]}`;
        box.append(chip);
    }
}

function renderUnusedImages() {
    const list = $id("stvp-image-unused-list");
    list.replaceChildren();
    renderUsedSummary(unused?.usedSummary);
    $id("stvp-image-cleanup").disabled = true;
    if (!unused) return;
    const count = unused.unused?.length || 0;
    const eligible = unused.unused.filter(item => item.eligible);
    const intro = document.createElement("p");
    intro.textContent = count === 0 ? "정리할 미사용 이미지가 없습니다."
        : `미사용 이미지 ${count}개 · 지금 정리 가능 ${eligible.length}개 (${sizeLabel(unused.eligibleBytes || 0)})`;
    list.append(intro);
    for (const item of unused.unused || []) {
        const label = document.createElement("label");
        label.className = "stvp-data-image-row";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = item.id;
        checkbox.checked = item.eligible;
        checkbox.disabled = !item.eligible;
        checkbox.addEventListener("change", () => {
            $id("stvp-image-cleanup").disabled = selectedIds("stvp-image-unused-list").length === 0;
        });
        const image = document.createElement("img");
        image.src = item.url;
        image.alt = "사용하지 않는 이미지 미리보기";
        image.loading = "lazy";
        const text = document.createElement("span");
        text.textContent = `${item.id.slice(0, 10)}… · ${sizeLabel(item.bytes)}${item.eligible ? "" : " · 업로드 후 24시간 보호 중"}`;
        label.append(checkbox, image, text);
        list.append(label);
    }
    $id("stvp-image-cleanup").disabled = eligible.length === 0;
}

function renderTrash() {
    const list = $id("stvp-image-trash-list");
    list.replaceChildren();
    if (!trash?.images?.length) {
        list.textContent = "휴지통이 비어 있습니다.";
        return;
    }
    for (const item of trash.images) {
        const label = document.createElement("label");
        label.className = "stvp-data-image-row";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = item.id;
        const image = document.createElement("img");
        image.src = item.url;
        image.alt = "휴지통 이미지 미리보기";
        image.loading = "lazy";
        image.onerror = () => image.remove();
        const text = document.createElement("span");
        const daysLeft = item.expiresAt ? Math.max(0, Math.ceil((Date.parse(item.expiresAt) - Date.now()) / 86400000)) : null;
        text.textContent = `${sizeLabel(item.bytes)} · ${item.purgeEligible ? "영구 삭제 가능" : "되살리기 가능"}${daysLeft !== null ? ` · ${daysLeft}일 뒤 자동 삭제` : ""}`;
        label.append(checkbox, image, text);
        list.append(label);
    }
}

async function scanUnused() {
    unused = await listUnusedImages();
    renderUnusedImages();
}

async function loadTrash() {
    trash = await listImageTrash();
    renderTrash();
}

async function loadHistory() {
    const response = await listRestoreHistory();
    const select = $id("stvp-history-select");
    select.replaceChildren();
    const snapshots = response.snapshots || [];
    for (const item of snapshots) {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = `${new Date(item.createdAt).toLocaleString()} · 저장 버전 ${item.revision}`;
        select.append(option);
    }
    if (!snapshots.length) select.add(new Option("복원 기록 없음", ""));
}

const USAGE_PARTS = [["dataBytes", "기록·설정", "data"], ["imageBytes", "이미지", "image"], ["trashBytes", "휴지통", "trash"], ["historyBytes", "복원 기록", "history"]];
let usageCheckedAt = 0;

function refreshSaveState() {
    const node = $id("stvp-save-state");
    if (!node) return;
    const { mode, lastSavedAt, pending } = getStorageStatus();
    const time = lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "";
    const [tone, text] = mode === "server"
        ? ["ok", pending ? "저장하는 중…" : `실리태번 사용자 파일에 저장됩니다${time ? ` · 마지막 저장 ${time}` : ""}`]
        : mode === "legacy" ? ["warn", "저장 공간에 연결하지 못해 실리태번 설정 안에 저장하고 있습니다"]
        : ["danger", "저장이 멈췄습니다 · 맨 위 안내를 확인해 주십시오"];
    node.dataset.tone = tone;
    node.lastElementChild.textContent = text;
}

async function refreshUsage(force = false) {
    if (!force && Date.now() - usageCheckedAt < 60000) return;
    usageCheckedAt = Date.now();
    const box = $id("stvp-usage"), note = $id("stvp-usage-note");
    const usage = getStorageStatus().mode === "server" ? await getServerUsage().catch(() => null) : null;
    box.hidden = !usage;
    if (!usage) {
        note.textContent = getStorageStatus().mode === "server" ? "용량을 읽지 못했습니다. 다시 계산을 눌러 주십시오." : "";
        return;
    }
    note.textContent = "";
    const total = USAGE_PARTS.reduce((sum, [key]) => sum + (usage[key] || 0), 0) || 1;
    $id("stvp-usage-total").textContent = `실리태번 폴더에서 약 ${sizeLabel(usage.totalBytes ?? total)} 사용 중`;
    $id("stvp-usage-quota").textContent = usage.imageQuotaBytes ? `이미지 ${sizeLabel(usage.imageBytes || 0)} / ${sizeLabel(usage.imageQuotaBytes)}` : "";
    const bar = $id("stvp-usage-bar"), legend = $id("stvp-usage-legend");
    bar.replaceChildren(); legend.replaceChildren();
    for (const [key, label, part] of USAGE_PARTS) {
        const bytes = usage[key] || 0;
        if (bytes > 0) {
            const segment = document.createElement("span");
            segment.dataset.part = part;
            segment.style.width = `${Math.max(1.5, bytes / total * 100)}%`;
            bar.append(segment);
        }
        const item = document.createElement("li");
        item.dataset.part = part;
        const count = key === "imageBytes" ? usage.imageCount : key === "trashBytes" ? usage.trashCount : key === "historyBytes" ? usage.historyCount : null;
        item.textContent = `${label} ${sizeLabel(bytes)}${count ? ` · ${count}개` : ""}`;
        legend.append(item);
    }
}

export function bindDataToolsUI(afterRestore) {
    refreshSaveState();
    for (const name of ["saipet-storage-status", "saipet-storage-saved"]) document.addEventListener(name, refreshSaveState);
    $id("stvp-usage-refresh").addEventListener("click", () => refreshUsage(true));
    document.querySelector('.stvp-tab[data-tab="data"]')?.addEventListener("click", () => { refreshSaveState(); refreshUsage(); });
    if (document.querySelector('.stvp-tab-content[data-tab="data"]')?.classList.contains("active")) refreshUsage();
    $id("stvp-image-trash-select-all").addEventListener("click", () => {
        const boxes = [...$id("stvp-image-trash-list").querySelectorAll("input[type=checkbox]")];
        const next = boxes.some(box => !box.checked);
        boxes.forEach(box => { box.checked = next; });
    });
    $id("stvp-backup-preview-result").style.whiteSpace = "pre-line";
    $id("stvp-backup-select-all").addEventListener("click", () => {
        selectionVersion++;
        archive = null;
        preview = null;
        $id("stvp-backup-file").value = "";
        $id("stvp-backup-restore").disabled = true;
        for (const input of document.querySelectorAll("#stvp-backup-categories input")) {
            input.disabled = false;
            input.checked = true;
        }
        result("stvp-backup-preview-result", "새 백업용 항목을 모두 선택했습니다.");
    });
    $id("stvp-backup-export").addEventListener("click", async () => {
        const chosen = categories();
        if (!chosen.length) return alert("백업할 항목을 하나 이상 선택하십시오.");
        try {
            const backup = await createBackup(chosen);
            downloadBlob(await backupZip(backup), `saipet-private-backup-${new Date().toISOString().slice(0, 10)}.zip`);
        } catch (error) {
            alert(`백업에 실패했습니다: ${error.message}`);
        }
    });

    $id("stvp-backup-file").addEventListener("change", async event => {
        archive = null;
        invalidatePreview();
        const version = selectionVersion;
        const file = event.target.files[0];
        if (!file) return;
        try {
            const parsed = await readPortableFile(file, "backup");
            if (version !== selectionVersion) return;
            if (parsed?.kind !== "saipet-backup" || parsed.version !== 1 || !Array.isArray(parsed.categories)) {
                throw new Error("SaiPet 전체 백업 파일 형식이 아닙니다.");
            }
            archive = parsed;
            for (const input of document.querySelectorAll("#stvp-backup-categories input")) {
                input.disabled = !parsed.categories.includes(input.dataset.category);
                input.checked = !input.disabled;
            }
            result("stvp-backup-preview-result", `${new Date(parsed.createdAt).toLocaleString()} 백업을 읽었습니다. 항목과 복원 방식을 선택해 미리보십시오.`);
        } catch (error) {
            if (version !== selectionVersion) return;
            result("stvp-backup-preview-result", `파일을 읽지 못했습니다: ${error.message}`, true);
        }
    });
    for (const element of document.querySelectorAll("#stvp-backup-categories input, #stvp-backup-mode")) {
        element.addEventListener("change", invalidatePreview);
    }
    $id("stvp-backup-preview").addEventListener("click", async () => {
        if (!archive) return alert("먼저 전체 백업 파일을 선택하십시오.");
        const chosen = categories();
        if (!chosen.length) return alert("복원할 항목을 하나 이상 선택하십시오.");
        const version = ++selectionVersion;
        const chosenArchive = archive;
        const mode = $id("stvp-backup-mode").value;
        preview = null;
        $id("stvp-backup-restore").disabled = true;
        try {
            result("stvp-backup-preview-result", "백업 이미지를 확인하는 중입니다. 데이터는 복원 버튼을 눌러야 바뀝니다.");
            await prepareBackupImages(chosenArchive, chosen);
            if (version !== selectionVersion || archive !== chosenArchive) return;
            const response = await previewBackup(chosenArchive, chosen, mode);
            if (version !== selectionVersion || archive !== chosenArchive) return;
            preview = { ...response, archive: chosenArchive, categoriesKey: JSON.stringify(chosen), selectedMode: mode, version };
            const conflicts = preview.conflicts || [];
            result("stvp-backup-preview-result", formatRestorePreview(preview, chosen, mode), conflicts.length > 0);
            $id("stvp-backup-restore").disabled = conflicts.length > 0;
        } catch (error) {
            if (version !== selectionVersion) return;
            preview = null;
            $id("stvp-backup-restore").disabled = true;
            result("stvp-backup-preview-result", `미리보기에 실패했습니다: ${friendlyError(error)}`, true);
        }
    });
    $id("stvp-backup-restore").addEventListener("click", async event => {
        const chosen = categories();
        const mode = $id("stvp-backup-mode").value;
        if (!archive || !preview || preview.conflicts?.length || preview.archive !== archive
            || preview.version !== selectionVersion || preview.categoriesKey !== JSON.stringify(chosen)
            || preview.selectedMode !== mode) {
            invalidatePreview();
            return;
        }
        if (!confirm(formatRestoreConfirmation(preview, chosen, mode))) return;
        event.currentTarget.disabled = true;
        try {
            await restoreBackup(archive, chosen, mode, preview.revision);
            selectionVersion++;
            preview = null;
            result("stvp-backup-preview-result", "선택한 항목을 복원했습니다.");
        } catch (error) {
            preview = null;
            result("stvp-backup-preview-result", `복원에 실패했습니다: ${friendlyError(error)} 미리보기부터 다시 해 주십시오.`, true);
            return;
        }
        try { afterRestore(); }
        catch (error) { result("stvp-backup-preview-result", `복원은 완료됐습니다. 화면 표시 오류가 있어 새로고침이 필요합니다: ${error.message}`, true); }
        await loadHistory().catch(() => {});
    });

    $id("stvp-history-select").closest("details")?.addEventListener("toggle", event => {
        if (event.target.open && !$id("stvp-history-select").options.length) loadHistory().catch(() => {});
    });
    $id("stvp-history-refresh").addEventListener("click", async () => {
        try { await loadHistory(); } catch (error) { alert(`복원 기록을 읽지 못했습니다: ${error.message}`); }
    });
    $id("stvp-history-restore").addEventListener("click", async () => {
        const id = $id("stvp-history-select").value;
        if (!id) return;
        if (!confirm("선택한 복원 전 상태로 현재 SaiPet 데이터를 되돌리시겠습니까?")) return;
        try {
            const revision = await getCurrentServerRevision();
            await restoreHistory(id, revision);
        } catch (error) { alert(`되돌리기에 실패했습니다: ${error.message}`); return; }
        try { afterRestore(); }
        catch (error) { alert(`이전 상태로 되돌렸습니다. 화면을 갱신하려면 새로고침하십시오: ${error.message}`); }
        await loadHistory().catch(() => {});
    });

    $id("stvp-image-scan").addEventListener("click", async () => {
        try { await scanUnused(); } catch (error) { result("stvp-image-unused-list", `이미지 확인 실패: ${error.message}`, true); }
    });
    $id("stvp-image-cleanup").addEventListener("click", async () => {
        if (!unused) return;
        const ids = selectedIds("stvp-image-unused-list");
        if (!ids.length) return;
        try {
            const moved = await cleanupUnusedImages(ids, unused.revision);
            await scanUnused();
            await loadTrash();
            alert(`${moved.moved}개 이미지를 휴지통으로 옮겼습니다. 7일 동안 복구할 수 있습니다.`);
        } catch (error) {
            await scanUnused().catch(() => {});
            alert(`이미지 정리에 실패했습니다: ${error.message}`);
        }
    });
    $id("stvp-image-trash-refresh").addEventListener("click", async () => {
        try { await loadTrash(); } catch (error) { result("stvp-image-trash-list", `휴지통 확인 실패: ${error.message}`, true); }
    });
    $id("stvp-image-trash-restore").addEventListener("click", async () => {
        const ids = selectedIds("stvp-image-trash-list");
        if (!ids.length) return;
        try {
            await restoreImagesFromTrash(ids);
            await loadTrash();
            await scanUnused();
        } catch (error) { alert(`이미지 복구에 실패했습니다: ${error.message}`); }
    });
    $id("stvp-image-trash-purge").addEventListener("click", async () => {
        const ids = selectedIds("stvp-image-trash-list");
        if (!ids.length) return;
        if (ids.some(id => !trash?.images?.find(item => item.id === id)?.purgeEligible)) {
            return alert("영구 삭제는 휴지통으로 옮긴 뒤 7일이 지난 이미지만 가능합니다.");
        }
        if (!confirm(`${ids.length}개 이미지를 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
        try {
            await purgeImageTrash(ids);
            await loadTrash();
        } catch (error) { alert(`영구 삭제에 실패했습니다: ${error.message}`); }
    });
}
