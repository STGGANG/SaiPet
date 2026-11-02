import { createHouseSpeech, planHouseGreeting } from "./house-speech.js";
import { bindHouseConversationUI } from "./house-conversation-ui.js";
import { getHouseConversationStatus, startHouseConversations, talkToHouse, HOUSE_TALK_MAX } from "./house-conversation.js";
import { refreshLifeStatus } from "./life-status.js";
import { beginLayerDrag } from "./house-layer-drag.js";
import { createFloorPlanner, floorGeometry, furniturePlacement, depthLayer, furnitureLayer, moveFurnitureLayer, petFloorBounds, pathLength, pointOnPath } from "./house-navigation.js";
import { startWalkVisual, stopWalkVisual } from "./walking.js";
import { maybeWalkHop, stopWalkHop, playGesture } from "./motion-effects.js";
import { chooseScene, spriteRect, areNeighbors, playPairScene, showEmote, applyEmoteTheme } from "./social-scenes.js";
import { FURNITURE, AVAILABLE_FURNITURE, FURNITURE_REACTIONS, furnitureInfo, orderedFurniture, applyRoomSnapshot, furnitureReaction } from "./house-data.js";
import { effectIcon } from "./effect-icons.js";
import { setupHouseLibrary } from "./house-library.js";
import { HOUSE_THEMES, resolveHouseSurface, themeRoomSnapshot } from "./house-themes.js";
import { DEFAULT_HOUSE_THEME, DEFAULT_SETTINGS, EXTENSION_BASE_PATH } from "./constants.js";
import { idleSprite, moodSprite, resolveSpriteSource } from "./sprite-paths.js";
import { state } from "./state.js";
import { getPresetList, saveImageFile, saveSettings } from "./storage.js";

/** A self-contained room scene. Timers exist only while the popup is open. */
let popup = null;
let walkTimer = null;
let interactionTimer = null;
const activeDrags = new Set();
const petRestUntil = new Map();
let cancelScene = null, cancelGreeting = null, previousScene = null, removedFurniture = null;
let selectedFurniture = null;
let cleanupLibrary = null, cleanupConversation = null;
let petPositions = new Map();
let roomGeometry = null, geometryTimer = null, resizeTimer = null, depthFrame = null;
const phoneLayout = window.matchMedia("(max-width: 760px)");
const planners = new Map();
const furnitureVisits = new Map();
const surfaceVersion = { wallpaper: 0, floor: 0 };

const houseSpeech = createHouseSpeech({
    getPopup: () => popup,
    getStatus: getHouseConversationStatus,
    isLocked: () => house().furnitureLocked,
    isPhone: () => phoneLayout.matches,
    getMaxWidth: () => state.settings.speechBubble?.maxWidth,
    stopMovement: () => {
        cancelScene?.(); cancelScene = null;
        popup?.querySelectorAll(".stvp-house-pet").forEach(stopPetMotion);
    },
    setMood: setPetMood,
});

function setPetMood(node, mood) {
    const image = node._houseImage, current = node.dataset.mood || "idle";
    if (!image || current === mood) return;
    const pet = choices().find(choice => choice.id === node.dataset.pet);
    if (!pet) return;
    node.dataset.mood = mood;
    image.src = mood === "idle" ? petSprite(pet) : moodSprite(pet.data, mood);
}
// Residents' own mood images are fetched once a conversation starts, so a spoken line swaps the pose at once.
const warmedSprites = new Set();
function warmMoodSprites() {
    for (const pet of choices()) {
        if (!house().occupants.includes(pet.id)) continue;
        for (const sprite of Object.values(pet.data?.appearance?.customSprites || {})) {
            const source = typeof sprite === "string" && sprite ? resolveSpriteSource(sprite) : "";
            if (!source || warmedSprites.has(source)) continue;
            warmedSprites.add(source); new Image().src = source;
        }
    }
}
function renderHouseDialogue() {
    if (getHouseConversationStatus().active) warmMoodSprites();
    houseSpeech.render(); syncTalkBar();
}
const queueDialogueLayout = houseSpeech.queueLayout;

/** Talking to the residents: a target chip row (everyone or one resident) and a one-line input under the room. */
let talkTarget = null;
function talkBar() { return popup?.querySelector("#stvp-house-talk"); }
function presentResidents() {
    const available = new Map(choices().map(pet => [pet.id, pet]));
    return house().occupants.filter(id => available.has(id)).map(id => available.get(id));
}
function renderTalkTargets() {
    const bar = talkBar();
    if (!bar) return;
    const residents = presentResidents();
    if (talkTarget && !residents.some(pet => pet.id === talkTarget)) talkTarget = null;
    const list = bar.querySelector(".stvp-house-talk-targets");
    list.replaceChildren();
    const chip = (id, label, face) => {
        const button = document.createElement("button");
        button.type = "button"; button.className = "stvp-house-talk-chip"; button.dataset.talkTarget = id || "";
        button.setAttribute("aria-pressed", String((id || null) === talkTarget));
        button.append(face, label);
        button.addEventListener("click", () => selectTalkTarget(id, true));
        list.append(button);
    };
    const all = document.createElement("i"); all.className = "fa-solid fa-users"; all.setAttribute("aria-hidden", "true");
    chip(null, "모두에게", all);
    for (const pet of residents) {
        const face = document.createElement("img"); face.alt = ""; face.src = petSprite(pet) || "";
        chip(pet.id, pet.name, face);
    }
    const target = residents.find(pet => pet.id === talkTarget);
    bar.querySelector(".stvp-house-talk-text").placeholder = target ? `${target.name}에게 할 말` : "모두에게 할 말";
    bar.hidden = !residents.length;
    syncTalkBar();
}
function selectTalkTarget(id, focus = false) {
    talkTarget = id || null;
    renderTalkTargets();
    if (focus) talkBar()?.querySelector(".stvp-house-talk-text").focus({ preventScroll: true });
}
function syncTalkBar() {
    const bar = talkBar();
    if (!bar) return;
    const status = getHouseConversationStatus();
    bar.querySelector(".stvp-house-talk-send").disabled = status.active || !presentResidents().length;
    bar.querySelector(".stvp-house-talk-status").textContent = status.active ? "" : status.message;
}
function fitTalkText(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 84)}px`;
}
function sendHouseTalk() {
    const bar = talkBar(), textarea = bar?.querySelector(".stvp-house-talk-text");
    const text = textarea?.value.trim();
    if (!text || getHouseConversationStatus().active) return;
    void talkToHouse(text, talkTarget);
    // The session starts synchronously when accepted; a rejected message stays in the box with its reason below.
    if (getHouseConversationStatus().active) { textarea.value = ""; fitTalkText(textarea); }
    syncTalkBar();
}
function bindTalkBar() {
    const bar = talkBar(), textarea = bar.querySelector(".stvp-house-talk-text");
    textarea.maxLength = HOUSE_TALK_MAX;
    textarea.addEventListener("input", () => { fitTalkText(textarea); bar.querySelector(".stvp-house-talk-status").textContent = ""; });
    textarea.addEventListener("keydown", event => {
        if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
        event.preventDefault(); sendHouseTalk();
    });
    bar.querySelector(".stvp-house-talk-send").addEventListener("click", sendHouseTalk);
    renderTalkTargets();
}

function house() {
    if (!state.settings.house || typeof state.settings.house !== "object") {
        state.settings.house = structuredClone(DEFAULT_SETTINGS.house);
    }
    const value = state.settings.house;
    if (!Array.isArray(value.furniture)) value.furniture = [];
    if (!Array.isArray(value.occupants)) value.occupants = ["primary"];
    if (!Array.isArray(value.customFurniture)) value.customFurniture = [];
    if (!Array.isArray(value.layouts)) value.layouts = [];
    if (!value.petPositions || typeof value.petPositions !== "object" || Array.isArray(value.petPositions)) value.petPositions = {};
    if (typeof value.furnitureLocked !== "boolean") value.furnitureLocked = true;
    // Rooms saved before the theme sets hold only retired art; they start over as the default theme with the same residents.
    if (!value.wallpaper && !value.floor && value.furniture.length && !value.furniture.some(furnitureInfo)) {
        applyRoomSnapshot(value, themeRoomSnapshot(DEFAULT_HOUSE_THEME, value));
    }
    return value;
}

function choices() {
    const settings = state.settings;
    const result = [{ id: "primary", name: settings.personality?.name || "메인 펫", data: settings }];
    if (settings.multiPet?.secondPetData) {
        const data = settings.multiPet.secondPetData;
        result.push({ id: "secondary", name: data.personality?.name || "2번째 펫", data });
    }
    for (const preset of getPresetList()) {
        if (!preset?.id) continue;
        result.push({ id: `preset:${preset.id}`, name: preset.name || preset.personality?.name || "프리셋", data: preset });
    }
    return result;
}

const finishDrags = () => { for (const finish of [...activeDrags]) finish(); };
// Capture pointer/touch, batch changes once per frame, and clean up on close.
function drag(element, event, move, end) {
    let frame = null, pending = null, finished = false;
    const flush = () => { if (frame !== null) cancelAnimationFrame(frame); frame = null; if (pending) { move(pending); pending = null; } };
    const onMove = next => { if (next.pointerId !== event.pointerId) return; pending = next; if (frame === null) frame = requestAnimationFrame(flush); };
    const finish = next => {
        if (finished || (next?.pointerId != null && next.pointerId !== event.pointerId)) return;
        finished = true; flush();
        element.removeEventListener("pointermove", onMove);
        for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) element.removeEventListener(name, finish);
        if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
        activeDrags.delete(finish); element.classList.remove("dragging"); end(next);
    };
    element.setPointerCapture(event.pointerId); element.classList.add("dragging");
    element.addEventListener("pointermove", onMove);
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) element.addEventListener(name, finish);
    activeDrags.add(finish);
}

function renderOccupants() {
    if (!popup) return;
    const list = popup.querySelector("#stvp-house-occupants");
    const selected = new Set(house().occupants);
    list.replaceChildren();
    for (const pet of choices()) {
        const label = document.createElement("label");
        label.className = "stvp-house-choice";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selected.has(pet.id);
        checkbox.addEventListener("change", () => {
            const current = new Set(house().occupants);
            if (checkbox.checked && current.size >= 4) {
                checkbox.checked = false;
                alert("방에는 최대 4명까지 배치할 수 있습니다.");
                return;
            }
            if (checkbox.checked) current.add(pet.id);
            else current.delete(pet.id);
            house().occupants = [...current];
            saveSettings();
            renderPets();
            updateOccupantSummary();
        });
        const face = document.createElement("img");
        face.alt = ""; face.loading = "lazy"; face.src = petSprite(pet) || "";
        const name = document.createElement("span"); name.textContent = pet.name;
        label.append(checkbox, face, name);
        list.append(label);
    }
    updateOccupantSummary();
}

function updateOccupantSummary() {
    const count = choices().filter(p => house().occupants.includes(p.id)).length;
    popup.querySelector("#stvp-house-occupant-summary").textContent = `함께 지낼 캐릭터 · ${count}/4`;
}

function petSprite(pet) {
    return idleSprite(pet.data);
}

function applyPetPosition(element, position) {
    element.style.left = `${position.x}%`;
    element.style.bottom = `${position.y}%`;
    element.style.zIndex = String(depthLayer(100 - position.y * .56, 100));
    queueDialogueLayout();
}

function renderPets() {
    if (!popup) return;
    cancelScene?.(); cancelScene = null; cancelGreeting?.();
    finishDrags();
    const layer = popup.querySelector("#stvp-house-pets");
    const available = new Map(choices().map(pet => [pet.id, pet]));
    const present = house().occupants.filter(id => available.has(id));
    layer.querySelectorAll(".stvp-house-pet").forEach(stopPetMotion);
    layer.replaceChildren();
    petPositions = new Map([...petPositions].filter(([id]) => present.includes(id)));
    present.forEach((id, index) => {
        const pet = available.get(id);
        const element = document.createElement("div");
        element.className = "stvp-house-pet";
        element.style.setProperty("--house-pet-scale", String(Math.max(40, Math.min(180, Number(pet.data?.appearance?.scale) || 100)) / 100));
        element.dataset.pet = id;
        applyEmoteTheme(element, pet.data?.speechBubble || state.settings.speechBubble);
        const image = document.createElement("img");
        image.alt = pet.name;
        image.draggable = false;
        image.addEventListener("load", () => element.dataset.mood && element.dataset.mood !== "idle" ? queueDialogueLayout() : queueGeometry());
        image.src = petSprite(pet);
        image.onerror = () => {
            const idle = petSprite(pet), fallback = `${EXTENSION_BASE_PATH}images/idle.webp`;
            if (image.src !== new URL(idle, location.href).href) image.src = idle;
            else if (!image.src.endsWith(fallback)) image.src = fallback;
        };
        element._houseImage = image;
        const shadow = document.createElement("span"); shadow.className = "stvp-house-foot-shadow"; shadow.setAttribute("aria-hidden", "true");
        const art = document.createElement("div"); art.className = "stvp-house-pet-art"; art.append(image);
        element.append(shadow, art);
        const stored = house().petPositions[id];
        layer.append(element);
        const requested = petPositions.get(id) || (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y) ? stored : { x: 20 + index * 18, y: 14 + (index % 2) * 8 });
        const position = clampPet(requested.x, requested.y, petBounds(element));
        petPositions.set(id, position);
        applyPetPosition(element, position);
        element.addEventListener("pointerdown", event => {
            if (!house().furnitureLocked || event.button !== 0 || activeDrags.size) return;
            event.preventDefault(); event.stopPropagation();
            cancelScene?.(); cancelScene = null;
            stopPetMotion(element);
            const rect = layer.getBoundingClientRect();
            const bounds = petBounds(element);
            const origin = { ...petPositions.get(id) };
            let moved = false;
            drag(element, event, next => {
                moved ||= Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) > 4;
                const position = clampPet(origin.x + (next.clientX - event.clientX) * 100 / rect.width, origin.y - (next.clientY - event.clientY) * 100 / rect.height, bounds);
                petPositions.set(id, position); applyPetPosition(element, position);
            }, up => {
                settlePet(element);
                house().petPositions[id] = { ...petPositions.get(id) };
                petRestUntil.set(id, Date.now() + 4500); saveSettings();
                if (up?.type === "pointerup" && !moved) selectTalkTarget(id, true);
            });
        });
    });
    queueGeometry(); renderTalkTargets(); renderHouseDialogue();
}

function petBounds(element) {
    const layer = element.parentElement;
    const room = layer.parentElement;
    if (!layer.clientWidth || !layer.clientHeight) return { margin: 8, top: 62 };
    return {
        margin: Math.min(50, Math.max(8, (element.offsetWidth / 2 + 4) * 100 / layer.clientWidth)),
        top: Math.max(6, Math.min(96, (room.clientHeight - element.offsetHeight - 4) * 100 / layer.clientHeight)),
    };
}

function clampPet(x, y, { margin, top }) {
    return { x: Math.max(margin, Math.min(100 - margin, x)), y: Math.max(6, Math.min(top, y)) };
}

// A room change invalidates geometry once. Walking only uses these cached numbers.
function queueGeometry() {
    if (!popup || resizeTimer) return;
    clearTimeout(geometryTimer);
    geometryTimer = setTimeout(() => { geometryTimer = null; refreshGeometry(); }, 80);
}
function refreshGeometry() {
    if (!popup || resizeTimer || activeDrags.size) return;
    cancelScene?.(); cancelScene = null;
    popup.querySelectorAll(".stvp-house-pet").forEach(stopPetMotion);
    const room = popup.querySelector(".stvp-house-room"), width = room.clientWidth, height = room.clientHeight;
    if (!width || !height) return;
    const furniture = [], nodes = new Map();
    for (const node of popup.querySelectorAll(".stvp-house-furniture")) if (!nodes.has(node.dataset.id)) nodes.set(node.dataset.id, node);
    for (const [order, item] of orderedFurniture(house().furniture).entries()) {
        const node = nodes.get(item.id);
        if (!node) continue;
        const rect = { left: node.offsetLeft, top: node.offsetTop, width: node.offsetWidth, height: node.offsetHeight };
        furniture.push({ ...floorGeometry(item, furnitureInfo(item), rect), node, item, order });
    }
    for (const object of furniture) {
        // Tabletop decorations share their support's floor depth, so they never
        // appear through a pet walking in front of the table or counter.
        if (object.placement === "surface") {
            const x = object.rect.left + object.rect.width / 2, y = object.rect.top + object.rect.height;
            const support = furniture.filter(o => o.blocks && /table|desk|counter|sideboard|shelf|vanity|sofa|bed/.test(o.item.type)
                && x >= o.rect.left && x <= o.rect.left + o.rect.width
                && y >= o.rect.top - 6 && y <= o.rect.top + o.rect.height * (/sofa|bed/.test(o.item.type) ? .85 : .6))
                .sort((a, b) => Math.abs(y - a.rect.top) - Math.abs(y - b.rect.top))[0];
            if (support) object.depth = support.depth + .3;
        }
        object.node.style.zIndex = String(furnitureLayer(object, height));
    }
    roomGeometry = { width, height, furniture }; planners.clear();
    popup.querySelectorAll(".stvp-house-pet").forEach(settlePet);
    renderLayerList(); updateSelectionControls();
}
function toFloor(position) { return { x: position.x * roomGeometry.width / 100, y: (100 - position.y * .56) * roomGeometry.height / 100 }; }
function fromFloor(point) { return { x: point.x * 100 / roomGeometry.width, y: (100 - point.y * 100 / roomGeometry.height) / .56 }; }
function plannerFor(node) {
    if (!roomGeometry) return null;
    if (planners.has(node)) return planners.get(node);
    const image = node.querySelector("img"), height = image.offsetHeight;
    const width = Math.min(image.offsetWidth, height * (image.naturalWidth / image.naturalHeight || .65));
    const bounds = petFloorBounds(roomGeometry.width, roomGeometry.height, width, height);
    const planner = createFloorPlanner(bounds, roomGeometry.furniture, { x: Math.max(5, width * .22), y: Math.max(4, height * .045) });
    planners.set(node, planner); return planner;
}
function settlePet(node) {
    const planner = plannerFor(node), old = petPositions.get(node.dataset.pet);
    if (!planner || !old) return;
    const point = planner.nearest(toFloor(old));
    if (!point) return;
    const position = fromFloor(point); petPositions.set(node.dataset.pet, position); applyPetPosition(node, position);
}
function currentFloorPoint(node) {
    const motion = node._houseMotion;
    if (motion) return pointOnPath(motion.path, Math.min(1, Math.max(0, Number(motion.animation.currentTime) || 0) / motion.duration));
    const position = petPositions.get(node.dataset.pet); return position && roomGeometry ? toFloor(position) : null;
}
function trackDepth() {
    if (depthFrame !== null) return;
    let last = 0;
    const tick = (time) => {
        depthFrame = null;
        if (!popup || document.hidden || resizeTimer) return;
        if (time - last < 100) { depthFrame = requestAnimationFrame(tick); return; }
        last = time;
        let moving = false;
        for (const node of popup.querySelectorAll(".stvp-house-pet")) {
            if (!node._houseMotion) continue;
            moving = true;
            const point = currentFloorPoint(node);
            node.style.zIndex = String(depthLayer(point.y, roomGeometry.height));
        }
        if (moving) depthFrame = requestAnimationFrame(tick);
    };
    depthFrame = requestAnimationFrame(tick);
}
function stopPetMotion(element) {
    stopWalkHop(element); stopWalkVisual(element);
    const motion = element._houseMotion;
    if (!motion) return;
    const point = currentFloorPoint(element);
    motion.animation.cancel(); element._houseMotion = null;
    if (point && roomGeometry) {
        const position = fromFloor(point); petPositions.set(element.dataset.pet, position); applyPetPosition(element, position);
    }
}
function movePet(id, x, y, duration = null, hopping = true, onArrival = null) {
    if (!popup || resizeTimer || !roomGeometry) return false;
    const element = [...popup.querySelectorAll(".stvp-house-pet")].find(node => node.dataset.pet === id);
    if (!element) return false;
    stopPetMotion(element);
    const planner = plannerFor(element), previous = toFloor(petPositions.get(id));
    const path = planner.route(previous, toFloor({ x, y }));
    const length = pathLength(path);
    if (path.length < 2 || length < 3) return false;
    // No fixed-duration dash across a large room. Social short steps still have a cap.
    const ms = duration ? Math.max(duration, length / 130 * 1000) : Math.min(5200, Math.max(1200, length / 70 * 1000));
    const target = path.at(-1), position = fromFloor(target);
    element.classList.toggle("stvp-house-pet-left", target.x < previous.x);
    petPositions.set(id, position); applyPetPosition(element, position);
    if (!element.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { onArrival?.(); return true; }
    let traveled = 0;
    const frames = path.map((point, i) => {
        if (i) traveled += Math.hypot(point.x - path[i - 1].x, point.y - path[i - 1].y);
        return { translate: `${point.x - target.x}px ${point.y - target.y}px`, offset: traveled / length };
    });
    const animation = element.animate(frames, { duration: ms, easing: "linear" });
    const motion = { animation, path, duration: ms }; element._houseMotion = motion;
    if (hopping) { startWalkVisual(element, choices().find(pet => pet.id === id)?.data, ms); maybeWalkHop(element, { enabled: state.settings.motion?.walkHop !== false }); }
    trackDepth();
    animation.finished.then(() => {
        if (element._houseMotion !== motion) return;
        element._houseMotion = null; stopWalkVisual(element); applyPetPosition(element, position);
        petRestUntil.set(id, Date.now() + 1500 + Math.random() * 2500); onArrival?.();
    }).catch(() => {});
    return true;
}
function approachFurniture(node) {
    if (!roomGeometry) return false;
    const planner = plannerFor(node), start = currentFloorPoint(node);
    const candidates = roomGeometry.furniture.filter(o => o.blocks && furnitureReaction(o.item).icons.length
        && Date.now() - (furnitureVisits.get(node.dataset.pet + o.id) || 0) > 30000).sort(() => Math.random() - .5);
    for (const object of candidates.slice(0, 5)) {
        const r = object.footprint, gapX = 15 + (planner.obstacles[0] ? 10 : 0), gapY = 14;
        const points = [{ x: (r.left + r.right) / 2, y: r.bottom + gapY }, { x: r.left - gapX, y: (r.top + r.bottom) / 2 }, { x: r.right + gapX, y: (r.top + r.bottom) / 2 }];
        const routes = points.map(p => planner.route(start, p)).filter(path => path.length > 1 && pathLength(path) > 12 && pathLength(path) < roomGeometry.width * .7).sort((a,b) => pathLength(a) - pathLength(b));
        if (!routes.length) continue;
        const target = fromFloor(routes[0].at(-1));
        return movePet(node.dataset.pet, target.x, target.y, null, true, () => {
            furnitureVisits.set(node.dataset.pet + object.id, Date.now());
            if (state.settings.multiPet?.visualInteractions) showFurnitureReaction(object.item, false, node);
        });
    }
    return false;
}
function roam() {
    if (!popup || state.houseDialogueActive || document.hidden || resizeTimer || cancelScene || activeDrags.size || !house().furnitureLocked) return;
    const nodes = [...popup.querySelectorAll(".stvp-house-pet")];
    for (const node of nodes) {
        const id = node.dataset.pet;
        if (node._houseMotion || Date.now() < (petRestUntil.get(id) || 0) || Math.random() < .15) continue;
        if (state.settings.multiPet?.visualInteractions && Math.random() < .45 && approachFurniture(node)) continue;
        const planner = plannerFor(node); if (!planner) continue;
        const pos = petPositions.get(id), others = nodes.filter(other => other !== node);
        for (let attempt = 0; attempt < 5; attempt++) {
            let target = { x: pos.x + (Math.random() - .5) * 52, y: pos.y + (Math.random() - .5) * 45 };
            if (!attempt && others.length && state.settings.multiPet?.visualInteractions && Math.random() < .45) {
                const other = petPositions.get(others[Math.floor(Math.random() * others.length)].dataset.pet);
                target = { x: other.x + (pos.x < other.x ? -12 : 12), y: other.y };
            }
            if (movePet(id, target.x, target.y)) break;
        }
    }
}

function interact() {
    if (!popup || state.houseDialogueActive || document.hidden || resizeTimer || cancelScene || activeDrags.size || !house().furnitureLocked || !state.settings.multiPet?.visualInteractions) return;
    const nodes = [...popup.querySelectorAll(".stvp-house-pet")].filter(node => !node._houseMotion && Date.now() >= (petRestUntil.get(node.dataset.pet) || 0));
    const pairs = [];
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        if (areNeighbors(spriteRect(nodes[i]), spriteRect(nodes[j])) && plannerFor(nodes[i])?.clear(currentFloorPoint(nodes[i]), currentFloorPoint(nodes[j]))) pairs.push([nodes[i], nodes[j]]);
    }
    if (!pairs.length || Math.random() < .35) {
        if (showFurnitureReaction()) return;
        if (!pairs.length) return;
    }
    const pair = pairs[Math.floor(Math.random() * pairs.length)];
    const relation = state.settings.multiPet?.visualRelation;
    previousScene = chooseScene(relation, previousScene);
    cancelScene = playPairScene(pair.map(node => ({
        node,
        bounds: () => node.parentElement.getBoundingClientRect(),
        moveTo(cx, feet, ms) {
            const art = spriteRect(node), layer = node.parentElement.getBoundingClientRect();
            const old = petPositions.get(node.dataset.pet);
            movePet(node.dataset.pet, old.x + (cx - art.cx) * 100 / layer.width, old.y - (feet - art.bottom) * 100 / layer.height, ms);
        },
        walk(ms) { startWalkVisual(node, choices().find(pet => pet.id === node.dataset.pet)?.data, ms); },
        face(left) { node.classList.toggle("stvp-house-pet-left", left); },
        stop() { stopPetMotion(node); },
        reset() { node.classList.remove("stvp-house-pet-left"); },
    })), {
        action: previousScene, relation,
        valid: () => !!popup && !document.hidden && !resizeTimer && !activeDrags.size && house().furnitureLocked && state.settings.multiPet?.visualInteractions,
        done: () => { cancelScene = null; },
    });
}

function renderSurfaces() {
    const data = house();
    const wall = popup.querySelector(".stvp-house-wall");
    const floor = popup.querySelector(".stvp-house-floor");
    for (const [key, node] of [["wallpaper", wall], ["floor", floor]]) {
        const source = resolveHouseSurface(data[key], EXTENSION_BASE_PATH);
        node.style.backgroundImage = source ? `url(${JSON.stringify(source)})` : "";
        node.classList.toggle("stvp-house-generated-surface", !!source && data[key].startsWith("builtin:"));
    }
    const ratio = Number.isFinite(data.aspectRatio) && data.aspectRatio >= 1 && data.aspectRatio <= 2 ? data.aspectRatio : null;
    popup.querySelector(".stvp-house-room").style.aspectRatio = ratio ? String(ratio) : "";
}

function showFurnitureReaction(chosenItem = null, preview = false, chosenNode = null) {
    if (!popup || state.houseDialogueActive || document.hidden || resizeTimer || cancelScene || activeDrags.size) return false;
    const nodes = [...popup.querySelectorAll(".stvp-house-pet")].filter(node => !node._houseMotion && (preview || chosenNode === node || Date.now() >= (petRestUntil.get(node.dataset.pet) || 0)));
    const candidates = [];
    const roomWidth = popup.querySelector(".stvp-house-room").clientWidth;
    for (const element of popup.querySelectorAll(".stvp-house-furniture")) {
        const item = house().furniture.find(value => value?.id === element.dataset.id);
        if (!item || (chosenItem && item !== chosenItem) || !furnitureReaction(item).icons.length) continue;
        const rect = element.getBoundingClientRect();
        for (const node of nodes) {
            if (chosenNode && node !== chosenNode) continue;
            const art = spriteRect(node);
            const distance = Math.hypot(Math.max(rect.left - art.cx, 0, art.cx - rect.right), Math.max(rect.top - art.bottom, 0, art.bottom - rect.bottom));
            if (preview || distance <= Math.max(55, roomWidth * .12)) candidates.push({ node, item, distance });
        }
    }
    if (!candidates.length) return false;
    candidates.sort((a, b) => a.distance - b.distance);
    const { node, item } = preview || chosenNode ? candidates[0] : candidates[Math.floor(Math.random() * Math.min(4, candidates.length))], reaction = furnitureReaction(item);
    const bubble = showEmote(node, reaction.icons[Math.floor(Math.random() * reaction.icons.length)]);
    node.dataset.furnitureReaction = item.reaction ?? furnitureInfo(item)?.reaction;
    petRestUntil.set(node.dataset.pet, Date.now() + 6500);
    let animation = null;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) animation = node.querySelector(".stvp-house-pet-art")?.animate?.([
        { translate: "0 0" }, { translate: "0 4px" }, { translate: "0 0" },
    ], { duration: 1000, iterations: 2, easing: "ease-in-out" });
    let timer;
    const cancel = () => {
        clearTimeout(timer); animation?.cancel(); bubble.remove(); delete node.dataset.furnitureReaction;
        if (cancelScene === cancel) cancelScene = null;
    };
    cancelScene = cancel; timer = setTimeout(cancel, 4000);
    return true;
}

/** Opening the room: residents look up, wave in turn, and one may say a custom greeting line. Nothing is fetched. */
function greetVisitor() {
    cancelGreeting?.();
    if (!popup || document.hidden || !house().furnitureLocked || getHouseConversationStatus().active) return;
    const residents = choices(), nodes = [...popup.querySelectorAll(".stvp-house-pet")];
    const resident = node => residents.find(pet => pet.id === node.dataset.pet);
    const plan = planHouseGreeting(nodes.map(node => ({ id: node.dataset.pet, lines: resident(node)?.data?.customSpeeches?.greeting })));
    if (!plan) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timers = new Set(), animations = new Set(), bubbles = new Set();
    const end = plan.speech ? plan.speech.delay + plan.speech.duration : plan.waves.at(-1).delay + 2400;
    let hideSpeech = null;
    const cancel = () => {
        timers.forEach(clearTimeout); timers.clear();
        animations.forEach(animation => animation.cancel()); animations.clear();
        bubbles.forEach(bubble => bubble.remove()); bubbles.clear();
        hideSpeech?.(); hideSpeech = null;
        if (cancelGreeting === cancel) cancelGreeting = null;
    };
    const later = (ms, fn) => {
        const timer = setTimeout(() => {
            timers.delete(timer);
            if (popup && house().furnitureLocked && !getHouseConversationStatus().active) fn(); else cancel();
        }, ms);
        timers.add(timer);
    };
    cancelGreeting = cancel;
    for (const node of nodes) petRestUntil.set(node.dataset.pet, Date.now() + end + 500);
    for (const wave of plan.waves) {
        const node = nodes.find(candidate => candidate.dataset.pet === wave.id);
        later(wave.delay, () => {
            if (!node.isConnected || node._houseMotion) return;
            node.classList.remove("stvp-house-pet-left");
            const bubble = showEmote(node, "wave"); bubbles.add(bubble);
            const hop = reduced ? null : playGesture(node.querySelector(".stvp-house-pet-art"), "hop", { height: 12, duration: 560 });
            if (hop) animations.add(hop);
            later(2400, () => { bubbles.delete(bubble); bubble.remove(); });
        });
    }
    if (plan.speech) later(plan.speech.delay, () => {
        bubbles.forEach(bubble => bubble.remove()); bubbles.clear();
        const node = nodes.find(candidate => candidate.dataset.pet === plan.speech.id);
        if (node?.isConnected) hideSpeech = houseSpeech.say(node, { name: resident(node)?.name, text: plan.speech.text, duration: plan.speech.duration });
    });
    later(end + 200, cancel);
}

function loadRoomLayout(snapshot) {
    // Validate/copy before changing the displayed room.
    const temporary = {}; applyRoomSnapshot(temporary, snapshot);
    surfaceVersion.wallpaper++; surfaceVersion.floor++;
    cancelScene?.(); cancelScene = null;
    finishDrags();
    applyRoomSnapshot(house(), temporary);
    selectedFurniture = null; removedFurniture = null;
    popup.querySelector("#stvp-house-undo").hidden = true;
    petPositions.clear(); petRestUntil.clear();
    renderSurfaces(); renderFurniture(); renderOccupants(); renderPets(); saveSettings();
}

function selectedItem() {
    return house().furniture.find(item => item && typeof item === "object" && item.id === selectedFurniture);
}

function furnitureImage(info, thumbnail = false) { return info.custom ? info.image : EXTENSION_BASE_PATH + "images/house/" + (thumbnail && info.thumbnail || info.image); }

function renderFurniture() {
    finishDrags();
    const layer = popup.querySelector("#stvp-house-furniture");
    layer.replaceChildren();
    for (const [index, item] of orderedFurniture(house().furniture).entries()) {
        if (!item || typeof item !== "object") continue;
        const type = furnitureInfo(item);
        if (!type) continue;
        item.width = Math.max(6, Math.min(60, Number(item.width) || type.width));
        item.x = Math.max(0, Math.min(100 - item.width, Number(item.x) || 0));
        item.y = Math.max(0, Math.min(93, Number(item.y) || 0));
        const element = document.createElement("div");
        element.className = "stvp-house-furniture stvp-house-furniture-" + item.type;
        element.dataset.id = item.id;
        element.style.zIndex = String(index + 2);
        element.style.left = item.x + "%"; element.style.top = item.y + "%"; element.style.width = item.width + "%";
        const image = document.createElement("img");
        image.addEventListener("load", queueGeometry);
        image.src = furnitureImage(type);
        image.alt = type.label; image.draggable = false;
        image.style.transform = item.flipped ? "scaleX(-1)" : "";
        element.append(image);
        element.addEventListener("pointerdown", event => {
            if (house().furnitureLocked || event.button !== 0 || activeDrags.size) return;
            event.preventDefault(); event.stopPropagation();
            selectedFurniture = item.id; updateSelectionControls();
            const room = popup.querySelector(".stvp-house-room").getBoundingClientRect();
            const originX = item.x, originY = item.y;
            let moved = false;
            drag(element, event, next => {
                const dx = next.clientX - event.clientX, dy = next.clientY - event.clientY;
                if (!moved && Math.hypot(dx, dy) < 3) return;
                moved = true;
                item.x = Math.max(0, Math.min(100 - item.width, originX + dx * 100 / room.width));
                item.y = Math.max(0, Math.min(93, originY + dy * 100 / room.height));
                element.style.left = item.x + "%"; element.style.top = item.y + "%";
            }, () => { if (moved) { saveSettings(); queueGeometry(); } });
        });
        layer.append(element);
    }
    renderLayerList();
    updateLock();
    queueGeometry();
}

function updateSelectionControls() {
    const item = selectedItem(), editable = !house().furnitureLocked;
    popup.querySelectorAll(".stvp-house-furniture").forEach(node => node.classList.toggle("selected", editable && node.dataset.id === selectedFurniture));
    const controls = popup.querySelector("#stvp-house-object-tools");
    controls.hidden = !item || !editable;
    if (controls.dataset.itemId !== item?.id) popup.querySelector("#stvp-house-reaction-sample").textContent = "";
    controls.dataset.itemId = item?.id || "";
    popup.querySelector("#stvp-house-selection-hint").hidden = !!item || !editable;
    if (item && editable) {
        popup.querySelector("#stvp-house-furniture-size").value = String(item.width);
        popup.querySelector("#stvp-house-placement").value = item.placement || "auto";
        popup.querySelector("#stvp-house-furniture-flip").setAttribute("aria-pressed", String(!!item.flipped));
        popup.querySelector("#stvp-house-selected-name").textContent = furnitureInfo(item)?.label || "선택한 가구";
        const sorted = paintedFurniture(), index = sorted.findIndex(object => object.item === item);
        popup.querySelector("#stvp-house-layer-back").disabled = index <= 0;
        popup.querySelector("#stvp-house-layer-front").disabled = index === sorted.length - 1;
        popup.querySelector("#stvp-house-furniture-reaction").value = item.reaction ?? furnitureInfo(item)?.reaction ?? "none";
        popup.querySelector("#stvp-house-furniture-size-label").textContent = `${Math.round(item.width)}%`;
    }
    popup.querySelectorAll("[data-layer-id]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.layerId === selectedFurniture)));
}

function updateLock() {
    const locked = house().furnitureLocked;
    if (!locked) cancelGreeting?.();
    popup.classList.toggle("stvp-house-locked", locked);
    popup.querySelector("#stvp-house-pets").inert = !locked;
    popup.querySelector("#stvp-house-auto-layers").disabled = locked;
    popup.querySelector("#stvp-house-layer-panel").open = !locked;
    const button = popup.querySelector("#stvp-house-lock");
    button.innerHTML = locked ? '<i class="fa-solid fa-couch"></i><span>꾸미기</span>' : '<i class="fa-solid fa-check"></i><span>꾸미기 끝내기</span>';
    button.title = locked ? "가구를 놓고 옮깁니다" : "꾸미기를 마치고 캐릭터를 다시 표시합니다";
    button.setAttribute("aria-pressed", String(!locked));
    if (!locked) showPane("decorate");
    popup.querySelectorAll("[data-add]").forEach(button => { button.disabled = locked; });
    popup.querySelectorAll("[data-layer-id], .stvp-house-layer-handle").forEach(button => { button.disabled = locked; });
    popup.querySelector("#stvp-house-undo").disabled = locked;
    popup.querySelector("#stvp-house-edit-hint").textContent = locked ? "위의 ‘꾸미기’를 누르면 가구를 놓고 옮길 수 있습니다." : "그림을 누르면 방에 놓입니다. 방에서 가구를 누르면 크기·순서를 바꿀 수 있습니다.";
    updateSelectionControls();
}

function removeSelectedFurniture() {
    if (house().furnitureLocked) return;
    const item = selectedItem();
    if (!item) return;
    removedFurniture = { item: structuredClone(item), index: house().furniture.indexOf(item) };
    house().furniture = house().furniture.filter(value => value !== item);
    selectedFurniture = null; saveSettings(); renderFurniture();
    popup.querySelector("#stvp-house-undo").hidden = false;
}

function addFurniture(type, asset = null) {
    if ((!Object.hasOwn(FURNITURE, type) && !asset) || house().furnitureLocked) return;
    if (house().furniture.length >= 60) { alert("한 방에는 가구를 최대 60개까지 놓을 수 있습니다."); return; }
    const item = {
        id: globalThis.crypto?.randomUUID?.() || "item-" + Date.now() + "-" + Math.random(),
        type, x: 34, y: 48,
        width: asset ? 22 : FURNITURE[type].width, flipped: false,
    };
    if (asset) Object.assign(item, { type: "custom", assetId: asset.id, image: asset.image, label: asset.label, reaction: asset.reaction });
    const ordered = orderedFurniture(house().furniture);
    ordered.forEach((value, i) => { value.order = i; });
    item.order = ordered.length;
    house().furniture.push(item); selectedFurniture = item.id;
    saveSettings(); renderFurniture();
}

function renderFurnitureCatalog() {
    const list = popup.querySelector(".stvp-house-adds");
    list.replaceChildren();
    const entries = [...Object.entries(AVAILABLE_FURNITURE).map(([type, info]) => ({ type, info })),
        ...house().customFurniture.filter(asset => asset?.id && typeof asset.image === "string").map(asset => ({ type: "custom", info: furnitureInfo({ ...asset, type: "custom" }), asset }))];
    const theme = popup.querySelector("#stvp-house-catalog-theme").value;
    for (const { type, info, asset } of entries) {
        if (theme !== "all" && theme !== (asset ? "custom" : info.theme)) continue;
        const button = document.createElement("button");
        button.type = "button"; button.dataset.add = type;
        button.title = info.label + " 추가"; button.setAttribute("aria-label", button.title);
        const image = document.createElement("img");
        image.src = furnitureImage(info, true);
        image.alt = info.label; image.draggable = false; image.loading = "lazy";
        button.append(image); button.addEventListener("click", () => addFurniture(type, asset)); list.append(button);
    }
}

// The list follows the rendered layers, including depth and manual overrides.
function paintedFurniture() {
    const cached = new Map((roomGeometry?.furniture || []).map(object => [object.id, object]));
    return orderedFurniture(house().furniture).map((item, order) => {
        const object = cached.get(item.id) || { item, order, placement: furniturePlacement(item, furnitureInfo(item)), depth: 100, rect: {} };
        return { ...object, item, z: furnitureLayer({ ...object, item }, roomGeometry?.height || 100) };
    }).sort((a, b) => a.z - b.z || a.order - b.order);
}
function reorderFurniture(id, index) {
    if (house().furnitureLocked || !moveFurnitureLayer(paintedFurniture(), id, index)) return;
    selectedFurniture = id;
    // Reuse cached geometry: changing a layer does not move the furniture base.
    for (const object of roomGeometry?.furniture || []) object.node.style.zIndex = String(furnitureLayer(object, roomGeometry.height));
    saveSettings(); renderLayerList(); updateSelectionControls();
}
function renderLayerList() {
    const list = popup.querySelector("#stvp-house-layers"), scroll = list.scrollTop;
    list.replaceChildren();
    const ordered = paintedFurniture().reverse();
    for (const { item } of ordered) {
        const info = furnitureInfo(item), row = document.createElement("div");
        row.className = "stvp-house-layer-row";
        row.dataset.layerRow = item.id;
        const button = document.createElement("button");
        button.type = "button"; button.dataset.layerId = item.id;
        button.disabled = house().furnitureLocked;
        button.title = `${info.label} 선택`; button.setAttribute("aria-pressed", String(item.id === selectedFurniture));
        const image = document.createElement("img"); image.src = furnitureImage(info, true); image.alt = ""; image.loading = "lazy"; image.draggable = false;
        const label = document.createElement("span"); label.textContent = info.label;
        button.append(image, label);
        button.addEventListener("click", () => { if (house().furnitureLocked) return; selectedFurniture = item.id; updateSelectionControls(); });
        const handle = document.createElement("button");
        handle.type = "button"; handle.className = "stvp-house-layer-handle"; handle.textContent = "⠿";
        handle.disabled = house().furnitureLocked;
        handle.setAttribute("aria-label", `${info.label} 순서 이동`);
        handle.title = "끌어서 순서 이동 · 위/아래 방향키로도 이동";
        handle.addEventListener("pointerdown", event => {
            if (house().furnitureLocked || event.button !== 0 || activeDrags.size) return;
            beginLayerDrag({ event, handle, row, list, activeDrags,
                commit: frontIndex => reorderFurniture(item.id, ordered.length - 1 - frontIndex) });
        });
        handle.addEventListener("keydown", event => {
            if (!["ArrowUp", "ArrowDown"].includes(event.key) || house().furnitureLocked) return;
            event.preventDefault();
            const index = paintedFurniture().findIndex(object => object.item.id === item.id);
            reorderFurniture(item.id, index + (event.key === "ArrowUp" ? 1 : -1));
            [...list.querySelectorAll("[data-layer-row]")].find(node => node.dataset.layerRow === item.id)?.querySelector(".stvp-house-layer-handle").focus({ preventScroll: true });
        });
        row.append(button, handle); list.append(row);
    }
    list.scrollTop = scroll;
    popup.querySelector("#stvp-house-layer-count").textContent = `배치한 가구 · ${house().furniture.length}개`;
}

async function uploadSurface(kind, file) {
    if (!file) return;
    const roomAtStart = popup;
    const dataAtStart = house();
    const version = ++surfaceVersion[kind];
    try {
        const image = await saveImageFile(file, 1600, 0.92);
        if (popup !== roomAtStart || state.settings.house !== dataAtStart || surfaceVersion[kind] !== version) return;
        dataAtStart[kind] = image;
        saveSettings();
        renderSurfaces();
    } catch (error) {
        if (popup !== roomAtStart || surfaceVersion[kind] !== version) return;
        alert(`방 이미지 저장에 실패했습니다: ${error.message}`);
    }
}

function onKeyDown(event) {
    if (event.key === "Escape") {
        const talkText = talkBar()?.querySelector(".stvp-house-talk-text");
        if (event.target === talkText) { talkText.value = ""; fitTalkText(talkText); talkText.blur(); }
        else if (selectedFurniture) { selectedFurniture = null; updateSelectionControls(); }
        else closeHouse();
    }
    if (["Delete", "Backspace"].includes(event.key) && !event.target.closest?.("input, textarea, select, [contenteditable='true']") && selectedFurniture && !house().furnitureLocked) {
        event.preventDefault(); removeSelectedFurniture();
    }
}

function settleRoomResize() {
    if (!popup) return;
    cancelScene?.(); cancelScene = null;
    popup.querySelectorAll(".stvp-house-pet").forEach(element => {
        stopPetMotion(element);
        const old = petPositions.get(element.dataset.pet);
        if (!old) return;
        const position = clampPet(old.x, old.y, petBounds(element));
        petPositions.set(element.dataset.pet, position);
        applyPetPosition(element, position);
    });
    refreshGeometry(); queueDialogueLayout();
}

/** Phones: the on-screen keyboard shrinks the viewport, but the room keeps the size it had. */
let stableViewport = null;
function holdPhoneHeight() {
    if (!popup) return;
    if (!phoneLayout.matches) {
        stableViewport = null;
        popup.style.removeProperty("--h-stable");
        return;
    }
    const width = window.innerWidth, height = window.innerHeight;
    const typing = popup.contains(document.activeElement) && document.activeElement.matches("textarea, input");
    if (stableViewport && stableViewport.width === width && (typing || height < stableViewport.height)) return;
    stableViewport = { width, height };
    popup.style.setProperty("--h-stable", `${height}px`);
}

/** Phones: while typing, the room is drawn smaller (no relayout) so the input stays above the keyboard. */
function fitTalkAboveKeyboard() {
    const room = popup?.querySelector(".stvp-house-room"), input = talkBar()?.querySelector(".stvp-house-talk-text");
    if (!room || !input) return;
    room.style.removeProperty("transform"); room.style.removeProperty("margin-bottom");
    const viewport = window.visualViewport;
    if (!phoneLayout.matches || !viewport || document.activeElement !== input) return;
    const overlap = input.getBoundingClientRect().bottom + 8 - (viewport.offsetTop + viewport.height);
    if (overlap <= 0) return;
    const height = room.offsetHeight, scale = Math.max(.4, (height - overlap) / height);
    room.style.transformOrigin = "top center";
    room.style.transform = `scale(${scale.toFixed(3)})`;
    room.style.marginBottom = `${-Math.round(height * (1 - scale))}px`;
}

const onKeyboardChange = () => { holdPhoneHeight(); fitTalkAboveKeyboard(); };
const onTalkFocus = () => setTimeout(fitTalkAboveKeyboard, 0);
let talkLayoutWatch = null;

function onRoomResize() {
    if (!popup) return;
    holdPhoneHeight();
    fitTalkAboveKeyboard();
    const room = popup.querySelector(".stvp-house-room");
    if (roomGeometry && room && room.clientWidth === roomGeometry.width && room.clientHeight === roomGeometry.height) return;
    if (!resizeTimer) {
        cancelScene?.(); cancelScene = null;
        popup.querySelectorAll(".stvp-house-pet").forEach(node => {
            stopPetMotion(node);
            const position = petPositions.get(node.dataset.pet);
            if (roomGeometry && position) {
                node.style.left = position.x * roomGeometry.width / 100 + "px";
                node.style.bottom = position.y * roomGeometry.height * .56 / 100 + "px";
            }
        });
    }
    clearTimeout(resizeTimer); clearTimeout(geometryTimer);
    resizeTimer = setTimeout(() => { resizeTimer = null; settleRoomResize(); }, 250);
}

function scheduleHouse() {
    const nextWalk = () => { walkTimer = setTimeout(() => { if (!popup) return; roam(); nextWalk(); }, 3000 + Math.random() * 2500); };
    const nextInteraction = () => { interactionTimer = setTimeout(() => { if (!popup) return; interact(); nextInteraction(); }, 14000 + Math.random() * 12000); };
    nextWalk(); nextInteraction();
}

function stopRoomActivity() {
    clearTimeout(walkTimer); clearTimeout(interactionTimer);
    walkTimer = null; interactionTimer = null;
    if (depthFrame !== null) cancelAnimationFrame(depthFrame); depthFrame = null;
    cancelScene?.(); cancelScene = null; cancelGreeting?.();
}

let housePaused = false;
/** Hidden tab: the room stands still but stays open; its timers restart once the tab is visible. */
export function pauseHouse() {
    if (!popup || housePaused) return;
    housePaused = true;
    stopRoomActivity();
    popup.querySelectorAll(".stvp-house-pet").forEach(stopPetMotion);
}
export function resumeHouse() {
    if (!housePaused) return;
    housePaused = false;
    if (popup) scheduleHouse();
}

function showPane(name) {
    if (!popup) return;
    popup.querySelectorAll(".stvp-house-tab").forEach(tab => {
        const active = tab.dataset.pane === name;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
    });
    popup.querySelectorAll(".stvp-house-pane").forEach(pane => pane.classList.toggle("active", pane.dataset.pane === name));
}
const showTalkPane = () => showPane("talk");

// Merged server data replaces the house object, so drags must rebind to the new items.
function onDataMerged() {
    if (!popup) return;
    finishDrags();
    selectedFurniture = null;
    renderSurfaces(); renderFurniture(); renderOccupants(); renderPets();
}

export function closeHouse() {
    if (!popup) return;
    housePaused = false;
    surfaceVersion.wallpaper++;
    surfaceVersion.floor++;
    clearTimeout(geometryTimer); clearTimeout(resizeTimer);
    geometryTimer = null; resizeTimer = null;
    houseSpeech.clear();
    stopRoomActivity();
    finishDrags();
    popup.querySelectorAll(".stvp-house-pet").forEach(stopPetMotion);
    petRestUntil.clear();
    cleanupLibrary?.(); cleanupLibrary = null;
    cleanupConversation?.(); cleanupConversation = null;
    document.removeEventListener("stvp-house-conversation", renderHouseDialogue);
    document.removeEventListener("saipet-data-merged", onDataMerged);
    document.removeEventListener("stvp-house-open-history", showTalkPane);
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", onRoomResize);
    window.visualViewport?.removeEventListener("resize", onKeyboardChange);
    talkLayoutWatch?.disconnect(); talkLayoutWatch = null;
    phoneLayout.removeEventListener("change", renderHouseDialogue);
    popup.remove();
    popup = null;
    refreshLifeStatus();
    selectedFurniture = null; talkTarget = null;
    removedFurniture = null;
    petPositions.clear(); roomGeometry = null; planners.clear(); furnitureVisits.clear();
}

export function openHouse() {
    if (popup) return;
    house();
    popup = document.createElement("div");
    popup.className = "stvp-house-modal";
    popup.innerHTML = `
        <div class="stvp-house-dialog" role="dialog" aria-modal="true" aria-label="펫하우스">
            <header class="stvp-house-header">
                <span class="stvp-house-mark" aria-hidden="true"><i class="fa-solid fa-house-chimney"></i></span>
                <div class="stvp-house-title"><strong>펫하우스</strong></div>
                <button type="button" class="stvp-house-mode" id="stvp-house-lock"></button>
                <button type="button" class="stvp-house-close" id="stvp-house-close" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button>
            </header>
            <div class="stvp-house-layout">
                <div class="stvp-house-stage">
                    <div class="stvp-house-room" aria-label="펫하우스 방">
                        <div class="stvp-house-wall"></div><div class="stvp-house-floor"></div>
                        <div id="stvp-house-furniture"></div><div id="stvp-house-pets"></div><div id="stvp-house-bubbles"></div>
                        <div class="stvp-house-room-toolbar"><button type="button" id="stvp-house-undo" hidden><i class="fa-solid fa-rotate-left"></i> 치운 가구 되돌리기</button></div>
                    </div>
                    <div id="stvp-house-dialogue-live" hidden role="status"><b class="stvp-house-subtitle-name"></b><span class="stvp-house-subtitle-text"></span></div>
                    <div id="stvp-house-talk" hidden>
                        <div class="stvp-house-talk-targets" role="group" aria-label="말 걸 상대"></div>
                        <div class="stvp-house-talk-row">
                            <textarea class="stvp-house-talk-text" rows="1" aria-label="주민에게 할 말" title="Enter 보내기 · Shift+Enter 줄바꿈"></textarea>
                            <button type="button" class="stvp-house-talk-send" title="보내기" aria-label="보내기"><i class="fa-solid fa-paper-plane"></i></button>
                        </div>
                        <small class="stvp-house-talk-status" role="status"></small>
                    </div>
                </div>
                <aside class="stvp-house-tools">
                    <nav class="stvp-house-tabs" role="tablist" aria-label="펫하우스 메뉴">
                        <button type="button" class="stvp-house-tab active" data-pane="residents" role="tab"><i class="fa-solid fa-user-group"></i><span>주민</span></button>
                        <button type="button" class="stvp-house-tab" data-pane="talk" role="tab"><i class="fa-solid fa-comments"></i><span>대화</span></button>
                        <button type="button" class="stvp-house-tab" data-pane="decorate" role="tab"><i class="fa-solid fa-couch"></i><span>꾸미기</span></button>
                        <button type="button" class="stvp-house-tab" data-pane="room" role="tab"><i class="fa-solid fa-paint-roller"></i><span>방</span></button>
                    </nav>
                    <section class="stvp-house-pane active" data-pane="residents">
                        <h4 id="stvp-house-occupant-summary">함께 지낼 캐릭터</h4>
                        <p class="stvp-house-hint">프리셋에서 최대 4명까지 고를 수 있습니다. 방 안의 캐릭터는 끌어서 옮길 수 있습니다.</p>
                        <div id="stvp-house-occupants"></div>
                    </section>
                    <section class="stvp-house-pane" data-pane="talk">
                        <h4>방 안 대화</h4>
                        <p class="stvp-house-hint" data-house-chat-status role="status"></p>
                        <button type="button" class="stvp-house-primary" data-house-chat-now><i class="fa-solid fa-comments"></i> 지금 펫끼리 대화시키기</button>
                        <details class="stvp-house-history" open><summary>지난 대화</summary><div data-house-chat-history></div></details>
                    </section>
                    <section class="stvp-house-pane" data-pane="decorate">
                        <p id="stvp-house-selection-hint" class="stvp-house-hint stvp-house-callout" hidden>방이나 아래 목록에서 가구를 고르십시오.</p>
                        <div id="stvp-house-object-tools" hidden aria-label="선택한 가구 편집">
                            <strong id="stvp-house-selected-name"></strong>
                            <div class="stvp-house-object-row"><button type="button" id="stvp-house-layer-back" title="한 단계 뒤로" aria-label="한 단계 뒤로"><i class="fa-solid fa-arrow-down"></i></button><button type="button" id="stvp-house-layer-front" title="한 단계 앞으로" aria-label="한 단계 앞으로"><i class="fa-solid fa-arrow-up"></i></button><button type="button" id="stvp-house-furniture-flip" title="좌우 반전" aria-label="좌우 반전"><i class="fa-solid fa-left-right"></i></button><button type="button" id="stvp-house-furniture-remove" title="치우기" aria-label="선택한 가구 치우기"><i class="fa-solid fa-trash-can"></i></button></div>
                            <div class="stvp-house-object-row"><i class="fa-solid fa-up-right-and-down-left-from-center" aria-hidden="true"></i><input type="range" id="stvp-house-furniture-size" min="6" max="60" aria-label="선택한 가구 크기" title="가구 크기"><output id="stvp-house-furniture-size-label"></output></div>
                            <div class="stvp-house-object-row"><select id="stvp-house-placement" aria-label="가구 배치 판정"><option value="auto">배치 판정 · 자동</option><option value="solid">바닥 가구 · 피해 걷기</option><option value="wall">벽·천장 장식</option><option value="rug">러그 · 지나가기</option><option value="surface">탁상 소품</option></select></div>
                            <div class="stvp-house-object-row"><select id="stvp-house-furniture-reaction" aria-label="가구 반응"></select><button type="button" id="stvp-house-reaction-preview" title="반응 미리보기" aria-label="반응 미리보기"><i class="fa-regular fa-face-smile"></i></button></div>
                            <small id="stvp-house-reaction-sample" role="status"></small>
                        </div>
                        <h4>가구 놓기</h4>
                        <select id="stvp-house-catalog-theme" aria-label="가구 테마"></select>
                        <div class="stvp-house-adds"></div>
                        <p class="stvp-house-hint" id="stvp-house-edit-hint"></p>
                        <details id="stvp-house-layer-panel"><summary id="stvp-house-layer-count">배치한 가구</summary><p class="stvp-house-hint">위쪽일수록 앞에 보입니다. ⠿ 손잡이를 끌거나 고른 뒤 방향키로 순서를 바꿉니다.</p><div id="stvp-house-layers"></div><button type="button" id="stvp-house-auto-layers"><i class="fa-solid fa-wand-magic-sparkles"></i> 위치에 따라 자동 정렬</button></details>
                        <details><summary>내 가구 등록</summary>
                            <label>이름 <input id="stvp-house-custom-name" type="text" maxlength="60" placeholder="비우면 파일 이름"></label>
                            <label>반응 <select id="stvp-house-custom-reaction"></select></label>
                            <label class="stvp-house-upload"><i class="fa-solid fa-image"></i> 이미지 골라 등록<input id="stvp-house-custom-file" type="file" accept="image/png,image/jpeg,image/webp"></label>
                            <p class="stvp-house-hint">PNG·JPG·WebP를 쓸 수 있으며 투명 배경도 유지됩니다.</p>
                            <div id="stvp-house-custom-list"></div>
                        </details>
                    </section>
                    <section class="stvp-house-pane" data-pane="room">
                        <h4>벽지와 바닥</h4>
                        <div class="stvp-house-surface-grid">
                            <label class="stvp-house-upload"><i class="fa-solid fa-image"></i> 벽지 바꾸기<input type="file" id="stvp-house-wallpaper" accept="image/png,image/jpeg,image/webp"></label>
                            <button type="button" id="stvp-house-wallpaper-reset">기본 벽지</button>
                            <label class="stvp-house-upload"><i class="fa-solid fa-image"></i> 바닥 바꾸기<input type="file" id="stvp-house-floor-input" accept="image/png,image/jpeg,image/webp"></label>
                            <button type="button" id="stvp-house-floor-reset">기본 바닥</button>
                        </div>
                        <h4>방 배치 저장·불러오기</h4>
                        <p class="stvp-house-hint">기본 테마를 불러오거나 내 배치를 저장합니다. 함께 지낼 캐릭터는 바뀌지 않습니다.</p>
                        <select id="stvp-house-layout-select" aria-label="저장한 방 배치"></select>
                        <input id="stvp-house-layout-name" maxlength="60" placeholder="방 이름" aria-label="방 이름">
                        <div class="stvp-house-preset-actions"><button type="button" id="stvp-house-layout-load">불러오기</button><button type="button" id="stvp-house-layout-save">새로 저장</button><button type="button" id="stvp-house-layout-overwrite">덮어쓰기</button><button type="button" id="stvp-house-layout-delete">삭제</button><button type="button" id="stvp-house-layout-undo" hidden>불러오기 되돌리기</button></div>
                        <p class="stvp-house-hint" id="stvp-house-library-status" role="status"></p>
                    </section>
                </aside>
            </div>
        </div>`;
    document.body.append(popup);
    popup.querySelector("#stvp-house-close").addEventListener("click", closeHouse);
    popup.querySelector(".stvp-house-tabs").addEventListener("click", event => {
        const tab = event.target.closest(".stvp-house-tab");
        if (tab) showPane(tab.dataset.pane);
    });
    popup.addEventListener("pointerdown", event => { if (event.target === popup) closeHouse(); });
    popup.querySelector("#stvp-house-wallpaper").addEventListener("change", event => uploadSurface("wallpaper", event.target.files[0]));
    popup.querySelector("#stvp-house-floor-input").addEventListener("change", event => uploadSurface("floor", event.target.files[0]));
    popup.querySelector("#stvp-house-wallpaper-reset").addEventListener("click", () => { surfaceVersion.wallpaper++; house().wallpaper = null; saveSettings(); renderSurfaces(); });
    popup.querySelector("#stvp-house-floor-reset").addEventListener("click", () => { surfaceVersion.floor++; house().floor = null; saveSettings(); renderSurfaces(); });
    const catalogTheme = popup.querySelector("#stvp-house-catalog-theme");
    for (const [id, theme] of Object.entries(HOUSE_THEMES)) catalogTheme.add(new Option(theme.label, id));
    for (const [id, label] of [["custom", "내 가구"], ["all", "전체 가구"]]) catalogTheme.add(new Option(label, id));
    catalogTheme.addEventListener("change", () => { renderFurnitureCatalog(); updateLock(); });
    renderFurnitureCatalog();
    for (const [value, info] of Object.entries(FURNITURE_REACTIONS)) popup.querySelector("#stvp-house-furniture-reaction").add(new Option(info.label, value));
    for (const [selector, delta] of [["#stvp-house-layer-back", -1], ["#stvp-house-layer-front", 1]]) popup.querySelector(selector).addEventListener("click", () => {
        const index = paintedFurniture().findIndex(object => object.item.id === selectedFurniture);
        if (index >= 0) reorderFurniture(selectedFurniture, index + delta);
    });
    popup.querySelector("#stvp-house-auto-layers").addEventListener("click", () => {
        if (house().furnitureLocked) return;
        for (const item of house().furniture) delete item.layerZ;
        saveSettings(); refreshGeometry();
    });
    popup.querySelector("#stvp-house-placement").addEventListener("change", event => {
        const item = selectedItem(); if (!item || house().furnitureLocked) return;
        item.placement = event.target.value; saveSettings(); queueGeometry();
    });
    popup.querySelector("#stvp-house-furniture-reaction").addEventListener("change", event => {
        const item = selectedItem(); if (!item || house().furnitureLocked) return;
        cancelScene?.(); cancelScene = null; item.reaction = event.target.value; saveSettings();
    });
    popup.querySelector("#stvp-house-reaction-preview").addEventListener("click", () => {
        const item = selectedItem(); if (!item) return;
        const reaction = furnitureReaction(item);
        popup.querySelector("#stvp-house-reaction-sample").replaceChildren(...reaction.icons.map(key => effectIcon(key)), ` ${reaction.label}`);
    });
    popup.querySelector("#stvp-house-lock").addEventListener("click", () => {
        finishDrags();
        cancelScene?.(); cancelScene = null;
        popup.querySelectorAll(".stvp-house-pet").forEach(stopPetMotion);
        house().furnitureLocked = !house().furnitureLocked;
        selectedFurniture = null; saveSettings(); startHouseConversations(); updateLock(); queueGeometry();
    });
    popup.querySelector(".stvp-house-room").addEventListener("pointerdown", event => {
        if (event.target.closest(".stvp-house-furniture, .stvp-house-pet, #stvp-house-object-tools, .stvp-house-room-toolbar")) return;
        selectedFurniture = null; updateSelectionControls();
    });
    popup.querySelector("#stvp-house-furniture-flip").addEventListener("click", () => {
        const item = selectedItem(); if (!item || house().furnitureLocked) return;
        item.flipped = !item.flipped; saveSettings(); renderFurniture();
    });
    popup.querySelector("#stvp-house-undo").addEventListener("click", () => {
        if (!removedFurniture || house().furnitureLocked) return;
        house().furniture.splice(removedFurniture.index, 0, removedFurniture.item);
        selectedFurniture = removedFurniture.item.id; removedFurniture = null;
        popup.querySelector("#stvp-house-undo").hidden = true;
        saveSettings(); renderFurniture();
    });
    popup.querySelector("#stvp-house-furniture-size").addEventListener("input", event => {
        const item = selectedItem();
        if (!item || house().furnitureLocked) return;
        item.width = Number(event.target.value);
        item.x = Math.min(item.x, 100 - item.width);
        const element = [...popup.querySelectorAll(".stvp-house-furniture")].find(node => node.dataset.id === item.id);
        if (element) { element.style.width = `${item.width}%`; element.style.left = `${item.x}%`; }
        // Keep the slider fixed under the pointer; moving it here feeds the
        // changed position back into the native range value and causes jitter.
        popup.querySelector("#stvp-house-furniture-size-label").textContent = `${item.width}%`;
    });
    popup.querySelector("#stvp-house-furniture-size").addEventListener("change", () => {
        if (!house().furnitureLocked) { saveSettings(); queueGeometry(); }
    });
    popup.querySelector("#stvp-house-furniture-remove").addEventListener("click", removeSelectedFurniture);
    bindTalkBar();
    renderSurfaces();
    renderFurniture();
    renderOccupants();
    renderPets();
    cleanupLibrary = setupHouseLibrary({ popup, getHouse: house, refreshCatalog: () => { renderFurnitureCatalog(); updateLock(); }, applyLayout: loadRoomLayout });
    document.addEventListener("stvp-house-open-history", showTalkPane);
    cleanupConversation = bindHouseConversationUI(popup, { history: true });
    document.addEventListener("stvp-house-conversation", renderHouseDialogue);
    document.addEventListener("saipet-data-merged", onDataMerged);
    renderHouseDialogue(); refreshLifeStatus();
    document.addEventListener("keydown", onKeyDown);
    stableViewport = null;
    holdPhoneHeight();
    window.addEventListener("resize", onRoomResize, { passive: true });
    window.visualViewport?.addEventListener("resize", onKeyboardChange);
    talkLayoutWatch = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (popup?.contains(document.activeElement) && document.activeElement.matches(".stvp-house-talk-text")) fitTalkAboveKeyboard(); }) : null;
    for (const node of popup.querySelectorAll("#stvp-house-dialogue-live, #stvp-house-talk")) talkLayoutWatch?.observe(node);
    popup.addEventListener("focusin", onTalkFocus);
    popup.addEventListener("focusout", onTalkFocus);
    phoneLayout.addEventListener("change", renderHouseDialogue);
    scheduleHouse();
    greetVisitor();
}
