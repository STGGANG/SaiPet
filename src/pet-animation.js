import { state, log, isPetAvailable, getPetInstanceEpoch, isCurrentPetRuntime, schedulePetTimeout } from "./state.js";
import { DEFAULT_SPRITES, MOOD_STATES } from "./constants.js";
import { updatePetSprite } from "./pet-core.js";
import { effectIcon } from "./effect-icons.js";

export const PET_STATES = MOOD_STATES;

const petContainer = petId => document.getElementById(petId === "secondary" ? "saipet-container-2" : "saipet-container");
const petWrapper = petId => petContainer(petId)?.querySelector(".st-pet-wrapper");

export function getCurrentSprite(petId = "primary") {
    let customSprites, currentState;
    if (petId === "secondary") {
        customSprites = state.settings.multiPet?.secondPetData?.appearance?.customSprites || {};
        currentState = state.secondPet.currentState || PET_STATES.IDLE;
    } else {
        customSprites = state.settings.appearance.customSprites;
        currentState = state.currentState || PET_STATES.IDLE;
    }
    if (customSprites[currentState]) return customSprites[currentState];
    // A missing mood falls back to the custom idle image before the stock one.
    if (customSprites.idle) return customSprites.idle;
    return DEFAULT_SPRITES[currentState] || DEFAULT_SPRITES.idle;
}

export function setState(newState, duration = null, petId = "primary") {
    if (!isPetAvailable(petId)) return;
    const epoch = state.lifecycleEpoch;
    const petEpoch = getPetInstanceEpoch(petId);
    const timerKey = petId === "secondary" ? "_stateRevertTimer2" : "_stateRevertTimer";
    if (state[timerKey]) clearTimeout(state[timerKey]);
    state[timerKey] = null;
    const runtime = petId === "secondary" ? state.secondPet : state;
    const prevState = runtime.currentState;
    runtime.currentState = newState;
    log(`State [${petId}]: ${prevState} -> ${newState}`);

    if (petId === "secondary") {
        import("./pet-core.js").then(({ updatePetSprite }) => {
            if (isCurrentPetRuntime(epoch, petId, petEpoch)) updatePetSprite(petId);
        });
    } else {
        updatePetSprite();
    }

    const container = petContainer(petId);
    if (container) {
        for (const s of Object.values(PET_STATES)) container.classList.remove(`state-${s}`);
        container.classList.add(`state-${newState}`);
    }

    if (duration !== null) {
        state[timerKey] = setTimeout(() => {
            state[timerKey] = null;
            if (!isCurrentPetRuntime(epoch, petId, petEpoch)) return;
            if (runtime.currentState === newState) setState(PET_STATES.IDLE, null, petId);
        }, duration);
    }
}

export function clearPetAnimationTimer(petId = "primary") {
    const timerKey = petId === "secondary" ? "_stateRevertTimer2" : "_stateRevertTimer";
    if (state[timerKey]) clearTimeout(state[timerKey]);
    state[timerKey] = null;
    if (petId === "secondary") state.secondPet.currentState = PET_STATES.IDLE;
    else state.currentState = PET_STATES.IDLE;
}

export function clearPetAnimationTimers() {
    clearPetAnimationTimer("primary");
    clearPetAnimationTimer("secondary");
}

function playClass(petId, className) {
    const container = petContainer(petId);
    if (!container) return;
    container.classList.add(className);
    schedulePetTimeout(() => container.classList.remove(className), 500);
}

export const playBounce = (petId = "primary") => playClass(petId, "bounce");
export const playShake = (petId = "primary") => playClass(petId, "shake");

export function playHearts(petId = "primary") {
    const wrapper = petWrapper(petId);
    if (!wrapper) return;
    const kinds = ["heart", "heart", "heartSoft", "sparkle"];
    const count = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
        const heart = document.createElement("span");
        heart.className = "st-pet-heart-particle";
        const kind = kinds[Math.floor(Math.random() * kinds.length)];
        heart.append(effectIcon(kind));
        heart.style.setProperty("--h-x", `${(Math.random() - 0.5) * 110}px`);
        heart.style.setProperty("--h-rot", `${(Math.random() - 0.5) * 40}deg`);
        heart.style.setProperty("--h-delay", `${i * 0.1}s`);
        heart.style.fontSize = `${(kind === "sparkle" ? 10 : 15) + Math.random() * 10}px`;
        wrapper.appendChild(heart);
        schedulePetTimeout(() => heart.remove(), 1500);
    }
}

export function showSleepZzz(petId = "primary") {
    const wrapper = petWrapper(petId);
    if (!wrapper || wrapper.querySelector(".st-pet-zzz")) return;
    const zzz = document.createElement("div");
    zzz.className = "st-pet-zzz";
    zzz.innerHTML = `<span class="zzz-1">z</span><span class="zzz-2">z</span>`;
    zzz.append(effectIcon("moon", "zzz-3"));
    wrapper.appendChild(zzz);
}

export function hideSleepZzz(petId = "primary") {
    petContainer(petId)?.querySelector(".st-pet-zzz")?.remove();
}

export function showDreamEffect(petId = "primary") {
    const wrapper = petWrapper(petId);
    if (!wrapper || wrapper.querySelector(".st-pet-dream")) return;
    const dream = document.createElement("div");
    dream.className = "st-pet-dream";
    dream.append(effectIcon("sparkle", "dream-1"), effectIcon("dream", "dream-2"), effectIcon("sparkle", "dream-3"));
    wrapper.appendChild(dream);
}

export function hideDreamEffect(petId = "primary") {
    petContainer(petId)?.querySelector(".st-pet-dream")?.remove();
}
