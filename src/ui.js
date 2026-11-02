import { bindHouseConversationUI } from "./house-conversation-ui.js";
import { armReminderAudio } from "./reminder-audio.js";
import { getCharacterSettings, currentPresetId, hasPresetChanges, rememberPairSettings, restorePairSettings } from "./storage.js";
import { WALK_DIRECTIONS } from "./walk-direction.js";
import { preserveSettingsScroll } from "./settings-scroll.js";
import { applyFont } from "./fonts.js";
import { readPortableFile } from "./portable-files.js";
import { RELATIONS, SCENES, startSocial, stopSocial, playSocialInteraction } from "./social.js";
import { SHARED_FILE_LIMIT, validatePreset } from "./data-validation.js";
import { DEFAULT_SPRITES, BUBBLE_DESIGNS } from "./constants.js";
import { state, log, isDeviceEnabled, isPetActive } from "./state.js";
import { saveSettings, setMasterEnabled, saveImageFile, savePreset, loadPreset, deletePreset, updatePreset, getPresetList, resetToDefaultMiyu, exportPreset, importPreset, resetAllSettings, getStorageStatus, retryServerSave, emergencyBackup, BACKUP_CATEGORIES } from "./storage.js";
import { PET_IDS, cancelCollisionReaction, createPetContainer, updatePetPosition, updatePetSize, updatePetOpacity, updatePetSprite, applyDesignTheme, clampPetPosition, startWalking, stopWalking } from "./pet-core.js";
import { extension_settings } from "../../../../extensions.js";
import { clearSpeechTimers } from "./pet-speech.js";
import { openHouse, closeHouse } from "./house.js";
import { bindDataToolsUI } from "./data-tools-ui.js";
import { resolveSpriteSource, idleSprite } from "./sprite-paths.js";
import { deactivatePet } from "./pet-lifecycle.js";
import { settingsMarkup } from "./settings-markup.js";
import { bindTips, escapeHtml } from "./ui-kit.js";
import { bindTextExpand } from "./text-expand.js";
import { bindLogUI, refreshLogViewer } from "./log-ui.js";
import { bindReminderUI, refreshReminderList } from "./reminder-ui.js";
import { createJournalPopup, bindJournalUI, openJournal, updateJournalPetFilter, refreshJournalViewer } from "./journal-ui.js";

// The built-in Miyu is not a saved preset: loading it restores the defaults, and it cannot be overwritten or deleted.
const BUILTIN_MIYU = "__builtin_miyu__";
const PAUSED_MODES = ["blocked", "conflict", "error"];

let editingPetId = "primary";
const presetSelections = { primary: null, secondary: null };
const editedPet = () => getCharacterSettings(editingPetId);
const storageDisabledControls = new Set();
const petTabKeys = new WeakMap();
let selectedImportFile = null;
let presetImportSelectionVersion = 0;

function refreshEditedSprite() {
    updatePetSprite(editingPetId);
}
function refreshEditedTheme() {
    applyDesignTheme(editingPetId);
    refreshBubbleSample();
}

function refreshPetEditorHeader() {
    const s = state.settings;
    for (const button of document.querySelectorAll(".stvp-pet-tab")) {
        const second = button.dataset.pet === "secondary";
        const data = second ? s.multiPet?.secondPetData : s;
        const name = data?.personality?.name || (second ? "선택 전" : "이름 없음");
        const enabled = Boolean(second ? s.multiPet?.enabled && s.multiPet?.secondPetData : s.primaryPetEnabled !== false);
        const avatar = data ? idleSprite(data) : "";
        const key = `${avatar}\n${name}\n${enabled}`;
        if (petTabKeys.get(button) !== key) {
            petTabKeys.set(button, key);
            button.innerHTML = `<span class="stvp-pet-avatar">${avatar ? `<img src="${escapeHtml(avatar)}" alt="">` : '<i class="fa-solid fa-plus"></i>'}<span class="stvp-pet-state" data-on="${enabled}" title="${enabled ? "화면에 보이는 중" : "꺼져 있음"}"></span></span>
                <span class="stvp-pet-tab-text"><small>${second ? "두 번째" : "첫 번째"} · ${enabled ? "ON" : "OFF"}</small><strong>${escapeHtml(name)}</strong></span>`;
        }
        const active = button.dataset.pet === editingPetId;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
    }
    const memoPets = document.getElementById("stvp-memo-pets");
    if (memoPets) {
        memoPets.hidden = !s.multiPet?.secondPetData;
        for (const button of memoPets.querySelectorAll("button")) {
            const second = button.dataset.pet === "secondary";
            button.textContent = (second ? s.multiPet?.secondPetData?.personality?.name : s.personality?.name) || (second ? "두 번째" : "첫 번째");
            button.classList.toggle("active", button.dataset.pet === editingPetId);
            button.setAttribute("aria-pressed", String(button.dataset.pet === editingPetId));
        }
    }
    $("#stvp-slot-enabled").prop("checked", editingPetId === "secondary" ? s.multiPet?.enabled === true : s.primaryPetEnabled !== false);
    document.querySelectorAll("[data-slot-position]").forEach(row => row.hidden = row.dataset.slotPosition !== editingPetId);
    $("#stvp-character-editor").attr("aria-label", `${editingPetId === "secondary" ? "두 번째" : "첫 번째"} 펫 설정`);
    $("#stvp-pair-settings").prop("hidden", !(s.primaryPetEnabled !== false && s.multiPet?.enabled && s.multiPet?.secondPetData));
    $("#stvp-pair-title").text(`${s.personality.name} · ${s.multiPet?.secondPetData?.personality?.name || "두 번째"}의 관계`);
    $("#stvp-preset-update").prop("disabled", !getPresetList().some(p => p.id === currentPresetId(editingPetId)));
}

async function refreshSlotRuntime() {
    deactivatePet();
    const { activatePet } = await import("../index.js");
    activatePet();
}

function characterLoaded() {
    stopSocial();
    if (isPetActive()) {
        createPetContainer(editingPetId);
    }
    startSocial();
    import("./pet-reactions.js").then(({ startInterPetChatTimer }) => startInterPetChatTimer());
    updateUIValues(); updatePresetList(); refreshPresetStatus();
}

export function refreshHeroStatus() {
    const node = document.getElementById("stvp-hero-status");
    if (!node) return;
    const device = state.isMobile ? "스마트폰" : "PC";
    let text = `${device}에서 함께하는 중`, tone = "ok";
    if (PAUSED_MODES.includes(getStorageStatus().mode)) [text, tone] = ["저장 문제로 잠시 멈췄습니다", "danger"];
    else if (!state.settings?.enabled) [text, tone] = ["꺼져 있습니다", "off"];
    else if (!isDeviceEnabled()) [text, tone] = [`${device}에서는 숨김 · 화면 탭에서 켤 수 있습니다`, "warn"];
    node.textContent = text;
    node.dataset.tone = tone;
}

export async function createUI() {
    const profiles = extension_settings?.connectionManager?.profiles || [];
    const profileOptions = profiles.length
        ? profiles.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("")
        : '<option value="">프로필 없음</option>';
    $("#extensions_settings").append(settingsMarkup({ profileOptions, backupCategories: BACKUP_CATEGORIES }));
    const settingsRoot = document.getElementById("saipet-settings");
    preserveSettingsScroll(settingsRoot);
    bindTips(settingsRoot);
    bindTextExpand(settingsRoot);
    $("#stvp-mobile-controls").prop("open", state.settings.deviceDisplay?.mobileEnabled === true);
    armReminderAudio(() => state.settings.enabled && state.settings.reminderSound !== false);
    document.addEventListener("stvp-api-status", refreshApiStatus);
    // OFF must win before any other listener can stop the event (also covers a duplicated panel).
    document.addEventListener("change", event => {
        if (event.target?.id !== "stvp-enabled" || event.target.checked) return;
        state.settings.enabled = false;
        deactivatePet();
        setMasterEnabled(false);
        refreshHeroStatus();
    }, true);
    restorePairSettings();

    const blockWhileStoragePaused = event => {
        if (!PAUSED_MODES.includes(getStorageStatus().mode)) return;
        if (event.target.closest?.(".stvp-storage-backup, .stvp-storage-retry, #stvp-enabled, .stvp-tab, .stvp-tip-btn, #stvp-journal-popup-close")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    const journalPopup = createJournalPopup();
    for (const eventName of ["click", "change", "input"]) {
        settingsRoot.addEventListener(eventName, blockWhileStoragePaused, true);
        journalPopup.addEventListener(eventName, blockWhileStoragePaused, true);
    }

    bindUIEvents();
    bindLogUI();
    bindReminderUI();
    bindJournalUI();
    bindDataToolsUI(() => {
        closeHouse();
        updateUIValues();
        updatePresetList();
    });
    updateUIValues();
    updateStorageStatus();
    document.addEventListener("saipet-storage-status", updateStorageStatus);
    document.addEventListener("saipet-data-merged", () => { updateUIValues(); updatePresetList(); });
    updatePresetList();
    bindHouseConversationUI(settingsRoot);
    document.addEventListener("stvp-open-house", openHouse);
    document.addEventListener("stvp-open-log", openConversationLog);
    settingsRoot.addEventListener("change", refreshPresetStatus);
    refreshPresetStatus();
    log("UI created");
}

const TASK_LABELS = {
    direct: "말 걸기", dual: "둘이 함께 대답", observer: "채팅 반응", inner: "채팅 반응", pair: "펫끼리 대화",
    housePair: "펫하우스 대화", houseTalk: "펫하우스 말 걸기", dream: "꿈", diary: "일기", reminder: "알림",
};
function refreshApiStatus() {
    const node = document.getElementById("stvp-api-status");
    const request = state.lastAIRequest;
    if (!node || (!request && !state.lastAIError)) return;
    const removed = request?.removedHistory || 0;
    const usage = request ? `최근 요청 · ${TASK_LABELS[request.task] || request.task} · 입력 약 ${Number(request.inputTokens || 0).toLocaleString()}토큰` : "";
    node.hidden = false;
    node.dataset.tone = state.lastAIError ? "danger" : removed ? "warn" : "info";
    node.textContent = state.lastAIError ? `최근 API 오류: ${state.lastAIError}`
        : removed ? `${usage} · 입력 한도에 맞춰 오래된 기록 ${removed}건을 제외했습니다. 저장된 기록은 그대로입니다.` : usage;
}

function refreshSocialActions() {
    const select = document.getElementById("stvp-social-action");
    if (!select) return;
    const previous = select.value;
    select.replaceChildren(new Option("랜덤", ""));
    const actions = (RELATIONS[state.settings.multiPet?.visualRelation] || RELATIONS.friends).actions;
    for (const action of actions) select.add(new Option(SCENES[action], action));
    select.value = actions.includes(previous) ? previous : "";
}

const TAB_KEY = "saipet-settings-tab";
function openConversationLog() {
    if (document.getElementById("rm_extensions_block")?.classList.contains("closedDrawer")) {
        document.querySelector("#extensions-settings-button .drawer-toggle")?.click();
    }
    const content = document.querySelector("#saipet-settings .inline-drawer-content");
    if (content && getComputedStyle(content).display === "none") document.querySelector("#saipet-settings .inline-drawer-toggle")?.click();
    selectTab("life");
    requestAnimationFrame(() => document.getElementById("stvp-log-viewer")?.closest(".stvp-card")?.scrollIntoView({ block: "start", behavior: "smooth" }));
}

function selectTab(tab) {
    try { localStorage.setItem(TAB_KEY, tab); } catch {}
    $(".stvp-tab").each(function() {
        const active = this.dataset.tab === tab;
        this.classList.toggle("active", active);
        this.setAttribute("aria-selected", String(active));
    });
    $(".stvp-tab-content").each(function() { this.classList.toggle("active", this.dataset.tab === tab); });
    if (tab === "life") refreshLogViewer();
}

function bindPetEditorEvents() {
    $("#stvp-memo-pets").on("click", "button", function() { $(`.stvp-pet-tab[data-pet="${this.dataset.pet}"]`).trigger("click"); });
    $(".stvp-pet-tab").on("click", function() {
        if (editingPetId === this.dataset.pet) return;
        presetSelections[editingPetId] = $("#stvp-preset-select").val();
        editingPetId = this.dataset.pet;
        updateUIValues(); updatePresetList(); refreshPresetStatus();
    });
    $(".stvp-pet-tab").on("keydown", function(event) {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const target = event.key === "Home" ? "primary" : event.key === "End" ? "secondary" : editingPetId === "primary" ? "secondary" : "primary";
        const button = document.querySelector(`.stvp-pet-tab[data-pet="${target}"]`);
        button.click(); button.focus({ preventScroll: true });
    });
    $("#stvp-slot-enabled").on("change", function() {
        if (editingPetId === "secondary") { getCharacterSettings("secondary"); state.settings.multiPet.enabled = this.checked; }
        else state.settings.primaryPetEnabled = this.checked;
        saveSettings(); refreshPetEditorHeader(); refreshSlotRuntime();
    });
    $("#stvp-character-scale").on("change", function() {
        editedPet().appearance.scale = Math.max(40, Math.min(180, Number(this.value) || 100));
        this.value = editedPet().appearance.scale;
        updatePetSize(editingPetId);
        clampPetPosition(editingPetId); saveSettings(); refreshPresetStatus();
    });
    $("#stvp-flip").on("change", function() {
        editedPet().appearance.flipHorizontal = this.checked;
        saveSettings();
        refreshEditedSprite();
    });
    $("#stvp-position").on("change", function() {
        const position = editingPetId === "secondary" ? state.settings.multiPet.secondPetPosition : state.settings.position;
        position.location = this.value; position.customX = null; position.customY = null;
        saveSettings();
        updatePetPosition(editingPetId);
    });

    for (const [id, key, fallback] of [["stvp-pet-name", "name", "냥이"], ["stvp-personality-prompt", "prompt"], ["stvp-user-relation", "userRelation"], ["stvp-owner-name", "ownerName"], ["stvp-owner-persona", "ownerPersona"]]) {
        $("#" + id).on("input change", function(event) {
            editedPet().personality[key] = this.value || fallback || "";
            if (event.type === "change") saveSettings(); else scheduleUISettingsSave();
            if (key === "name") refreshPetEditorHeader();
        });
    }
    $("#stvp-cultural-background").on("change", function() {
        editedPet().personality.culturalBackground = this.value.trim(); saveSettings();
    });

    $("#stvp-memo-tag-select").on("change", function() {
        const recurring = ["일정", "건강", "운동", "기타"].includes(this.value);
        $("#stvp-memo-days-row").toggle(recurring);
        if (!recurring) $(".stvp-memo-day-btn").removeClass("active");
    });
    $(".stvp-memo-day-btn").on("click", function() { $(this).toggleClass("active"); });
    $("#stvp-memo-add-btn").on("click", () => {
        const content = $("#stvp-memo-content-input").val().trim();
        if (!content) return;
        const memo = { tag: $("#stvp-memo-tag-select").val(), content };
        const date = $("#stvp-memo-date-input").val();
        if (date) memo.date = date;
        const days = $(".stvp-memo-day-btn.active").map(function() { return Number(this.dataset.day); }).get();
        if (days.length) memo.recurDays = days;
        (editedPet().personality.personalMemos ||= []).push(memo);
        saveSettings();
        renderMemoList();
        $("#stvp-memo-content-input, #stvp-memo-date-input").val("");
        $(".stvp-memo-day-btn").removeClass("active");
        $("#stvp-memo-days-row").hide();
        $("#stvp-memo-tag-select").val("메모");
    });
    $("#stvp-memo-content-input").on("keydown", event => {
        if (event.key !== "Enter" || event.isComposing) return;
        event.preventDefault();
        $("#stvp-memo-add-btn").trigger("click");
    });
    $("#stvp-memo-list").on("click", ".stvp-memo-delete-btn", function() {
        const memos = editedPet().personality.personalMemos;
        if (!memos) return;
        memos.splice(Number(this.dataset.idx), 1);
        saveSettings();
        renderMemoList();
    });

    bindSpriteEvents();
    $(".stvp-speech-textarea").on("change", function() {
        editedPet().customSpeeches[this.dataset.mood] = this.value.trim() ? this.value.split("\n").filter(s => s.trim()) : [];
        saveSettings();
    });
    for (const [id, key] of [["stvp-fallback-no-response", "noResponse"], ["stvp-fallback-api-error", "apiError"]]) {
        $("#" + id).on("change", function() {
            (editedPet().fallbackMessages ||= {})[key] = this.value;
            saveSettings();
        });
    }
    const pickBubbleDesign = card => {
        card.focus();
        editedPet().speechBubble.design = card.dataset.design;
        saveSettings();
        refreshEditedTheme();
    };
    $("#stvp-bubble-design").on("click", ".stvp-design-card", function() { pickBubbleDesign(this); });
    $("#stvp-bubble-design").on("keydown", ".stvp-design-card", function(event) {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        const cards = [...this.parentElement.querySelectorAll(".stvp-design-card")];
        pickBubbleDesign(cards[(cards.indexOf(this) + step + cards.length) % cards.length]);
    });
    $("#stvp-bubble-design-colors").on("click", () => {
        Object.assign(editedPet().speechBubble, bubbleDesign(editedPet().speechBubble.design).defaults);
        saveSettings();
        refreshBubbleColorInputs();
        refreshEditedTheme();
    });
    $("#stvp-bubble-font").on("change", function() {
        editedPet().speechBubble.font = this.value;
        saveSettings();
        refreshEditedTheme();
        queueMicrotask(refreshFontPreview);
    });
    for (const [id, key] of [["stvp-bubble-bg", "backgroundColor"], ["stvp-bubble-text-color", "textColor"], ["stvp-bubble-accent-color", "accentColor"]]) {
        $("#" + id).on("input", function() { refreshBubbleSample({ [key]: this.value }); });
        $("#" + id).on("change", function() {
            editedPet().speechBubble[key] = this.value;
            saveSettings();
            refreshEditedTheme();
        });
    }
}

function bindSpriteEvents() {
    $("#saipet-settings").on("keydown", ".stvp-sprite-preview", function(event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        this.click();
    });
    $(".stvp-sprite-preview").not("#stvp-walk-preview, #stvp-walk2-preview").on("click", function() {
        $(`#stvp-file-${$(this).closest(".stvp-sprite-item").data("mood")}`).click();
    });
    $("[id^='stvp-file-']").on("change", async function() {
        const moodId = this.id.replace("stvp-file-", "");
        const petId = editingPetId, images = editedPet().appearance.customSprites;
        const file = this.files[0];
        this.value = "";
        if (!file) return;
        try {
            const imageUrl = await saveImageFile(file);
            if (getCharacterSettings(petId).appearance.customSprites !== images) return;
            images[moodId] = imageUrl;
            saveSettings();
            if (petId !== editingPetId) { updatePetSprite(petId); return; }
            setImagePreview(document.getElementById(`stvp-preview-${moodId}`), imageUrl, moodId);
            $(`.stvp-sprite-clear[data-mood="${moodId}"]`).show();
            refreshEditedSprite();
            if (moodId === "idle") refreshPetEditorHeader();
        } catch (error) {
            log("Failed to upload sprite:", error);
            alert(`이미지 저장에 실패했습니다: ${error.message}`);
        }
    });
    const setSprite = (moodId, value) => {
        editedPet().appearance.customSprites[moodId] = value;
        saveSettings();
        setImagePreview(document.getElementById(`stvp-preview-${moodId}`), value, moodId);
        $(`.stvp-sprite-clear[data-mood="${moodId}"]`).toggle(Boolean(value));
        refreshEditedSprite();
        if (moodId === "idle") refreshPetEditorHeader();
    };
    $(".stvp-sprite-url").not("#stvp-walk-sprite-url, #stvp-walk2-sprite-url").on("click", function(event) {
        event.stopPropagation();
        const moodId = $(this).data("mood");
        const current = editedPet().appearance.customSprites[moodId];
        const url = prompt("이미지 URL을 입력하십시오:", current && !current.startsWith("data:") ? current : "");
        if (url === null) return;
        setSprite(moodId, url.trim() || null);
    });
    $(".stvp-sprite-clear").not("#stvp-walk-sprite-clear, #stvp-walk2-sprite-clear").on("click", function(event) {
        event.stopPropagation();
        setSprite($(this).data("mood"), null);
    });

    $("#stvp-walk-mode").on("change", function() {
        editedPet().walk.animationMode = this.value;
        walkingImagesChanged();
    });
    for (const [prefix, key] of [["stvp-walk", "walkSprite"], ["stvp-walk2", "walkSprite2"]]) {
        $(`#${prefix}-preview`).on("click", () => $(`#${prefix}-sprite-file`).trigger("click"));
        $(`#${prefix}-sprite-file`).on("change", async function() {
            const file = this.files?.[0]; this.value = "";
            if (!file) return;
            const petId = editingPetId, walk = editedPet().walk;
            try {
                const image = await saveImageFile(file);
                if (getCharacterSettings(petId).walk !== walk) return;
                walk[key] = image; saveSettings();
                restartMovement();
                if (petId === editingPetId) { refreshWalkControls(); refreshPresetStatus(); }
            } catch (error) { alert(`걷기 이미지 저장에 실패했습니다: ${error.message}`); }
        });
        $(`#${prefix}-sprite-url`).on("click", function(event) {
            event.stopPropagation();
            const current = editedPet().walk[key] || "";
            const url = prompt("걷기 이미지 URL을 입력하십시오:", current.startsWith("data:") ? "" : current);
            if (url === null) return;
            editedPet().walk[key] = url.trim() || null; walkingImagesChanged();
        });
        $(`#${prefix}-sprite-clear`).on("click", function(event) {
            event.stopPropagation(); editedPet().walk[key] = null; walkingImagesChanged();
        });
    }
}

function restartMovement() {
    for (const petId of PET_IDS) stopWalking(petId);
    stopSocial();
    for (const petId of PET_IDS) startWalking(petId);
    startSocial();
}
function walkingImagesChanged() {
    saveSettings(); refreshWalkControls(); refreshPresetStatus(); restartMovement();
}

function bindPresetEvents() {
    $("#stvp-preset-save").on("click", () => {
        const name = prompt("프리셋 이름을 입력하십시오:", `프리셋 ${(state.settings.savedPresets?.length || 0) + 1}`);
        if (!name) return;
        savePreset(name, editingPetId);
        presetSelections[editingPetId] = currentPresetId(editingPetId);
        updatePresetList();
        alert("프리셋을 저장했습니다.");
    });
    $("#stvp-preset-load").on("click", () => {
        const presetId = $("#stvp-preset-select").val();
        if (!presetId) return alert("불러올 프리셋을 선택하십시오.");
        if (presetId === BUILTIN_MIYU) {
            if (!confirm("기본 메이드 미유 설정으로 되돌리시겠습니까?\n(커스텀 이미지와 대사가 초기화됩니다)")) return;
            resetToDefaultMiyu(editingPetId);
            characterLoaded();
            $("#stvp-preset-select").val(BUILTIN_MIYU);
            renderPresetPreview();
            return alert("기본 미유를 불러왔습니다!");
        }
        if (loadPreset(presetId, editingPetId)) {
            presetSelections[editingPetId] = presetId;
            characterLoaded();
            alert("프리셋을 불러왔습니다!");
        }
    });
    $("#stvp-preset-update").on("click", () => {
        const presetId = currentPresetId(editingPetId);
        if (!presetId) return alert("덮어쓸 프리셋을 선택하십시오.");
        if (presetId === BUILTIN_MIYU) return alert("기본 미유는 기본 제공 프리셋이라 덮어쓸 수 없습니다.\n지금 설정을 남기려면 '새 프리셋으로 저장'을 눌러 주십시오.");
        if (!confirm("현재 사용 중인 프리셋을 지금 내용으로 덮어쓰시겠습니까?")) return;
        if (updatePreset(presetId, editingPetId)) {
            refreshPresetStatus();
            alert("현재 프리셋을 덮어썼습니다. 다른 자리에서 사용 중인 펫은 그대로 유지됩니다.");
        }
    });
    $("#stvp-preset-delete").on("click", () => {
        const presetId = $("#stvp-preset-select").val();
        if (!presetId) return alert("삭제할 프리셋을 선택하십시오.");
        if (presetId === BUILTIN_MIYU) return alert("기본 미유는 기본 제공 프리셋이라 삭제할 수 없습니다.");
        if (confirm("선택한 프리셋을 삭제하시겠습니까?") && deletePreset(presetId)) {
            updatePresetList();
            alert("프리셋을 삭제했습니다.");
        }
    });
    $("#stvp-preset-export").on("click", async () => {
        const selectedId = $("#stvp-preset-select").val();
        if (selectedId === BUILTIN_MIYU) return alert("기본 미유는 사이펫에 기본으로 들어 있어 내보낼 필요가 없습니다.");
        try {
            if (selectedId) await exportPreset(selectedId, "zip");
            else if (confirm("선택된 프리셋이 없습니다.\n현재 설정을 내보내시겠습니까?")) await exportPreset(null, "zip", editingPetId);
        } catch (error) {
            alert(`프리셋 내보내기에 실패했습니다: ${error.message}`);
        }
    });
    $("#stvp-preset-import").on("click", () => $("#stvp-preset-import-file").click());
    $("#stvp-preset-select").on("change", function() { presetSelections[editingPetId] = this.value; renderPresetPreview(); });
    $("#stvp-preset-import-file").on("change", async function() {
        const version = ++presetImportSelectionVersion;
        const file = this.files[0];
        if (!file) return;
        selectedImportFile = null;
        $("#stvp-import-preview").prop("hidden", true);
        try {
            if (file.size > SHARED_FILE_LIMIT) throw new Error("공유 프리셋 파일이 96MB를 넘습니다.");
            const data = await readPortableFile(file);
            if (version !== presetImportSelectionVersion) return;
            if (!["SaiPet-Preset", "ST-Virtual-Pet-Preset"].includes(data?._type)
                || !data?.preset?.appearance || !data?.preset?.personality || !data?.preset?.customSpeeches) {
                throw new Error("SaiPet 공유 프리셋 형식이 아닙니다.");
            }
            validatePreset(data.preset);
            selectedImportFile = file;
            const preset = data.preset;
            const sprites = Object.values(preset.appearance.customSprites || {}).filter(Boolean);
            const image = preset.appearance.customSprites?.idle || sprites[0] || preset.walk?.walkSprite;
            $("#stvp-import-preview-name").text(preset.name || preset.personality.name || "이름 없는 프리셋");
            $("#stvp-import-preview-info").text(`이미지 ${sprites.length}개 · ${data._type === "ST-Virtual-Pet-Preset" ? "구버전 공유 파일" : "SaiPet 공유 파일"}`);
            const previewImage = document.getElementById("stvp-import-preview-image");
            previewImage.hidden = !image;
            if (image) previewImage.src = resolveSpriteSource(image);
            $("#stvp-import-preview").prop("hidden", false);
        } catch (error) {
            if (version !== presetImportSelectionVersion) return;
            alert(`프리셋 미리보기에 실패했습니다: ${error.message}`);
        }
    });
    $("#stvp-import-confirm").on("click", async function() {
        if (!selectedImportFile) return;
        this.disabled = true;
        if (await importPreset(selectedImportFile)) {
            updatePresetList();
            updateUIValues();
            alert("프리셋을 가져왔습니다. 불러오기에서 선택하십시오.");
        }
        selectedImportFile = null;
        $("#stvp-import-preview").prop("hidden", true);
        $("#stvp-preset-import-file").val("");
        this.disabled = false;
    });
    $("#stvp-reset-all").on("click", async () => {
        const scope = $("#stvp-reset-scope").val();
        const descriptions = {
            settings: "공통 확장 설정을 기본값으로 되돌립니다. 프리셋·현재 캐릭터·기록·개인 메모·등록한 알림·펫하우스 꾸미기는 유지됩니다.",
            presets: "저장된 캐릭터 프리셋 보관함을 비웁니다. 현재 화면의 캐릭터·공통 설정·기록은 유지됩니다.",
            all: "프리셋·현재 캐릭터 설정·기록·개인 메모·알림·펫하우스를 포함한 모든 사이펫 데이터를 초기화합니다.",
        };
        if (!descriptions[scope] || !confirm(descriptions[scope] + "\n계속하시겠습니까?")) return;
        try {
            await resetAllSettings(scope);
            presetSelections.primary = presetSelections.secondary = null;
            updateUIValues(); updatePresetList();
            alert("선택한 범위를 초기화했습니다.");
        } catch (error) { alert("초기화 실패: " + error.message); }
    });
}

function bindPairEvents() {
    $("#stvp-social-enabled").on("change", function() {
        state.settings.multiPet.visualInteractions = this.checked; rememberPairSettings(); startSocial(); saveSettings();
    });
    $("#stvp-visual-relation").on("change", function() {
        state.settings.multiPet.visualRelation = this.value; rememberPairSettings(); refreshSocialActions(); stopSocial(); startSocial(); saveSettings();
    });
    $("#stvp-social-preview").on("click", () => {
        if (!playSocialInteraction({ preview: true, action: $("#stvp-social-action").val() })) alert("두 펫이 모두 화면에 있고 잠자기·드래그·대화·이전 반응이 끝난 뒤 다시 눌러 주십시오.");
    });
    $("#stvp-multi-dual-talk").on("change", function() {
        if (!state.settings.multiPet) return;
        state.settings.multiPet.dualDirectTalk = this.checked; rememberPairSettings();
        saveSettings();
    });
    $("#stvp-multi-pet-relation").on("change", function() {
        if (!state.settings.multiPet) return;
        state.settings.multiPet.petRelation = this.value.trim(); rememberPairSettings();
        saveSettings();
    });
    const restartInterPet = () => import("./pet-reactions.js").then(({ startInterPetChatTimer }) => startInterPetChatTimer());
    $("#stvp-multi-interpet-enabled").on("change", function() {
        if (!state.settings.multiPet) return;
        state.settings.multiPet.interPetChat ||= { enabled: false, interval: 5 };
        state.settings.multiPet.interPetChat.enabled = this.checked; rememberPairSettings();
        saveSettings();
        restartInterPet();
    });
    $("#stvp-multi-interpet-interval").on("input", function() {
        $("#stvp-multi-interpet-interval-label").text(this.value);
    }).on("change", function() {
        if (!state.settings.multiPet?.interPetChat) return;
        state.settings.multiPet.interPetChat.interval = parseInt(this.value) || 5; rememberPairSettings();
        scheduleUISettingsSave();
        restartInterPet();
    });
}

function bindDisplayEvents() {
    const refreshDeviceActivation = async device => {
        saveSettings();
        refreshHeroStatus();
        if ((device === "mobile") !== state.isMobile) return;
        const { activatePet, deactivatePet } = await import("../index.js");
        if (isDeviceEnabled()) activatePet();
        else deactivatePet();
    };
    $("#stvp-pc-enabled").on("change", function() {
        state.settings.deviceDisplay.pcEnabled = this.checked;
        refreshDeviceActivation("pc");
    });
    $("#stvp-mobile-enabled").on("change", function() {
        state.settings.deviceDisplay.mobileEnabled = this.checked;
        $("#stvp-mobile-controls").prop("open", this.checked);
        refreshDeviceActivation("mobile");
    });
    $("#stvp-mobile-size").on("change", function() {
        const entered = Number(this.value);
        state.settings.deviceDisplay.mobile.size = entered === 0 ? null : Math.max(80, Math.min(240, entered || 110));
        this.value = state.settings.deviceDisplay.mobile.size ?? 0;
        saveSettings();
        if (state.isMobile && isPetActive()) {
            for (const petId of PET_IDS) { updatePetSize(petId); clampPetPosition(petId); }
        }
    });
    for (const [selector, key] of [["#stvp-mobile-position", "position"], ["#stvp-mobile-second-position", "secondPetPosition"]]) {
        $(selector).on("change", function() {
            const position = state.settings.deviceDisplay.mobile[key];
            position.location = this.value;
            position.customX = null;
            position.customY = null;
            saveSettings();
            if (state.isMobile && isPetActive()) clampPetPosition(key === "position" ? "primary" : "secondary");
        });
    }
    $("#stvp-mobile-walk-range").on("input", function() {
        $("#stvp-mobile-walk-range-label").text(this.value);
    }).on("change", function() {
        state.settings.deviceDisplay.mobile.walkRange = Math.max(0, Math.min(160, Number(this.value) || 0));
        saveSettings();
    });
    $("#stvp-mobile-walk-enabled").on("change", function() {
        state.settings.deviceDisplay.mobile.walkEnabled = this.value === "inherit" ? null : this.value === "on";
        saveSettings();
        if (state.isMobile && isPetActive()) {
            for (const petId of PET_IDS) { stopWalking(petId); startWalking(petId); }
        }
    });
    $("#stvp-mobile-speech-enabled").on("change", function() {
        state.settings.deviceDisplay.mobile.speechEnabled = this.value === "inherit" ? null : this.value === "on";
        saveSettings();
        if (state.isMobile && isPetActive()) clearSpeechTimers();
    });
    $("#stvp-mobile-speech-mode").on("change", function() {
        state.settings.deviceDisplay.mobile.speechMode = this.value === "bubble" ? "bubble" : "bar";
        saveSettings();
        if (state.isMobile && isPetActive()) clearSpeechTimers();
    });

    $("#stvp-size").on("input", function() {
        state.settings.appearance.size = Math.min(500, Math.max(20, parseInt(this.value) || 20));
        for (const petId of PET_IDS) updatePetSize(petId);
        scheduleUISettingsSave();
    });
    $("#stvp-opacity").on("input", function() {
        const opacity = Math.min(100, Math.max(10, parseInt(this.value) || 10));
        state.settings.appearance.opacity = opacity;
        $("#stvp-opacity-label").text(opacity);
        updatePetOpacity();
        scheduleUISettingsSave();
    });
    $("#stvp-bubble-enabled").on("change", function() {
        state.settings.speechBubble.enabled = this.checked;
        saveSettings();
    });
    $("#stvp-bubble-duration").on("change", function() {
        const seconds = Math.min(30, Math.max(1, Number(this.value) || 3));
        state.settings.speechBubble.duration = Math.round(seconds * 1000);
        this.value = seconds;
        saveSettings();
    });
    $("#stvp-bubble-max-width").on("input", function() {
        const width = parseInt(this.value) || 360;
        $("#stvp-bubble-max-width-label").text(width);
        state.settings.speechBubble.maxWidth = width;
        scheduleUISettingsSave();
        for (const petId of PET_IDS) applyDesignTheme(petId);
        refreshBubbleSample();
    });
    $("#stvp-draggable").on("change", function() {
        state.settings.position.draggable = this.checked;
        saveSettings();
    });
    $("#stvp-walk-direction").on("change", function() {
        state.settings.motion ||= {};
        state.settings.motion.walkDirection = WALK_DIRECTIONS.includes(this.value) ? this.value : "nearby";
        stopSocial(); cancelCollisionReaction();
        for (const petId of PET_IDS) stopWalking(petId);
        saveSettings();
        for (const petId of PET_IDS) startWalking(petId);
        startSocial();
    });
    $("#stvp-walk-enabled").on("change", function() {
        state.settings.walk ||= { enabled: false, walkSprite: null };
        state.settings.walk.enabled = this.checked;
        stopSocial(); startSocial();
        saveSettings();
        if (!this.checked) { for (const petId of PET_IDS) stopWalking(petId); return; }
        startWalking("primary");
        if (state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData) startWalking("secondary");
    });
    $("#stvp-collision-reaction").on("change", function() {
        state.settings.motion ||= {};
        state.settings.motion.collisionReaction = this.checked;
        if (!this.checked) cancelCollisionReaction();
        saveSettings();
    });
}

function bindAIEvents() {
    $("#stvp-use-cm").on("change", function() {
        state.settings.api.useConnectionManager = this.checked;
        saveSettings();
        $("#stvp-cm-profile-row").toggle(this.checked);
    });
    $("#stvp-cm-profile").on("change", function() {
        state.settings.api.connectionProfile = this.value;
        saveSettings();
    });
    for (const [id, key] of [["stvp-max-tokens", "maxTokens"], ["stvp-max-input-tokens", "maxInputTokens"], ["stvp-direct-memory-count", "directMemoryCount"], ["stvp-pair-memory-count", "pairMemoryCount"]]) {
        $("#" + id).on("change", function() {
            const n = Number(this.value);
            if (!Number.isSafeInteger(n) || n < 0) { this.value = state.settings.api[key]; return; }
            state.settings.api[key] = n;
            updateMemorySummary(); saveSettings();
        });
    }
    $("#stvp-speech-language").on("change", function() {
        state.settings.speechLanguage = this.value;
        saveSettings();
    });
    $("#stvp-ai-enabled").on("change", function() {
        state.settings.personality.enabled = this.checked;
        saveSettings();
        $("#stvp-ai-settings").toggle(this.checked);
    });
    $("#stvp-reaction-interval").on("input", function() {
        $("#stvp-reaction-interval-label").text(this.value);
    }).on("change", function() {
        state.settings.reactions.reactionInterval = parseInt(this.value) || 3;
        scheduleUISettingsSave();
    });
    $("#stvp-reaction-mode").on("change", function() {
        state.settings.api.reactionMode = this.value;
        saveSettings();
    });
    $("#stvp-multi-chat-reactor").on("change", function() {
        if (!state.settings.multiPet) return;
        state.settings.multiPet.chatReactor = this.value;
        saveSettings();
    });
    $("#stvp-history-count").on("input", function() {
        $("#stvp-history-count-label").text(this.value);
    }).on("change", function() {
        state.settings.api.historyCount = parseInt(this.value) || 5;
        scheduleUISettingsSave();
    });
    $("#stvp-include-worldinfo").on("change", function() {
        state.settings.api.includeWorldInfo = this.checked;
        saveSettings();
    });
    $("#stvp-time-aware").on("change", function() {
        state.settings.api.timeAware = this.checked;
        saveSettings();
    });
}

function bindLifeEvents() {
    $("#stvp-house-open").on("click", openHouse);
    $("#stvp-open-journal-popup").on("click", openJournal);
    $("#stvp-reminder-sound").on("change", function() { state.settings.reminderSound = this.checked; saveSettings(); });
    const journal = () => state.settings.petJournal ||= {};
    $("#stvp-journal-dream-enabled").on("change", function() {
        journal().dreamEnabled = this.checked;
        saveSettings();
    });
    $("#stvp-journal-max-dreams").on("input", function() {
        const value = parseInt(this.value);
        $("#stvp-journal-max-dreams-label").text(value === 0 ? "∞" : value);
        journal().maxDreamsPerDay = value;
        scheduleUISettingsSave();
    });
    $("#stvp-journal-diary-enabled").on("change", function() {
        journal().diaryEnabled = this.checked;
        $("#stvp-auto-diary-section").toggle(this.checked);
        saveSettings();
    });
    $("#stvp-diary-writer").on("change", function() {
        journal().diaryWriter = this.value;
        saveSettings();
    });
    $("#stvp-auto-diary-enabled").on("change", function() {
        (state.settings.autoDiary ||= {}).enabled = this.checked;
        saveSettings();
    });
    $("#stvp-auto-diary-min-chats").on("input", function() {
        const value = parseInt(this.value);
        $("#stvp-auto-diary-min-chats-label").text(value);
        (state.settings.autoDiary ||= {}).minChats = value;
        scheduleUISettingsSave();
    });
    $("#stvp-auto-diary-minutes").on("change", function() {
        const n = Number(this.value);
        if (!Number.isSafeInteger(n) || n < 0) { this.value = state.settings.autoDiary.minSessionMinutes; return; }
        state.settings.autoDiary.minSessionMinutes = n; saveSettings();
    });
}

function bindUIEvents() {
    $(".stvp-tab").on("click", function() { selectTab(this.dataset.tab); });
    let savedTab = null;
    try { savedTab = localStorage.getItem(TAB_KEY); } catch {}
    if (savedTab && document.querySelector(`.stvp-tab[data-tab="${CSS.escape(savedTab)}"]`)) selectTab(savedTab);
    $("#stvp-enabled").on("change", async function() {
        if (!this.checked) return;
        if (state.storageBlocked) {
            this.checked = false;
            return;
        }
        setMasterEnabled(true);
        refreshHeroStatus();
        const { activatePet } = await import("../index.js");
        if (this.checked && state.settings.enabled) activatePet();
    });
    bindPetEditorEvents();
    bindPresetEvents();
    bindPairEvents();
    bindDisplayEvents();
    bindAIEvents();
    bindLifeEvents();
}

function storageNotice(tone, icon, text) {
    const notice = document.createElement("div");
    notice.className = "stvp-notice";
    notice.dataset.tone = tone;
    notice.innerHTML = `<i class="fa-solid ${icon}"></i><div class="stvp-notice-body"><p></p><div class="stvp-notice-actions"></div></div>`;
    notice.querySelector("p").textContent = text;
    return notice;
}

function noticeButton(notice, className, label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `stvp-btn ${className}`;
    button.textContent = label;
    button.addEventListener("click", onClick);
    notice.querySelector(".stvp-notice-actions").append(button);
    return button;
}

function updateStorageStatus() {
    const el = document.getElementById("stvp-storage-status");
    if (!el) return;
    const { mode, error } = getStorageStatus();
    const paused = PAUSED_MODES.includes(mode);
    el.replaceChildren();
    el.dataset.mode = mode;
    const legacyOnly = mode === "blocked" && state.settings?._storageVersion === 1;
    const messages = {
        blocked: ["danger", "fa-plug-circle-xmark", `저장 공간을 확인할 수 없어 사이펫을 잠시 멈췄습니다. 실리태번 연결을 확인하고 새로고침해 주십시오. (${error})`],
        legacy: ["warn", "fa-plug-circle-exclamation", `실리태번 사용자 파일에 연결하지 못해 설정 안에 저장하고 있습니다.${error ? ` (${error})` : ""}`],
        conflict: ["danger", "fa-code-merge", "두 기기에서 같은 항목을 고쳐 자동으로 합치지 못했습니다. 지금 데이터를 받아 둔 뒤 새로고침해 주십시오."],
        error: ["danger", "fa-triangle-exclamation", `서버 저장 오류: ${error || "알 수 없는 오류"}. 사이펫을 잠시 멈췄습니다. 연결을 확인한 뒤 다시 저장해 주십시오.`],
    };
    if (mode === "server" && error) el.append(storageNotice("warn", "fa-circle-info", `저장 안내: ${error}`));
    else if (messages[mode]) el.append(storageNotice(...messages[mode]));

    const notice = el.querySelector(".stvp-notice");
    if (paused && notice) {
        notice.querySelector("p").append(" 받은 파일은 새로고침한 뒤 데이터 탭 › 백업에서 복원으로 되살릴 수 있습니다.");
        noticeButton(notice, "stvp-storage-backup", legacyOnly ? "이 기기에 남은 설정 받기" : "지금 데이터 받기", () => {
            const blob = new Blob([JSON.stringify(emergencyBackup())], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `saipet-unsaved-backup-${Date.now()}.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
    }
    if (mode === "error" && notice) {
        const retryButton = noticeButton(notice, "stvp-storage-retry stvp-btn-primary", "다시 저장", async () => {
            retryButton.disabled = true;
            try {
                await retryServerSave();
            } catch (retryError) {
                alert(`다시 저장하지 못했습니다: ${retryError.message}`);
                retryButton.disabled = false;
            }
        });
    }
    el.hidden = !el.childElementCount;

    document.querySelectorAll("#saipet-settings :is(input, button, select, textarea)").forEach(control => {
        if (control.id === "stvp-enabled" || control.matches(".stvp-tab, .stvp-tip-btn")) {
            control.disabled = false;
            storageDisabledControls.delete(control);
            return;
        }
        if (control.matches(".stvp-storage-backup, .stvp-storage-retry")) return;
        if (paused && !control.disabled) {
            control.disabled = true;
            storageDisabledControls.add(control);
        } else if (!paused && storageDisabledControls.has(control)) {
            control.disabled = false;
            storageDisabledControls.delete(control);
        }
    });
    refreshHeroStatus();
}

function setImagePreview(container, src, alt) {
    if (!container) return;
    container.textContent = "";
    container.classList.toggle("has-image", Boolean(src));
    if (!src) {
        const placeholder = document.createElement("span");
        placeholder.className = "stvp-sprite-placeholder";
        placeholder.textContent = "+";
        container.appendChild(placeholder);
        return;
    }
    const img = document.createElement("img");
    img.loading = "lazy";
    img.src = resolveSpriteSource(src);
    img.alt = alt;
    container.appendChild(img);
}

const setRange = (id, value, label = value) => {
    $("#" + id).val(value);
    $(`#${id}-label`).text(label);
};

function updateUIValues() {
    const s = state.settings, c = editedPet();
    const mobile = s.deviceDisplay?.mobile || {};
    $("#stvp-enabled").prop("checked", s.enabled);
    $("#stvp-pc-enabled").prop("checked", s.deviceDisplay?.pcEnabled !== false);
    $("#stvp-mobile-enabled").prop("checked", s.deviceDisplay?.mobileEnabled === true);
    $("#stvp-mobile-size").val(mobile.size ?? 0);
    $("#stvp-mobile-position").val(mobile.position?.location || "bottom-right");
    $("#stvp-mobile-second-position").val(mobile.secondPetPosition?.location || "bottom-left");
    setRange("stvp-mobile-walk-range", mobile.walkRange ?? 80);
    $("#stvp-mobile-walk-enabled").val(mobile.walkEnabled == null ? "inherit" : mobile.walkEnabled ? "on" : "off");
    $("#stvp-mobile-speech-enabled").val(mobile.speechEnabled == null ? "inherit" : mobile.speechEnabled ? "on" : "off");
    $("#stvp-mobile-speech-mode").val(mobile.speechMode || "bar");

    $("#stvp-size").val(s.appearance.size);
    $("#stvp-character-scale").val(c.appearance.scale || 100);
    $("#stvp-collision-reaction").prop("checked", s.motion?.collisionReaction !== false);
    refreshSocialActions();
    $("#stvp-social-enabled").prop("checked", s.multiPet?.visualInteractions !== false);
    $("#stvp-visual-relation").val(s.multiPet?.visualRelation || "friends");
    $("#stvp-flip").prop("checked", c.appearance.flipHorizontal);
    setRange("stvp-opacity", s.appearance.opacity ?? 100);
    for (const [moodId, data] of Object.entries(c.appearance.customSprites || {})) {
        setImagePreview(document.getElementById(`stvp-preview-${moodId}`), data || null, moodId);
        $(`.stvp-sprite-clear[data-mood="${moodId}"]`).toggle(Boolean(data));
    }
    $("#stvp-position").val((editingPetId === "secondary" ? s.multiPet.secondPetPosition : s.position).location);
    $("#stvp-draggable").prop("checked", s.position.draggable);
    $("#stvp-walk-enabled").prop("checked", s.walk?.enabled);
    $("#stvp-walk-direction").val(WALK_DIRECTIONS.includes(s.motion?.walkDirection) ? s.motion.walkDirection : "nearby");
    refreshWalkControls();

    $(".stvp-speech-textarea").val("");
    for (const [moodId, speeches] of Object.entries(c.customSpeeches || {})) {
        $(`#stvp-speech-${moodId}`).val(Array.isArray(speeches) ? speeches.join("\n") : "");
    }

    $("#stvp-ai-enabled").prop("checked", s.personality.enabled);
    $("#stvp-ai-settings").toggle(Boolean(s.personality.enabled));
    setRange("stvp-reaction-interval", s.reactions.reactionInterval || 3);
    $("#stvp-pet-name").val(c.personality.name);
    $("#stvp-personality-prompt").val(c.personality.prompt);
    $("#stvp-user-relation").val(c.personality.userRelation || "");
    $("#stvp-owner-name").val(c.personality.ownerName || "");
    $("#stvp-owner-persona").val(c.personality.ownerPersona || "");
    $("#stvp-cultural-background").val(c.personality.culturalBackground || "");
    renderMemoList();
    $("#stvp-reaction-mode").val(s.api.reactionMode || "observer");
    $("#stvp-include-worldinfo").prop("checked", s.api.includeWorldInfo || false);
    setRange("stvp-history-count", s.api.historyCount || 6);
    $("#stvp-use-cm").prop("checked", s.api.useConnectionManager);
    $("#stvp-cm-profile-row").toggle(Boolean(s.api.useConnectionManager));
    $("#stvp-cm-profile").val(s.api.connectionProfile);
    $("#stvp-max-tokens").val(s.api.maxTokens ?? 0);
    $("#stvp-max-input-tokens").val(s.api.maxInputTokens ?? 0);
    $("#stvp-direct-memory-count").val(s.api.directMemoryCount ?? 30);
    $("#stvp-pair-memory-count").val(s.api.pairMemoryCount ?? 15);
    $("#stvp-time-aware").prop("checked", s.api.timeAware !== false);
    $("#stvp-reminder-sound").prop("checked", s.reminderSound !== false);
    $("#stvp-auto-diary-minutes").val(s.autoDiary?.minSessionMinutes ?? 5);
    updateMemorySummary();

    $("#stvp-bubble-enabled").prop("checked", s.speechBubble.enabled);
    $("#stvp-bubble-font").val(c.speechBubble.font || "default");
    setRange("stvp-bubble-max-width", s.speechBubble.maxWidth || 360);
    $("#stvp-bubble-duration").val((s.speechBubble.duration || 3000) / 1000);
    refreshBubbleColorInputs();
    refreshFontPreview();
    $("#stvp-fallback-no-response").val(c.fallbackMessages?.noResponse || "");
    $("#stvp-fallback-api-error").val(c.fallbackMessages?.apiError || "");
    $("#stvp-speech-language").val(s.speechLanguage || "ko");
    const mp = s.multiPet || {};
    $("#stvp-multi-chat-reactor").val(mp.chatReactor || "primary");
    $("#stvp-multi-dual-talk").prop("checked", mp.dualDirectTalk || false);
    $("#stvp-multi-pet-relation").val(mp.petRelation || "");
    $("#stvp-multi-interpet-enabled").prop("checked", mp.interPetChat?.enabled || false);
    setRange("stvp-multi-interpet-interval", mp.interPetChat?.interval || 5);

    refreshLogViewer();
    const journal = s.petJournal || {};
    $("#stvp-journal-dream-enabled").prop("checked", journal.dreamEnabled !== false);
    const maxDreams = journal.maxDreamsPerDay ?? 3;
    setRange("stvp-journal-max-dreams", maxDreams, maxDreams === 0 ? "∞" : maxDreams);
    $("#stvp-journal-diary-enabled").prop("checked", journal.diaryEnabled !== false);
    $("#stvp-auto-diary-section").toggle(journal.diaryEnabled !== false);
    $("#stvp-diary-writer").val(journal.diaryWriter || "primary");
    updateJournalPetFilter();
    refreshJournalViewer();
    refreshReminderList();
    $("#stvp-reminder-pet-id").val(s.reminderPetId || "primary");
    const autoDiary = s.autoDiary || {};
    $("#stvp-auto-diary-enabled").prop("checked", autoDiary.enabled || false);
    setRange("stvp-auto-diary-min-chats", autoDiary.minChats || 5);

    refreshHeroStatus();
    refreshPetEditorHeader();
}

function updatePresetList() {
    const presets = getPresetList();
    const $select = $("#stvp-preset-select");
    const selected = presetSelections[editingPetId];
    $select.empty();
    $select.append('<option value="">-- 선택 --</option>');
    $select.append($('<optgroup label="기본 제공">').append(new Option("기본 미유", BUILTIN_MIYU)));
    if (presets.length) {
        $select.append($('<optgroup label="내 프리셋">').append(presets.map(preset => new Option(String(preset.name || ""), String(preset.id || "")))));
    }
    const selectedExists = selected === BUILTIN_MIYU || presets.some(p => p.id === selected);
    $select.val(selectedExists ? selected : currentPresetId(editingPetId) || "");
    renderPresetPreview();
    refreshPresetStatus();
}

function renderPresetPreview() {
    const root = document.getElementById("stvp-preset-preview");
    if (!root) return;
    root.replaceChildren();
    const id = document.getElementById("stvp-preset-select")?.value;
    const preset = id === BUILTIN_MIYU ? null : getPresetList().find(item => String(item.id) === id);
    if (id !== BUILTIN_MIYU && !preset) {
        root.hidden = true;
        return;
    }
    root.hidden = false;
    const images = Object.values(preset?.appearance?.customSprites || {}).filter(Boolean);
    const imageUrl = preset ? preset.appearance?.customSprites?.idle || images[0] || preset.walk?.walkSprite : DEFAULT_SPRITES.idle;
    if (imageUrl) {
        const image = document.createElement("img");
        image.src = resolveSpriteSource(imageUrl);
        image.alt = "";
        root.append(image);
    }
    const info = document.createElement("div");
    const title = document.createElement("strong");
    const detail = document.createElement("small");
    title.textContent = preset ? preset.name || "이름 없는 프리셋" : "기본 미유";
    detail.textContent = preset
        ? `${preset.personality?.name || "캐릭터 이름 없음"} · 이미지 ${images.length}개`
        : "기본 제공 · 불러오면 이름·성격·이미지·대사가 기본값으로 돌아갑니다";
    info.append(title, detail);
    root.append(info);
}

function renderMemoList() {
    const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
    const container = document.getElementById("stvp-memo-list");
    if (!container) return;
    const memos = editedPet().personality.personalMemos || [];
    if (!memos.length) {
        container.innerHTML = '<div class="stvp-empty stvp-empty-sm"><span>아직 메모가 없습니다</span></div>';
        return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    container.innerHTML = memos.map((memo, index) => {
        const recurring = memo.recurDays?.length > 0;
        const expired = memo.date && !recurring && new Date(memo.date + "T00:00:00") < today;
        const meta = [memo.date, recurring ? `매주 ${memo.recurDays.map(d => DAY_NAMES[d]).join("·")}` : ""].filter(Boolean).join(" · ");
        return `<div class="stvp-memo-item${expired ? " stvp-memo-expired" : ""}">
            <span class="stvp-memo-tag" data-tag="${escapeHtml(memo.tag)}">${escapeHtml(memo.tag)}</span>
            <span class="stvp-memo-text"><span class="stvp-memo-content">${escapeHtml(memo.content)}</span>${meta ? `<small>${escapeHtml(meta)}</small>` : ""}</span>
            <button type="button" class="stvp-memo-delete-btn" data-idx="${index}" title="삭제" aria-label="메모 삭제"><i class="fa-solid fa-xmark"></i></button>
        </div>`;
    }).join("");
}

let uiSaveTimer = null;
function scheduleUISettingsSave() {
    clearTimeout(uiSaveTimer);
    uiSaveTimer = setTimeout(() => { uiSaveTimer = null; saveSettings(); refreshPresetStatus(); }, 250);
}

function refreshPresetStatus() {
    const node = document.getElementById("stvp-preset-status");
    if (!node) return;
    const preset = getPresetList().find(p => p.id === currentPresetId(editingPetId));
    const dirty = hasPresetChanges(editingPetId);
    const name = preset?.name || editedPet().personality?.name || "새 캐릭터";
    const status = dirty ? "dirty" : preset ? "saved" : "new";
    const detail = { dirty: "저장 안 한 변경 있음", saved: "프리셋과 같음", new: "아직 프리셋으로 저장 안 함" }[status];
    const key = `${status}\n${name}`;
    if (node.dataset.key !== key) {
        node.dataset.key = key;
        node.dataset.state = status;
        node.innerHTML = `<span class="stvp-dot"></span><b title="${escapeHtml(name)}">${escapeHtml(name)}</b><span>사용 중 · ${detail}</span>`;
    }
    refreshPetEditorHeader();
}

function refreshWalkControls() {
    const walk = editedPet().walk || {};
    const frames = walk.animationMode === "frames";
    $("#stvp-walk-mode").val(frames ? "frames" : "motion");
    $("#stvp-walk2-sprite-item").prop("hidden", !frames);
    for (const [prefix, key] of [["stvp-walk", "walkSprite"], ["stvp-walk2", "walkSprite2"]]) {
        setImagePreview(document.getElementById(`${prefix}-preview`), walk[key] || null, "walk");
        $(`#${prefix}-sprite-clear`).toggle(Boolean(walk[key]));
    }
    $("#stvp-walk-hint").text(frames
        ? "두 이미지를 0.3초마다 번갈아 보여줍니다. 크기와 발 위치를 맞추면 자연스럽습니다." + (!walk.walkSprite || !walk.walkSprite2 ? " 두 장을 모두 넣기 전에는 1장 방식으로 움직입니다." : "")
        : "걷기 1 이미지를 살짝 흔들며 걷습니다. 비워 두면 현재 캐릭터 이미지를 사용합니다. 화면과 펫하우스에 함께 적용됩니다.");
}

const bubbleDesign = id => BUBBLE_DESIGNS[id] || BUBBLE_DESIGNS.simple;

function refreshBubbleColorInputs() {
    const c = editedPet();
    $("#stvp-bubble-bg").val(c.speechBubble.backgroundColor);
    $("#stvp-bubble-text-color").val(c.speechBubble.textColor);
    $("#stvp-bubble-accent-color").val(c.speechBubble.accentColor || "#7c9bff");
}

function refreshBubbleSample(live = {}) {
    const preview = document.getElementById("stvp-bubble-preview"), picker = document.getElementById("stvp-bubble-design");
    if (!preview) return;
    const bubble = { ...editedPet().speechBubble, ...live };
    const design = BUBBLE_DESIGNS[bubble.design] ? bubble.design : "simple";
    preview.dataset.design = design;
    for (const node of [preview, picker]) {
        node.style.setProperty("--spc-bubble-bg", bubble.backgroundColor || "#ffffff");
        node.style.setProperty("--bubble-bg-color", bubble.backgroundColor || "#ffffff");
        node.style.setProperty("--spc-bubble-text", bubble.textColor || "#333333");
        node.style.setProperty("--spc-accent", bubble.accentColor || "#7c9bff");
    }
    preview.style.setProperty("--spc-bubble-max-w", `${state.settings.speechBubble?.maxWidth || 360}px`);
    for (const card of picker.querySelectorAll(".stvp-design-card")) {
        const selected = card.dataset.design === design;
        card.setAttribute("aria-checked", String(selected));
        card.tabIndex = selected ? 0 : -1;
    }
}

let fontPreviewVersion = 0;
function refreshFontPreview() {
    const node = document.getElementById("stvp-font-preview");
    if (!node) return;
    refreshBubbleSample();
    const key = editedPet().speechBubble?.font, version = ++fontPreviewVersion;
    node.textContent = "가나다 · あいう · 오늘도 함께 걸어요!";
    applyFont(node, key).then(loaded => {
        if (version === fontPreviewVersion && key && key !== "default" && !loaded) node.textContent = "글꼴을 불러오지 못해 기본 글꼴로 표시합니다. 연결을 확인하고 새로고침해 주십시오.";
    });
}

function updateMemorySummary() {
    for (const [id, key, fallback] of [["direct", "directMemoryCount", 30], ["pair", "pairMemoryCount", 15]]) {
        const count = state.settings.api[key] ?? fallback;
        $("#stvp-" + id + "-memory-summary").text(count === 0 ? "저장된 전체 기록" : `최근 ${count}건`);
    }
}
