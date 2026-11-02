import { state, log } from "./state.js";
import { getLogs, clearLogs, deleteLogEntry } from "./pet-ai.js";
import { dualPair } from "./ai-context.js";
import { showSpeechBubble } from "./pet-speech.js";
import { setState } from "./pet-animation.js";
import { openHouse } from "./house.js";
import { escapeHtml, gestureHtml, moodEmoji } from "./ui-kit.js";

const PAGE_SIZE = 10;
let page = 1;

const TRIGGER_LABELS = {
    aiResponse: "채팅 반응", userMessage: "유저 메시지", idle: "대기 중", click: "클릭", clickSpam: "연타",
    petting: "쓰다듬기", greeting: "인사", latenight: "심야", morning: "아침", newchat: "새 채팅",
    longAbsence: "오랜만에", feeding: "밥", hungry: "배고픔", interPet: "펫끼리 대화",
};
const NOTIFICATION_LABELS = { reminder: "알림", hungry: "배고픔 알림" };

const timeLabel = timestamp => new Date(timestamp).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const userLine = text => `<p class="stvp-log-user"><i class="fa-solid fa-user"></i><span>${escapeHtml(text)}</span></p>`;
const petLine = (name, mood, text) =>
    `<p class="stvp-log-pet"><span class="stvp-log-mood">${moodEmoji(mood)}</span>${name ? `<b>${escapeHtml(name)}</b>` : ""}<span>${gestureHtml(text)}</span></p>`;

function entryHtml(kind, badge, entry, replay, body, extra = "") {
    return `<article class="stvp-log-entry" data-kind="${kind}" data-id="${escapeHtml(entry.id || "")}" data-timestamp="${entry.timestamp}" data-type="${entry.type === "interPet" ? "interPet" : kind === "notification" ? "notification" : kind === "reaction" ? "reaction" : "direct"}" ${replay}${extra}>
        <header class="stvp-log-head">
            <span class="stvp-log-badge">${badge}</span>
            <time>${timeLabel(entry.timestamp)}</time>
            <span class="stvp-log-actions">
                <button type="button" class="stvp-log-replay-btn" title="말풍선 다시 띄우기" aria-label="말풍선 다시 띄우기"><i class="fa-solid fa-rotate-right"></i></button>
                <button type="button" class="stvp-log-delete-btn" title="이 기록 삭제" aria-label="이 기록 삭제"><i class="fa-solid fa-xmark"></i></button>
            </span>
        </header>
        ${body}
    </article>`;
}

const replayAttrs = (text, mood, text2, mood2) => `data-replay-text="${escapeHtml(text)}" data-replay-mood="${mood || "happy"}"`
    + (text2 !== undefined ? ` data-replay-text2="${escapeHtml(text2)}" data-replay-mood2="${mood2 || "happy"}"` : "");

export function renderLogEntries(items) {
    let html = "";
    for (let i = 0; i < items.length; i++) {
        const entry = items[i];
        if (entry.type === "direct") {
            const next = items[i + 1];
            if (next?.type === "direct" && dualPair(entry, next)) {
                const [first, second] = entry.timestamp <= next.timestamp ? [entry, next] : [next, entry];
                html += entryHtml("dual", '<i class="fa-solid fa-comments"></i> 둘이 함께 대답', entry,
                    replayAttrs(first.petResponse, first.mood, second.petResponse, second.mood),
                    userLine(first.userText)
                    + petLine(first.speaker || "펫", first.mood, first.petResponse) + petLine(second.speaker || "펫", second.mood, second.petResponse),
                    ` data-id2="${escapeHtml(next.id || "")}" data-timestamp2="${next.timestamp}"`);
                i++;
                continue;
            }
            html += entryHtml("direct", '<i class="fa-solid fa-comment"></i> 직접 대화', entry, replayAttrs(entry.petResponse, entry.mood),
                userLine(entry.userText)
                + petLine(entry.speaker || entry.petName || (entry.mode === "dual" ? "펫" : ""), entry.mood, entry.petResponse));
        } else if (entry.type === "interPet") {
            const house = entry.source === "house";
            const lines = (entry.lines || [{ name: entry.petAName, text: entry.petAText, mood: entry.petAMood }, { name: entry.petBName, text: entry.petBText, mood: entry.petBMood }])
                .filter(line => line.text);
            html += entryHtml(house ? "house" : "interPet", house ? `<i class="fa-solid fa-house-chimney"></i> ${entry.userText ? "펫하우스 말 걸기" : "펫하우스 대화"}` : '<i class="fa-solid fa-people-arrows"></i> 펫끼리 대화', entry,
                replayAttrs(entry.petAText, entry.petAMood, entry.petBText, entry.petBMood) + ' data-replay-dual="1"',
                (entry.userText ? userLine(entry.userText) : "")
                + lines.map(line => petLine(line.name, line.mood, line.text)).join(""),
                ` data-source="${house ? "house" : "screen"}"`);
        } else if (entry.type === "notification") {
            html += entryHtml("notification", `<i class="fa-solid fa-bell"></i> ${NOTIFICATION_LABELS[entry.notificationType] || "알림"}`, entry,
                replayAttrs(entry.petResponse, entry.mood),
                `<p class="stvp-log-note"><i class="fa-solid fa-clock"></i><span>${escapeHtml(entry.message)}</span></p>` + petLine(entry.petName, entry.mood, entry.petResponse));
        } else {
            html += entryHtml("reaction", `<i class="fa-solid fa-bolt"></i> ${escapeHtml(TRIGGER_LABELS[entry.trigger] || entry.trigger)}`, entry,
                replayAttrs(entry.petResponse, entry.mood), petLine(entry.petName, entry.mood, entry.petResponse));
        }
    }
    return html;
}

export function refreshLogViewer() {
    if (!document.querySelector('.stvp-tab-content[data-tab="life"]')?.classList.contains("active")) return;
    const viewer = document.getElementById("stvp-log-viewer");
    if (!viewer) return;
    const logs = getLogs($("#stvp-log-filter").val() || "all");
    if (!logs.length) {
        viewer.innerHTML = '<div class="stvp-empty"><i class="fa-solid fa-inbox"></i><span>아직 기록이 없습니다</span></div>';
        $("#stvp-log-pagination").hide();
        page = 1;
        return;
    }
    const newest = [...logs].reverse();
    const pages = Math.ceil(newest.length / PAGE_SIZE);
    page = Math.min(Math.max(page, 1), pages);
    viewer.innerHTML = renderLogEntries(newest.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));
    $("#stvp-log-pagination").toggle(pages > 1);
    $("#stvp-log-page-info").text(`${page} / ${pages}`);
    $("#stvp-log-prev").prop("disabled", page <= 1);
    $("#stvp-log-next").prop("disabled", page >= pages);
}

function replay(entry, button) {
    if (entry.dataset.source === "house") {
        openHouse();
        document.dispatchEvent(new CustomEvent("stvp-house-open-history", { detail: { timestamp: Number(entry.dataset.timestamp) } }));
        return;
    }
    if (state.isPetGenerating || state.isGenerating || state.secondPet?.isPetGenerating) {
        log("Replay blocked: API call in progress");
        return;
    }
    const { replayText: text, replayMood: mood = "happy", replayText2: text2, replayMood2: mood2 } = entry.dataset;
    if (!text) return;
    setState(mood, 3000, "primary");
    showSpeechBubble(text, null, false, "primary");
    if (text2 && state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData) {
        setState(mood2 || "happy", 3000, "secondary");
        showSpeechBubble(text2, null, false, "secondary");
    }
    const icon = button.querySelector("i");
    icon.className = "fa-solid fa-check";
    setTimeout(() => { icon.className = "fa-solid fa-rotate-right"; }, 1000);
}

export function bindLogUI() {
    const viewer = document.getElementById("stvp-log-viewer");
    viewer.addEventListener("click", event => {
        const button = event.target.closest("button");
        const entry = button?.closest(".stvp-log-entry");
        if (!entry) return;
        event.stopPropagation();
        if (button.classList.contains("stvp-log-replay-btn")) return replay(entry, button);
        if (!button.classList.contains("stvp-log-delete-btn")) return;
        // Stored logs written before ids existed are still matched by timestamp.
        deleteLogEntry(entry.dataset.id || Number(entry.dataset.timestamp), entry.dataset.type);
        if (entry.dataset.timestamp2) deleteLogEntry(entry.dataset.id2 || Number(entry.dataset.timestamp2), entry.dataset.type);
        entry.classList.add("stvp-removing");
        setTimeout(refreshLogViewer, 180);
    });
    $("#stvp-log-filter").on("change", () => { page = 1; refreshLogViewer(); });
    $("#stvp-log-refresh").on("click", refreshLogViewer);
    $("#stvp-log-prev").on("click", () => { if (page > 1) { page--; refreshLogViewer(); } });
    $("#stvp-log-next").on("click", () => { page++; refreshLogViewer(); });
    for (const [scope, question] of [
        ["direct", "직접 대화 기록을 모두 삭제하시겠습니까?"],
        ["chat", "이 채팅방의 반응 기록을 삭제하시겠습니까?"],
        ["notification", "알림 기록을 모두 삭제하시겠습니까?"],
        ["all", "모든 대화 기록을 삭제하시겠습니까?"],
    ]) {
        $(`#stvp-log-clear-${scope}`).on("click", () => {
            if (!confirm(question)) return;
            clearLogs(scope);
            page = 1;
            refreshLogViewer();
        });
    }
    document.addEventListener("stvp-log-updated", refreshLogViewer);
}
