import { startHouseConversations, stopHouseConversations } from "./house-conversation.js";
import { clearLifeActivities } from "./life-status.js";
import { playReminderSound } from "./reminder-audio.js";
import { characterId, characterName } from "./character-identity.js";

import { eventSource, event_types } from "../../../../../script.js";
import { state, log, logError, isPetActive, isPetAvailable, isCurrentRuntime, getPetInstanceEpoch, isCurrentPetRuntime, getLocalDateKey } from "./state.js";
import { saveSettings } from "./storage.js";
import { setState, PET_STATES, playBounce, playShake, playHearts, showSleepZzz, hideSleepZzz, showDreamEffect, hideDreamEffect } from "./pet-animation.js";
import { showStateSpeech, showSpeechBubble, customSpeech } from "./pet-speech.js";
import { showAIReaction, saveNotificationLog, isPetRequestRunning } from "./pet-ai.js";
import { COMPLEMENTARY_MOODS } from "./constants.js";

let reactionsInitialized = false;
const pendingIdleWaits = new Set();
const pendingReactionSleeps = new Set();

function waitForActiveDelay(ms, epoch) {
    return new Promise(resolve => {
        let settled = false;
        let timer = null;
        const finish = value => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            pendingReactionSleeps.delete(cancel);
            resolve(value);
        };
        const cancel = () => finish(false);
        pendingReactionSleeps.add(cancel);
        timer = setTimeout(() => finish(isCurrentRuntime(epoch)), ms);
    });
}

export function initReactions() {
    if (!isPetActive() || reactionsInitialized) return;
    reactionsInitialized = true;
    eventSource.on(event_types.MESSAGE_SENT, onUserMessage);

    eventSource.on(event_types.GENERATION_STARTED, onGenerationStart);

    eventSource.on(event_types.MESSAGE_RECEIVED, onAIResponse);

    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnd);

    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    // Startup cooldown: ignore the events other extensions fire while a chat opens.
    state.isReady = false;
    if (state._startupCooldownTimer) clearTimeout(state._startupCooldownTimer);
    state._startupCooldownTimer = setTimeout(() => {
        state._startupCooldownTimer = null;
        if (!isPetActive()) return;
        state.isReady = true;
        log("Reactions ready (startup cooldown ended)");
    }, 5000);

    if (state._greetingTimer) clearTimeout(state._greetingTimer);
    state._greetingTimer = setTimeout(() => {
        state._greetingTimer = null;
        if (!isPetActive()) return;
        triggerEntryGreeting();
    }, 500);

    startIdleTimer();

    startConditionTimer();

    startInterPetChatTimer();
    startHouseConversations();

    startReminderTimer();

    state._sessionChatCount = 0;
    beginSessionClock();

    log("Reactions initialized");
}

/** Daily visible time for the automatic diary; time on a hidden tab does not count. */
function beginSessionClock() {
    state._sessionStartTime = Date.now();
    const todayStr = getLocalDateKey();
    if (state.settings._dailySessionDate === todayStr) {
        state._dailySessionAccumulated = state.settings._dailySessionAccumulated || 0;
    } else {
        state._dailySessionAccumulated = 0;
        state.settings._dailySessionDate = todayStr;
        state.settings._dailySessionAccumulated = 0;
    }
}
function stopSessionClock() {
    if (!state._sessionStartTime) return;
    state._dailySessionAccumulated = (state._dailySessionAccumulated || 0) + Date.now() - state._sessionStartTime;
    state.settings._dailySessionAccumulated = state._dailySessionAccumulated;
    state._sessionStartTime = null;
}

let paused = null;
let pendingAiReaction = null;

/** Hidden tab: stop every timer that would start new activity, but keep the pets, their
 * epochs and any request already in flight so a late reply is still shown and logged. */
export function pauseReactions() {
    if (!reactionsInitialized || paused) return;
    paused = {
        idle: Boolean(state.idleTimer || state.sleepTimer),
        dreams: ["primary", "secondary"].filter(id => (id === "secondary" ? state.secondPet : state).dreamTimer),
    };
    stopIdleTimer();
    for (const runtime of [state, state.secondPet]) { clearTimeout(runtime.dreamTimer); runtime.dreamTimer = null; }
    stopConditionTimer();
    stopInterPetChatTimer();
    stopHouseConversations();
    stopReminderTimer();
    stopSessionClock();
    if (conditionDirty) saveCondition();
    log("Reactions paused");
}

/** Visible again: restart the clocks from zero (no bursts). Hunger is charged for the time
 * away in whole 20-minute steps; the greeting only speaks on the first return of a new day. */
export function resumeReactions(awayMs = 0) {
    if (!reactionsInitialized || !paused) return;
    const { idle, dreams } = paused;
    paused = null;
    if (!isPetActive()) return;
    beginSessionClock();
    startConditionTimer();
    triggerEntryGreeting();
    if (idle) startIdleTimer();
    for (const petId of dreams) {
        if ((petId === "secondary" ? state.secondPet : state).currentState === PET_STATES.SLEEPING) scheduleDream(petId);
    }
    startInterPetChatTimer();
    startHouseConversations();
    startReminderTimer();
    const reactPetId = pendingAiReaction;
    pendingAiReaction = null;
    // A chat reply that landed while away gets its reaction now that the user is reading it.
    if (reactPetId && awayMs < 15 * 60 * 1000 && isPetAvailable(reactPetId)
        && !state.isPetGenerating && !state.secondPet.isPetGenerating) triggerReaction("aiResponse", reactPetId);
    log("Reactions resumed");
}

/** Quick menu: the regular sleeping flow, so a dream can follow. */
export function sleepPet(petId = "primary") {
    const runtime = petId === "secondary" ? state.secondPet : state;
    if (!isPetAvailable(petId) || runtime.isPetGenerating || runtime.currentState === PET_STATES.SLEEPING) return;
    triggerReaction("sleeping", petId);
}

export function wakePet(petId = "primary") {
    const runtime = petId === "secondary" ? state.secondPet : state;
    if (!isPetAvailable(petId) || runtime.currentState !== PET_STATES.SLEEPING) return;
    clearTimeout(runtime.dreamTimer); runtime.dreamTimer = null;
    runtime.hasDreamedThisSleep = false;
    hideSleepZzz(petId);
    hideDreamEffect(petId);
    playBounce(petId);
    if (!sayWakeLine(petId)) setState(PET_STATES.IDLE, null, petId);
    resetIdleTimer();
}

function sayWakeLine(petId) {
    const line = customSpeech("wakeUp", petId);
    if (!line) return false;
    setState(PET_STATES.SURPRISED, 2500, petId);
    showSpeechBubble(line, null, false, petId);
    return true;
}

export function destroyReactions() {
    if (reactionsInitialized && state._sessionStartTime) {
        stopSessionClock();
        saveSettings();
    }
    state._sessionStartTime = null;
    reactionsInitialized = false;
    paused = null;
    pendingAiReaction = null;
    reminderCheckRunning = false;
    state.isReady = false;

    for (const key of ["_startupCooldownTimer", "_greetingTimer", "dreamTimer"]) {
        if (state[key]) clearTimeout(state[key]);
        state[key] = null;
    }
    if (state.secondPet.dreamTimer) clearTimeout(state.secondPet.dreamTimer);
    state.secondPet.dreamTimer = null;
    if (greetingCooldownTimer) clearTimeout(greetingCooldownTimer);
    greetingCooldownTimer = null;
    greetingCooldown = false;
    for (const cancel of pendingIdleWaits) cancel();
    pendingIdleWaits.clear();
    for (const cancel of pendingReactionSleeps) cancel();
    pendingReactionSleeps.clear();

    eventSource.removeListener(event_types.MESSAGE_SENT, onUserMessage);
    eventSource.removeListener(event_types.GENERATION_STARTED, onGenerationStart);
    eventSource.removeListener(event_types.MESSAGE_RECEIVED, onAIResponse);
    eventSource.removeListener(event_types.GENERATION_ENDED, onGenerationEnd);
    eventSource.removeListener(event_types.CHAT_CHANGED, onChatChanged);

    stopIdleTimer();
    stopConditionTimer();
    stopInterPetChatTimer();
    stopHouseConversations(); clearLifeActivities();
    stopReminderTimer();

    log("Reactions destroyed");
}

function onUserMessage() {
    if (!isPetActive() || !state.isReady) return;
    if (state.isPetGenerating) return;

    triggerReaction("userMessage");
    if (state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData) {
        triggerReaction("userMessage", "secondary");
    }
}

/** SillyTavern emits (type, options, dryRun). A dry run only assembles a prompt (other extensions'
 * prompt counting, message deletion); "quiet" generations include the pets' own requests. */
function onGenerationStart(type, _options, dryRun) {
    if (!isPetActive() || !state.isReady) return;
    if (state.isPetGenerating) return;

    if (dryRun || type === "quiet") return;

    state.isGenerating = true;
    resetIdleTimer();
    log(`Generation started: type=${type}`);
}

let messageCounter = 0;

function onAIResponse(messageId) {
    if (!isPetActive() || !state.isReady) return;
    if (greetingCooldown) return; // replies other extensions trigger right after the greeting

    log("onAIResponse triggered, messageId:", messageId);

    resetIdleTimer();

    messageCounter++;
    const interval = state.settings.reactions.reactionInterval || 3;
    if (messageCounter < interval) {
        log(`Skipping reaction (${messageCounter}/${interval})`);
        return;
    }
    messageCounter = 0;

    let reactPetId = "primary";
    if (state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData) {
        const reactor = state.settings.multiPet.chatReactor || "primary";
        if (reactor === "secondary") {
            reactPetId = "secondary";
        } else if (reactor === "alternate") {
            reactionAlternator = !reactionAlternator;
            reactPetId = reactionAlternator ? "secondary" : "primary";
        }
    }
    if (!isPetAvailable(reactPetId)) reactPetId = isPetAvailable("primary") ? "primary" : "secondary";
    // Nobody is watching a hidden tab; react once when the user comes back instead.
    if (paused) { pendingAiReaction = reactPetId; return; }
    const responseEpoch = state.lifecycleEpoch;
    const responsePetEpoch = getPetInstanceEpoch(reactPetId);

    if (state.isPetGenerating || state.secondPet?.isPetGenerating) {
        log("Pet is generating, deferring AI reaction...");
        waitForPetIdle(15000, 2000).then(available => {
            if (available && isCurrentPetRuntime(responseEpoch, reactPetId, responsePetEpoch)) {
                log("Pet now idle, executing deferred AI reaction");
                triggerReaction("aiResponse", reactPetId);
            } else {
                log("Deferred AI reaction timed out, discarding");
            }
        });
        return;
    }

    triggerReaction("aiResponse", reactPetId);
}

function waitForPetIdle(maxWait = 15000, pollInterval = 2000) {
    return new Promise(resolve => {
        const start = Date.now();
        const epoch = state.lifecycleEpoch;
        let timer = null;
        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            pendingIdleWaits.delete(cancel);
            resolve(value);
        };
        const cancel = () => finish(false);
        pendingIdleWaits.add(cancel);
        const check = () => {
            if (!isCurrentRuntime(epoch)) return finish(false);
            if (!state.isPetGenerating && !state.secondPet?.isPetGenerating) {
                return finish(true);
            }
            if (Date.now() - start >= maxWait) {
                return finish(false);
            }
            timer = setTimeout(check, pollInterval);
        };
        check();
    });
}

function onGenerationEnd() {
    if (!isPetActive() || !state.isReady) return;
    // Non-streaming replies emit MESSAGE_RECEIVED first, so a pet reaction may already be running.
    state.isGenerating = false;
    if (state.isPetGenerating) return;

    if (state.currentState === PET_STATES.THINKING) {
        setState(PET_STATES.IDLE);
        log("Generation ended, reset to idle");
    }
    if (state.settings.multiPet?.enabled && state.secondPet?.currentState === PET_STATES.THINKING) {
        setState(PET_STATES.IDLE, null, "secondary");
        log("Generation ended, reset secondary to idle");
    }
}

function onChatChanged() {
    state.chatEpoch = (state.chatEpoch || 0) + 1;
    if (!isPetActive() || !state.isReady) return;
    log("Chat changed");

    messageCounter = 0;
    resetIdleTimer();
}

let greetingCooldown = false;
let greetingCooldownTimer = null;

function triggerEntryGreeting() {
    if (!isPetActive()) return;
    const today = getLocalDateKey();
    state.settings.condition ||= { hunger:100, lastFed:null, lastVisit:null };
    const condition = state.settings.condition;
    // Stored with the shared server data: refresh, room changes and OFF/ON do not repeat it.
    if (condition.lastGreetingDate === today) return;
    const now = Date.now(), hour = new Date(now).getHours();
    // The condition timer already moved lastVisit forward; judge absence by the visit before it.
    const previousVisit = state._previousVisit ?? condition.lastVisit;
    const absent = previousVisit && now - previousVisit > 86400000;
    condition.lastGreetingDate = today;
    condition.lastVisit = now;
    saveSettings();
    greetingCooldown = true;
    clearTimeout(greetingCooldownTimer);
    greetingCooldownTimer = setTimeout(() => {
        greetingCooldownTimer = null; greetingCooldown = false;
    }, 5000);
    const type = absent ? "longAbsence" : hour <= 6 ? "latenight" : hour <= 10 ? "morning" : "greeting";
    triggerReaction(type);
    if (state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData) triggerReaction(type, "secondary");
}

export async function triggerReaction(triggerType, petId = "primary") {
    if (!isPetAvailable(petId)) return;
    const epoch = state.lifecycleEpoch;
    const petEpoch = getPetInstanceEpoch(petId);
    log(`Trigger [${petId}]: ${triggerType}`);

    // Only user interaction resets the idle/sleep timers; pet-to-pet talk, idling, sleep and dreams do not.
    const userInteractionTriggers = [
        "click", "clickSpam", "petting", "dragging",
        "feeding", "aiResponse", "userMessage",
        "greeting", "longAbsence",
    ];
    if (userInteractionTriggers.includes(triggerType)) {
        resetIdleTimer();
    }

    const wasSleeping = (petId === "secondary" ? state.secondPet : state).currentState === PET_STATES.SLEEPING;
    if (triggerType !== "sleeping" && triggerType !== "idle") {
        hideSleepZzz(petId);
        hideDreamEffect(petId);
        if (petId === "secondary") {
            if (state.secondPet.dreamTimer) { clearTimeout(state.secondPet.dreamTimer); state.secondPet.dreamTimer = null; }
            state.secondPet.hasDreamedThisSleep = false;
        } else {
            if (state.dreamTimer) { clearTimeout(state.dreamTimer); state.dreamTimer = null; }
            state.hasDreamedThisSleep = false;
        }
    }
    if (wasSleeping && ["click", "clickSpam", "petting"].includes(triggerType) && sayWakeLine(petId)) return;
    const hunger = petId === "secondary"
        ? (state.settings.multiPet?.secondPetCondition?.hunger ?? 100)
        : (state.settings.condition?.hunger ?? 100);
    const isStarving = hunger <= 10;
    const isHungry = hunger <= 30;

    if (isStarving && !["feeding", "hungry", "dragging"].includes(triggerType)) {
        if (["click", "petting", "clickSpam"].includes(triggerType) && Math.random() < 0.5) {
            showStateSpeech("hungry", petId);
            setState(PET_STATES.SAD, 2000, petId);
            log(`Hunger penalty [${petId}]: ignored ${triggerType} (starving)`);
            return;
        }
    }

    let defaultMood = PET_STATES.IDLE;
    let speechType = "idle";

    switch (triggerType) {
        case "userMessage":
            playBounce(petId);
            return;

        case "aiResponse":
            defaultMood = PET_STATES.HAPPY;
            playBounce(petId);

            if (state.settings.personality.enabled) {
                const reactionResult = await showAIReaction(petId);
                if (!isCurrentPetRuntime(epoch, petId, petEpoch)) return;

                if (state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData && reactionResult) {
                    const otherPetId = petId === "primary" ? "secondary" : "primary";
                    const compMoods = COMPLEMENTARY_MOODS[reactionResult.mood] || ["idle"];
                    const compMood = compMoods[Math.floor(Math.random() * compMoods.length)];
                    setState(compMood, 4000, otherPetId);
                }
            }

            const curState = petId === "secondary" ? state.secondPet.currentState : state.currentState;
            if (curState === PET_STATES.THINKING) {
                setState(defaultMood, 2000, petId);
            }
            return;

        case "idle":
            defaultMood = PET_STATES.IDLE;
            speechType = "idle";
            break;

        case "sleeping":
            defaultMood = PET_STATES.SLEEPING;
            speechType = "sleeping";
            showSleepZzz(petId);
            scheduleDream(petId);
            break;

        case "dragging":
            defaultMood = PET_STATES.DRAGGING;
            speechType = "dragging";
            setState(defaultMood, null, petId);
            showStateSpeech(speechType, petId);
            return;

        case "click":
            defaultMood = PET_STATES.HAPPY;
            speechType = "click";
            playBounce(petId);
            break;

        case "clickSpam":
            defaultMood = PET_STATES.ANGRY;
            speechType = "clickSpam";
            playShake(petId);
            break;

        case "petting":
            defaultMood = PET_STATES.SHY;
            speechType = "petting";
            playBounce(petId);
            playHearts(petId);
            break;

        case "greeting":
            defaultMood = PET_STATES.HAPPY;
            speechType = "greeting";
            playBounce(petId);
            break;

        case "latenight":
            defaultMood = PET_STATES.IDLE;
            speechType = "latenight";
            break;

        case "morning":
            defaultMood = PET_STATES.SLEEPING;
            speechType = "morning";
            break;

        case "longAbsence":
            defaultMood = PET_STATES.SURPRISED;
            speechType = "longAbsence";
            playShake(petId);
            break;

        case "feeding":
            defaultMood = PET_STATES.HAPPY;
            speechType = "feeding";
            playBounce(petId);
            break;

        case "hungry":
            defaultMood = PET_STATES.SAD;
            speechType = "hungry";
            break;

        default:
            defaultMood = PET_STATES.IDLE;
            speechType = "idle";
    }

    if (isHungry && speechType === "idle") {
        speechType = "hungry";
        defaultMood = PET_STATES.SAD;
    }
    setState(defaultMood, triggerType === "idle" || triggerType === "sleeping" ? null : 2000, petId);
    showStateSpeech(speechType, petId);
}

function startIdleTimer() {
    if (!isPetActive()) return;
    if (!state.settings.reactions.onIdle) return;

    const idleTimeout = (state.settings.reactions.idleTimeout || 300) * 1000;
    const sleepTimeout = (state.settings.reactions.sleepTimeout || 900) * 1000;

    // A pet already put to sleep from the quick menu is left asleep.
    const awake = petId => (petId === "secondary" ? state.secondPet : state).currentState !== PET_STATES.SLEEPING;
    state.idleTimer = setTimeout(() => {
        state.idleTimer = null;
        if (!isPetActive()) return;
        if (!state.isGenerating && !state.isPetGenerating) {
            if (awake("primary")) triggerReaction("idle");
            if (state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData && !state.secondPet.isPetGenerating && awake("secondary")) {
                triggerReaction("idle", "secondary");
            }
        }
    }, idleTimeout);

    state.sleepTimer = setTimeout(() => {
        state.sleepTimer = null;
        if (!isPetActive()) return;
        if (!state.isGenerating && !state.isPetGenerating) {
            if (awake("primary")) triggerReaction("sleeping");
            if (state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData && !state.secondPet.isPetGenerating && awake("secondary")) {
                triggerReaction("sleeping", "secondary");
            }
        }
    }, sleepTimeout);
}

export function resetIdleTimer() {
    stopIdleTimer();
    if (!isPetActive()) return;
    startIdleTimer();
}

function stopIdleTimer() {
    if (state.idleTimer) {
        clearTimeout(state.idleTimer);
        state.idleTimer = null;
    }
    if (state.sleepTimer) {
        clearTimeout(state.sleepTimer);
        state.sleepTimer = null;
    }
}
let conditionTimer = null;
const CONDITION_INTERVAL = 10 * 60 * 1000;   // -1 hunger every 10 minutes while on (empty after about 17 hours)
const HUNGER_DECAY_PER_CHECK = 1;
const AWAY_DECAY_INTERVAL = 20 * 60 * 1000;  // half speed while away
const AWAY_DECAY_MAX = 40;                   // cap for one absence, however long
const HUNGER_WARNING = 30;
// A tick only changes memory; saving each one rewrote SillyTavern's whole settings file every 10 minutes.
const CONDITION_SAVE_INTERVAL = 30 * 60 * 1000;
let conditionSavedAt = 0;
let conditionDirty = false;
let hungryNotified = false;
let secondPetHungryNotified = false;
let interPetChatTimer = null;
let reactionAlternator = false;

function saveCondition() {
    conditionSavedAt = Date.now();
    conditionDirty = false;
    saveSettings();
}

function startConditionTimer() {
    stopConditionTimer();
    if (!isPetActive()) return;

    if (!state.settings.condition) {
        state.settings.condition = { hunger: 100, lastFed: null, lastVisit: Date.now() };
        saveSettings();
    }
    conditionSavedAt = Date.now();

    const lastVisit = state.settings.condition.lastVisit;
    state._previousVisit = lastVisit;
    if (lastVisit) {
        const elapsed = Date.now() - lastVisit;
        const decay = Math.min(AWAY_DECAY_MAX, Math.floor(elapsed / AWAY_DECAY_INTERVAL));
        if (decay > 0) {
            if (isPetAvailable("primary")) state.settings.condition.hunger = Math.max(0, state.settings.condition.hunger - decay);
            log(`Offline hunger decay: -${decay}, now ${state.settings.condition.hunger}`);

            if (isPetAvailable("secondary") && state.settings.multiPet?.secondPetCondition) {
                state.settings.multiPet.secondPetCondition.hunger = Math.max(0, state.settings.multiPet.secondPetCondition.hunger - decay);
                log(`SecondPet offline hunger decay: -${decay}, now ${state.settings.multiPet.secondPetCondition.hunger}`);
            }

            // Otherwise every reactivation (tab switch, preset load) charges the same absence again.
            state.settings.condition.lastVisit = Date.now();
            saveCondition();
        }
    }

    conditionTimer = setInterval(updateCondition, CONDITION_INTERVAL);
    log(`Condition system started, hunger: ${state.settings.condition.hunger}`);
}

function stopConditionTimer() {
    if (conditionTimer) {
        clearInterval(conditionTimer);
        conditionTimer = null;
    }
}

function updateCondition() {
    if (!isPetActive()) return;
    if (!state.settings.condition) return;

    const second = isPetAvailable("secondary") ? state.settings.multiPet?.secondPetCondition : null;
    const before = [state.settings.condition.hunger, second?.hunger];
    if (isPetAvailable("primary")) state.settings.condition.hunger = Math.max(0, state.settings.condition.hunger - HUNGER_DECAY_PER_CHECK);
    // lastVisit always moves in memory, so a later resume charges only the time really away.
    state.settings.condition.lastVisit = Date.now();
    log(`Condition update: hunger=${state.settings.condition.hunger}`);

    if (second) {
        second.hunger = Math.max(0, second.hunger - HUNGER_DECAY_PER_CHECK);
        updateHungerGauge("secondary");

        // A sleeping pet is left asleep; the notice fires on a later check after it wakes.
        if (second.hunger <= HUNGER_WARNING && !secondPetHungryNotified && !state.secondPet.isPetGenerating
            && state.secondPet.currentState !== PET_STATES.SLEEPING) {
            secondPetHungryNotified = true;
            triggerReaction("hungry", "secondary");
        }
        if (second.hunger > HUNGER_WARNING) secondPetHungryNotified = false;
    }

    const crossed = [state.settings.condition.hunger, second?.hunger].some((hunger, i) => before[i] > HUNGER_WARNING && hunger <= HUNGER_WARNING);
    if (crossed || Date.now() - conditionSavedAt >= CONDITION_SAVE_INTERVAL) saveCondition();
    else conditionDirty = true;

    if (state.settings.condition.hunger <= HUNGER_WARNING && !hungryNotified && !state.isGenerating && !state.isPetGenerating
        && state.currentState !== PET_STATES.SLEEPING) {
        hungryNotified = true;
        triggerReaction("hungry");
    }
    if (state.settings.condition.hunger > HUNGER_WARNING) hungryNotified = false;

    updateHungerGauge();
    checkAutoDiary();
}

// A full gauge keeps the character's accent colour; only hunger warnings override it.
const hungerColor = hunger => hunger <= 20 ? "rgba(190, 100, 100, 0.75)" : hunger <= 50 ? "rgba(214, 170, 80, 0.75)" : "";

const petCondition = petId => (petId === "secondary" ? state.settings.multiPet?.secondPetCondition : state.settings.condition);

export function updateHungerGauge(petId = "primary") {
    const gauge = document.querySelector(`#${petId === "secondary" ? "saipet-container-2" : "saipet-container"} .st-pet-hunger-fill`);
    if (gauge) {
        const hunger = petCondition(petId)?.hunger ?? 100;
        gauge.style.width = `${hunger}%`;
        gauge.style.backgroundColor = hungerColor(hunger);
    }
}

export function feedPet(petId = "primary") {
    if (!isPetActive()) return;
    const second = petId === "secondary";
    if (second && !state.settings.multiPet?.enabled) return;
    if (!petCondition(petId)) {
        if (second) state.settings.multiPet.secondPetCondition = { hunger: 100, lastFed: null };
        else state.settings.condition = { hunger: 100, lastFed: null, lastVisit: Date.now() };
    }
    const condition = petCondition(petId);

    const before = condition.hunger;
    condition.hunger = Math.min(100, condition.hunger + 40);
    condition.lastFed = Date.now();
    if (second) secondPetHungryNotified = false;
    else hungryNotified = false;
    saveCondition();

    log(`Fed ${second ? "second pet" : "pet"}: ${before} -> ${condition.hunger}`);

    updateHungerGauge(petId);
    triggerReaction("feeding", petId);
}
let interPetRetryTimer = null;

async function runInterPetChat(label) {
    try {
        const { showInterPetDialogue } = await import("./pet-ai.js");
        if (!isPetActive()) return;
        await showInterPetDialogue();
    } catch (err) {
        logError(label, err);
    }
}

export function startInterPetChatTimer() {
    stopInterPetChatTimer();
    if (!isPetActive()) return;

    if (!isPetAvailable("primary") || !isPetAvailable("secondary")) return;
    if (!state.settings.multiPet?.interPetChat?.enabled) return;
    if (!state.settings.multiPet?.secondPetData) return;

    const intervalMin = Math.max(3, state.settings.multiPet.interPetChat.interval || 10);
    const intervalMs = intervalMin * 60 * 1000;

    interPetChatTimer = setInterval(async () => {
        if (!isPetActive()) return;
        if (interPetRetryTimer) {
            log("Inter-pet chat skipped: retry already pending");
            return;
        }

        if (state.isPetGenerating || state.secondPet?.isPetGenerating) {
            log("Inter-pet chat blocked, will retry in 30s");
            interPetRetryTimer = setTimeout(async () => {
                interPetRetryTimer = null;
                if (!isPetActive()) return;
                if (state.isPetGenerating || state.secondPet?.isPetGenerating) {
                    log("Inter-pet chat retry still blocked, skipping");
                    return;
                }
                await runInterPetChat("펫끼리 대화 (재시도)");
            }, 30000);
            return;
        }
        await runInterPetChat("펫끼리 대화");
    }, intervalMs);

    log(`Inter-pet chat timer started: interval=${intervalMin}min`);
}

function stopInterPetChatTimer() {
    if (interPetRetryTimer) {
        clearTimeout(interPetRetryTimer);
        interPetRetryTimer = null;
    }
    if (interPetChatTimer) {
        clearInterval(interPetChatTimer);
        interPetChatTimer = null;
        log("Inter-pet chat timer stopped");
    }
}

const DREAM_RETRY_LIMIT = 5;

function scheduleDream(petId = "primary") {
    if (!isPetAvailable(petId)) return;
    const epoch = state.lifecycleEpoch;
    const petEpoch = getPetInstanceEpoch(petId);
    const runtime = petId === "secondary" ? state.secondPet : state;

    if (runtime.hasDreamedThisSleep) return;

    if (!state.settings.petJournal?.dreamEnabled) return;

    const maxDreams = state.settings.petJournal.maxDreamsPerDay ?? 3;
    if (maxDreams > 0) {
        const todayStr = getLocalDateKey();
        if (!state.settings.petJournal.dreamCounts) state.settings.petJournal.dreamCounts = {};
        if (state.settings.petJournal.dreamCountDate !== todayStr) {
            state.settings.petJournal.dreamCountDate = todayStr;
            state.settings.petJournal.dreamCounts = {};
            saveSettings();
        }
        const petName = characterName(state.settings, petId);
        const petCount = state.settings.petJournal.dreamCounts[characterId(state.settings, petId)] || 0;
        if (petCount >= maxDreams) {
            log(`Dream skipped [${petId}]: daily limit reached for ${petName} (${petCount}/${maxDreams})`);
            return;
        }
    }

    const arm = (delay, attempt) => {
        if (runtime.dreamTimer) clearTimeout(runtime.dreamTimer);
        log(`Dream scheduled [${petId}]: ${Math.round(delay / 1000)}s delay`);
        runtime.dreamTimer = setTimeout(async () => {
            runtime.dreamTimer = null;
            if (!isCurrentPetRuntime(epoch, petId, petEpoch)) return;
            if (runtime.currentState !== PET_STATES.SLEEPING) {
                log(`Dream cancelled [${petId}]: no longer sleeping`);
                return;
            }
            // Two sleeping pets must not share the single default connection; wait for the other request.
            if (isPetRequestRunning() || state.isDreamGenerating || state.secondPet.isDreamGenerating) {
                if (attempt >= DREAM_RETRY_LIMIT) {
                    log(`Dream skipped [${petId}]: requests stayed busy`);
                    return;
                }
                arm((20 + Math.floor(Math.random() * 20)) * 1000, attempt + 1);
                return;
            }

            runtime.isDreamGenerating = true;
            runtime.hasDreamedThisSleep = true;
            showDreamEffect(petId);
            showSpeechBubble("꿈꾸는 중...", 20000, false, petId);

            try {
                const { generateDream, saveDream } = await import("./pet-ai.js");
                if (!isCurrentPetRuntime(epoch, petId, petEpoch)) return;
                const petName = characterName(state.settings, petId);

                const result = await generateDream(petId);
                if (!isCurrentPetRuntime(epoch, petId, petEpoch)) return;

                if (result && result.content) {
                    saveDream(petName, result.content, result.sleepTalk, petId, result);
                    showSpeechBubble(result.sleepTalk, 10000, false, petId);
                    log(`Dream complete [${petId}]: "${result.sleepTalk}"`);
                } else {
                    showSpeechBubble("...zzz...", 5000, false, petId);
                }
            } catch (err) {
                if (!isCurrentPetRuntime(epoch, petId, petEpoch)) return;
                logError("꿈 생성", err);
                showSpeechBubble("...zzz...", 5000, false, petId);
            } finally {
                if (isCurrentPetRuntime(epoch, petId, petEpoch)) {
                    hideDreamEffect(petId);
                    runtime.isDreamGenerating = false;
                }
            }
        }, delay);
    };
    arm((30 + Math.floor(Math.random() * 30)) * 1000, 0);
}
let reminderTimer = null;
let reminderCheckRunning = false;
const REMINDER_CHECK_INTERVAL = 60 * 1000;
const REMINDER_GRACE_MINUTES = 10;
// Interval reminders count page time: a reload starts over; tab switches and edits keep counting.
const intervalReminderStarts = new Map();
const reminderKey = reminder => reminder.id ?? reminder;

export function startReminderTimer() {
    stopReminderTimer();
    if (!isPetActive()) return;

    if (!state.settings.reminders?.some(reminder => reminder.enabled)) return;

    const now = Date.now();
    for (const reminder of state.settings.reminders) {
        if (reminder.mode === "interval" && !intervalReminderStarts.has(reminderKey(reminder))) intervalReminderStarts.set(reminderKey(reminder), now);
    }

    reminderTimer = setInterval(checkReminders, REMINDER_CHECK_INTERVAL);

    log(`Reminder timer started (${state.settings.reminders.length} reminders)`);
    checkReminders();
}

function stopReminderTimer() {
    if (reminderTimer) {
        clearInterval(reminderTimer);
        reminderTimer = null;
    }
}

async function checkReminders() {
    if (reminderCheckRunning || !isPetActive()) return;
    const epoch = state.lifecycleEpoch;
    if (!state.settings.reminders || state.settings.reminders.length === 0) return;
    // Busy: skip quietly; a later check within the grace period delivers it.
    if (state.isPetGenerating || state.secondPet?.isPetGenerating || state.isGenerating) return;

    const now = new Date();
    const nowMs = now.getTime();
    const minuteOfDay = now.getHours() * 60 + now.getMinutes();
    const todayStr = getLocalDateKey(now);
    const dayOfWeek = now.getDay();

    const toTrigger = [];

    for (const reminder of state.settings.reminders) {
        if (!reminder.enabled) continue;

        if (reminder.mode === "interval") {
            const key = reminderKey(reminder);
            if (!intervalReminderStarts.has(key)) { intervalReminderStarts.set(key, nowMs); continue; }
            if (nowMs - intervalReminderStarts.get(key) >= (reminder.intervalMinutes || 30) * 60 * 1000) toTrigger.push(reminder);
            continue;
        }

        // Time mode: within the grace period after the scheduled time, once per day.
        if (reminder.lastTriggered === todayStr) continue;
        const [hh, mm] = String(reminder.time || "").split(":").map(Number);
        const elapsed = minuteOfDay - (hh * 60 + mm);
        if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > REMINDER_GRACE_MINUTES) continue;

        const days = reminder.days || [];
        if (days.length > 0 && !days.includes(dayOfWeek)) continue;

        toTrigger.push(reminder);
    }

    if (toTrigger.length === 0) return;

    const reminderPetId = state.settings.reminderPetId || "primary";
    const actualPetId = isPetAvailable(reminderPetId) ? reminderPetId : isPetAvailable("primary") ? "primary" : "secondary";
    if (!isPetAvailable(actualPetId)) return;
    const actualPetEpoch = getPetInstanceEpoch(actualPetId);

    // One at a time with a gap between; the next check never overlaps a running one.
    reminderCheckRunning = true;
    try {
        for (let i = 0; i < toTrigger.length; i++) {
            const reminder = toTrigger[i];

            if (i > 0) {
                if (!await waitForActiveDelay(18000, epoch)) return;
                if (state.isPetGenerating || state.secondPet?.isPetGenerating) break;
            }

            log(`Reminder triggered: "${reminder.message}" at ${reminder.time || reminder.intervalMinutes + 'min interval'}`);

            if (reminder.mode === "interval") {
                intervalReminderStarts.set(reminderKey(reminder), Date.now());
            } else {
                reminder.lastTriggered = todayStr;
                if ((reminder.days || []).length === 0) {
                    reminder.enabled = false;
                }
                saveSettings();
                document.dispatchEvent(new CustomEvent("stvp-reminders-updated"));
            }

            try {
                const { generateReminder } = await import("./pet-ai.js");
                if (!isCurrentPetRuntime(epoch, actualPetId, actualPetEpoch)) return;
                const result = await generateReminder(reminder.message, actualPetId);
                if (!isCurrentPetRuntime(epoch, actualPetId, actualPetEpoch)) return;

                playReminderSound(state.settings.reminderSound !== false);
                if (result && result.text) {
                    setState(result.mood || PET_STATES.HAPPY, 3000, actualPetId);
                    showSpeechBubble(result.text, 15000, true, actualPetId);
                    saveNotificationLog(reminder.message, result.text, result.mood || "happy", "reminder", actualPetId);
                } else {
                    showSpeechBubble(`⏰ ${reminder.message}`, 10000, false, actualPetId);
                }
            } catch (err) {
                if (!isCurrentPetRuntime(epoch, actualPetId, actualPetEpoch)) return;
                logError("리마인드 생성", err);
                playReminderSound(state.settings.reminderSound !== false);
                showSpeechBubble(`⏰ ${reminder.message}`, 10000, false, actualPetId);
            }
        }
    } finally {
        reminderCheckRunning = false;
    }
}
let autoDiaryEpoch = null;

/** Once a day per pet, after the user's chat-count and daily visible-time thresholds. */
async function checkAutoDiary() {
    if (!isPetActive()) return;
    const epoch = state.lifecycleEpoch;
    const autoDiary = state.settings.autoDiary;
    if (!autoDiary?.enabled) return;
    if (!state.settings.petJournal?.diaryEnabled) return;
    if (autoDiaryEpoch === epoch) return;
    if (state.isPetGenerating || state.isGenerating || state.secondPet?.isPetGenerating) return;

    const todayStr = getLocalDateKey();

    const minSessionMs = (autoDiary.minSessionMinutes ?? 5) * 60 * 1000;
    const currentSessionElapsed = Date.now() - (state._sessionStartTime || Date.now());
    const totalDailySession = (state._dailySessionAccumulated || 0) + currentSessionElapsed;
    if (totalDailySession < minSessionMs) return;

    const minChats = autoDiary.minChats || 5;
    if ((state._sessionChatCount || 0) < minChats) return;

    const writer = state.settings.petJournal?.diaryWriter || "primary";
    const targets = [];
    if ((writer === "primary" || writer === "both") && isPetAvailable("primary")) targets.push("primary");
    if ((writer === "secondary" || writer === "both") && isPetAvailable("secondary")) targets.push("secondary");
    if (targets.length === 0) {
        if (isPetAvailable("primary")) targets.push("primary");
        else if (isPetAvailable("secondary")) targets.push("secondary");
    }

    const lastDates = state.settings.petJournal.lastDiaryDates || {};
    const pendingTargets = targets.filter(id => lastDates[characterId(state.settings, id)] !== todayStr);
    if (pendingTargets.length === 0) return;

    autoDiaryEpoch = epoch;
    log(`Auto diary conditions met (session: ${Math.floor(totalDailySession/60000)}min, chats: ${state._sessionChatCount}, writers: ${pendingTargets.join(",")})`);

    try {
        const { generateDiary, saveDiary } = await import("./pet-ai.js");
        if (!isCurrentRuntime(epoch)) return;

        for (const petId of pendingTargets) {
            if (!isCurrentRuntime(epoch)) return;
            const petName = characterName(state.settings, petId);

            const result = await generateDiary(petId);
            if (!isCurrentRuntime(epoch)) return;

            if (result && result.diary) {
                saveDiary(petName, result.diary, petId, result.comment);

                if (result.comment) {
                    setState(result.mood || PET_STATES.HAPPY, 4000, petId);
                    showSpeechBubble(`📔 ${result.comment}`, 10000, true, petId);
                } else {
                    setState(PET_STATES.HAPPY, 3000, petId);
                    showSpeechBubble("📔 일기 다 썼다...", 6000, false, petId);
                }

                log(`Auto diary written for ${petName} [${petId}]`);
            }
        }
    } catch (err) {
        logError("자동 일기", err);
    } finally {
        if (autoDiaryEpoch === epoch) autoDiaryEpoch = null;
    }
}
