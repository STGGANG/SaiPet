import { row, rowPair, subFold, button, moodEmoji, escapeHtml, gestureHtml } from "./ui-kit.js";
import { state, getLocalDateKey, isPetActive } from "./state.js";
import { saveSettings } from "./storage.js";
import { getLogs } from "./pet-ai.js";
import { houseActors, houseDialogueSettings, houseDailyCount } from "./house-conversation-data.js";
import { getHouseConversationStatus, startHouseConversations, runHouseConversation } from "./house-conversation.js";

export function houseDialogueControls() {
    const number = (option, min, step, unit, max = "") =>
        `<span class="stvp-number"><input type="number" class="stvp-input" data-house-option="${option}" min="${min}"${max ? ` max="${max}"` : ""} step="${step}"><span class="stvp-unit">${unit}</span></span>`;
    return subFold("방 안 자율 대화", `
        <label class="stvp-row"><span class="stvp-row-text"><span class="stvp-row-title">자율 대화</span><small class="stvp-row-desc">팝업을 닫아도 이어집니다</small></span><span class="stvp-row-ctrl"><input type="checkbox" class="stvp-switch" data-house-option="enabled"></span></label>
        ${rowPair(row("쉬는 간격", number("intervalMinutes", 0.25, 0.25, "분"), { desc: "대화와 대화 사이" }),
            row("하루 최대", number("maxPerDay", 0, 1, "번"), { desc: "0이면 제한 없음 · 자동 대화만 셉니다" }))}
        ${row("주고받기", number("exchanges", 1, 1, "바퀴", 10), { desc: "1바퀴마다 API를 한 번 사용합니다", tip: "1바퀴는 방 안 모두가 한 번씩 말하는 것입니다. 혼자 있으면 혼잣말을 합니다." })}
        <div class="stvp-row stvp-row-stack"><label class="stvp-row-text"><span class="stvp-row-title">화제 · 분위기</span></label><div class="stvp-row-ctrl"><textarea class="stvp-input" data-house-option="topics" rows="2" placeholder="관심사, 대화 소재, 원하는 분위기"></textarea></div></div>
        <div class="stvp-row stvp-row-stack"><label class="stvp-row-text"><span class="stvp-row-title">방 설정 <small>(선택)</small></span></label><div class="stvp-row-ctrl"><textarea class="stvp-input" data-house-option="roomNote" rows="2" placeholder="예: 비 오는 오후의 작은 작업실"></textarea></div></div>
        <div class="stvp-inline stvp-house-chat-now">${button("", "지금 펫끼리 대화시키기", { icon: "fa-comments", attrs: "data-house-chat-now" })}<small data-house-chat-status role="status"></small></div>`);
}
export function bindHouseConversationUI(root, { history = false } = {}) {
    let shown = 10;
    const inputs = [...root.querySelectorAll("[data-house-option]")];
    const sync = () => {
        const config = houseDialogueSettings(state.settings), status = getHouseConversationStatus();
        for (const input of inputs) {
            if (input === document.activeElement) continue;
            if (input.type === "checkbox") input.checked = config[input.dataset.houseOption];
            else input.value = String(config[input.dataset.houseOption]);
        }
        const count = houseDailyCount(state.settings, getLocalDateKey());
        const people = houseActors(state.settings).length;
        const label = root.querySelector("[data-house-chat-status]");
        if (label) label.textContent = status.message || (!people ? "캐릭터를 한 명 이상 선택하십시오." : config.enabled && !isPetActive()
            ? "자동 대화는 사이펫을 켜고 이 기기 표시를 켜면 시작됩니다. ‘지금 펫끼리 대화시키기’는 바로 가능합니다."
            : `오늘 자동 대화 ${count}회${config.maxPerDay ? " / " + config.maxPerDay + "회" : " · 제한 없음"}`);
        const button = root.querySelector("[data-house-chat-now]");
        if (button) button.disabled = status.active || !people;
    };
    const change = () => {
        const next = { ...state.settings.house?.dialogue };
        for (const input of inputs) next[input.dataset.houseOption] = input.type === "checkbox" ? input.checked
            : input.type === "number" ? Number(input.value) : input.value;
        state.settings.house.dialogue = houseDialogueSettings({ house: { dialogue: next } });
        saveSettings(); startHouseConversations();
        document.dispatchEvent(new CustomEvent("stvp-house-settings-updated"));
    };
    for (const input of inputs) input.addEventListener("change", change);
    const now = () => {
        document.dispatchEvent(new CustomEvent("stvp-open-house"));
        void runHouseConversation({ manual: true });
    };
    root.querySelector("[data-house-chat-now]")?.addEventListener("click", now);
    const renderHistory = () => {
        if (!history) return;
        const viewer = root.querySelector("[data-house-chat-history]"); viewer.replaceChildren();
        const logs = getLogs("house").reverse();
        if (!logs.length) {
            const empty = document.createElement("p"); empty.className = "stvp-house-chat-empty"; empty.textContent = "아직 방 안 대화가 없습니다.";
            viewer.append(empty); return;
        }
        const groups = [];
        for (const entry of logs.slice(0, shown)) {
            const last = groups.at(-1);
            if (last && entry.conversationId && last[0].conversationId === entry.conversationId) last.push(entry);
            else groups.push([entry]);
        }
        for (const group of groups) {
            const entries = [...group].reverse(), first = entries[0];
            const card = document.createElement("article"); card.className = "stvp-house-chat-entry";
            card.dataset.timestamps = entries.map(entry => entry.timestamp).join(",");
            const head = document.createElement("header"), room = document.createElement("span"), time = document.createElement("time");
            room.className = "stvp-house-chat-room";
            room.innerHTML = '<i class="fa-solid fa-house-chimney"></i>';
            room.append(` ${first.roomLabel || "한 방"}`);
            time.textContent = new Date(first.timestamp).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
            head.append(room, time); card.append(head);
            for (const entry of entries) {
                const lines = (entry.lines || [{ name: entry.petAName, text: entry.petAText, mood: entry.petAMood }, { name: entry.petBName, text: entry.petBText, mood: entry.petBMood }]).filter(line => line.text);
                if (entry.userText) lines.unshift({ user: true, name: "나", text: entry.userText });
                for (const { user, name, text, mood } of lines) {
                    const line = document.createElement("p"), face = document.createElement("span"), body = document.createElement("span"), speaker = document.createElement("b");
                    line.className = user ? "stvp-house-chat-line stvp-house-chat-user" : "stvp-house-chat-line"; face.className = "stvp-house-chat-mood";
                    if (user) face.innerHTML = '<i class="fa-solid fa-user"></i>'; else face.textContent = moodEmoji(mood);
                    speaker.textContent = name || "캐릭터";
                    body.append(speaker);
                    body.insertAdjacentHTML("beforeend", user ? escapeHtml(text || "") : gestureHtml(text || ""));
                    line.append(face, body); card.append(line);
                }
            }
            viewer.append(card);
        }
        if (logs.length > shown) {
            const more = document.createElement("button"); more.type = "button"; more.className = "stvp-house-chat-more"; more.textContent = "이전 대화 더 보기";
            more.onclick = () => { shown += 10; renderHistory(); }; viewer.append(more);
        }
    };
    const openHistory = event => {
        if (!history) return;
        const logs = getLogs("house").reverse(), index = logs.findIndex(e => e.timestamp === event.detail?.timestamp);
        shown = Math.max(shown, index + 1); renderHistory();
        const viewer = root.querySelector("[data-house-chat-history]"); viewer.closest("details").open = true;
        const target = String(event.detail?.timestamp);
        const card = [...viewer.querySelectorAll(".stvp-house-chat-entry")].find(node => node.dataset.timestamps.split(",").includes(target));
        if (card) { card.classList.add("stvp-house-chat-focus"); card.scrollIntoView({ block: "nearest" }); setTimeout(() => card.classList.remove("stvp-house-chat-focus"), 1600); }
    };
    document.addEventListener("stvp-house-open-history", openHistory);
    for (const event of ["stvp-house-conversation", "stvp-house-settings-updated", "stvp-api-status"]) document.addEventListener(event, sync);
    document.addEventListener("stvp-log-updated", renderHistory);
    document.addEventListener("stvp-log-updated", sync);
    sync(); renderHistory();
    return () => {
        document.removeEventListener("stvp-house-open-history", openHistory);
        for (const input of inputs) input.removeEventListener("change", change);
        root.querySelector("[data-house-chat-now]")?.removeEventListener("click", now);
        for (const event of ["stvp-house-conversation", "stvp-house-settings-updated", "stvp-api-status"]) document.removeEventListener(event, sync);
        document.removeEventListener("stvp-log-updated", renderHistory); document.removeEventListener("stvp-log-updated", sync);
    };
}
