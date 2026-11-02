import { state } from "./state.js";
import { saveSettings } from "./storage.js";
import { escapeHtml } from "./ui-kit.js";

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const MAX_REMINDERS = 10;
const restartTimer = () => import("./pet-reactions.js").then(({ startReminderTimer }) => startReminderTimer());

function daysLabel(reminder) {
    const days = reminder.days;
    if (!days?.length) return "한 번";
    if (days.length === 7) return "매일";
    const sorted = [...days].sort((a, b) => a - b).join(",");
    if (sorted === "1,2,3,4,5") return "평일";
    if (sorted === "0,6") return "주말";
    return [...days].sort((a, b) => a - b).map(day => DAY_NAMES[day]).join("");
}

export function refreshReminderList() {
    const container = document.getElementById("stvp-reminder-list");
    if (!container) return;
    const reminders = state.settings.reminders || [];
    if (!reminders.length) {
        container.innerHTML = '<div class="stvp-empty"><i class="fa-solid fa-bell-slash"></i><span>등록된 알림이 없습니다</span></div>';
        return;
    }
    container.innerHTML = reminders.map(r => {
        const interval = r.mode === "interval";
        return `<div class="stvp-reminder-item${r.enabled ? "" : " stvp-reminder-disabled"}" data-rid="${escapeHtml(r.id)}">
            <span class="stvp-reminder-time">${interval ? `${r.intervalMinutes || 30}<small>분마다</small>` : escapeHtml(r.time)}</span>
            <span class="stvp-reminder-text"><span class="stvp-reminder-msg">${escapeHtml(r.message)}</span><small class="stvp-reminder-repeat">${interval ? "접속 중 반복" : escapeHtml(daysLabel(r))}</small></span>
            <button type="button" class="stvp-reminder-edit" data-rid="${escapeHtml(r.id)}" title="수정" aria-label="알림 수정"><i class="fa-solid fa-pen"></i></button>
            <input type="checkbox" class="stvp-switch stvp-switch-sm stvp-reminder-toggle" data-rid="${escapeHtml(r.id)}" aria-label="알림 켜기"${r.enabled ? " checked" : ""}>
            <button type="button" class="stvp-reminder-delete" data-rid="${escapeHtml(r.id)}" title="삭제" aria-label="알림 삭제"><i class="fa-solid fa-xmark"></i></button>
        </div>`;
    }).join("");
}

function showMode(mode) {
    $("#stvp-reminder-mode").val(mode);
    $(".stvp-reminder-mode-btn").removeClass("active").filter(`[data-mode="${mode}"]`).addClass("active");
    $("#stvp-reminder-time-section").toggle(mode !== "interval");
    $("#stvp-reminder-interval-section").toggle(mode === "interval");
}

function openForm(editId) {
    $("#stvp-reminder-edit-id").val(editId || "");
    $("#stvp-reminder-confirm-label").text(editId ? "저장" : "추가");
    $("#stvp-reminder-form").show();
    $("#stvp-reminder-add-btn").hide();
}

function closeForm() {
    $("#stvp-reminder-form").hide();
    $("#stvp-reminder-add-btn").show();
}

function selectedDays() {
    return $(".stvp-day-btn.active").map(function() { return Number(this.dataset.day); }).get();
}

function saveReminder() {
    const editId = $("#stvp-reminder-edit-id").val();
    const interval = $("#stvp-reminder-mode").val() === "interval";
    const reminders = state.settings.reminders ||= [];
    const existing = editId ? reminders.find(r => r.id === editId) : null;
    if (!existing && reminders.length >= MAX_REMINDERS) return alert(`알림은 최대 ${MAX_REMINDERS}개까지 등록할 수 있습니다.`);

    let next;
    if (interval) {
        const minutes = parseInt($("#stvp-reminder-interval-min").val()) || 30;
        const message = $("#stvp-reminder-interval-message").val().trim();
        if (!message) return alert("알림 내용을 입력해 주십시오.");
        if (minutes < 10) return alert("최소 간격은 10분입니다.");
        next = { mode: "interval", intervalMinutes: minutes, message, time: null, days: null };
    } else {
        const time = $("#stvp-reminder-time").val();
        const message = $("#stvp-reminder-message").val().trim();
        if (!time) return alert("알림 시각을 정해 주십시오.");
        if (!message) return alert("알림 내용을 입력해 주십시오.");
        next = { mode: "time", time, message, days: selectedDays(), lastTriggered: null };
    }
    if (existing) Object.assign(existing, next);
    else reminders.push({ id: "rem_" + Date.now(), enabled: true, lastTriggered: null, ...next });

    saveSettings();
    refreshReminderList();
    closeForm();
    restartTimer();
}

export function bindReminderUI() {
    const list = document.getElementById("stvp-reminder-list");
    $(document).on("click", ".stvp-day-btn", function() { $(this).toggleClass("active"); });
    $(document).on("click", ".stvp-day-preset", function() {
        const $days = $(".stvp-day-btn").removeClass("active");
        const preset = this.dataset.preset;
        if (preset === "daily") $days.addClass("active");
        else if (preset === "weekdays") $days.filter((_, b) => !["0", "6"].includes(b.dataset.day)).addClass("active");
        else if (preset === "weekend") $days.filter((_, b) => ["0", "6"].includes(b.dataset.day)).addClass("active");
    });
    $("#stvp-reminder-add-btn").on("click", () => {
        showMode("time");
        const soon = new Date(Date.now() + 60 * 60 * 1000);
        $("#stvp-reminder-time").val(`${String(soon.getHours()).padStart(2, "0")}:${String(soon.getMinutes()).padStart(2, "0")}`);
        $("#stvp-reminder-message, #stvp-reminder-interval-message").val("");
        $("#stvp-reminder-interval-min").val(30);
        $(".stvp-day-btn").addClass("active");
        openForm();
        document.getElementById("stvp-reminder-message")?.focus({ preventScroll: true });
    });
    $(".stvp-reminder-mode-btn").on("click", function() { showMode(this.dataset.mode); });
    $("#stvp-reminder-cancel").on("click", closeForm);
    $("#stvp-reminder-confirm").on("click", saveReminder);
    $("#stvp-reminder-pet-id").on("change", function() { state.settings.reminderPetId = this.value; saveSettings(); });

    list.addEventListener("change", event => {
        const toggle = event.target.closest(".stvp-reminder-toggle");
        const reminder = toggle && (state.settings.reminders || []).find(r => r.id === toggle.dataset.rid);
        if (!reminder) return;
        reminder.enabled = toggle.checked;
        if (toggle.checked) reminder.lastTriggered = null;
        saveSettings();
        refreshReminderList();
        restartTimer();
    });
    list.addEventListener("click", event => {
        const button = event.target.closest("button[data-rid]");
        if (!button) return;
        const id = button.dataset.rid;
        if (button.classList.contains("stvp-reminder-delete")) {
            state.settings.reminders = (state.settings.reminders || []).filter(r => r.id !== id);
            saveSettings();
            refreshReminderList();
            restartTimer();
            return;
        }
        const reminder = (state.settings.reminders || []).find(r => r.id === id);
        if (!reminder) return;
        const interval = reminder.mode === "interval";
        showMode(interval ? "interval" : "time");
        if (interval) {
            $("#stvp-reminder-interval-min").val(reminder.intervalMinutes || 30);
            $("#stvp-reminder-interval-message").val(reminder.message);
        } else {
            $("#stvp-reminder-time").val(reminder.time);
            $("#stvp-reminder-message").val(reminder.message);
        }
        $(".stvp-day-btn").removeClass("active");
        for (const day of reminder.days || []) $(`.stvp-day-btn[data-day="${day}"]`).addClass("active");
        openForm(id);
    });
    document.addEventListener("stvp-reminders-updated", refreshReminderList);
}
