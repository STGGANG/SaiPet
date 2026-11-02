import { constrainWalkTarget, walkDirection, mobileWalkRange, walkingEnabled } from "./walk-direction.js";
import { startWalkVisual } from "./walking.js";
import { maybeWalkHop } from "./motion-effects.js";
import { state, isPetActive, isPetAvailable } from "./state.js";
import { moveElement, stopMotion } from "./movement.js";
import { RELATIONS, SCENES, SCENE_DURATION, chooseScene, spriteRect, areNeighbors, planApproach, walkDuration, playPairScene } from "./social-scenes.js";
export { RELATIONS, SCENES };

let timer = null, cancelScene = null;
let lastInteraction = 0, previousScene = null;
export function stopSocial() {
    clearTimeout(timer); timer = null;
    cancelSocialInteraction();
}
export function cancelSocialInteraction() {
    cancelScene?.(); cancelScene = null;
    state.socialUntil = 0;
}
function bounds() {
    const viewport = state.isMobile ? window.visualViewport : null;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    return { left: left + 8, top: top + 8, right: left + (viewport?.width || window.innerWidth) - 8, bottom: top + (viewport?.height || window.innerHeight) - 8 };
}
function calm() {
    return isPetActive() && !document.hidden && !state.viewportResizing && !state.isDragging && !state.isGenerating
        && !state.isPetGenerating && !state.secondPet.isPetGenerating && !state.isPrioritySpeech && !state.secondPet.isPrioritySpeech
        && ![state.currentState, state.secondPet.currentState].some(s => ["sleeping", "thinking"].includes(s));
}
const talking = node => !!node.querySelector(".st-pet-bubble.show:not(.stvp-social-bubble)")
    || (node.querySelector(".st-pet-chat-input")?.style.display || "none") !== "none";
/** Phones: at most 2.5× the wander range (200px by default, so the two bottom corners can still meet); a range of 0 means no approach. */
function approachOptions() {
    const view = bounds(), maxStep = state.isMobile ? 120 : 250;
    const reach = state.isMobile ? mobileWalkRange(state.settings.deviceDisplay?.mobile?.walkRange) * 2.5 : 600;
    return { mode: walkDirection(state.settings), bounds: view, maxStep, maxDistance: Math.min((view.right - view.left) * .65, reach) };
}
export function playSocialInteraction({ preview = false, action = null } = {}) {
    if (cancelScene || !calm() || !state.settings.multiPet?.visualInteractions) return false;
    const nodes = [document.getElementById("saipet-container"), document.getElementById("saipet-container-2")];
    if (nodes.some(n => !n || n.classList.contains("walking") || n.classList.contains("dragging"))) return false;
    if (!preview && (Date.now() - lastInteraction < 90000 || document.querySelector(".stvp-house-modal") || nodes.some(talking))) return false;
    let plan = null;
    if (!preview && !areNeighbors(...nodes.map(spriteRect))) {
        plan = walkingEnabled(state.settings, state.isMobile) && planApproach(nodes.map(node => ({ art: spriteRect(node), box: node.getBoundingClientRect() })), approachOptions());
        if (!plan) return false;
    }
    if (preview) for (const node of nodes) {
        const bubble = node.querySelector(".st-pet-bubble.show:not(.stvp-social-bubble)");
        if (bubble) { bubble.classList.remove("show"); bubble.style.display = "none"; }
    }
    lastInteraction = Date.now();
    const relation = state.settings.multiPet.visualRelation;
    previousScene = preview && (RELATIONS[relation] || RELATIONS.friends).actions.includes(action) ? action : chooseScene(relation, previousScene);
    const actors = nodes.map((node, index) => {
        const settings = index ? state.settings.multiPet.secondPetData : state.settings;
        const userFlip = !!settings?.appearance?.flipHorizontal;
        const sprite = node.querySelector(".st-pet-sprite");
        return {
            node, bounds,
            speechBubble: index ? state.settings.multiPet.secondPetData?.speechBubble || state.settings.speechBubble : state.settings.speechBubble,
            moveTo(cx, feet, ms) {
                const box = node.getBoundingClientRect(), art = spriteRect(node), view = bounds();
                const x = Math.max(view.left, Math.min(view.right - box.width, box.left + cx - art.cx));
                const y = Math.max(view.top, Math.min(view.bottom - box.height, box.top + feet - art.bottom));
                const target = constrainWalkTarget(walkDirection(state.settings), {x:box.left,y:box.top}, {x,y});
                moveElement(node, target.x, target.y, ms);
            },
            walk(ms) { startWalkVisual(node, settings, ms); },
            face(left) { sprite?.classList.toggle("flipped", left !== userFlip); },
            stop() { stopMotion(node); },
            reset() { sprite?.classList.toggle("flipped", userFlip); },
        };
    });
    const scene = done => {
        state.socialUntil = Date.now() + SCENE_DURATION + 200;
        return playPairScene(actors, { action: previousScene, relation, canMove: walkingEnabled(state.settings, state.isMobile), valid: calm, done });
    };
    cancelScene = plan ? walkOver(actors, plan, scene) : scene(() => { cancelScene = null; state.socialUntil = 0; });
    return true;
}
/** One character strolls over at walking pace, the scene plays beside the other, then it strolls back to where it stood. */
function walkOver(actors, plan, scene) {
    const walker = actors[plan.walker], other = actors[1 - plan.walker];
    const home = spriteRect(walker.node), maxStep = approachOptions().maxStep;
    let timer = null, cancelCurrent = null, ended = false;
    const finish = () => {
        if (ended) return;
        ended = true; clearTimeout(timer);
        cancelCurrent?.(); cancelCurrent = null;
        walker.stop(); walker.reset();
        state.socialUntil = 0; cancelScene = null;
    };
    const later = (ms, fn) => {
        timer = setTimeout(() => {
            if (ended) return;
            if (!calm() || actors.some(actor => !actor.node.isConnected || talking(actor.node))) { finish(); return; }
            fn();
        }, ms);
    };
    const stroll = (cx, feet, ms, after) => {
        state.socialUntil = Date.now() + ms + after;
        walker.face(cx < spriteRect(walker.node).cx);
        walker.moveTo(cx, feet, ms); walker.walk(ms);
        maybeWalkHop(walker.node, { enabled: state.settings.motion?.walkHop !== false });
    };
    stroll(plan.cx, plan.feet, plan.duration, SCENE_DURATION + 2500);
    later(plan.duration + 150, () => {
        walker.stop(); walker.reset();
        if (!areNeighbors(spriteRect(walker.node), spriteRect(other.node))) { finish(); return; }
        cancelCurrent = scene(() => {
            cancelCurrent = null;
            if (ended) return;
            state.socialUntil = Date.now() + 9000;
            later(900 + Math.random() * 600, () => {
                const here = spriteRect(walker.node), distance = Math.hypot(home.cx - here.cx, home.bottom - here.bottom);
                if (distance < 12) { finish(); return; }
                const ms = walkDuration(distance, maxStep);
                stroll(home.cx, home.bottom, ms, 500);
                later(ms + 150, finish);
            });
        });
    });
    return finish;
}
export function startSocial() {
    stopSocial();
    if (!isPetAvailable("primary") || !isPetAvailable("secondary") || !state.settings.multiPet?.visualInteractions) return;
    const next = () => {
        timer = setTimeout(() => { playSocialInteraction(); if (isPetActive()) next(); }, 90000 + Math.random() * 90000);
    };
    next();
}
