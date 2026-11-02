import { state, log } from "./state.js";
import { getJournalEntries, deleteJournalEntry, clearJournal, getJournalPetNames, generateDiary, saveDiary } from "./pet-ai.js";
import { characterData, characterName } from "./character-identity.js";
import { idleSprite } from "./sprite-paths.js";
import { escapeHtml } from "./ui-kit.js";
import { getStorageStatus } from "./storage.js";
import { saveEntryImage } from "./journal-card.js";

const PAGE_SIZE = 3;
let page = 1;
let typeFilter = "all";
let monthFilter = "all";
let query = "";
let searchTimer = null;
let visibleEntries = [];

const $overlay = () => document.getElementById("stvp-journal-popup-overlay");
const isOpen = () => {
    const overlay = $overlay();
    return Boolean(overlay) && overlay.style.display !== "none";
};

export function createJournalPopup() {
    let overlay = $overlay();
    if (overlay) return overlay;
    document.body.insertAdjacentHTML("beforeend", `
    <div id="stvp-journal-popup-overlay" class="stvp-journal-popup-overlay" style="display:none;">
        <div class="stvp-journal-popup" role="dialog" aria-modal="true" aria-labelledby="stvp-journal-title">
            <header class="stvp-journal-head">
                <h3 id="stvp-journal-title"><i class="fa-solid fa-book-open"></i> 일기장</h3>
                <button type="button" class="stvp-journal-icon-btn" id="stvp-journal-refresh" title="새로고침" aria-label="새로고침"><i class="fa-solid fa-arrows-rotate"></i></button>
                <button type="button" class="stvp-journal-icon-btn" id="stvp-journal-popup-close" title="닫기" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button>
            </header>
            <nav class="stvp-journal-index" role="tablist" aria-label="기록 종류">
                <button type="button" class="stvp-jpopup-tab active" data-jtype="all" role="tab">전체</button>
                <button type="button" class="stvp-jpopup-tab" data-jtype="dream" role="tab"><i class="fa-solid fa-moon"></i> 꿈</button>
                <button type="button" class="stvp-jpopup-tab" data-jtype="diary" role="tab"><i class="fa-solid fa-pen-nib"></i> 일기</button>
            </nav>
            <div class="stvp-journal-toolbar">
                <select id="stvp-journal-pet-filter" class="stvp-journal-select" aria-label="펫 고르기"><option value="all">모든 펫</option></select>
                <button type="button" class="stvp-journal-btn stvp-journal-btn-ink" id="stvp-journal-write-diary"><i class="fa-solid fa-pen-to-square"></i> 일기 쓰기</button>
            </div>
            <div class="stvp-journal-toolbar stvp-journal-filters">
                <select id="stvp-journal-month" class="stvp-journal-select" aria-label="달 고르기"><option value="all">모든 날짜</option></select>
                <label class="stvp-journal-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input type="search" id="stvp-journal-search" placeholder="내용 검색" aria-label="일기 내용 검색"></label>
            </div>
            <div id="stvp-journal-viewer" class="stvp-journal-viewer"></div>
            <footer class="stvp-journal-foot">
                <div class="stvp-journal-pagination" id="stvp-journal-pagination" style="display:none;">
                    <button type="button" class="stvp-journal-icon-btn" id="stvp-journal-prev" title="이전 장" aria-label="이전 장"><i class="fa-solid fa-chevron-left"></i></button>
                    <span id="stvp-journal-page-info">1 / 1</span>
                    <button type="button" class="stvp-journal-icon-btn" id="stvp-journal-next" title="다음 장" aria-label="다음 장"><i class="fa-solid fa-chevron-right"></i></button>
                </div>
                <button type="button" class="stvp-journal-btn stvp-journal-btn-danger" id="stvp-journal-clear-all"><i class="fa-solid fa-trash-can"></i> 전체 삭제</button>
            </footer>
        </div>
    </div>`);
    return $overlay();
}

export function updateJournalPetFilter() {
    const select = document.getElementById("stvp-journal-pet-filter");
    if (!select) return;
    const current = select.value || "all";
    const pets = getJournalPetNames();
    const repeated = name => pets.filter(pet => pet.name === name).length > 1;
    select.replaceChildren(new Option("모든 펫", "all"), ...pets.map(({ id, name }) => new Option(repeated(name) ? `${name} · ${id.slice(-6)}` : name, id)));
    select.value = pets.some(pet => pet.id === current) ? current : "all";
}

function photo(entry) {
    const character = characterData(state.settings, entry.characterId) || (entry.characterId === "pet:default" ? {} : null);
    const image = character ? `<img src="${escapeHtml(idleSprite(character))}" alt="" loading="lazy">` : '<i class="fa-solid fa-paw" aria-hidden="true"></i>';
    return `<figure class="stvp-journal-photo">${image}<figcaption>${escapeHtml(entry.petName)}</figcaption></figure>`;
}

const monthKey = timestamp => {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

function highlight(text) {
    const needle = query.toLowerCase();
    if (!needle) return escapeHtml(text);
    const lower = String(text).toLowerCase();
    let out = "", from = 0, at;
    while ((at = lower.indexOf(needle, from)) !== -1) {
        out += escapeHtml(text.slice(from, at)) + `<mark>${escapeHtml(text.slice(at, at + needle.length))}</mark>`;
        from = at + needle.length;
    }
    return out + escapeHtml(text.slice(from));
}

const searchable = entry => [entry.title, entry.content, entry.sleepTalk, entry.afterWake, entry.comment].filter(value => typeof value === "string").join("\n").toLowerCase();

function entryHtml(entry) {
    const date = new Date(entry.timestamp);
    const dream = entry.type === "dream";
    const title = dream
        ? (typeof entry.title === "string" && entry.title.trim()) || "이름 없는 꿈"
        : date.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" });
    const meta = dream
        ? date.toLocaleString("ko-KR", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) + "에 씀";
    const sleepTalk = dream && entry.sleepTalk
        ? `<p class="stvp-journal-sleeptalk"><span>잠꼬대</span>“${highlight(entry.sleepTalk)}”</p>` : "";
    const afterWake = dream && typeof entry.afterWake === "string" && entry.afterWake.trim()
        ? `<div class="stvp-journal-after-wake"><span class="stvp-journal-after-wake-label">깨어난 뒤</span>${highlight(entry.afterWake)}</div>`
        : !dream && typeof entry.comment === "string" && entry.comment.trim()
            ? `<div class="stvp-journal-after-wake stvp-journal-diary-note"><span class="stvp-journal-after-wake-label">마무리 한마디</span>“${highlight(entry.comment)}”</div>` : "";
    return `<article class="stvp-journal-card" data-kind="${dream ? "dream" : "diary"}" data-timestamp="${entry.timestamp}" data-type="${entry.type}">
        ${photo(entry)}
        <div class="stvp-journal-meta"><span class="stvp-journal-stamp">${dream ? '<i class="fa-solid fa-moon"></i> 꿈' : '<i class="fa-solid fa-pen-nib"></i> 일기'}</span><time>${meta}</time></div>
        <h4 class="stvp-journal-entry-title">${highlight(title)}</h4>
        <div class="stvp-journal-card-content">${highlight(entry.content)}</div>
        ${sleepTalk}${afterWake}
        <div class="stvp-journal-actions">
            <button type="button" class="stvp-journal-save-btn" title="이미지로 저장" aria-label="이미지로 저장"><i class="fa-solid fa-camera"></i></button>
            <button type="button" class="stvp-journal-delete-btn" title="이 기록 삭제" aria-label="이 기록 삭제"><i class="fa-solid fa-xmark"></i></button>
        </div>
    </article>`;
}

function updateMonthFilter(entries) {
    const select = document.getElementById("stvp-journal-month");
    const counts = new Map();
    for (const entry of entries) counts.set(monthKey(entry.timestamp), (counts.get(monthKey(entry.timestamp)) || 0) + 1);
    const months = [...counts.keys()].sort().reverse();
    if (monthFilter !== "all" && !counts.has(monthFilter)) monthFilter = "all";
    select.replaceChildren(new Option("모든 날짜", "all"), ...months.map(key => {
        const [year, month] = key.split("-");
        return new Option(`${year}년 ${Number(month)}월 · ${counts.get(key)}`, key);
    }));
    select.value = monthFilter;
}

export function refreshJournalViewer() {
    if (!isOpen()) return;
    const viewer = document.getElementById("stvp-journal-viewer");
    const pet = document.getElementById("stvp-journal-pet-filter")?.value || "all";
    const byKind = getJournalEntries()
        .filter(entry => (pet === "all" || entry.characterId === pet) && (typeFilter === "all" || entry.type === typeFilter))
        .sort((a, b) => b.timestamp - a.timestamp);
    updateMonthFilter(byKind);
    const needle = query.toLowerCase();
    const entries = byKind.filter(entry => (monthFilter === "all" || monthKey(entry.timestamp) === monthFilter)
        && (!needle || searchable(entry).includes(needle)));
    const pager = document.getElementById("stvp-journal-pagination");
    if (!entries.length) {
        viewer.innerHTML = byKind.length
            ? `<div class="stvp-journal-empty"><i class="fa-solid fa-magnifying-glass"></i><strong>찾는 기록이 없습니다</strong><span>다른 날짜나 낱말로 찾아보십시오.</span></div>`
            : `<div class="stvp-journal-empty"><i class="fa-solid fa-feather-pointed"></i><strong>아직 비어 있는 페이지입니다</strong><span>펫이 잠들면 꿈을, ‘일기 쓰기’를 누르면 일기를 남깁니다.</span></div>`;
        pager.style.display = "none";
        page = 1;
        visibleEntries = [];
        return;
    }
    const pages = Math.ceil(entries.length / PAGE_SIZE);
    page = Math.min(Math.max(page, 1), pages);
    visibleEntries = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    viewer.innerHTML = visibleEntries.map(entryHtml).join("");
    viewer.scrollTop = 0;
    pager.style.display = pages > 1 ? "" : "none";
    document.getElementById("stvp-journal-page-info").textContent = `${page} / ${pages}`;
    document.getElementById("stvp-journal-prev").disabled = page <= 1;
    document.getElementById("stvp-journal-next").disabled = page >= pages;
}

export function openJournal() {
    if (["blocked", "conflict", "error"].includes(getStorageStatus().mode)) return;
    page = 1;
    typeFilter = "all";
    monthFilter = "all";
    query = "";
    document.getElementById("stvp-journal-search").value = "";
    $(".stvp-jpopup-tab").removeClass("active").filter('[data-jtype="all"]').addClass("active");
    updateJournalPetFilter();
    $overlay().style.display = "";
    refreshJournalViewer();
}

const closeJournal = () => $($overlay()).fadeOut(150);

async function writeDiary(button) {
    if (!state.settings.petJournal?.diaryEnabled) return alert("일기 쓰기가 꺼져 있습니다. 생활 탭 › 일기장에서 켜 주십시오.");
    const writer = state.settings.petJournal?.diaryWriter || "primary";
    const targets = [];
    if (writer === "primary" || writer === "both") targets.push("primary");
    if ((writer === "secondary" || writer === "both") && state.settings.multiPet?.enabled) targets.push("secondary");
    if (!targets.length) targets.push("primary");

    const label = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 쓰는 중…';
    try {
        const { setState, PET_STATES } = await import("./pet-animation.js");
        const { showSpeechBubble } = await import("./pet-speech.js");
        const written = [];
        for (const petId of targets) {
            const petName = characterName(state.settings, petId);
            const result = await generateDiary(petId);
            if (!result?.diary) continue;
            saveDiary(petName, result.diary, petId, result.comment);
            written.push(petName);
            if (result.comment) {
                setState(result.mood || PET_STATES.HAPPY, 3000, petId);
                showSpeechBubble(result.comment, 8000, true, petId);
            }
        }
        page = 1;
        refreshJournalViewer();
        alert(written.length ? `${written.join(", ")}의 일기를 썼습니다.` : "일기를 쓰지 못했습니다. 대화 기록이 충분한지 확인해 주십시오.");
    } catch (error) {
        log("Diary write error: " + error.message);
        alert("일기를 쓰는 중 오류가 발생했습니다.");
    } finally {
        button.disabled = false;
        button.innerHTML = label;
    }
}

export function bindJournalUI() {
    const overlay = $overlay();
    overlay.addEventListener("click", event => {
        if (event.target === overlay) return closeJournal();
        const button = event.target.closest("button");
        if (!button) return;
        if (button.id === "stvp-journal-popup-close") return closeJournal();
        if (button.id === "stvp-journal-refresh") { updateJournalPetFilter(); return refreshJournalViewer(); }
        if (button.id === "stvp-journal-prev") { page--; return refreshJournalViewer(); }
        if (button.id === "stvp-journal-next") { page++; return refreshJournalViewer(); }
        if (button.id === "stvp-journal-write-diary") return writeDiary(button);
        if (button.id === "stvp-journal-clear-all") {
            if (!confirm("일기장의 모든 기록(꿈 + 일기)을 삭제하시겠습니까?")) return;
            clearJournal();
            page = 1;
            return refreshJournalViewer();
        }
        if (button.classList.contains("stvp-jpopup-tab")) {
            $(".stvp-jpopup-tab").removeClass("active");
            button.classList.add("active");
            typeFilter = button.dataset.jtype;
            page = 1;
            return refreshJournalViewer();
        }
        if (button.classList.contains("stvp-journal-save-btn")) {
            const card = button.closest(".stvp-journal-card");
            const entry = visibleEntries.find(item => String(item.timestamp) === card.dataset.timestamp && item.type === card.dataset.type);
            if (entry) return saveEntryImage(entry, button);
        }
        if (button.classList.contains("stvp-journal-delete-btn")) {
            const card = button.closest(".stvp-journal-card");
            deleteJournalEntry(Number(card.dataset.timestamp), card.dataset.type);
            refreshJournalViewer();
        }
    });
    document.getElementById("stvp-journal-pet-filter").addEventListener("change", () => { page = 1; refreshJournalViewer(); });
    document.getElementById("stvp-journal-month").addEventListener("change", event => { monthFilter = event.target.value; page = 1; refreshJournalViewer(); });
    document.getElementById("stvp-journal-search").addEventListener("input", event => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { query = event.target.value.trim(); page = 1; refreshJournalViewer(); }, 200);
    });
    document.addEventListener("keydown", event => { if (event.key === "Escape" && isOpen()) closeJournal(); });
    document.addEventListener("stvp-journal-updated", () => { updateJournalPetFilter(); refreshJournalViewer(); });
    document.addEventListener("stvp-open-journal", openJournal);
}
