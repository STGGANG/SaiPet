import { mobileReadingPlan } from "./mobile-reading.js";
import { applyFont } from "./fonts.js";
import { state, getPetInstanceEpoch } from "./state.js";
import { setGestureText } from "./ui-kit.js";

/** Each character's latest line only: at most two rows, no queue or history. */
const rows = new Map();
let currentBar = null;
let resizeTimer = null;

function topBarBottom() {
    const top = document.querySelector("#top-bar, #topbar, .top-bar");
    return Math.max(0, top?.getBoundingClientRect().bottom || 48);
}
function isCurrent(row) {
    return rows.get(row.petId) === row && row.epoch === getPetInstanceEpoch(row.petId);
}
function removeRow(row) {
    clearTimeout(row.timer);
    row.animation?.cancel();
    row.element.remove();
    if (rows.get(row.petId) === row) rows.delete(row.petId);
    if (!rows.size) currentBar?.classList.remove("show");
}
function scheduleHide(row, ms) {
    clearTimeout(row.timer);
    row.deadline = Date.now() + ms;
    row.timer = setTimeout(() => removeRow(row), ms);
}
function measure(row, initial = false) {
    if (!isCurrent(row)) return;
    const { phrase, viewport } = row;
    row.animation?.cancel(); row.animation = null;
    phrase.style.animation = "none";
    phrase.style.transform = "translateX(0)";
    const distance = Math.max(0, phrase.scrollWidth - viewport.clientWidth);
    let hideAfter = Math.max(2500, row.duration);
    if (distance > 2 && !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
        const plan = mobileReadingPlan(distance, parseFloat(getComputedStyle(phrase).fontSize));
        row.animation = phrase.animate([
            { transform: "translateX(0)", offset: 0 },
            { transform: "translateX(0)", offset: plan.hold / plan.duration },
            { transform: `translateX(${-distance}px)`, offset: (plan.hold + plan.travel) / plan.duration },
            { transform: `translateX(${-distance}px)`, offset: 1 },
        ], { duration: plan.duration, iterations: 3, easing: "linear", fill: "forwards" });
        hideAfter = Math.max(hideAfter, plan.duration * 3 + 600);
    }
    if (row.pausedRemaining !== null) row.animation?.pause();
    // A resize/font load must not keep extending the life of an old message.
    if (initial) scheduleHide(row, hideAfter);
    return hideAfter;
}
function reposition() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (!currentBar) return;
        currentBar.style.top = `${topBarBottom() + 4}px`;
        for (const row of rows.values()) {
            if (isCurrent(row)) measure(row);
            else removeRow(row);
        }
    }, 250);
}
function togglePause(row) {
    if (!isCurrent(row)) return;
    if (row.pausedRemaining === null) {
        row.pausedRemaining = Math.max(1, row.deadline - Date.now());
        clearTimeout(row.timer);
        row.animation?.pause();
    } else {
        row.animation?.play();
        scheduleHide(row, row.pausedRemaining);
        row.pausedRemaining = null;
    }
}
function createBar() {
    if (currentBar?.isConnected) return currentBar;
    const bar = document.createElement("div");
    bar.id = "saipet-mobile-speech";
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-label", "캐릭터의 최근 대사");
    window.addEventListener?.("resize", reposition, { passive: true });
    document.body.appendChild(bar);
    currentBar = bar;
    return bar;
}

/** New speech replaces the same character's row immediately, except that a minor line
 * (idle chatter, collision, dreaming) never covers that character's visible AI reply or reminder. */
export function showMobileSpeech(text, duration, priority, petId) {
    const current = rows.get(petId);
    if (current && isCurrent(current) && current.priority && !priority) return;
    const bar = createBar();
    for (const row of rows.values()) if (!isCurrent(row) || row.petId === petId) removeRow(row);
    if (rows.size >= 2) removeRow(rows.values().next().value);
    const element = document.createElement("div");
    element.className = "saipet-mobile-row";
    element.dataset.petId = petId;
    element.innerHTML = `
        <span class="saipet-mobile-speaker"></span>
        <div class="saipet-mobile-speech-window" title="눌러서 일시 정지 / 계속 읽기"><span class="saipet-mobile-speech-text"></span></div>
        <button type="button" class="saipet-mobile-close" aria-label="대사 닫기">×</button>
    `;
    const settings = petId === "secondary" ? state.settings.multiPet?.secondPetData : state.settings;
    element.querySelector(".saipet-mobile-speaker").textContent = settings?.personality?.name || (petId === "secondary" ? "펫 2" : "펫");
    const row = {
        element, petId, priority:Boolean(priority), epoch:getPetInstanceEpoch(petId), duration:Number(duration) || 15000,
        phrase:element.querySelector(".saipet-mobile-speech-text"),
        viewport:element.querySelector(".saipet-mobile-speech-window"),
        timer:null, deadline:0, pausedRemaining:null,
    };
    setGestureText(row.phrase, String(text));
    element.querySelector(".saipet-mobile-close").addEventListener("click", () => removeRow(row));
    row.viewport.addEventListener("click", () => togglePause(row));
    bar.prepend(element);
    rows.set(petId, row);
    bar.style.top = `${topBarBottom() + 4}px`;
    bar.classList.add("show");
    const hideAfter = measure(row, true);
    applyFont(element, settings?.speechBubble?.font).then(loaded => {
        if (loaded && isCurrent(row)) measure(row);
    });
    return { shown:true, hideAfter, cancel:() => { if (isCurrent(row)) removeRow(row); } };
}

export function hideMobileSpeech(petId = null) {
    for (const row of rows.values()) if (petId == null || row.petId === petId) removeRow(row);
}
export function clearMobileSpeech() {
    hideMobileSpeech();
    clearTimeout(resizeTimer); resizeTimer = null;
    window.removeEventListener?.("resize", reposition);
    currentBar?.remove(); currentBar = null;
}
