import { beginLifeActivity } from "./life-status.js";
import { buildHouseAIInput } from "./house-conversation-data.js";
import { resolveTokenLimits, fitPromptToBudget, tokenCounterFor } from "./ai-budget.js";
import { connectionOverrides } from "./api-connection.js";
import { parseStructuredResponse } from "./prompts/response-format.js";
import { HOUSE_TASKS } from "./prompts/builder.js";
import { buildAIInput, collectWorldInfo } from "./ai-context.js";
import { responseText } from "./ai-response-utils.js";
import { captureChatScope, matchesChatScope } from "./ai-request-scope.js";
import { characterId, characterName, pairId, characterLabel, migrateCharacterHistory } from "./character-identity.js";

import { getContext } from "../../../../extensions.js";
import * as STAPI from "../../../../../script.js";
import { state, log, logError, isPetActive, isPetAvailable, getPetInstanceEpoch, isCurrentPetRuntime, schedulePetTimeout, getLocalDateKey } from "./state.js";
import { showSpeechBubble } from "./pet-speech.js";
import { setState, PET_STATES } from "./pet-animation.js";
import { saveSettings } from "./storage.js";

let ConnectionManagerRequestService = null;

async function loadConnectionManager() {
    if (ConnectionManagerRequestService) return true;

    try {
        const shared = await import("../../../shared.js");
        ConnectionManagerRequestService = shared.ConnectionManagerRequestService;
        log("ConnectionManagerRequestService loaded");
        return true;
    } catch (error) {
        log("ConnectionManagerRequestService not available");
        return false;
    }
}

function getCurrentChatId() {
    const context = getContext();
    return context?.chatId || null;
}

function ensureLogStorage() {
    migrateCharacterHistory(state.settings);
    const logs = state.settings.conversationLog ||= { directLogs: {}, chatLogs: {} };
    logs.interPetLogs ||= {};
    logs.notificationLogs ||= [];
}

/** Entries written in the same millisecond (dual replies) still get distinct ids. */
const newLogId = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

/** Characters whose records the log viewer shows: the primary pet and, when present, the second pet. */
function activeCharacterIds() {
    const ids = [characterId(state.settings)];
    if (state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData) ids.push(characterId(state.settings, "secondary"));
    return new Set(ids);
}

/** Appends an entry with a fresh id and timestamp, keeps the newest maxLogs, saves and refreshes the viewers. */
function appendLog(logs, entry) {
    const record = { id: newLogId(), timestamp: Date.now(), ...entry };
    logs.push(record);
    const maxLogs = state.settings.conversationLog.maxLogs || 100;
    while (logs.length > maxLogs) logs.shift();
    saveSettings();
    document.dispatchEvent(new CustomEvent("stvp-log-updated"));
    return record;
}

function saveDirectLog(userText, petResponse, mood, petId = "primary", isDual = false) {
    ensureLogStorage();
    const logKey = isDual ? pairId(state.settings) : characterId(state.settings, petId);
    appendLog(state.settings.conversationLog.directLogs[logKey] ||= [], {
        characterId: characterId(state.settings, petId),
        userText,
        petResponse,
        mood,
        type: "direct",
        speaker: characterName(state.settings, petId),
        mode: isDual ? "dual" : "single",
    });
}

/** `subjectId` names the chat character an inner thought belongs to; such entries never feed a widget pet's memory. */
function saveChatLog(petResponse, mood, trigger, petId = "primary", mode = "observer", subjectId = "") {
    ensureLogStorage();
    const chatId = getCurrentChatId();
    if (!chatId) return;
    appendLog(state.settings.conversationLog.chatLogs[chatId] ||= [], {
        petResponse,
        mood,
        trigger,
        type: "reaction",
        characterId: characterId(state.settings, petId),
        petName: characterName(state.settings, petId),
        mode,
        ...(subjectId ? { subjectId } : {}),
    });
}

export function saveNotificationLog(message, petResponse, mood, notificationType = "reminder", petId = "primary") {
    ensureLogStorage();
    appendLog(state.settings.conversationLog.notificationLogs, {
        message,
        petResponse,
        mood,
        type: "notification",
        notificationType,
        characterId: characterId(state.settings, petId),
        petName: characterName(state.settings, petId),
    });
}

export function clearLogs(type = "all") {
    ensureLogStorage();
    if (type === "all" || type === "direct") {
        const ids = activeCharacterIds();
        const dlogs = state.settings.conversationLog.directLogs;
        for (const key of Object.keys(dlogs)) {
            dlogs[key] = dlogs[key].filter(e => !ids.has(e.characterId));
        }
    }
    if (type === "all" || type === "chat") {
        state.settings.conversationLog.chatLogs = {};
    }
    if (type === "all" || type === "interPet") {
        state.settings.conversationLog.interPetLogs = {};
    }
    if (type === "all" || type === "notification") {
        state.settings.conversationLog.notificationLogs = [];
    }
    saveSettings();
    log(`Logs cleared: ${type}`);
}

/** Deletes one entry: `key` is its id, or the timestamp of an old entry written before ids existed. */
export function deleteLogEntry(key, type) {
    ensureLogStorage();
    const matches = e => typeof key === "string" ? e.id === key : e.timestamp === key;
    const removeFrom = lists => Object.keys(lists).some(name => {
        const idx = (lists[name] || []).findIndex(matches);
        if (idx === -1) return false;
        lists[name].splice(idx, 1);
        if (lists[name].length === 0) delete lists[name];
        return true;
    });
    const logs = state.settings.conversationLog;
    const deleted = type === "notification" ? removeFrom({ notification: logs.notificationLogs })
        : type === "direct" ? removeFrom(logs.directLogs)
        : removeFrom(logs.chatLogs) || removeFrom(logs.interPetLogs);

    if (deleted) {
        saveSettings();
        log(`Log entry deleted: ${type} @ ${key}`);
        document.dispatchEvent(new CustomEvent("stvp-log-updated"));
    }
    return deleted;
}

export function getLogs(type = "all") {
    ensureLogStorage();
    const result = [];

    if (type === "all" || type === "direct") {
        const ids = activeCharacterIds();
        for (const logs of Object.values(state.settings.conversationLog.directLogs || {})) {
            result.push(...(logs || []).filter(e => ids.has(e.characterId) || e.characterId?.startsWith("legacy:")));
        }
    }

    if (type === "all" || type === "chat") {
        const chatId = getCurrentChatId();
        if (chatId && state.settings.conversationLog.chatLogs[chatId]) {
            result.push(...state.settings.conversationLog.chatLogs[chatId]);
        }
    }

    if (type === "all" || type === "interPet" || type === "house") {
        const ipLogsObj = state.settings.conversationLog.interPetLogs || {};
        for (const comboKey of Object.keys(ipLogsObj)) {
            result.push(...(ipLogsObj[comboKey] || []).filter(e => type !== "house" || e.source === "house"));
        }
    }

    if (type === "all" || type === "notification") {
        const nLogs = state.settings.conversationLog.notificationLogs || [];
        result.push(...nLogs);
    }

    result.sort((a, b) => a.timestamp - b.timestamp);
    return result;
}

let defaultRequestRunning = false;
let houseRequestRunning = false;

export async function showAIReaction(petId = "primary") {
    if (!isPetAvailable(petId)) return null;
    const epoch = state.lifecycleEpoch;
    const petEpoch = getPetInstanceEpoch(petId);
    const chatScope = captureChatScope(getContext(), state.chatEpoch);
    try {
        const result = await generatePetReaction(petId);
        if (!isCurrentPetRuntime(epoch, petId, petEpoch)
            || !matchesChatScope(chatScope, getContext(), state.chatEpoch)) return null;

        if (result && result.text) {
            setState(result.mood, 4000, petId);
            showSpeechBubble(result.text, null, true, petId);
            saveChatLog(result.text, result.mood, "aiResponse", petId, result.mode, result.mode === "inner" ? result.characterId : "");
            log(`AI Reaction [${petId}]: [${result.mood}] ${result.text}`);
            return result;
        }

        log("AI response empty, skipping reaction");
        return null;
    } catch (error) {
        logError("AI 반응 (showAIReaction)", error);
        return null;
    }
}
function saveInterPetLog(petAName, petAText, petAMood, petBName, petBText, petBMood) {
    ensureLogStorage();
    appendLog(state.settings.conversationLog.interPetLogs[pairId(state.settings)] ||= [],
        { petAId: characterId(state.settings), petBId: characterId(state.settings, "secondary"), petAName, petAText, petAMood, petBName, petBText, petBMood, type: "interPet" });
}

let interPetTurnFlag = false;

export async function showInterPetDialogue() {
    if (state.houseDialogueActive) return false;
    if (!isPetActive()) return false;
    const epoch = state.lifecycleEpoch;
    const primaryEpoch = getPetInstanceEpoch("primary");
    const secondaryEpoch = getPetInstanceEpoch("secondary");
    const bothPetsCurrent = () => isCurrentPetRuntime(epoch, "primary", primaryEpoch)
        && isCurrentPetRuntime(epoch, "secondary", secondaryEpoch);
    if (!bothPetsCurrent()) return false;
    const result = await generateInterPetDialogue();
    if (!bothPetsCurrent()) return false;
    if (!result) return false;

    const bWentFirst = result.firstPetId === "secondary";
    const petAName = characterName(state.settings);
    const petBName = characterName(state.settings, "secondary");

    const firstPetId = bWentFirst ? "secondary" : "primary";
    const secondPetId = bWentFirst ? "primary" : "secondary";
    const firstResult = bWentFirst ? result.b : result.a;
    const secondResult = bWentFirst ? result.a : result.b;

    if (firstResult.text) {
        setState(firstResult.mood, 12000, firstPetId);
        showSpeechBubble(firstResult.text, 12000, true, firstPetId);
        // The second speaker waits idle until its turn instead of looking busy.
        setState(PET_STATES.IDLE, null, secondPetId);
    }

    if (secondResult.text) {
        schedulePetTimeout(() => {
            if (!bothPetsCurrent()) return;
            setState(secondResult.mood, 12000, secondPetId);
            showSpeechBubble(secondResult.text, 12000, true, secondPetId);
        }, readingDelay(firstResult.text));
    }

    if (result.a.text || result.b.text) {
        saveInterPetLog(petAName, result.a.text || "", result.a.mood, petBName, result.b.text || "", result.b.mood);
        if (typeof state._sessionChatCount === "number") state._sessionChatCount++;
    }

    return true;
}
function ensureJournalStorage() {
    migrateCharacterHistory(state.settings);
    const journal = state.settings.petJournal ||= { dreamEnabled: true, diaryEnabled: true };
    journal.dreams ||= {};
    journal.diaries ||= {};
}

export function saveDream(petName, content, sleepTalk = "", petId = "primary", details = {}) {
    const recordId = characterId(state.settings, petId);
    ensureJournalStorage();
    const dreams = state.settings.petJournal.dreams[recordId] ||= [];
    const maxEntries = state.settings.petJournal.maxEntries || 50;

    dreams.push({
        timestamp: Date.now(),
        content,
        characterId: recordId, petName,
        sleepTalk: sleepTalk || "",
        ...(typeof details?.title === "string" && details.title.trim() ? { title: details.title.trim() } : {}),
        ...(typeof details?.afterWake === "string" && details.afterWake.trim() ? { afterWake: details.afterWake.trim() } : {}),
        type: "dream",
    });

    while (dreams.length > maxEntries) dreams.shift();

    const todayStr = getLocalDateKey();
    if (state.settings.petJournal.dreamCountDate !== todayStr) {
        state.settings.petJournal.dreamCountDate = todayStr;
        state.settings.petJournal.dreamCounts = {};
    }
    if (!state.settings.petJournal.dreamCounts) state.settings.petJournal.dreamCounts = {};
    state.settings.petJournal.dreamCounts[recordId] = (state.settings.petJournal.dreamCounts[recordId] || 0) + 1;

    saveSettings();
    document.dispatchEvent(new CustomEvent("stvp-journal-updated"));
    log(`Dream saved for ${petName}`);
}

export function saveDiary(petName, content, petId = "primary", comment = "") {
    const recordId = characterId(state.settings, petId);
    ensureJournalStorage();
    const diaries = state.settings.petJournal.diaries[recordId] ||= [];
    const maxEntries = state.settings.petJournal.maxEntries || 50;

    const now = new Date();
    diaries.push({
        timestamp: Date.now(),
        content,
        characterId: recordId, petName,
        type: "diary",
        ...(typeof comment === "string" && comment.trim() ? { comment: comment.trim() } : {}),
    });

    while (diaries.length > maxEntries) diaries.shift();

    const todayStr = getLocalDateKey(now);
    if (!state.settings.petJournal.lastDiaryDates) state.settings.petJournal.lastDiaryDates = {};
    state.settings.petJournal.lastDiaryDates[recordId] = todayStr;

    saveSettings();
    document.dispatchEvent(new CustomEvent("stvp-journal-updated"));
    log(`Diary saved for ${petName} [${petId}]`);
}

export function getJournalEntries(filter = "all", petNameFilter = null) {
    ensureJournalStorage();
    const result = [];

    if (filter === "all" || filter === "dream") {
        const dreams = state.settings.petJournal.dreams || {};
        for (const [name, entries] of Object.entries(dreams)) {
            if (petNameFilter && name !== petNameFilter) continue;
            for (const entry of entries) {
                result.push({ ...entry, characterId: name, petName: characterLabel(state.settings, name, entry.petName || name.replace(/^legacy:/, "") + " · 이전 기록"), type: "dream" });
            }
        }
    }

    if (filter === "all" || filter === "diary") {
        const diaries = state.settings.petJournal.diaries || {};
        for (const [name, entries] of Object.entries(diaries)) {
            if (petNameFilter && name !== petNameFilter) continue;
            for (const entry of entries) {
                result.push({ ...entry, characterId: name, petName: characterLabel(state.settings, name, entry.petName || name.replace(/^legacy:/, "") + " · 이전 기록"), type: "diary" });
            }
        }
    }

    result.sort((a, b) => b.timestamp - a.timestamp);
    return result;
}

export function deleteJournalEntry(timestamp, type) {
    ensureJournalStorage();
    let deleted = false;
    const source = type === "dream" ? state.settings.petJournal.dreams : state.settings.petJournal.diaries;

    for (const name of Object.keys(source)) {
        const entries = source[name];
        const idx = entries.findIndex(e => e.timestamp === timestamp);
        if (idx !== -1) {
            entries.splice(idx, 1);
            if (entries.length === 0) delete source[name];
            deleted = true;
            break;
        }
    }

    if (deleted) {
        saveSettings();
        document.dispatchEvent(new CustomEvent("stvp-journal-updated"));
        log(`Journal entry deleted: ${type} @ ${timestamp}`);
    }
    return deleted;
}

export function clearJournal(type = "all") {
    ensureJournalStorage();
    if (type === "all" || type === "dream") {
        state.settings.petJournal.dreams = {};
    }
    if (type === "all" || type === "diary") {
        state.settings.petJournal.diaries = {};
    }
    saveSettings();
    document.dispatchEvent(new CustomEvent("stvp-journal-updated"));
    log(`Journal cleared: ${type}`);
}

export function getJournalPetNames() {
    ensureJournalStorage();
    const names = new Set();
    for (const name of Object.keys(state.settings.petJournal.dreams || {})) names.add(name);
    for (const name of Object.keys(state.settings.petJournal.diaries || {})) names.add(name);
    return [...names].map(id => ({ id, name: characterLabel(state.settings, id, id.replace(/^legacy:/, "") + " · 이전 기록") }));
}

/** Common Connection Manager route; never silently falls back to another connection. */
async function callConnectionManagerAPI(messages, api, valid) {
    if (!api.connectionProfile) throw new Error("공통 API 연결에서 Connection Profile을 선택해 주십시오.");
    if (!await loadConnectionManager()) throw new Error("Connection Manager를 사용할 수 없습니다.");
    if (!valid()) return "";
    const profile = ConnectionManagerRequestService.getProfile?.(api.connectionProfile);
    const overrides = connectionOverrides(profile, getContext());
    const controller=new AbortController();state.apiControllers.add(controller);
    const timeout=setTimeout(()=>controller.abort(),120000);
    try {
        const result=await ConnectionManagerRequestService.sendRequest(api.connectionProfile,messages,api.resolvedOutputTokens,
            {includePreset:false,includeInstruct:true,extractData:true,stream:false,signal:controller.signal},overrides);
        return responseText(result);
    } finally {clearTimeout(timeout);state.apiControllers.delete(controller);}
}

/** Any pet request in flight, or the single default-connection slot being taken. */
export function isPetRequestRunning() {
    return Boolean(state.isPetGenerating || state.secondPet?.isPetGenerating || defaultRequestRunning || houseRequestRunning);
}

function waitForPetRequestIdle(maxWait, valid, pollInterval = 500) {
    return new Promise(resolve => {
        const start = Date.now();
        const check = () => {
            if (!valid()) return resolve(false);
            if (!isPetRequestRunning()) return resolve(true);
            if (Date.now() - start >= maxWait) return resolve(false);
            setTimeout(check, pollInterval);
        };
        check();
    });
}

/** Use raw text extraction so ST does not rewrite the JSON as roleplay dialogue. */
async function callDefaultAPI(messages, api) {
    if (defaultRequestRunning) throw Object.assign(new Error("이전 기본 API 요청이 아직 끝나지 않았습니다."), { busy: true });
    defaultRequestRunning=true;
    let deadline=null;
    try {
        const context = getContext();
        if (STAPI.main_api === "openai" && context?.chatCompletionSettings?.chat_completion_source === "vertexai") {
            if (!context.ChatCompletionService?.processRequest) throw new Error("Vertex AI를 지원하는 실리태번 버전이 필요합니다.");
            const controller = new AbortController(); state.apiControllers.add(controller);
            const timeout = setTimeout(() => controller.abort(), 120000);
            try {
                const result = await context.ChatCompletionService.processRequest({
                    messages, stream:false, max_tokens:api.resolvedOutputTokens,
                    model:context.chatCompletionSettings.vertexai_model, chat_completion_source:"vertexai",
                    reverse_proxy:context.chatCompletionSettings.reverse_proxy,
                    proxy_password:context.chatCompletionSettings.proxy_password,
                    ...connectionOverrides(null,context),
                }, {}, true, controller.signal);
                return responseText(result);
            } finally { clearTimeout(timeout); state.apiControllers.delete(controller); }
        }
        const options={prompt:messages,quietToLoud:false,responseLength:api.resolvedOutputTokens,trimNames:false};
        // generateRaw has no abort signal; give up like the Connection Manager path so the lock is released.
        const timeout=new Promise((_,reject) => { deadline=setTimeout(() => reject(new Error("기본 API 응답이 120초 안에 오지 않았습니다.")),120000); });
        const selectedAPI=STAPI.main_api;
        const request=typeof STAPI.generateRawData === "function" && typeof STAPI.extractMessageFromData === "function"
            ? STAPI.generateRawData({...options,api:selectedAPI}).then(data => STAPI.extractMessageFromData(data,selectedAPI))
            : STAPI.generateRaw(options);
        return responseText(await Promise.race([request,timeout]));
    } finally {clearTimeout(deadline);defaultRequestRunning=false;}
}

export const PET_REQUEST_BUSY = Symbol("pet request busy");

/** All AI features share a single request path and immutable connection choice per request.
 * Returns the entries, null on failure, or PET_REQUEST_BUSY when another request still holds a pet. */
async function requestPetTask(task, petIds, request, options = {}) {
    const houseRequest = HOUSE_TASKS.has(task);
    if (houseRequest ? state.storageBlocked || !options.valid?.() : petIds.some(id => !isPetAvailable(id))) return null;
    if (petIds.some(id => (id === "secondary" ? state.secondPet : state).isPetGenerating) || (houseRequest && houseRequestRunning)) return PET_REQUEST_BUSY;
    if (!state.settings.api?.useConnectionManager && defaultRequestRunning) return PET_REQUEST_BUSY;
    const epoch = state.lifecycleEpoch;
    const instances = petIds.map(id => getPetInstanceEpoch(id));
    const current = () => houseRequest ? !state.storageBlocked && state.lifecycleEpoch === epoch : petIds.every((id,i) => isCurrentPetRuntime(epoch,id,instances[i]));
    const context = getContext() || {};
    const chatScope = captureChatScope(context,state.chatEpoch);
    const readsChat = ["observer","inner"].includes(task);
    const valid = () => current() && (!options.valid || options.valid()) && (!readsChat || matchesChatScope(chatScope,getContext(),state.chatEpoch));
    const api = { ...state.settings.api };
    const token = {};
    // The pet house has its own lock so the pets on screen stay clickable while residents talk.
    if (houseRequest) houseRequestRunning = true;
    else for (const id of petIds) {
        const runtime = id === "secondary" ? state.secondPet : state;
        runtime.isPetGenerating = true; runtime._aiRequestToken = token;
    }
    try {
        ensureLogStorage(); ensureJournalStorage();
        const input = houseRequest ? buildHouseAIInput(state.settings,context,options.houseActors,request,{ task, addressee: options.addressee }) : buildAIInput(options.inputSettings || state.settings,context,task,petIds,request);
        if (["observer","inner"].includes(task) && api.includeWorldInfo) {
            try { input.sources.worldInfo = await collectWorldInfo(context,input.sources.chatScene,true); }
            catch (error) { logError("월드인포 읽기",error); }
        }
        if (!valid()) return null;
        let profile;
        if (api.useConnectionManager) {
            if (!api.connectionProfile || !await loadConnectionManager()) throw new Error("공통 API 연결에서 사용할 Connection Profile을 확인해 주십시오.");
            profile = ConnectionManagerRequestService.getProfile(api.connectionProfile);
            if (!profile) throw new Error("선택한 연결 프로필을 찾을 수 없습니다.");
        }
        const limits = resolveTokenLimits(api, context, profile, STAPI.main_api, STAPI.amount_gen);
        api.resolvedOutputTokens = limits.output;
        const counter = tokenCounterFor(context, profile, limits.input);
        const built = await fitPromptToBudget(input, limits.input, counter);
        if (!valid()) return null;
        if (task !== "dream" && !houseRequest) for (const id of petIds) setState(PET_STATES.THINKING,null,id);
        state.lastAIRequest = { task, inputTokens:built.inputTokens, removedHistory:built.removedHistory };
        const text = api.useConnectionManager
            ? await callConnectionManagerAPI(built.messages,api,valid)
            : await callDefaultAPI(built.messages,api);
        if (!valid()) return null;
        const parsed = parseStructuredResponse(text,built.expected);
        if (!parsed.ok) throw new Error(`AI 응답 형식이 올바르지 않습니다 (${parsed.error}).`);
        state.lastAIError = null;
        return parsed.entries.map(entry => ({ ...entry, characterId: built.speakerMap[entry.speaker] }));
    } catch (error) {
        if (error.busy) {
            log(`AI ${task} skipped: ${error.message}`);
            return PET_REQUEST_BUSY;
        }
        if (valid()) {
            state.lastAIError = error.cause?.message || error.message || "AI 요청 실패";
            logError(`AI ${task}`,error);
        }
        return null;
    } finally {
        if (valid() && typeof document !== "undefined") document.dispatchEvent(new CustomEvent("stvp-api-status"));
        if (houseRequest) houseRequestRunning = false;
        else petIds.forEach((id,i) => {
            const runtime = id === "secondary" ? state.secondPet : state;
            if (runtime._aiRequestToken !== token || epoch !== state.lifecycleEpoch || getPetInstanceEpoch(id) !== instances[i]) return;
            runtime._aiRequestToken = null;
            runtime.isPetGenerating = false;
            if (!isCurrentPetRuntime(epoch,id,instances[i])) return;
            if (runtime.currentState === PET_STATES.THINKING) setState(PET_STATES.IDLE,null,id);
        });
    }
}

/** The second pet waits until the first line has had time to be read. */
function readingDelay(text) { return Math.max(2500, Math.min(7000, 1500 + Array.from(text || "").length * 70)); }

/** Direct speech works even when automatic chat reactions are switched off. */
export async function talkToPet(userText, petId = "primary") {
    if (!isPetAvailable(petId)) return;
    const epoch = state.lifecycleEpoch, instance = getPetInstanceEpoch(petId);
    const current = () => isCurrentPetRuntime(epoch,petId,instance);
    // This import only resets inactivity; it must not postpone acquiring the request lock.
    import("./pet-reactions.js").then(({resetIdleTimer}) => {
        if (current()) resetIdleTimer();
    }).catch(() => {});
    // The message is never dropped silently: wait for the running request, then say so if it is still busy.
    const busy = isPetRequestRunning() && !await waitForPetRequestIdle(20000,current);
    if (!current()) return;
    if (busy) { showSpeechBubble("잠깐만, 생각 중이야…",4000,false,petId); return; }
    const other = petId === "primary" ? "secondary" : "primary";
    const dual = Boolean(state.settings.multiPet?.dualDirectTalk && isPetAvailable(other));
    const ids = dual ? [petId,other] : [petId];
    const instances = ids.map(getPetInstanceEpoch);
    const bothCurrent = () => ids.every((id,i) => isCurrentPetRuntime(epoch,id,instances[i]));
    const settings = petId === "secondary" ? state.settings.multiPet.secondPetData : state.settings;
    const replies = await requestPetTask(dual ? "dual" : "direct",ids,userText);
    if (!bothCurrent()) return;
    if (replies === PET_REQUEST_BUSY) { showSpeechBubble("잠깐만, 생각 중이야…",4000,false,petId); return; }
    if (!replies) {
        showSpeechBubble(settings.fallbackMessages?.apiError || state.settings.fallbackMessages?.apiError || "대사를 불러오지 못했어요.",null,true,petId);
        return;
    }
    replies.forEach((reply,i) => {
        const id=ids[i];
        const present = () => {
            if (!bothCurrent()) return;
            setState(reply.mood,12000,id);showSpeechBubble(reply.text,12000,true,id);
        };
        // Record validated replies immediately, so a follow-up request sees both turns.
        saveDirectLog(userText,reply.text,reply.mood,id,dual);
        if (i===0) present();
        else schedulePetTimeout(present,readingDelay(replies[0].text));
    });
    state._sessionChatCount = (state._sessionChatCount || 0)+1;
}

/** Chat reading alone is controlled by the AI reaction toggle. */
export async function generatePetReaction(petId = "primary") {
    if (!state.settings.personality.enabled) return null;
    const inner = state.settings.api.reactionMode === "character";
    const entry = (await requestPetTask(inner ? "inner" : "observer",[petId],inner
        ? "Write A's brief unspoken thought about the latest meaningful moment in the supplied chat scene."
        : "Respond to the latest meaningful moment in the supplied chat scene."))?.[0];
    return entry ? { ...entry, mode: inner ? "inner" : "observer" } : null;
}

/** Both IDs are fixed before calling the model; names never identify response ownership. */
export async function generateInterPetDialogue() {
    if (!isPetAvailable("primary") || !isPetAvailable("secondary") || state.isPetGenerating || state.secondPet.isPetGenerating) return null;
    const bFirst=interPetTurnFlag;
    const ids=bFirst ? ["secondary","primary"] : ["primary","secondary"];
    const replies=await requestPetTask("pair",ids,"Generate one small exchange between the two characters sharing the current environment.");
    if (!Array.isArray(replies)) return null;
    interPetTurnFlag=!bFirst;
    return {a:bFirst?replies[1]:replies[0], b:bFirst?replies[0]:replies[1],firstPetId:ids[0]};
}

/** House residents may be saved presets rather than the two desktop slots. */
export async function generateHouseDialogue(actors, valid, continuing = false) {
    if (!actors.length || actors.length > 4) return null;
    return requestPetTask("housePair", ["primary", "secondary"],
        continuing ? "Continue this room's preceding conversation or self-talk naturally." : "Start a natural conversation among all assigned residents, or self-talk if alone.",
        { valid, houseActors: actors });
}
/** The addressed resident answers first; everyone else in the room reacts in order. One request for all of them. */
export async function generateHouseTalk(actors, valid, userText, addressee) {
    if (!actors.length || actors.length > 4) return null;
    return requestPetTask("houseTalk", ["primary", "secondary"], userText, { valid, houseActors: actors, addressee });
}
/** `details.userText` marks an exchange the user started; it is remembered with the residents' lines. */
export function saveHouseDialogue(actors, replies, details = {}) {
    ensureLogStorage();
    const key = "pair:" + JSON.stringify(actors.map(a => a.id).sort());
    const [a, b] = actors;
    state._sessionChatCount = (state._sessionChatCount || 0) + 1;
    return appendLog(state.settings.conversationLog.interPetLogs[key] ||= [], { type: "interPet", source: "house", conversationId: details.conversationId,
        exchange: details.exchange, roomLabel: details.roomLabel, ...(details.userText ? { userText: details.userText } : {}),
        petAId: a.id, petAName: a.name, petAText: replies[0].text, petAMood: replies[0].mood,
        petBId: b?.id || "", petBName: b?.name || "", petBText: replies[1]?.text || "", petBMood: replies[1]?.mood || "idle",
        lines: actors.map((actor,i) => ({characterId:actor.id,name:actor.name,text:replies[i].text,mood:replies[i].mood})) });
}

/** Dream title, narrative, sleep talk and waking epilogue are generated in one request. */
export async function generateDream(petId = "primary") {
    if (!state.settings.petJournal?.dreamEnabled) return null;
    const finish = beginLifeActivity("dream:" + petId, "🌙 꿈을 꾸는 중", "stvp-open-journal");
    try {
        const entry=(await requestPetTask("dream",[petId],"Write a new dream, its title, a brief sleep utterance, and a short imagined waking epilogue."))?.[0];
        return entry ? {content:entry.text,sleepTalk:entry.aside,title:entry.title,afterWake:entry.afterWake} : null;
    } finally { finish(); }
}

/** A quiet day may use the character's modest fictional daily life. */
export async function generateDiary(petId = "primary") {
    if (!state.settings.petJournal?.diaryEnabled) return null;
    const finish = beginLifeActivity("diary:" + petId, "📔 일기를 쓰는 중", "stvp-open-journal");
    try {
        const entry=(await requestPetTask("diary",[petId],"Write today's private diary and a brief finishing remark."))?.[0];
        return entry ? {diary:entry.text,comment:entry.aside,mood:entry.mood} : null;
    } finally { finish(); }
}

/** Scheduled reminders use the shared connection, independently of chat reactions. */
export async function generateReminder(message, petId = "primary") {
    return (await requestPetTask("reminder",[petId],message))?.[0] || null;
}
