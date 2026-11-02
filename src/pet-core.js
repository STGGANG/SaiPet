import { beginDragMotion } from "./drag-motion.js";
import { chooseWalkTarget, walkDirection, mobileWalkRange, walkingEnabled } from "./walk-direction.js";
import { setupBubbleInteraction, scheduleBubbleLayout } from "./pet-speech.js";
import { applyFont } from "./fonts.js";
import { startWalkVisual, stopWalkVisual } from "./walking.js";
import { startSocial, stopSocial, cancelSocialInteraction } from "./social.js";
import { maybeWalkHop, playGesture } from "./motion-effects.js";
import { spriteRect } from "./social-scenes.js";
import { moveElement, stopMotion } from "./movement.js";

import { state, log, isPetActive, getPetInstanceEpoch, isCurrentPetRuntime } from "./state.js";
import { saveSettings } from "./storage.js";
import { getCurrentSprite, PET_STATES, clearPetAnimationTimer } from "./pet-animation.js";
import { EXTENSION_BASE_PATH, COLLISION_SPEECHES, POSITION_PRESETS } from "./constants.js";
import { resolveSpriteSource } from "./sprite-paths.js";

const MOBILE_MIN_SIZE = 110;
const MOBILE_MAX_SIZE = 160;

function mobileDisplay() {
    state.settings.deviceDisplay ||= {};
    state.settings.deviceDisplay.mobile ||= {};
    return state.settings.deviceDisplay.mobile;
}

function mobilePosition(petId = "primary") {
    const profile = mobileDisplay();
    const key = petId === "secondary" ? "secondPetPosition" : "position";
    if (!profile[key]) {
        profile[key] = petId === "secondary"
            ? { location: "bottom-left", customX: null, customY: null }
            : { location: "bottom-right", customX: null, customY: null };
    }
    return profile[key];
}

function positionFor(petId = "primary") {
    if (state.isMobile) return mobilePosition(petId);
    return petId === "secondary" ? state.settings.multiPet?.secondPetPosition : state.settings.position;
}

/** Scaled to the screen on phones unless the user chose a phone size. */
function petSizeFor(petId = "primary") {
    // Size is a display preference shared by both characters. Old presets may
    // still carry appearance.size, but that value must not change the viewport.
    const desktopSize = state.settings.appearance.size || 250;
    const appearance = petId === "secondary" ? state.settings.multiPet?.secondPetData?.appearance : state.settings.appearance;
    const scale = Math.max(40, Math.min(180, Number(appearance?.scale) || 100)) / 100;
    if (!state.isMobile) return desktopSize * scale;
    const chosen = Number(mobileDisplay().size);
    if (Number.isFinite(chosen) && chosen >= 80 && chosen <= 240) return Math.min(280, chosen * scale);
    const screenBased = Math.round(Math.min(window.innerWidth * 0.32, desktopSize * 0.62));
    return Math.min(280, Math.max(MOBILE_MIN_SIZE, Math.min(MOBILE_MAX_SIZE, screenBased)) * scale);
}

function opacityFor() {
    const opacity = state.settings.appearance.opacity ?? 100;
    return Math.max(0, Math.min(100, opacity)) / 100;
}

function visibleBounds() {
    const viewport = state.isMobile ? window.visualViewport : null;
    const offsetTop = viewport?.offsetTop || 0;
    const topBar = state.isMobile ? document.querySelector("#top-bar, #topbar, .top-bar") : null;
    const topBarBottom = topBar?.getBoundingClientRect().bottom || 0;
    return {
        minX: Math.max(0, viewport?.offsetLeft || 0),
        minY: Math.max(0, offsetTop, topBarBottom),
        maxX: (viewport?.offsetLeft || 0) + (viewport?.width || window.innerWidth),
        maxY: offsetTop + (viewport?.height || window.innerHeight),
    };
}

/** On phones the hidden status row makes the box wider than the character; edges follow the character. */
function spriteInsets(container) {
    if (!state.isMobile) return { left: 0, right: 0 };
    const box = container.getBoundingClientRect(), art = spriteRect(container);
    if (!box.width || art.width < 8) return { left: 0, right: 0 };
    return { left: Math.max(0, art.left - box.left), right: Math.max(0, box.right - art.right) };
}

function clampCoordinates(x, y, container, wholeBox = false) {
    const bounds = visibleBounds();
    const margin = state.isMobile ? 8 : 0;
    const inset = wholeBox ? { left: 0, right: 0 } : spriteInsets(container);
    return {
        x: Math.max(bounds.minX + margin - inset.left, Math.min(x, bounds.maxX - container.offsetWidth - margin + inset.right)),
        y: Math.max(bounds.minY + margin, Math.min(y, bounds.maxY - container.offsetHeight - margin)),
    };
}

function keepConditionRowOnScreen(container) {
    const row = container.querySelector(".st-pet-condition-row");
    if (!row) return;
    row.style.removeProperty("translate");
    const rect = row.getBoundingClientRect(), view = visibleBounds();
    const shift = rect.left < view.minX + 4 ? view.minX + 4 - rect.left : rect.right > view.maxX - 4 ? view.maxX - 4 - rect.right : 0;
    if (shift) row.style.translate = `${Math.round(shift)}px 0`;
}

function setInteracting(container, interacting) {
    if (!container) return;
    if (container._saipetFadeTimer) clearTimeout(container._saipetFadeTimer);
    if (interacting) {
        container.classList.add("saipet-interacting");
        if (state.isMobile) keepConditionRowOnScreen(container);
    }
    else container._saipetFadeTimer = setTimeout(() => {
        container.classList.remove("saipet-interacting");
        container._saipetFadeTimer = null;
    }, state.isMobile ? 2500 : 200);
}

function setupOpacityInteraction(container) {
    container.addEventListener("pointerdown", () => setInteracting(container, true));
    container.addEventListener("pointerup", () => setInteracting(container, false));
    container.addEventListener("pointercancel", () => setInteracting(container, false));
}

function isImageSprite(sprite) {
    return typeof sprite === "string" && (
        sprite.startsWith("data:") || sprite.startsWith("blob:") ||
        sprite.startsWith("http") || sprite.startsWith("/") ||
        /\.(?:png|gif|webp|jpe?g)(?:[?#].*)?$/i.test(sprite)
    );
}

export const PET_IDS = ["primary", "secondary"];

const WALK_RANGE = 250;
const WALK_MOVE_MIN = 30000;
const WALK_MOVE_MAX = 90000;
const walkTimers = () => ({ timer: null, transitionTimer: null, originX: null, originY: null });
const WALKS = { primary: walkTimers(), secondary: walkTimers() };

const PET_SLOTS = {
    primary: {
        id: "primary", containerId: "saipet-container", logName: "Pet", spriteAlt: "pet",
        epochKey: "primaryInstanceEpoch", walkStartTimerKey: "_walkStartTimer", walkStartDelay: 3000,
        dragCleanupKey: "cleanupDragEvents", chatOutsideClickKey: "_chatOutsideClickHandler",
    },
    secondary: {
        id: "secondary", containerId: "saipet-container-2", logName: "Second pet", spriteAlt: "pet2",
        epochKey: "instanceEpoch", walkStartTimerKey: "_walkStartTimer2", walkStartDelay: 4000,
        dragCleanupKey: "_cleanupSecondPetDrag", chatOutsideClickKey: "_chatOutsideClickHandler2",
    },
};

/** Everything that differs between the first and the second pet: DOM id, runtime, settings objects and timer slots. */
export function petSlot(petId = "primary") {
    const second = petId === "secondary";
    const fixed = PET_SLOTS[second ? "secondary" : "primary"];
    const settings = state.settings;
    return {
        ...fixed,
        enabled: second ? Boolean(settings?.multiPet?.enabled) : settings?.primaryPetEnabled !== false,
        runtime: second ? state.secondPet : state,
        data: second ? settings?.multiPet?.secondPetData : settings,
        condition: second ? settings?.multiPet?.secondPetCondition : settings?.condition,
        get position() { return positionFor(fixed.id); },
        walk: WALKS[fixed.id],
    };
}

const PET_MARKUP = `
        <div class="st-pet-wrapper">
            <div class="st-pet-sprite"></div>
            <div class="st-pet-bubble" style="display:none;">
                <span class="st-pet-bubble-text"></span>
            </div>
            <div class="st-pet-condition-row">
                <button class="st-pet-feed-btn" title="밥주기"><i class="fa-solid fa-drumstick-bite"></i></button>
                <div class="st-pet-hunger-bar">
                    <div class="st-pet-hunger-fill" style="width: 100%;"></div>
                </div>
                <button class="st-pet-chat-btn" title="말 걸기"><i class="fa-solid fa-comment-dots"></i></button>
                <button type="button" class="st-pet-menu-btn" title="더 보기" aria-haspopup="menu" aria-expanded="false"><i class="fa-solid fa-ellipsis"></i></button>
                <div class="st-pet-menu" role="menu" hidden>
                    <button type="button" role="menuitem" data-action="journal"><i class="fa-solid fa-book-open"></i>일기장</button>
                    <button type="button" role="menuitem" data-action="today"><i class="fa-solid fa-comments"></i>오늘 대화</button>
                    <button type="button" role="menuitem" data-action="house"><i class="fa-solid fa-house"></i>펫하우스</button>
                    <button type="button" role="menuitem" data-action="sleep"><i class="fa-solid fa-moon"></i>재우기</button>
                </div>
            </div>
            <div class="st-pet-chat-input" style="display:none;">
                <textarea class="st-pet-chat-text" rows="1" maxlength="300" aria-label="펫에게 할 말" placeholder="할 말을 입력하십시오" title="Enter 보내기 · Shift+Enter 줄바꿈"></textarea>
            </div>
        </div>
    `;

export function createPetContainer(petId = "primary") {
    const slot = petSlot(petId);
    if (!isPetActive() || !slot.enabled) {
        // A disabled first pet must not linger; the second pet is torn down by its own switch.
        if (petId === "primary") removePetContainer(petId);
        return;
    }
    removePetContainer(petId);
    if (!slot.data) return;

    const container = document.createElement("div");
    container.id = slot.containerId;
    container.classList.toggle("saipet-mobile", state.isMobile);
    container.setAttribute("data-design", slot.data.speechBubble?.design || state.settings.speechBubble?.design || "simple");
    container.innerHTML = PET_MARKUP;

    document.body.appendChild(container);
    setupOpacityInteraction(container);
    setupBubbleInteraction(container);

    slot.runtime.petElement = container.querySelector(".st-pet-sprite");
    slot.runtime.bubbleElement = container.querySelector(".st-pet-bubble");

    updatePetPosition(petId);
    updatePetSprite(petId);
    // Clicks and petting work even when dragging is off.
    setupDragEvents(container, petId);
    updatePetSize(petId);
    updatePetOpacity();
    clampPetPosition(petId);
    applyDesignTheme(petId);

    if (walkingEnabled(state.settings, state.isMobile)) {
        state[slot.walkStartTimerKey] = setTimeout(() => {
            state[slot.walkStartTimerKey] = null;
            if (isPetActive()) startWalking(petId);
        }, slot.walkStartDelay);
    }

    container.querySelector(".st-pet-feed-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        import("./pet-reactions.js").then(({ feedPet }) => feedPet(petId));
    });
    container.querySelector(".st-pet-chat-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleChatInput(petId);
    });
    setupQuickMenu(container, petId);

    const hungerFill = container.querySelector(".st-pet-hunger-fill");
    if (hungerFill) {
        hungerFill.style.width = `${slot.condition?.hunger ?? 100}%`;
        import("./pet-reactions.js").then(m => m.updateHungerGauge(petId)).catch(() => {});
    }

    if (petId === "secondary") startSocial();
    log(`${slot.logName} container created`);
}

export function removePetContainer(petId = "primary") {
    const slot = petSlot(petId), { runtime } = slot;
    cancelCollisionReaction();
    if (petId === "secondary") stopSocial();
    runtime[slot.epochKey]++;
    clearPetAnimationTimer(petId);
    if (state[slot.walkStartTimerKey]) {
        clearTimeout(state[slot.walkStartTimerKey]);
        state[slot.walkStartTimerKey] = null;
    }
    stopWalking(petId);
    if (runtime.bubbleTimer) clearTimeout(runtime.bubbleTimer);
    runtime.bubbleTimer = null;
    runtime.isPrioritySpeech = false;
    if (runtime.dreamTimer) clearTimeout(runtime.dreamTimer);
    runtime.dreamTimer = null;

    if (state[slot.dragCleanupKey]) {
        state[slot.dragCleanupKey]();
        state[slot.dragCleanupKey] = null;
    }
    if (state[slot.chatOutsideClickKey]) {
        document.removeEventListener("click", state[slot.chatOutsideClickKey]);
        state[slot.chatOutsideClickKey] = null;
    }

    // Hot reloads and old tabs can leave more than one node with this ID.
    for (const existing of document.querySelectorAll(`#${slot.containerId}`)) {
        stopMotion(existing, false);
        if (existing._saipetFadeTimer) clearTimeout(existing._saipetFadeTimer);
        existing._saipetMenuClose?.();
        existing.remove();
    }
    runtime.petElement = null;
    runtime.bubbleElement = null;
    if (petId === "secondary") runtime.currentState = "idle";
    else state.isDragging = false;
    runtime.isPetGenerating = false;
    runtime.isDreamGenerating = false;
}

export function updatePetPosition(petId = "primary") {
    const slot = petSlot(petId);
    const container = document.getElementById(slot.containerId);
    if (!container) return;

    stopMotion(container);
    const pos = slot.position;
    if (pos?.customX != null && pos?.customY != null) {
        container.style.left = `${pos.customX}px`;
        container.style.top = `${pos.customY}px`;
        container.style.right = "auto";
        container.style.bottom = "auto";
        return;
    }

    const inset = state.isMobile ? "8px" : "20px";
    container.style.left = "auto";
    container.style.top = "auto";
    container.style.right = "auto";
    container.style.bottom = "auto";

    const edge = spriteInsets(container);
    const side = (property, gap) => { container.style[property] = state.isMobile ? `${8 - gap}px` : inset; };
    if (petId === "secondary") {
        // Without a saved corner the second pet takes the side opposite the first pet.
        // Its top preset keeps the fixed 20px inset on phones as well.
        const opposites = { "top-left": "top-right", "top-right": "top-left", "bottom-left": "bottom-right", "bottom-right": "bottom-left" };
        const preset = POSITION_PRESETS[pos?.location || opposites[positionFor("primary")?.location || "bottom-right"] || "bottom-left"];
        if (preset) {
            if (preset.x == null) side("right", edge.right);
            else if (state.isMobile) side("left", edge.left);
            else container.style.left = `${preset.x}px`;
            if (preset.y != null) container.style.top = `${preset.y}px`; else container.style.bottom = inset;
        } else {
            side("left", edge.left);
            container.style.bottom = inset;
        }
        return;
    }

    switch (pos?.location) {
        case "top-left":
            side("left", edge.left);
            container.style.top = inset;
            break;
        case "top-right":
            side("right", edge.right);
            container.style.top = inset;
            break;
        case "bottom-left":
            side("left", edge.left);
            container.style.bottom = inset;
            break;
        case "bottom-right":
        default:
            side("right", edge.right);
            container.style.bottom = inset;
            break;
    }
}

export function updatePetSize(petId = "primary") {
    const container = document.getElementById(petSlot(petId).containerId);
    if (!container) return;
    container.style.setProperty("--pet-size", `${petSizeFor(petId)}px`);
}

/** Opacity is one display preference, so both pets always get it together. */
export function updatePetOpacity() {
    const opacity = String(opacityFor());
    for (const petId of PET_IDS) {
        document.getElementById(petSlot(petId).containerId)?.style.setProperty("--saipet-rest-opacity", opacity);
    }
}

export function updatePetSprite(petId = "primary") {
    const slot = petSlot(petId), element = slot.runtime.petElement;
    if (!element) return;
    stopWalkVisual(document.getElementById(slot.containerId));
    const sprite = getCurrentSprite(petId);

    if (isImageSprite(sprite)) {
        const imgSrc = resolveSpriteSource(sprite);
        const existingImg = element.querySelector("img");
        if (!existingImg || existingImg.dataset.src !== imgSrc) {
            element.textContent = "";
            const img = document.createElement("img");
            img.dataset.src = imgSrc;
            img.src = imgSrc;
            img.alt = slot.spriteAlt;
            img.draggable = false;
            img.onerror = () => { img.onerror = null; img.src = EXTENSION_BASE_PATH + "images/idle.webp"; };
            element.appendChild(img);
        }
        element.classList.add("has-image");
    } else {
        element.textContent = sprite || "🐱";
        element.classList.remove("has-image");
    }
    element.classList.toggle("flipped", Boolean(slot.data?.appearance?.flipHorizontal));
}

function setupDragEvents(container, petId) {
    const slot = petSlot(petId), { runtime } = slot;
    let startX, startY, initialX, initialY;
    let dragFrame = null, pendingDrag = null, dragMotion = null;
    const flushDrag = () => {
        if (dragFrame !== null) cancelAnimationFrame(dragFrame);
        dragFrame = null;
        if (pendingDrag) {
            dragMotion?.move(pendingDrag.x, pendingDrag.y); pendingDrag = null;
        }
    };
    let hasMoved = false;
    let isPointerDown = false;
    let clickCount = 0;
    let clickResetTimer = null;
    let holdTimer = null;
    let didTriggerPetting = false;
    const busy = () => runtime.isPetGenerating || runtime.currentState === "thinking";

    function onDragStart(e) {
        const target = e.target;
        if (target.closest && (target.closest(".st-pet-condition-row") || target.closest(".st-pet-chat-input") || target.closest(".st-pet-bubble"))) {
            return false;
        }
        // On touch screens a press outside the character art must still scroll the page.
        if (e.type.includes("touch") && !target.closest?.(".st-pet-sprite")) return false;

        container._chatLift = null;
        cancelSocialInteraction();
        stopMotion(container);
        isPointerDown = true;
        setInteracting(container, true);
        hasMoved = false;
        didTriggerPetting = false;

        const event = e.type.includes("touch") ? e.touches[0] : e;
        startX = event.clientX;
        startY = event.clientY;

        const rect = container.getBoundingClientRect();
        initialX = rect.left;
        initialY = rect.top;

        holdTimer = setTimeout(() => {
            if (isPointerDown && !hasMoved && !busy()) {
                didTriggerPetting = true;
                import("./pet-reactions.js").then(({ triggerReaction }) => triggerReaction("petting", petId));
            }
        }, 800);

        e.preventDefault();
        return true;
    }

    function onDragMove(e) {
        if (!isPointerDown) return;

        const event = e.type.includes("touch") ? e.touches[0] : e;
        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;

        if (!hasMoved && Math.sqrt(deltaX * deltaX + deltaY * deltaY) >= 5) {
            clearTimeout(holdTimer);
            holdTimer = null;
            if (!state.settings.position.draggable) return;
            hasMoved = true;
            state.isDragging = true;
            container.classList.add("dragging");
            const view = visibleBounds(), inset = spriteInsets(container);
            dragMotion = beginDragMotion(container, { ...view, minX: view.minX - inset.left, maxX: view.maxX + inset.right }, state.isMobile ? 8 : 0);

            if (state.settings.reactions.onInteraction && !runtime.isPetGenerating) {
                import("./pet-reactions.js").then(({ triggerReaction }) => triggerReaction("dragging", petId));
            }
        }

        if (!hasMoved) return;

        pendingDrag = { x: initialX + deltaX, y: initialY + deltaY };
        if (dragFrame === null) dragFrame = requestAnimationFrame(flushDrag);

        e.preventDefault();
    }

    function onDragEnd() {
        if (!isPointerDown) return;
        flushDrag();
        if (!hasMoved) { dragMotion?.finish(); dragMotion = null; }
        isPointerDown = false;
        setInteracting(container, false);

        clearTimeout(holdTimer);
        holdTimer = null;

        if (hasMoved) {
            state.isDragging = false;
            container.classList.remove("dragging");

            const rect = dragMotion?.finish() || container.getBoundingClientRect();
            dragMotion = null;
            const position = slot.position;
            position.customX = rect.left;
            position.customY = rect.top;
            if (container._saipetResizedDuringDrag) {
                delete container._saipetResizedDuringDrag;
                clampPetPosition(petId);
            }
            saveSettings();

            resetWalkOrigin(petId);
            checkAndResolvePetCollision(petId);
            import("./pet-animation.js").then(({ setState, PET_STATES }) => {
                if (runtime.currentState === PET_STATES.DRAGGING) {
                    setState(runtime.isPetGenerating ? PET_STATES.THINKING : PET_STATES.IDLE, null, petId);
                }
            });
        } else {
            if (didTriggerPetting) return;

            clickCount++;
            clearTimeout(clickResetTimer);
            clickResetTimer = setTimeout(() => { clickCount = 0; }, 1500);

            if (!busy()) {
                import("./pet-reactions.js").then(({ triggerReaction }) => {
                    if (clickCount >= 5) {
                        clickCount = 0;
                        triggerReaction("clickSpam", petId);
                    } else {
                        triggerReaction("click", petId);
                    }
                });
            }
        }
    }

    function onDragStartWrapped(e) {
        if (!onDragStart(e)) return;
        document.addEventListener("mousemove", onDragMove);
        document.addEventListener("mouseup", onDragEndWrapped);
        document.addEventListener("touchmove", onDragMove, { passive: false });
        document.addEventListener("touchend", onDragEndWrapped);
        document.addEventListener("touchcancel", onDragEndWrapped);
    }
    function onDragEndWrapped(e) {
        try {
            onDragEnd(e);
        } finally {
            scheduleBubbleLayout();
            document.removeEventListener("mousemove", onDragMove);
            document.removeEventListener("mouseup", onDragEndWrapped);
            document.removeEventListener("touchmove", onDragMove);
            document.removeEventListener("touchend", onDragEndWrapped);
            document.removeEventListener("touchcancel", onDragEndWrapped);
        }
    }

    container.addEventListener("mousedown", onDragStartWrapped);
    container.addEventListener("touchstart", onDragStartWrapped, { passive: false });

    state[slot.dragCleanupKey] = () => {
        if (holdTimer) clearTimeout(holdTimer);
        if (clickResetTimer) clearTimeout(clickResetTimer);
        if (container._saipetFadeTimer) clearTimeout(container._saipetFadeTimer);
        flushDrag(); dragMotion?.finish(); dragMotion = null;
        isPointerDown = false;
        container.removeEventListener("mousedown", onDragStartWrapped);
        container.removeEventListener("touchstart", onDragStartWrapped);
        document.removeEventListener("mousemove", onDragMove);
        document.removeEventListener("mouseup", onDragEndWrapped);
        document.removeEventListener("touchmove", onDragMove);
        document.removeEventListener("touchend", onDragEndWrapped);
        document.removeEventListener("touchcancel", onDragEndWrapped);
    };
}

/** On phones the input floats under the pet: only the box slides sideways, and the pet lifts only if the box would leave the screen. */
function placeChatInput(container, chatInput) {
    const box = container.getBoundingClientRect();
    if (!state.isMobile) {
        const safe = clampCoordinates(box.left, box.top, container, true);
        moveElement(container, safe.x, safe.y, 0);
        return;
    }
    chatInput.style.setProperty("--chat-shift", "0px");
    const view = visibleBounds(), rect = chatInput.getBoundingClientRect();
    const shift = rect.left < view.minX + 8 ? view.minX + 8 - rect.left : rect.right > view.maxX - 8 ? view.maxX - 8 - rect.right : 0;
    chatInput.style.setProperty("--chat-shift", `${Math.round(shift)}px`);
    const lift = Math.max(0, rect.bottom - (view.maxY - 8));
    if (!lift) return;
    container._chatLift = { x: box.left, y: box.top };
    moveElement(container, box.left, box.top - lift, 0);
}

function hideChatInput(container) {
    const chatInput = container.querySelector(".st-pet-chat-input"), textInput = container.querySelector(".st-pet-chat-text");
    if (chatInput) chatInput.style.display = "none";
    if (textInput) { textInput.value = ""; fitChatText(textInput); }
    const back = container._chatLift;
    container._chatLift = null;
    if (back) moveElement(container, back.x, back.y, 0);
}

function toggleChatInput(petId) {
    const slot = petSlot(petId);
    const container = document.getElementById(slot.containerId);
    if (!container) return;

    const chatInput = container.querySelector(".st-pet-chat-input");
    const textInput = container.querySelector(".st-pet-chat-text");
    if (!chatInput || !textInput) return;

    const isVisible = chatInput.style.display !== "none";

    if (isVisible) {
        hideChatInput(container);
    } else {
        chatInput.style.display = "flex";
        // Keep the input inside the viewport before focusing. Otherwise the
        // browser scrolls the document to reveal it, taking ST's top bar offscreen.
        placeChatInput(container, chatInput);
        textInput.focus({ preventScroll: true });

        if (!textInput._hasEnterHandler) {
            textInput._hasEnterHandler = true;
            textInput.addEventListener("input", () => fitChatText(textInput));
            textInput.addEventListener("keydown", e => {
                if (e.key === "Escape") { hideChatInput(container); return; }
                if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
                e.preventDefault();
                const userText = textInput.value.trim();
                if (!userText) return;
                hideChatInput(container);
                import("./pet-ai.js").then(({ talkToPet }) => talkToPet(userText, petId));
            });
            if (state[slot.chatOutsideClickKey]) {
                document.removeEventListener("click", state[slot.chatOutsideClickKey]);
            }
            state[slot.chatOutsideClickKey] = (e) => {
                const c = document.getElementById(slot.containerId);
                const ci = c?.querySelector(".st-pet-chat-input");
                if (c && ci && !c.contains(e.target) && ci.style.display !== "none") hideChatInput(c);
            };
            document.addEventListener("click", state[slot.chatOutsideClickKey]);
        }
    }
}

/** "⋯" button: a tiny popover with the diary, today's talks, the house and sleep/wake for this pet. */
function setupQuickMenu(container, petId) {
    const button = container.querySelector(".st-pet-menu-btn");
    const menu = container.querySelector(".st-pet-menu");
    if (!button || !menu) return;
    const sleepItem = menu.querySelector('[data-action="sleep"]');
    const sleeping = () => petSlot(petId).runtime.currentState === PET_STATES.SLEEPING;
    const onOutside = event => { if (!menu.contains(event.target) && !button.contains(event.target)) close(); };
    const onKey = event => { if (event.key === "Escape") close(); };
    function close() {
        if (menu.hidden) return;
        menu.hidden = true;
        container.classList.remove("st-pet-menu-open");
        button.setAttribute("aria-expanded", "false");
        document.removeEventListener("pointerdown", onOutside, true);
        document.removeEventListener("keydown", onKey, true);
    }
    function open() {
        const asleep = sleeping();
        sleepItem.innerHTML = `<i class="fa-solid ${asleep ? "fa-sun" : "fa-moon"}"></i>${asleep ? "깨우기" : "재우기"}`;
        menu.classList.remove("st-pet-menu-below");
        menu.style.removeProperty("translate");
        menu.hidden = false;
        container.classList.add("st-pet-menu-open");
        const view = visibleBounds();
        if (menu.getBoundingClientRect().top < view.minY + 4) menu.classList.add("st-pet-menu-below");
        const rect = menu.getBoundingClientRect();
        const shift = rect.left < view.minX + 4 ? view.minX + 4 - rect.left : rect.right > view.maxX - 4 ? view.maxX - 4 - rect.right : 0;
        if (shift) menu.style.translate = `${Math.round(shift)}px 0`;
        const placed = menu.getBoundingClientRect(), anchor = button.getBoundingClientRect();
        menu.style.setProperty("--menu-arrow-x", `${Math.round(Math.max(22, Math.min(placed.width - 22, anchor.left + anchor.width / 2 - placed.left)))}px`);
        button.setAttribute("aria-expanded", "true");
        document.addEventListener("pointerdown", onOutside, true);
        document.addEventListener("keydown", onKey, true);
    }
    button.addEventListener("click", event => {
        event.stopPropagation();
        if (menu.hidden) open(); else close();
    });
    menu.addEventListener("click", event => {
        const action = event.target.closest?.("[data-action]")?.dataset.action;
        if (!action) return;
        event.stopPropagation();
        close();
        if (action === "journal") document.dispatchEvent(new CustomEvent("stvp-open-journal"));
        else if (action === "house") document.dispatchEvent(new CustomEvent("stvp-open-house"));
        else if (action === "today") import("./today-talk-ui.js").then(({ openTodayTalks }) => openTodayTalks());
        else {
            const wake = sleeping();
            import("./pet-reactions.js").then(({ sleepPet, wakePet }) => (wake ? wakePet : sleepPet)(petId));
        }
    });
    container._saipetMenuClose = close;
}

/** Freeze right/bottom anchors once, then do no geometry work during a resize burst. */
export function beginViewportResize() {
    if (state.viewportResizing) return;
    state.viewportResizing = true;
    cancelSocialInteraction();
    for (const petId of PET_IDS) {
        const node = document.getElementById(petSlot(petId).containerId);
        if (!node) continue;
        if (node.classList.contains("dragging")) { node._saipetResizedDuringDrag = true; continue; }
        stopMotion(node);
        const rect = node.getBoundingClientRect();
        node.style.left = `${rect.left}px`; node.style.top = `${rect.top}px`;
        node.style.right = "auto"; node.style.bottom = "auto";
    }
}
export function finishViewportResize() {
    state.viewportResizing = false;
    if (!isPetActive() || state.isDragging) return;
    for (const petId of PET_IDS) {
        const settings = positionFor(petId);
        if (settings && (settings.customX == null || settings.customY == null)) updatePetPosition(petId);
        clampPetPosition(petId);
    }
}

export function clampPetPosition(petId = "primary") {
    if (state.viewportResizing) return;
    scheduleBubbleLayout();
    const container = document.getElementById(petSlot(petId).containerId);
    if (!container) return;

    if (state.isMobile) {
        // Start from the saved position every time, so the pet returns once the keyboard closes.
        updatePetPosition(petId);
        const rect = container.getBoundingClientRect();
        const clamped = clampCoordinates(rect.left, rect.top, container);
        container.style.left = `${clamped.x}px`;
        container.style.top = `${clamped.y}px`;
        container.style.right = "auto";
        container.style.bottom = "auto";
        return;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = container.offsetWidth;
    const ch = container.offsetHeight;

    const posSettings = positionFor(petId);
    if (!posSettings) return;

    // A corner preset (right/bottom based) can also be cut off on a narrow screen.
    if (posSettings.customX == null || posSettings.customY == null) {
        const rect = container.getBoundingClientRect();
        const point = clampCoordinates(rect.left, rect.top, container);
        if (point.x !== rect.left || point.y !== rect.top) {
            stopMotion(container, false);
            moveElement(container, point.x, point.y, 0);
        }
        return;
    }

    const maxX = Math.max(0, vw - cw);
    const maxY = Math.max(0, vh - ch);

    const savedX = Number(posSettings.customX) || 0;
    const savedY = Number(posSettings.customY) || 0;
    const x = Math.max(0, Math.min(maxX, savedX));
    const y = Math.max(0, Math.min(maxY, savedY));
    const constrained = x !== savedX || y !== savedY;

    // Resizing is temporary: never save the clamped value, so the chosen position survives.
    // Reapply the stored position only when undoing an earlier clamp.
    if (constrained || container.dataset.saipetViewportClamped === "1") {
        stopMotion(container, false);
        if (container.style.left !== `${x}px`) container.style.left = `${x}px`;
        if (container.style.top !== `${y}px`) container.style.top = `${y}px`;
        if (container.style.right !== "auto") container.style.right = "auto";
        if (container.style.bottom !== "auto") container.style.bottom = "auto";
        container.dataset.saipetViewportClamped = constrained ? "1" : "";
    } else {
        // Walking can leave the saved anchor behind. Clamp the visible pet too,
        // while keeping that anchor intact for the next session.
        const rect = container.getBoundingClientRect();
        const visibleX = Math.max(0, Math.min(maxX, rect.left));
        const visibleY = Math.max(0, Math.min(maxY, rect.top));
        if (visibleX !== rect.left || visibleY !== rect.top) {
            stopMotion(container, false);
            container.style.left = `${visibleX}px`;
            container.style.top = `${visibleY}px`;
            container.style.right = "auto";
            container.style.bottom = "auto";
        }
    }
}

/** The second pet may carry its own bubble style; the width limit is shared. */
export function applyDesignTheme(petId = "primary") {
    const slot = petSlot(petId);
    const container = document.getElementById(slot.containerId);
    if (!container) return;

    const { design, backgroundColor, textColor, accentColor, font } = slot.data?.speechBubble || state.settings.speechBubble;
    const { maxWidth } = state.settings.speechBubble;
    container.setAttribute("data-design", design || "simple");
    container.style.setProperty("--spc-bubble-bg", backgroundColor);
    container.style.setProperty("--spc-bubble-text", textColor);
    container.style.setProperty("--spc-accent", accentColor || "#7c9bff");
    container.style.setProperty("--bubble-bg-color", backgroundColor);
    container.style.setProperty("--spc-bubble-max-w", `${maxWidth || 360}px`);

    applyFont(container, font);
}
function fitChatText(textarea) {
    textarea.style.height = "auto";
    if (!textarea.value || !textarea.scrollHeight) { textarea.style.height = ""; return; }
    textarea.style.height = `${Math.min(textarea.scrollHeight, 112)}px`;
}

function walkRange() {
    return state.isMobile ? mobileWalkRange(mobileDisplay().walkRange) : WALK_RANGE;
}

function nextWalkTarget(container, currentRect, originX, originY) {
    const view = visibleBounds(), margin = state.isMobile ? 8 : 0, inset = spriteInsets(container);
    const minX = view.minX + margin - inset.left, minY = view.minY + margin;
    return chooseWalkTarget({
        mode:walkDirection(state.settings), current:{x:currentRect.left,y:currentRect.top},
        origin:{x:originX,y:originY}, range:walkRange(), maxStep:state.isMobile ? 120 : 250,
        bounds:{minX,minY,maxX:Math.max(minX,view.maxX-container.offsetWidth-margin+inset.right),maxY:Math.max(minY,view.maxY-container.offsetHeight-margin)},
    });
}

export function startWalking(petId = "primary") {
    const slot = petSlot(petId);
    cancelSocialInteraction();
    stopWalking(petId);
    if (!isPetActive()) return;
    if (!walkingEnabled(state.settings, state.isMobile)) return;

    const container = document.getElementById(slot.containerId);
    if (!container) return;

    const rect = container.getBoundingClientRect();
    slot.walk.originX = rect.left;
    slot.walk.originY = rect.top;

    log(`${slot.logName} walking started`);
    scheduleNextWalk(petId);
}

export function stopWalking(petId = "primary") {
    const { walk, containerId } = petSlot(petId);
    if (walk.timer) {
        clearTimeout(walk.timer);
        walk.timer = null;
    }
    if (walk.transitionTimer) {
        clearTimeout(walk.transitionTimer);
        walk.transitionTimer = null;
    }

    const container = document.getElementById(containerId);
    if (container) {
        stopMotion(container);
        container.classList.remove("walking");
    }
}

function scheduleNextWalk(petId) {
    if (!isPetActive()) return;
    const delay = WALK_MOVE_MIN + Math.random() * (WALK_MOVE_MAX - WALK_MOVE_MIN);
    petSlot(petId).walk.timer = setTimeout(() => doWalkStep(petId), delay);
}

function doWalkStep(petId) {
    if (!isPetActive()) return;
    const slot = petSlot(petId), { runtime, walk } = slot;
    const container = document.getElementById(slot.containerId);
    if (!container) return;

    if (runtime.currentState === PET_STATES.SLEEPING ||
        runtime.currentState === PET_STATES.DRAGGING ||
        state.isDragging || state.viewportResizing ||
        state.isGenerating || Date.now() < (state.socialUntil || 0) ||
        runtime.isPetGenerating) {
        scheduleNextWalk(petId);
        return;
    }

    const currentRect = container.getBoundingClientRect();

    if (walk.originX === null) walk.originX = currentRect.left;
    if (walk.originY === null) walk.originY = currentRect.top;

    const { x:clampedX, y:clampedY } = nextWalkTarget(container, currentRect, walk.originX, walk.originY);

    const movingLeft = clampedX < currentRect.left;
    const userFlip = Boolean(slot.data?.appearance?.flipHorizontal);
    container.querySelector(".st-pet-sprite")?.classList.toggle("flipped", movingLeft ? !userFlip : userFlip);

    moveElement(container, clampedX, clampedY);
    startWalkVisual(container, slot.data);
    if (Math.hypot(clampedX - currentRect.left, clampedY - currentRect.top) > 16) {
        maybeWalkHop(container, { enabled: state.settings.motion?.walkHop !== false });
    }

    walk.transitionTimer = setTimeout(() => {
        walk.transitionTimer = null;

        const c = document.getElementById(slot.containerId);
        if (!c) return;

        c.classList.remove("walking");
        c.querySelector(".st-pet-sprite")?.classList.toggle("flipped", Boolean(petSlot(petId).data?.appearance?.flipHorizontal));

        // Walking positions are temporary; only a drag saves a position.
        checkAndResolvePetCollision(petId);

        if (walkingEnabled(state.settings, state.isMobile)) {
            scheduleNextWalk(petId);
        }
    }, 2700);
}

function resetWalkOrigin(petId) {
    const { walk, containerId } = petSlot(petId);
    const container = document.getElementById(containerId);
    if (container) {
        const rect = container.getBoundingClientRect();
        walk.originX = rect.left;
        walk.originY = rect.top;
    }
}

/** Hidden tab: both pets stop where they stand; walking resumes on its usual delay once visible. */
export function pauseWalking() {
    for (const petId of PET_IDS) {
        const { walkStartTimerKey } = petSlot(petId);
        clearTimeout(state[walkStartTimerKey]); state[walkStartTimerKey] = null;
    }
    cancelCollisionReaction();
    for (const petId of PET_IDS) stopWalking(petId);
}
export function resumeWalking() {
    if (!isPetActive() || !walkingEnabled(state.settings, state.isMobile)) return;
    for (const petId of PET_IDS) startWalking(petId);
}
let collisionCancel = null, lastCollisionAt = 0;
export function cancelCollisionReaction() {
    collisionCancel?.(); collisionCancel = null;
}

export function checkAndResolvePetCollision(movingPetId = "primary") {
    if (!isPetActive() || state.settings.motion?.collisionReaction === false
        || Date.now() < (state.socialUntil || 0) || Date.now() - lastCollisionAt < 3500) return;
    const c1 = document.getElementById("saipet-container");
    const c2 = document.getElementById("saipet-container-2");
    if (!c1 || !c2) return;

    const r1 = spriteRect(c1), r2 = spriteRect(c2);
    const overlapX = Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left);
    const overlapY = Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top);
    // Transparent square containers should not push nearby characters apart.
    const overlaps = overlapX > Math.min(r1.width, r2.width) * .45 && overlapY > Math.min(r1.height, r2.height) * .5;
    if (!overlaps) return;

    const pushedId = movingPetId === "primary" ? "secondary" : "primary";
    const pushed = pushedId === "primary" ? c1 : c2;
    const pusher = pushedId === "primary" ? c2 : c1;

    const pusherRect = pusher.getBoundingClientRect();
    const pushedRect = pushed.getBoundingClientRect();
    let dx = pushedRect.left - pusherRect.left;
    let dy = pushedRect.top - pusherRect.top;
    if (Math.abs(dx) + Math.abs(dy) < 1) dx = pushedId === "secondary" ? 1 : -1;
    const direction = walkDirection(state.settings);
    if (direction === "horizontal") { dy = 0; if (!dx) dx = pushedId === "secondary" ? 1 : -1; }
    if (direction === "vertical") { dx = 0; if (!dy) dy = pushedId === "secondary" ? 1 : -1; }
    const dist = Math.hypot(dx, dy);

    const pushDist = state.isMobile ? 48 : 80;
    const { x: clampedX, y: clampedY } = clampCoordinates(
        pushedRect.left + (dx / dist) * pushDist,
        pushedRect.top + (dy / dist) * pushDist,
        pushed,
    );

    cancelCollisionReaction();
    lastCollisionAt = Date.now();
    moveElement(pushed, clampedX, clampedY, 350);
    const motion = pushed._saipetMotion;
    const gesture = playGesture(pushed.querySelector(".st-pet-sprite"), "hop", { height: 10, duration: 500 });
    const epoch = state.lifecycleEpoch, petEpoch = getPetInstanceEpoch(pushedId);
    let canceled = false, timer, hideOwnSpeech = null;
    const cancel = () => {
        if (canceled) return;
        canceled = true; clearTimeout(timer); gesture?.cancel();
        if (motion && pushed._saipetMotion === motion) stopMotion(pushed);
        hideOwnSpeech?.();
        if (collisionCancel === cancel) collisionCancel = null;
    };
    collisionCancel = cancel;
    timer = setTimeout(cancel, 3200);
    const customCollision = petSlot(pushedId).data?.customSpeeches?.collision;
    const pool = customCollision?.length ? customCollision : COLLISION_SPEECHES;
    const speech = pool[Math.floor(Math.random() * pool.length)];
    import("./pet-speech.js").then(({ showSpeechBubble, hideSpeechBubble }) => {
        if (canceled || state.settings.motion?.collisionReaction === false || !pushed.isConnected
            || !isCurrentPetRuntime(epoch, pushedId, petEpoch)) return;
        const pet = petSlot(pushedId).runtime;
        const before = pet.bubbleTimer;
        const receipt = showSpeechBubble(speech, 3000, false, pushedId);
        if (receipt?.cancel) {
            hideOwnSpeech = receipt.cancel;
            clearTimeout(timer); timer = setTimeout(cancel, receipt.hideAfter + 200);
        }
        const ownTimer = pet.bubbleTimer;
        // Never hide a newer line (especially an AI response) when switching OFF.
        if (ownTimer && ownTimer !== before) hideOwnSpeech = () => {
            if (pet.bubbleTimer === ownTimer && !pet.isPrioritySpeech) hideSpeechBubble(pushedId);
        };
    }).catch(error => log("Collision speech unavailable:", error));
}
