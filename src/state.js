import { EXTENSION_NAME } from "./constants.js";

export const state = {
    settings: null,
    petElement: null,
    bubbleElement: null,
    currentState: "idle",
    isDragging: false,
    idleTimer: null,
    sleepTimer: null,
    bubbleTimer: null,
    isGenerating: false,
    isPetGenerating: false,
    isReady: false,
    isMobile: false,
    runtimeActive: false,
    apiControllers: new Set(),
    storageBlocked: false,   // no usable server data: running and saving are blocked
    chatEpoch: 0,            // a chat change (even away and back) discards pending chat reactions
    lifecycleEpoch: 0,       // replies that arrive after OFF are ignored
    primaryInstanceEpoch: 0, // replies for a replaced pet are ignored
    isPrioritySpeech: false,
    cleanupDragEvents: null,
    _cleanupSecondPetDrag: null,
    _chatOutsideClickHandler: null,
    _chatOutsideClickHandler2: null,
    _startupCooldownTimer: null,
    _greetingTimer: null,
    _stateRevertTimer: null,
    _stateRevertTimer2: null,
    _walkStartTimer: null,
    _walkStartTimer2: null,
    _asyncPresentationTimers: new Set(),
    _sessionStartTime: null,
    _sessionChatCount: 0,
    dreamTimer: null,
    isDreamGenerating: false,
    hasDreamedThisSleep: false,
    secondPet: {
        petElement: null,
        bubbleElement: null,
        currentState: "idle",
        isPetGenerating: false,
        isPrioritySpeech: false,
        bubbleTimer: null,
        dreamTimer: null,
        isDreamGenerating: false,
        hasDreamedThisSleep: false,
        instanceEpoch: 0,
    },
};

export function isPetActive() {
    return Boolean(state.runtimeActive && !state.storageBlocked && state.settings?.enabled && isDeviceEnabled()
        && (state.settings.primaryPetEnabled !== false || (state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData)));
}

/** PC and phone have separate display switches; the pet data is shared. */
export function isDeviceEnabled() {
    const display = state.settings?.deviceDisplay;
    return state.isMobile ? display?.mobileEnabled === true : display?.pcEnabled !== false;
}

export function isPetAvailable(petId = "primary") {
    if (!isPetActive()) return false;
    if (petId === "secondary") {
        return Boolean(state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData && state.secondPet.petElement);
    }
    return Boolean(state.settings.primaryPetEnabled !== false && state.petElement);
}

export function isCurrentRuntime(epoch) {
    return isPetActive() && state.lifecycleEpoch === epoch;
}

export function getPetInstanceEpoch(petId = "primary") {
    return petId === "secondary" ? state.secondPet.instanceEpoch : state.primaryInstanceEpoch;
}

export function isCurrentPetRuntime(epoch, petId, instanceEpoch) {
    return isCurrentRuntime(epoch)
        && isPetAvailable(petId)
        && getPetInstanceEpoch(petId) === instanceEpoch;
}

export function schedulePetTimeout(callback, delay) {
    const epoch = state.lifecycleEpoch;
    const timer = setTimeout(() => {
        state._asyncPresentationTimers.delete(timer);
        if (isCurrentRuntime(epoch)) callback();
    }, delay);
    state._asyncPresentationTimers.add(timer);
    return timer;
}

export function getLocalDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function log(...args) {
    console.debug(`[${EXTENSION_NAME}]`, ...args);
}

export function logError(...args) {
    console.error(`[${EXTENSION_NAME}]`, ...args);
}
