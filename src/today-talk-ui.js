import { getLogs } from "./pet-ai.js";
import { renderLogEntries } from "./log-ui.js";

let overlay = null, opener = null;

function build() {
    document.body.insertAdjacentHTML("beforeend", `
    <div class="stvp-today" hidden>
        <div class="stvp-today-box" role="dialog" aria-modal="true" aria-labelledby="stvp-today-title">
            <header><i class="fa-solid fa-comments" aria-hidden="true"></i><div><strong id="stvp-today-title">오늘의 대화</strong><small class="stvp-today-count"></small></div>
                <button type="button" class="stvp-today-close" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button></header>
            <div class="stvp-today-list"></div>
        </div>
    </div>`);
    overlay = document.body.lastElementChild;
    overlay.addEventListener("click", event => {
        if (event.target === overlay || event.target.closest(".stvp-today-close")) closeTodayTalks();
    });
    overlay.addEventListener("keydown", event => { if (event.key === "Escape") { event.stopPropagation(); closeTodayTalks(); } });
}

function render() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const today = getLogs("all").filter(entry => entry.timestamp >= start.getTime()).reverse();
    overlay.querySelector(".stvp-today-count").textContent = today.length ? `${today.length}개 · 최근 순` : "";
    overlay.querySelector(".stvp-today-list").innerHTML = today.length
        ? renderLogEntries(today)
        : '<div class="stvp-today-empty"><i class="fa-regular fa-comment"></i><span>오늘은 아직 나눈 대화가 없습니다</span></div>';
}

export function openTodayTalks() {
    if (!overlay) build();
    opener = document.activeElement;
    render();
    overlay.hidden = false;
    overlay.querySelector(".stvp-today-close").focus({ preventScroll: true });
    document.addEventListener("stvp-log-updated", render);
}

function closeTodayTalks() {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    document.removeEventListener("stvp-log-updated", render);
    opener?.focus?.({ preventScroll: true }); opener = null;
}
