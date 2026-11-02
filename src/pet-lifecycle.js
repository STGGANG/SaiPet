import { stopMotion } from "./movement.js";
import { state, isPetActive, schedulePetTimeout } from "./state.js";
import { removePetContainer, pauseWalking, resumeWalking } from "./pet-core.js";
import { destroyReactions, pauseReactions, resumeReactions } from "./pet-reactions.js";
import { clearPetAnimationTimers } from "./pet-animation.js";
import { clearSpeechTimers } from "./pet-speech.js";
import { startSocial, stopSocial } from "./social.js";
import { closeHouse, pauseHouse, resumeHouse } from "./house.js";
import { getLogs } from "./pet-ai.js";
import { beginLifeActivity } from "./life-status.js";

let hiddenSince = null;
let lastActivity = Date.now();
let activityWatched = false;
const IDLE_NOTICE_MS = 10 * 60 * 1000;

function onUserActivity() {
    const now = Date.now();
    if (now - lastActivity >= IDLE_NOTICE_MS && !document.hidden && isPetActive()) announceMissedConversations(lastActivity);
    lastActivity = now;
}

/** "Away" also means a visible tab nobody touched for a while; pets keep chatting then. */
export function watchUserActivity() {
    if (activityWatched) return;
    activityWatched = true;
    for (const name of ["pointerdown", "keydown", "wheel", "touchstart"]) {
        document.addEventListener(name, onUserActivity, { capture: true, passive: true });
    }
}

/** Hidden tab: stop timers and motion, but keep the pets, the house popup and in-flight replies. */
export function pausePet() {
    if (hiddenSince !== null || !isPetActive()) return;
    hiddenSince = Date.now();
    pauseWalking();
    stopSocial();
    pauseReactions();
    pauseHouse();
}

export function resumePet() {
    if (hiddenSince === null) return;
    const since = hiddenSince;
    hiddenSince = null;
    if (!isPetActive()) return;
    resumeWalking();
    startSocial();
    resumeReactions(Date.now() - since);
    resumeHouse();
    announceMissedConversations(Math.min(since, lastActivity));
    lastActivity = Date.now();
}

/** House talks count once per conversation; pet-to-pet chats and reminders once per entry. */
export function countMissedConversations(entries, since) {
    const seen = new Set();
    for (const entry of entries) {
        if (!(entry.timestamp > since)) continue;
        seen.add(entry.source === "house" && entry.conversationId ? entry.conversationId : (entry.id ?? entry.timestamp));
    }
    return seen.size;
}

function announceMissedConversations(since) {
    const count = countMissedConversations([...getLogs("interPet"), ...getLogs("notification")], since);
    if (!count) return;
    const finish = beginLifeActivity("missed", `자리 비운 사이 대화 ${count}개가 있었습니다`, "stvp-open-log", { once: true });
    schedulePetTimeout(finish, 20000);
}

/** Stop all pet activity and remove every visible pet element. */
export function deactivatePet() {
    hiddenSince = null;
    state.runtimeActive = false;
    for (const controller of state.apiControllers || []) controller.abort();
    state.apiControllers?.clear();
    state.lifecycleEpoch++;
    // Hide first: even if a later cleanup step fails, OFF never leaves a pet on screen.
    const nodes = document.querySelectorAll("#saipet-container, #saipet-container-2");
    for (const node of nodes) node.remove();
    for (const node of nodes) stopMotion(node, false);
    closeHouse();
    destroyReactions();
    clearPetAnimationTimers();
    clearSpeechTimers();
    for (const timer of state._asyncPresentationTimers) clearTimeout(timer);
    state._asyncPresentationTimers.clear();
    removePetContainer("secondary");
    removePetContainer("primary");
    state.isReady = false;
    state.isGenerating = false;
    state.isPetGenerating = false;
    state.secondPet.isPetGenerating = false;
    state.isDreamGenerating = false;
    state.secondPet.isDreamGenerating = false;
}
