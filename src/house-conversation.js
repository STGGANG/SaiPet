import { state, isPetActive, getLocalDateKey } from "./state.js";
import { saveSettings } from "./storage.js";
import { generateHouseDialogue, generateHouseTalk, saveHouseDialogue, isPetRequestRunning, PET_REQUEST_BUSY } from "./pet-ai.js";
import { houseActors, houseDialogueSettings, houseDailyCount, houseDialogueScope, houseRoomContext } from "./house-conversation-data.js";
import { beginLifeActivity } from "./life-status.js";

let timer = null, revision = 0, conversationTurn = 0, finishBadge = null;
const waits = new Set();
let status = { active: false, phase: "idle", lines: [], actors: [], message: "" };
export function getHouseConversationStatus() { return status; }
function notify(next) {
    status = { ...status, ...next };
    state.houseDialogueActive = status.active;
    document.dispatchEvent(new CustomEvent("stvp-house-conversation", { detail: status }));
}
function editing() { return !!document.querySelector(".stvp-house-modal:not(.stvp-house-locked)"); }
function wait(ms) {
    return new Promise(resolve => {
        const pending = { timer: null, cancel: () => { clearTimeout(pending.timer); waits.delete(pending); resolve(false); } };
        pending.timer = setTimeout(() => { waits.delete(pending); resolve(true); }, ms);
        waits.add(pending);
    });
}
function schedule() {
    clearTimeout(timer); timer = null;
    if (!isPetActive() || !houseDialogueSettings(state.settings).enabled) return;
    timer = setTimeout(async () => {
        timer = null;
        const version = revision;
        await runHouseConversation();
        if (version === revision) schedule();
    }, houseDialogueSettings(state.settings).intervalMinutes * 60000);
}
export function stopHouseConversations() {
    revision++; clearTimeout(timer); timer = null;
    for (const pending of [...waits]) pending.cancel();
    finishBadge?.(); finishBadge = null;
    notify({ active: false, phase: "idle", lines: [], actors: [], message: "" });
}
export function startHouseConversations() { stopHouseConversations(); schedule(); }

const BUSY_MESSAGE = "다른 AI 응답이 끝나지 않아 이번 대화는 미뤘습니다.";
const requestsBusy = () => isPetRequestRunning() || state.isDreamGenerating || state.secondPet.isDreamGenerating;
/** A dream, reaction or direct talk may be running between exchanges; give it a bounded moment to finish. */
async function waitForRequests(valid, maxWait = 20000) {
    const start = Date.now();
    while (requestsBusy()) {
        if (!valid() || Date.now() - start >= maxWait || !await wait(1000)) return false;
    }
    return true;
}

const GENERATING_MESSAGE = "대화 준비 중…";
const prepareActors = residents => residents.slice(0, 4).map(a => ({ ...a, data: { personality: structuredClone(a.data.personality || {}) } }));
function rejectWith(message, manual) { if (manual) notify({ message }); return false; }
/** Checks shared by automatic, manual and user-started exchanges; returns the residents or false. */
function roomReady(manual) {
    const residents = houseActors(state.settings);
    if (state.storageBlocked) return rejectWith("데이터 연결을 먼저 확인해 주십시오.", manual);
    if (document.hidden) return rejectWith("브라우저 탭을 열어 둔 상태에서 실행해 주십시오.", manual);
    if (editing()) return rejectWith("‘꾸미기 끝내기’를 누른 뒤 대화해 주십시오.", manual);
    if (status.active) return rejectWith("이미 방 안에서 대화하고 있습니다.", manual);
    if (!residents.length) return rejectWith("방에 캐릭터를 한 명 이상 배치하십시오.", manual);
    return residents;
}
/** Runs one or more exchanges as a session: every resident thinks while a request runs, then the replies are
 * spoken one by one. `generate(exchange, ordered, alive)` returns the replies for that round. */
async function converse({ manual, actors, exchanges, order, generate, record }) {
    const settings = state.settings;
    const version = revision, epoch = state.lifecycleEpoch, scope = houseDialogueScope(settings);
    // A request already sent keeps its reply while the tab is hidden; new exchanges wait for a visible tab.
    const alive = () => version === revision && !state.storageBlocked && (manual || isPetActive()) && epoch === state.lifecycleEpoch
        && !editing() && houseDialogueScope(state.settings) === scope;
    const valid = () => alive() && !document.hidden;
    const conversationId = globalThis.crypto?.randomUUID?.() || `house-${Date.now()}-${conversationTurn}`;
    const room = houseRoomContext(settings);
    let recorded = false;
    clearTimeout(timer); timer = null;
    notify({ active: true, phase: "generating", actors, lines: [], message: GENERATING_MESSAGE });
    const finish = beginLifeActivity("house", "💬 하우스 대화중", "stvp-open-house"); finishBadge = finish;
    try {
        for (let exchange = 0; exchange < exchanges; exchange++) {
            if (!valid()) break;
            const ordered = order(exchange);
            notify({ phase: "generating", message: GENERATING_MESSAGE });
            if (!await waitForRequests(valid)) { if (valid()) notify({ message: BUSY_MESSAGE }); break; }
            const replies = await generate(exchange, ordered, alive);
            if (!alive()) break;
            if (replies === PET_REQUEST_BUSY) { notify({ message: BUSY_MESSAGE }); break; }
            if (!replies) { notify({ message: state.lastAIError || "대화를 불러오지 못했습니다. API 연결을 확인하십시오." }); break; }
            record(ordered, replies, { conversationId, exchange, roomLabel: room.label }, recorded);
            recorded = true;
            for (let i = 0; i < replies.length; i++) {
                if (!valid()) break;
                const line = { ...replies[i], actor: ordered[i] };
                const lines = [...status.lines.filter(previous => previous.actor.id !== line.actor.id), line];
                notify({ phase: "speaking", line, lines, message: `${line.actor.name} · 대화중` });
                const duration = Math.max(2800, Math.min(11000, Array.from(line.text).length * 100 + 1400));
                if (!await wait(duration)) break;
            }
        }
        return recorded;
    } catch (error) {
        if (valid()) notify({message: error.message || "대화 중 문제가 생겼습니다. 다시 시도해 주십시오."});
        return recorded;
    } finally {
        finish(); if (finishBadge === finish) finishBadge = null;
        if (version === revision) {
            notify({ active: false, phase: "idle", actors: [], lines: [], message: status.message.includes("대화중") || status.message === GENERATING_MESSAGE ? "" : status.message });
            schedule();
        }
    }
}

/** Remains alive when only the house popup closes. All activity stops on master OFF,
 * edits, resident/profile changes or settings changes; a hidden tab stops new exchanges.
 */
export async function runHouseConversation({ manual = false } = {}) {
    const settings = state.settings, config = houseDialogueSettings(settings);
    if (!manual && !isPetActive()) return false;
    const residents = roomReady(manual);
    if (!residents) return false;
    if (!manual && (!config.enabled || (config.maxPerDay && houseDailyCount(settings, getLocalDateKey()) >= config.maxPerDay))) return false;
    if (state.isGenerating || requestsBusy()) return rejectWith("다른 AI 응답이 끝난 뒤 다시 눌러 주십시오.", manual);
    const actors = prepareActors(residents);
    const start = conversationTurn++ % actors.length;
    actors.push(...actors.splice(0,start));
    return converse({ manual, actors, exchanges: config.exchanges,
        order: exchange => { const offset = exchange % actors.length; return [...actors.slice(offset), ...actors.slice(0,offset)]; },
        generate: (exchange, ordered, alive) => generateHouseDialogue(ordered, alive, exchange > 0),
        record: (ordered, replies, details, recorded) => {
            saveHouseDialogue(ordered, replies, details);
            if (!recorded && !manual) {
                settings.house.dialogueUsage = { date: getLocalDateKey(), count: houseDailyCount(settings, getLocalDateKey()) + 1 };
                saveSettings();
            }
        } });
}

export const HOUSE_TALK_MAX = 300;
/** The user speaks to one resident (`slot`) or to everyone (null): the addressed resident answers first and the
 * others react in room order, from a single request. Never counts toward the daily automatic limit. */
export async function talkToHouse(text, slot = null) {
    const message = typeof text === "string" ? Array.from(text.trim()).slice(0, HOUSE_TALK_MAX).join("") : "";
    if (!message) return false;
    const residents = roomReady(true);
    if (!residents) return false;
    const target = slot ? residents.find(actor => actor.slot === slot) : null;
    if (slot && !target) return rejectWith("그 캐릭터는 지금 방에 없습니다.", true);
    if (state.isGenerating || requestsBusy()) return rejectWith("다른 AI 응답이 끝난 뒤 다시 말해 주십시오.", true);
    const everyone = prepareActors(residents);
    const actors = target ? everyone.filter(actor => actor.slot === slot) : everyone;
    return converse({ manual: true, actors, exchanges: 1, order: () => actors,
        generate: (_, ordered, alive) => generateHouseTalk(ordered, alive, message, target ? target.name : "all"),
        record: (ordered, replies, details) => saveHouseDialogue(ordered, replies, { ...details, userText: message }) });
}
