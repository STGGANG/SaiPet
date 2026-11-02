import { state, log, isPetAvailable, schedulePetTimeout } from "./state.js";
import { DEFAULT_SPEECHES } from "./constants.js";
import { showMobileSpeech, hideMobileSpeech, clearMobileSpeech } from "./mobile-speech.js";
import { setGestureText } from "./ui-kit.js";

export function showSpeechBubble(text, duration = null, priority = false, petId = "primary") {
    if (!isPetAvailable(petId)) return;
    // Give the short emote scene room; AI responses still take priority.
    const usesMobileBar = state.isMobile && state.settings.deviceDisplay?.mobile?.speechMode !== "bubble";
    if (!usesMobileBar && !priority && Date.now() < (state.socialUntil || 0)) return;
    const isSecond = petId === "secondary";
    // ON/OFF and display time are shared by both pets, not part of a pet's own bubble style.
    const mobileSpeech = state.isMobile ? state.settings.deviceDisplay?.mobile?.speechEnabled : null;
    if (!(mobileSpeech == null ? state.settings.speechBubble.enabled : mobileSpeech)) return;

    const bubbleEl = isSecond ? state.secondPet.bubbleElement : state.bubbleElement;
    if (!bubbleEl) return;

    const bubbleText = bubbleEl.querySelector(".st-pet-bubble-text");
    if (!bubbleText) return;

    if (usesMobileBar) {
        const receipt = showMobileSpeech(text, duration || state.settings.speechBubble.duration, priority, petId);
        if (!receipt) log(`Speech [${petId}] blocked (priority active): "${text}"`);
        return receipt;
    }
    const isPriorityActive = isSecond ? state.secondPet.isPrioritySpeech : state.isPrioritySpeech;
    if (isPriorityActive && !priority) {
        log(`Speech [${petId}] blocked (priority active): "${text}"`);
        return;
    }

    const existingTimer = isSecond ? state.secondPet.bubbleTimer : state.bubbleTimer;
    if (existingTimer) {
        clearTimeout(existingTimer);
    }

    if (isSecond) {
        state.secondPet.isPrioritySpeech = priority;
    } else {
        state.isPrioritySpeech = priority;
    }

    hideMobileSpeech();

    applyBubbleStyle(petId);

    setGestureText(bubbleText, text);

    bubbleEl.style.display = "block";
    bubbleEl.classList.add("show");

    const container = document.getElementById(isSecond ? "saipet-container-2" : "saipet-container");
    if (container) promoteBubble(container);
    scheduleBubbleLayout();

    const hideAfter = duration || state.settings.speechBubble.duration;
    const newTimer = setTimeout(() => {
        hideSpeechBubble(petId);
    }, hideAfter);

    if (isSecond) {
        state.secondPet.bubbleTimer = newTimer;
    } else {
        state.bubbleTimer = newTimer;
    }

    log(`Speech [${petId}]: "${text}"`);
}

export function hideSpeechBubble(petId = "primary") {
    hideMobileSpeech(petId);
    const isSecond = petId === "secondary";
    const bubbleEl = isSecond ? state.secondPet.bubbleElement : state.bubbleElement;
    if (!bubbleEl) return;

    if (isSecond) {
        state.secondPet.isPrioritySpeech = false;
    } else {
        state.isPrioritySpeech = false;
    }
    bubbleEl.classList.remove("show");

    schedulePetTimeout(() => {
        const el = isSecond ? state.secondPet.bubbleElement : state.bubbleElement;
        if (el === bubbleEl && !el.classList.contains("show")) el.style.display = "none";
        scheduleBubbleLayout();
    }, 200);

    const timer = isSecond ? state.secondPet.bubbleTimer : state.bubbleTimer;
    if (timer) {
        clearTimeout(timer);
        if (isSecond) {
            state.secondPet.bubbleTimer = null;
        } else {
            state.bubbleTimer = null;
        }
    }
}

export function clearSpeechTimers() {
    if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
    layoutFrame = null;
    clearMobileSpeech();
    for (const pet of [state, state.secondPet]) {
        if (pet.bubbleTimer) clearTimeout(pet.bubbleTimer);
        pet.bubbleTimer = null;
        pet.isPrioritySpeech = false;
        if (pet.bubbleElement) {
            pet.bubbleElement.classList.remove("show");
            pet.bubbleElement.style.display = "none";
        }
    }
}

let layoutFrame = null;

/** Tap a bubble even when pet dragging is disabled. Never treat the tap as petting. */
export function setupBubbleInteraction(container) {
    container.addEventListener("pointerdown", event => {
        if (!event.target.closest?.(".st-pet-bubble")) return;
        event.stopPropagation();
        promoteBubble(container);
    });
    container.addEventListener("saipet-positioned", scheduleBubbleLayout);
}
/** The latest speaker sits one step above the other pet, never above other extensions' popups. */
function promoteBubble(container) {
    for (const id of ["saipet-container", "saipet-container-2"]) document.getElementById(id)?.style.removeProperty("z-index");
    container.style.zIndex = "3011";
}
/** At most two bubbles, updated on speech/drag/resize/movement end, never in a frame loop. */
export function scheduleBubbleLayout() {
    if (layoutFrame !== null) return;
    layoutFrame = requestAnimationFrame(() => {
        layoutFrame = null;
        const nodes = ["saipet-container", "saipet-container-2"].map(id => document.getElementById(id)).filter(Boolean);
        const visible = nodes.map(container => ({container,bubble:container.querySelector(".st-pet-bubble:not(.stvp-social-bubble)")}))
            .filter(({bubble}) => bubble?.classList.contains("show") && bubble.style.display !== "none");
        if (!visible.length) return;
        const viewport = state.isMobile ? window.visualViewport : null;
        const topBar = state.isMobile ? document.querySelector("#top-bar, #topbar, .top-bar") : null;
        const left = (viewport?.offsetLeft || 0) + 8;
        const right = (viewport?.offsetLeft || 0) + (viewport?.width || window.innerWidth) - 8;
        const top = Math.max(viewport?.offsetTop || 0,topBar?.getBoundingClientRect().bottom || 0) + 8;
        const bottom = (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight) - 8;
        for (const {bubble} of visible) {
            bubble.style.setProperty("--bubble-stack-y", "0px");
            bubble.style.setProperty("--bubble-offset-x", "-50%");
            bubble.style.setProperty("--tail-left", "50%");
            bubble.classList.remove("below");
        }
        // All reads, then all writes: two bubbles cost one forced layout instead of one each.
        for (const item of visible) {
            item.below = item.bubble.getBoundingClientRect().top < top;
            item.center = item.container.getBoundingClientRect().left + item.container.offsetWidth / 2;
        }
        for (const item of visible) item.bubble.classList.toggle("below", item.below);
        for (const item of visible) item.box = item.bubble.getBoundingClientRect();
        const flipped = visible.filter(item => item.below && item.box.bottom > bottom);
        for (const item of flipped) item.bubble.classList.remove("below");
        for (const item of flipped) item.box = item.bubble.getBoundingClientRect();
        for (const { bubble, box, center } of visible) {
            const shiftX = box.left < left ? left-box.left : box.right > right ? right-box.right : 0;
            const shiftY = box.top < top ? top-box.top : box.bottom > bottom ? bottom-box.bottom : 0;
            bubble.style.setProperty("--bubble-offset-x", `calc(-50% + ${shiftX}px)`);
            bubble.style.setProperty("--bubble-stack-y", `${shiftY}px`);
            bubble.style.setProperty("--tail-left", `${Math.max(12,Math.min(box.width-12,center-box.left-shiftX))}px`);
        }
    });
}
function applyBubbleStyle(petId = "primary") {
    const isSecond = petId === "secondary";
    const containerId = isSecond ? "saipet-container-2" : "saipet-container";
    const container = document.getElementById(containerId);
    if (!container) return;

    const speechBubbleSettings = isSecond
        ? (state.settings.multiPet?.secondPetData?.speechBubble || state.settings.speechBubble)
        : state.settings.speechBubble;
    const { backgroundColor, textColor, accentColor } = speechBubbleSettings;

    container.style.setProperty("--spc-bubble-bg", backgroundColor);
    container.style.setProperty("--spc-bubble-text", textColor);
    container.style.setProperty("--spc-accent", accentColor || "#7c9bff");
    container.style.setProperty("--bubble-bg-color", backgroundColor);
}

function getRandomSpeech(speechType, petId = "primary") {
    const validTypes = ["idle", "sleeping", "dragging", "click", "greeting", "latenight", "morning", "clickSpam", "longAbsence", "feeding", "hungry", "petting"];
    const type = validTypes.includes(speechType) ? speechType : "idle";
    const own = customSpeech(type, petId);
    if (own) return own;
    // The stock lines are Miyu's voice; a pet with its own images stays quiet instead of speaking as her.
    const pet = petId === "secondary" ? state.settings.multiPet?.secondPetData : state.settings;
    const sprites = pet?.appearance?.customSprites || {};
    if (Object.values(sprites).some(Boolean) || pet?.walk?.walkSprite) return "";
    const defaultList = DEFAULT_SPEECHES[type] || DEFAULT_SPEECHES.idle;
    return defaultList[Math.floor(Math.random() * defaultList.length)];
}

/** Only the user's own lines; an empty list means the pet stays quiet. */
export function customSpeech(type, petId = "primary") {
    const source = petId === "secondary" ? state.settings.multiPet?.secondPetData?.customSpeeches : state.settings.customSpeeches;
    const lines = (Array.isArray(source?.[type]) ? source[type] : []).filter(line => typeof line === "string" && line.trim());
    return lines.length ? lines[Math.floor(Math.random() * lines.length)] : "";
}

export function showStateSpeech(speechType, petId = "primary") {
    const speech = getRandomSpeech(speechType, petId);
    if (speech) showSpeechBubble(speech, null, false, petId);
}
