import { MOOD_LABELS, POSITION_PRESETS, BUBBLE_DESIGNS, FONT_LIST, SPEECH_LANGUAGES } from "./constants.js";
import { houseDialogueControls } from "./house-conversation-ui.js";
import {
    row, switchRow, rangeControl, numberControl, selectControl, card, fold, subFold,
    subhead, chip, scopeNote, button, escapeHtml, expandableTextarea, rowPair,
} from "./ui-kit.js";

const TABS = [
    ["pet", "fa-paw", "펫"],
    ["display", "fa-display", "화면"],
    ["ai", "fa-wand-magic-sparkles", "AI"],
    ["life", "fa-house-chimney", "생활"],
    ["data", "fa-box-archive", "데이터"],
];

const SPEECH_GROUPS = [
    ["만날 때", [["greeting", "인사"], ["morning", "아침", "7~10시"], ["latenight", "심야", "0~6시"], ["longAbsence", "오랜만의 접속"]]],
    ["쉬는 중", [["idle", "심심할 때", "5분 동안 입력 없음"], ["sleeping", "잠들 때", "15분 동안 입력 없음"], ["wakeUp", "깨웠을 때", "비우면 말 없이 깹니다"]]],
    ["만질 때", [["click", "눌렀을 때"], ["clickSpam", "연타", "5번 이상"], ["petting", "쓰다듬기", "길게 누르기"], ["dragging", "들어 올릴 때"]]],
    ["밥", [["feeding", "밥 먹을 때"], ["hungry", "배고플 때"]]],
    ["두 펫", [["collision", "부딪혔을 때"]]],
];

const BACKUP_LABELS = {
    presets: "저장된 프리셋", activeSettings: "현재 펫·화면·AI 설정과 이미지",
    customSpeeches: "커스텀 대사", logs: "AI 대화 기록", journals: "꿈과 일기",
    reminders: "알림", memos: "개인 메모", house: "펫하우스", otherData: "조합별 관계 등 기타",
};

const options = entries => entries.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
const positionOptions = () => options(Object.entries(POSITION_PRESETS).map(([id, data]) => [id, data.name]));
const DAYS = [["1", "월"], ["2", "화"], ["3", "수"], ["4", "목"], ["5", "금"], ["6", "토"], ["0", "일"]];

function spriteItem({ id, label, previewId, fileId, urlAttrs, clearAttrs, mood }) {
    return `<div class="stvp-sprite-item"${id ? ` id="${id}"` : ""}${mood ? ` data-mood="${mood}"` : ""}>
        <div class="stvp-sprite-preview" id="${previewId}" role="button" tabindex="0" aria-label="${label} 이미지 올리기"><span class="stvp-sprite-placeholder">+</span></div>
        <span class="stvp-sprite-label">${label}</span>
        <input type="file" id="${fileId}" accept="image/*,.gif,.webp" hidden>
        <div class="stvp-sprite-buttons">
            <button type="button" class="stvp-sprite-url" ${urlAttrs} title="주소로 넣기" aria-label="${label} 이미지 주소로 넣기"><i class="fa-solid fa-link"></i></button>
            <button type="button" class="stvp-sprite-clear" ${clearAttrs} title="지우기" aria-label="${label} 이미지 지우기" style="display:none;"><i class="fa-solid fa-xmark"></i></button>
        </div>
    </div>`;
}

function hero() {
    return `<div class="stvp-hero">
        <span class="stvp-hero-mark" aria-hidden="true"><i class="fa-solid fa-paw"></i></span>
        <div class="stvp-hero-text">
            <strong class="stvp-hero-title">사이펫</strong>
            <small id="stvp-hero-status" class="stvp-hero-status"></small>
        </div>
        <input type="checkbox" class="stvp-switch stvp-switch-lg" id="stvp-enabled" aria-label="사이펫 켜기">
    </div>
    <div id="stvp-storage-status" class="stvp-storage" role="status"></div>`;
}

function tabs() {
    return `<nav class="stvp-tabs" role="tablist" aria-label="사이펫 설정">${TABS.map(([id, icon, label], index) =>
        `<button type="button" class="stvp-tab${index ? "" : " active"}" role="tab" data-tab="${id}" aria-selected="${!index}"><i class="fa-solid ${icon}"></i><span>${label}</span></button>`).join("")}</nav>`;
}

function petTab() {
    const sprites = Object.entries(MOOD_LABELS).map(([mood, label]) => spriteItem({
        mood, label, previewId: `stvp-preview-${mood}`, fileId: `stvp-file-${mood}`,
        urlAttrs: `data-mood="${mood}"`, clearAttrs: `data-mood="${mood}"`,
    })).join("");
    const walkSprites = [["stvp-walk", "걷기 1"], ["stvp-walk2", "걷기 2"]].map(([prefix, label]) => spriteItem({
        id: `${prefix}-sprite-item`, label, previewId: `${prefix}-preview`, fileId: `${prefix}-sprite-file`,
        urlAttrs: `id="${prefix}-sprite-url"`, clearAttrs: `id="${prefix}-sprite-clear"`,
    })).join("");
    const speeches = SPEECH_GROUPS.map(([title, items]) => subhead(title) + `<div class="stvp-speech-grid">${items.map(([mood, label, hint]) =>
        `<label class="stvp-speech-item"><span class="stvp-speech-label">${label}${hint ? `<small>${hint}</small>` : ""}</span><textarea id="stvp-speech-${mood}" class="stvp-input stvp-speech-textarea" rows="2" placeholder="한 줄에 하나씩" data-mood="${mood}"></textarea></label>`).join("")}</div>`).join("");
    return `<div class="stvp-tab-content active" data-tab="pet" role="tabpanel">
        <div class="stvp-pet-tabs" role="tablist" aria-label="관리할 펫">
            <button type="button" class="stvp-pet-tab active" role="tab" aria-selected="true" aria-controls="stvp-character-editor" data-pet="primary"></button>
            <button type="button" class="stvp-pet-tab" role="tab" aria-selected="false" aria-controls="stvp-character-editor" data-pet="secondary"></button>
        </div>
        ${card({ id: "stvp-slot-controls", icon: "fa-location-dot", tint: "pet", title: "펫 위치", chip: chip("프리셋과 별개"),
            tip: "프리셋을 불러와도 표시 여부와 위치는 바뀌지 않습니다.",
            body: switchRow("stvp-slot-enabled", "이 자리에 펫 표시")
                + row("PC·태블릿 위치", selectControl("stvp-position", positionOptions()))
                + row("스마트폰 위치", selectControl("stvp-mobile-position", positionOptions()), { attrs: 'data-slot-position="primary"' })
                + row("스마트폰 위치", selectControl("stvp-mobile-second-position", positionOptions()), { attrs: 'data-slot-position="secondary"' }) })}
        ${card({ icon: "fa-bookmark", tint: "pet", title: "프리셋",
            tip: "<b>불러오기</b> 고른 프리셋을 이 자리에 적용합니다.<br><b>현재 프리셋 덮어쓰기</b> 아래에서 고친 내용으로 지금 프리셋을 덮어씁니다. 누르기 전까지는 화면의 펫에만 적용됩니다.<br><b>새 프리셋으로 저장</b> 지금 모습을 새 프리셋으로 보관합니다.",
            body: `<div id="stvp-preset-status" class="stvp-preset-status" role="status"></div>
                <div class="stvp-field">${selectControl("stvp-preset-select", '<option value="">-- 선택 --</option>', 'aria-label="저장된 프리셋"')}</div>
                <div id="stvp-preset-preview" class="stvp-preset-preview" aria-live="polite" hidden></div>
                <div class="stvp-btn-row">
                    ${button("stvp-preset-load", "불러오기", { icon: "fa-folder-open", tone: "primary" })}
                    ${button("stvp-preset-update", "현재 프리셋 덮어쓰기", { icon: "fa-arrows-rotate" })}
                </div>
                ${button("stvp-preset-save", "새 프리셋으로 저장", { icon: "fa-plus", tone: "block" })}
                ${subFold("공유 · 가져오기 · 삭제", `
                    <div class="stvp-btn-row">
                        ${button("stvp-preset-export", "내보내기", { icon: "fa-file-export" })}
                        ${button("stvp-preset-import", "가져오기", { icon: "fa-file-import" })}
                        ${button("stvp-preset-delete", "삭제", { icon: "fa-trash-can", tone: "danger" })}
                    </div>
                    <input type="file" id="stvp-preset-import-file" accept=".json,.zip" hidden>
                    <div id="stvp-import-preview" class="stvp-preset-preview" hidden>
                        <img id="stvp-import-preview-image" alt="가져올 프리셋 이미지">
                        <div><strong id="stvp-import-preview-name"></strong><small id="stvp-import-preview-info"></small>
                            ${button("stvp-import-confirm", "이 프리셋 가져오기", { tone: "primary" })}</div>
                    </div>
                    <ul class="stvp-share-info">
                        <li><b>포함</b> 이름 · 성격 · 관계 · 이미지 · 말풍선 · 대사</li>
                        <li><b>제외</b> 유저 정보 · 개인 메모 · API · 기록</li>
                    </ul>`)}` })}
        <div id="stvp-character-editor" role="tabpanel" aria-label="첫 번째 펫 설정">
            ${scopeNote("fa-bookmark", "아래 설정은 선택한 펫에만 적용되며 프리셋에 함께 저장됩니다.")}
            ${fold({ icon: "fa-id-card", tint: "pet", title: "캐릭터 정보", open: true, cls: "stvp-character-section", body:
                row("이름", '<input type="text" id="stvp-pet-name" class="stvp-input" placeholder="냥이">', { stack: true, forId: "stvp-pet-name" })
                + row("성격 · 말투", expandableTextarea("stvp-personality-prompt", { rows: 7, title: "성격 · 말투", placeholder: "성격, 말투, 배경을 자유롭게 적어 주십시오" }), { stack: true, forId: "stvp-personality-prompt" })
                + row("국가 · 문화 배경", '<input type="text" id="stvp-cultural-background" class="stvp-input" placeholder="예: 미국 뉴욕 출신 / 가상의 왕국">', { stack: true, forId: "stvp-cultural-background",
                    tip: "대사 언어와 별개로 생활 방식, 음식, 호칭 같은 문화를 반영합니다. 비워 두면 따로 지시하지 않습니다." })
                + subhead("유저 정보", "비워 두면 펫이 ‘주인님’이라고 부릅니다.")
                + row("펫과의 관계", '<input type="text" id="stvp-user-relation" class="stvp-input" placeholder="예: 주인, 친구, 동거인 (비우면 주인)">', { stack: true, forId: "stvp-user-relation" })
                + row("유저 이름", '<input type="text" id="stvp-owner-name" class="stvp-input" placeholder="펫이 부를 이름 (비우면 주인님)">', { stack: true, forId: "stvp-owner-name" })
                + row("유저 설명", expandableTextarea("stvp-owner-persona", { rows: 5, title: "유저 설명", placeholder: "펫이 알고 있을 유저 정보 (선택)" }), { stack: true, forId: "stvp-owner-persona" })
 })}
            ${fold({ icon: "fa-image", tint: "pet", title: "외형 · 이미지", cls: "stvp-character-section", body:
                switchRow("stvp-flip", "좌우 반전")
                + row("크기 비율", numberControl("stvp-character-scale", { min: 40, max: 180, step: 5, unit: "%" }),
                    { tip: "화면 탭의 기본 크기에 곱해집니다. 예: 200px × 80% = 160px" })
                + subhead("기분별 이미지", "칸을 눌러 올리거나 <i class=\"fa-solid fa-link\"></i>로 주소를 넣습니다. 비워 두면 기본 이미지를 사용합니다.<br>정지 이미지는 1024px·4MB에 맞춰 줄이고, 움직이는 GIF·WebP는 12MB까지 그대로 저장합니다.")
                + `<div class="stvp-sprite-grid">${sprites}</div>`
                + subhead("걷는 모습")
                + row("표시 방식", selectControl("stvp-walk-mode", [["motion", "이미지 1장 · 살짝 흔들기"], ["frames", "이미지 2장 · 번갈아 보이기"]]))
                + `<div class="stvp-sprite-grid stvp-walk-grid">${walkSprites}</div><p id="stvp-walk-hint" class="stvp-hint"></p>` })}
            ${fold({ icon: "fa-comment", tint: "pet", title: "말풍선", cls: "stvp-character-section", body:
                row("디자인", `<div class="stvp-design-picker" id="stvp-bubble-design" role="radiogroup" aria-label="말풍선 디자인">${Object.entries(BUBBLE_DESIGNS).map(([id, d]) =>
                    `<button type="button" class="stvp-design-card" role="radio" aria-checked="false" tabindex="-1" data-design="${id}"><span class="stvp-bubble-preview stvp-design-mini" data-design="${id}" aria-hidden="true"><span class="st-pet-bubble show"><span class="st-pet-bubble-text">안녕!</span></span></span><span class="stvp-design-name">${d.name.replace(/^\S+\s/, "")}</span></button>`).join("")}</div>`, { stack: true })
                + row("글꼴", selectControl("stvp-bubble-font", options(FONT_LIST.map(f => [f.id, f.name]))))
                + '<div class="stvp-bubble-preview" id="stvp-bubble-preview" data-design="simple"><span class="st-pet-bubble show"><span class="st-pet-bubble-text" id="stvp-font-preview" aria-live="polite"></span></span></div>'
                + subhead("색상", "강조색은 배고픔 게이지, 버튼, 입력창 테두리에 쓰입니다.")
                + `<div class="stvp-colors">${[["stvp-bubble-bg", "배경", "#ffffff"], ["stvp-bubble-text-color", "글자", "#333333"], ["stvp-bubble-accent-color", "강조", "#7c9bff"]]
                    .map(([id, label, value]) => `<label class="stvp-color"><input type="color" id="${id}" value="${value}"><span>${label}</span></label>`).join("")}</div>`
                + `<div class="stvp-colors-reset">${button("stvp-bubble-design-colors", "디자인 기본 색", { icon: "fa-palette", tone: "ghost", attrs: 'title="고른 디자인의 기본 색으로 되돌립니다"' })}</div>` })}
            ${fold({ icon: "fa-quote-left", tint: "pet", title: "상황별 대사", cls: "stvp-character-section",
                tip: "비워 두면 기본 대사를 사용합니다. 한 줄에 하나씩 적으면 그중에서 골라 말합니다.", body:
                speeches
                + subhead("AI 응답이 실패했을 때")
                + row("답이 비었을 때", '<input type="text" id="stvp-fallback-no-response" class="stvp-input" placeholder="...뭐라고?">', { stack: true, forId: "stvp-fallback-no-response" })
                + row("API 오류일 때", '<input type="text" id="stvp-fallback-api-error" class="stvp-input" placeholder="...잘 안 들렸어.">', { stack: true, forId: "stvp-fallback-api-error" }) })}
        </div>
        ${fold({ id: "stvp-pair-settings", icon: "fa-heart", tint: "point", title: "두 펫의 관계", titleId: "stvp-pair-title", open: true,
            chip: chip("이 조합에 저장", "point"), attrs: "hidden",
            tip: "두 캐릭터 조합마다 따로 저장됩니다. 두 펫의 자리를 바꿔도 유지됩니다.", body:
            switchRow("stvp-social-enabled", "함께 어울리기", { desc: "API 없이 서로 다가가 반응합니다" })
            + row("관계", selectControl("stvp-visual-relation", [["friends", "친구"], ["lovers", "연인"], ["family", "가족"], ["rivals", "라이벌"], ["neutral", "아는 사이"]]))
            + row("동작 미리보기", `${selectControl("stvp-social-action", '<option value="">랜덤</option>')}${button("stvp-social-preview", "", { icon: "fa-play", tone: "icon", attrs: 'title="지금 반응 보기" aria-label="지금 반응 보기"' })}`)
            + subhead("AI 대화")
            + row("둘의 관계 설명", '<textarea id="stvp-multi-pet-relation" class="stvp-input" rows="3" placeholder="캐릭터 이름으로 둘의 관계를 적어 주십시오"></textarea>', { stack: true, forId: "stvp-multi-pet-relation" })
            + switchRow("stvp-multi-dual-talk", "말 걸면 둘 다 대답", { desc: "API 한 번으로 두 펫이 함께 답합니다" })
            + switchRow("stvp-multi-interpet-enabled", "둘이 알아서 대화", { desc: "정한 간격마다 API를 사용합니다" })
            + row("대화 간격", rangeControl("stvp-multi-interpet-interval", { min: 3, max: 30, unit: "분" })) })}
    </div>`;
}

function displayTab() {
    return `<div class="stvp-tab-content" data-tab="display" role="tabpanel">
        ${scopeNote("fa-users", "두 펫 모두에 적용됩니다. 프리셋을 바꿔도 유지됩니다.")}
        ${card({ icon: "fa-display", tint: "display", title: "표시할 기기", body:
            rowPair(switchRow("stvp-pc-enabled", "PC · 태블릿"), switchRow("stvp-mobile-enabled", "스마트폰")) })}
        ${card({ icon: "fa-up-right-and-down-left-from-center", tint: "display", title: "크기 · 투명도", body:
            row("기본 크기", numberControl("stvp-size", { min: 20, max: 500, unit: "px" }), { tip: "PC에서 모든 펫에 적용됩니다. 펫마다 비율은 펫 탭 › 외형에서 따로 정합니다." })
            + row("투명도", rangeControl("stvp-opacity", { min: 10, max: 100, step: 5, unit: "%" }), { desc: "마우스를 올리면 선명해집니다" }) })}
        ${card({ icon: "fa-comment-dots", tint: "display", title: "말풍선", body:
            switchRow("stvp-bubble-enabled", "말풍선 보이기")
            + row("보이는 시간", numberControl("stvp-bubble-duration", { min: 1, max: 30, step: 0.5, unit: "초" }))
            + row("최대 너비", rangeControl("stvp-bubble-max-width", { min: 120, max: 600, step: 10, unit: "px" })) })}
        ${card({ icon: "fa-person-walking", tint: "display", title: "움직임", body:
            switchRow("stvp-draggable", "끌어서 옮기기")
            + switchRow("stvp-walk-enabled", "걸어 다니기", { desc: "잠잘 때와 들고 있을 때는 멈춥니다" })
            + row("이동 범위", selectControl("stvp-walk-direction", [["nearby", "주변"], ["horizontal", "좌우로만"], ["vertical", "위아래로만"], ["screen", "화면 전체"]]),
                { tip: "<b>주변</b> 지금 위치 근처를 돌아다닙니다.<br><b>좌우 · 위아래</b> 지금 위치에서 한 방향으로만 걷습니다.<br><b>화면 전체</b> 범위 제한 없이 돌아다닙니다.<br>어느 설정에서든 손으로 끌어 옮길 수 있습니다." })
            + switchRow("stvp-collision-reaction", "부딪히면 반응", { desc: "끄면 서로 겹쳐 지나갑니다" }) })}
        ${fold({ id: "stvp-mobile-controls", icon: "fa-mobile-screen", tint: "display", title: "스마트폰 전용", body:
            row("펫 크기", numberControl("stvp-mobile-size", { min: 0, max: 240, step: 5, unit: "px" }), { desc: "0이면 자동 (110~160px)" })
            + row("걷는 범위", rangeControl("stvp-mobile-walk-range", { min: 0, max: 160, step: 10, unit: "px" }))
            + row("걷기", selectControl("stvp-mobile-walk-enabled", [["inherit", "PC와 같게"], ["on", "켜기"], ["off", "끄기"]]))
            + row("대사", selectControl("stvp-mobile-speech-enabled", [["inherit", "PC와 같게"], ["on", "켜기"], ["off", "끄기"]]))
            + row("대사 표시", selectControl("stvp-mobile-speech-mode", [["bar", "상단 바"], ["bubble", "말풍선"]]),
                { tip: "<b>상단 바</b> 화면 위에 한 줄로 표시합니다. 긴 대사는 잠시 멈췄다가 흘러갑니다.<br><b>말풍선</b> PC처럼 펫 위에 표시합니다.<br>대화 기록에는 AI 대사만 남습니다." }) })}
    </div>`;
}

function aiTab(profileOptions) {
    const memoDays = DAYS.map(([day, label]) => `<button type="button" class="stvp-memo-day-btn stvp-day" data-day="${day}">${label}</button>`).join("");
    const days = DAYS.map(([day, label]) => `<button type="button" class="stvp-day-btn stvp-day" data-day="${day}">${label}</button>`).join("");
    return `<div class="stvp-tab-content" data-tab="ai" role="tabpanel">
        ${scopeNote("fa-users", "두 펫 모두에 적용됩니다.")}
        ${card({ id: "stvp-api-section", icon: "fa-plug", tint: "ai", title: "API 연결",
            tip: "말 걸기, 채팅 반응, 펫끼리 대화, 꿈·일기, 알림이 모두 이 연결을 사용합니다.<br>Vertex AI는 global 리전으로 요청하며, 인증 정보는 연결 프로필이나 현재 API 설정을 따릅니다.", body:
            switchRow("stvp-use-cm", "Connection Manager 사용", { desc: "끄면 지금 실리태번에 연결된 API를 사용합니다" })
            + row("연결 프로필", selectControl("stvp-cm-profile", profileOptions), { attrs: 'id="stvp-cm-profile-row"' })
            + rowPair(row("최대 출력 토큰", numberControl("stvp-max-tokens", { min: 0 }), { desc: "0이면 프리셋 설정" }),
                row("최대 입력 토큰", numberControl("stvp-max-input-tokens", { min: 0 }), { desc: "0이면 프리셋 설정",
                    tip: "0이면 프리셋 컨텍스트 크기에서 출력 토큰을 뺀 만큼을 사용합니다. 모델의 실제 한도는 그대로 적용됩니다." }))
            + '<div id="stvp-api-status" class="stvp-notice" data-tone="warn" role="status" hidden></div>' })}
        ${card({ icon: "fa-language", tint: "ai", title: "대사 언어", body:
            row("AI 대사 언어", selectControl("stvp-speech-language", options(Object.entries(SPEECH_LANGUAGES).map(([id, d]) => [id, d.label]))),
                { tip: "AI가 만드는 대사의 언어입니다. 캐릭터의 문화 배경은 펫 탭 › 캐릭터 정보에서 정합니다." }) })}
        ${card({ icon: "fa-comments", tint: "ai", title: "채팅 자동 반응",
            tip: "켜면 채팅 메시지를 읽고 펫이 알아서 한마디 합니다.<br>꺼도 말 걸기·펫끼리 대화·꿈·일기·알림은 각자 설정대로 동작합니다.", body:
            switchRow("stvp-ai-enabled", "채팅 보고 반응하기", { desc: "반응할 때마다 API를 추가로 사용합니다" })
            + `<div id="stvp-ai-settings" class="stvp-row-group">
                ${row("반응 간격", rangeControl("stvp-reaction-interval", { min: 1, max: 10, unit: "번째마다" }), { desc: "메시지 기준" })}
                ${row("반응 방식", selectControl("stvp-reaction-mode", [["observer", "관전자 · 옆에서 감상"], ["character", "속마음 · 캐릭터의 내면"]]))}
                ${row("반응할 펫", selectControl("stvp-multi-chat-reactor", [["primary", "첫 번째"], ["secondary", "두 번째"], ["alternate", "번갈아"]]), { desc: "한 마리만 켜져 있으면 그 펫이 반응합니다" })}
                ${row("함께 볼 메시지", rangeControl("stvp-history-count", { min: 1, max: 20, unit: "개" }))}
                ${switchRow("stvp-include-worldinfo", "월드인포 함께 보내기")}
            </div>` })}
        ${card({ icon: "fa-brain", tint: "ai", title: "기억",
            tip: "펫이 답할 때 참고할 지난 대화 수입니다.<br>입력 토큰 한도를 넘으면 오래된 기록부터 제외하고, 캐릭터 설정과 개인 메모는 항상 포함합니다.", body:
            rowPair(row("직접 대화", numberControl("stvp-direct-memory-count", { min: 0, unit: "건" }), { desc: "펫마다 최근 · 0이면 전체" }),
                row("펫끼리 대화", numberControl("stvp-pair-memory-count", { min: 0, unit: "건" }), { desc: "펫마다 최근 · 0이면 전체" }))
            + switchRow("stvp-time-aware", "기억에 날짜·시간 반영", { desc: "끄면 AI에 날짜와 시간을 보내지 않습니다" }) })}
        ${card({ id: "stvp-memo-card", icon: "fa-note-sticky", tint: "pet", title: "개인 메모", chip: chip("펫마다 따로"),
            tip: "펫이 대화할 때 자연스럽게 참고합니다. 날짜나 반복 요일을 정하면 그날에 맞춰 챙깁니다. 프리셋 공유 파일에는 들어가지 않습니다.", body:
            '<div class="stvp-segment stvp-memo-pets" id="stvp-memo-pets" role="group" aria-label="메모를 볼 펫"><button type="button" data-pet="primary"></button><button type="button" data-pet="secondary"></button></div>'
            + `<div id="stvp-memo-list" class="stvp-memo-list"></div>
                <div class="stvp-memo-add">
                    <div class="stvp-inline">
                        <input type="text" id="stvp-memo-content-input" class="stvp-input" placeholder="예: 금요일 병원 예약" aria-label="메모 내용">
                        <button type="button" id="stvp-memo-add-btn" class="stvp-btn stvp-btn-primary stvp-btn-icon" title="메모 추가" aria-label="메모 추가"><i class="fa-solid fa-plus"></i></button>
                    </div>
                    <div class="stvp-inline">
                        ${selectControl("stvp-memo-tag-select", [["메모", "메모"], ["일정", "일정"], ["건강", "건강"], ["운동", "운동"], ["기타", "기타"]], 'aria-label="메모 종류"')}
                        <input type="date" id="stvp-memo-date-input" class="stvp-input" title="날짜 (선택)" aria-label="날짜 (선택)">
                    </div>
                    <div class="stvp-memo-days-row" id="stvp-memo-days-row" style="display:none;"><small>매주 반복</small>${memoDays}</div>
                </div>` })}
        ${card({ icon: "fa-bell", tint: "alarm", title: "알림", chip: chip("알림마다 API 1회"),
            tip: "정한 시간에 펫이 캐릭터답게 알려 줍니다. 최대 10개까지 등록할 수 있습니다.", body:
            `<div id="stvp-reminder-list" class="stvp-reminder-list"></div>
            <div class="stvp-reminder-form" id="stvp-reminder-form" style="display:none;">
                <input type="hidden" id="stvp-reminder-edit-id" value="">
                <div class="stvp-segment" role="group" aria-label="알림 방식">
                    <button type="button" class="stvp-reminder-mode-btn active" data-mode="time"><i class="fa-solid fa-clock"></i> 정해진 시각</button>
                    <button type="button" class="stvp-reminder-mode-btn" data-mode="interval"><i class="fa-solid fa-arrows-rotate"></i> 일정 간격</button>
                </div>
                <select id="stvp-reminder-mode" hidden><option value="time">시각 지정</option><option value="interval">반복 간격</option></select>
                <div id="stvp-reminder-time-section">
                    <div class="stvp-inline">
                        <input type="time" id="stvp-reminder-time" class="stvp-input stvp-reminder-time-input" aria-label="알림 시각">
                        <input type="text" id="stvp-reminder-message" class="stvp-input" placeholder="예: 약 먹기, 스트레칭" maxlength="50" aria-label="알림 내용">
                    </div>
                    <div class="stvp-day-buttons">${days}</div>
                    <div class="stvp-day-presets">
                        <button type="button" class="stvp-day-preset" data-preset="daily">매일</button>
                        <button type="button" class="stvp-day-preset" data-preset="weekdays">평일</button>
                        <button type="button" class="stvp-day-preset" data-preset="weekend">주말</button>
                        <button type="button" class="stvp-day-preset" data-preset="once">한 번만</button>
                    </div>
                </div>
                <div id="stvp-reminder-interval-section" style="display:none;">
                    <div class="stvp-inline">
                        <input type="number" id="stvp-reminder-interval-min" class="stvp-input stvp-reminder-interval" min="10" max="240" step="5" value="30" aria-label="간격 (분)">
                        <span class="stvp-unit">분마다</span>
                        <input type="text" id="stvp-reminder-interval-message" class="stvp-input" placeholder="예: 물 마시기" maxlength="50" aria-label="알림 내용">
                    </div>
                    <small class="stvp-hint">접속해 있는 동안 간격마다 알립니다. 다시 접속하면 처음부터 셉니다.</small>
                </div>
                <div class="stvp-btn-row">
                    <button type="button" class="stvp-btn stvp-btn-primary" id="stvp-reminder-confirm"><i class="fa-solid fa-check"></i><span id="stvp-reminder-confirm-label">추가</span></button>
                    <button type="button" class="stvp-btn" id="stvp-reminder-cancel"><span>취소</span></button>
                </div>
            </div>
            ${button("stvp-reminder-add-btn", "알림 추가", { icon: "fa-plus", tone: "dashed" })}`
            + row("알려줄 펫", selectControl("stvp-reminder-pet-id", [["primary", "첫 번째"], ["secondary", "두 번째"]]))
            + switchRow("stvp-reminder-sound", "효과음", { desc: "페이지를 한 번 누른 뒤부터 소리가 납니다" }) })}
    </div>`;
}

function lifeTab() {
    return `<div class="stvp-tab-content" data-tab="life" role="tabpanel">
        ${card({ icon: "fa-house-chimney", tint: "house", title: "펫하우스", cls: "stvp-feature", body:
            `<div class="stvp-feature-intro"><p>프리셋 캐릭터를 최대 4명까지 방에 모아 지켜볼 수 있습니다.</p>${button("stvp-house-open", "방 열기", { icon: "fa-door-open", tone: "house" })}</div>`
            + houseDialogueControls() })}
        ${card({ icon: "fa-book-open", tint: "diary", title: "일기장", cls: "stvp-feature", body:
            `<div class="stvp-feature-intro"><p>잠든 사이 꾼 꿈과 하루를 정리한 일기가 모입니다.</p>${button("stvp-open-journal-popup", "일기장 열기", { icon: "fa-book-open", tone: "diary" })}</div>`
            + switchRow("stvp-journal-dream-enabled", "꿈 꾸기", { desc: "잠든 동안 API로 꿈을 만들어 기록합니다" })
            + row("하루 최대 꿈", rangeControl("stvp-journal-max-dreams", { min: 0, max: 10, unit: "번" }), { desc: "0이면 제한 없음" })
            + switchRow("stvp-journal-diary-enabled", "일기 쓰기")
            + `<div id="stvp-auto-diary-section" class="stvp-row-group" style="display:none;">
                ${row("일기 쓸 펫", selectControl("stvp-diary-writer", [["primary", "첫 번째만"], ["secondary", "두 번째만"], ["both", "둘 다"]]))}
                ${switchRow("stvp-auto-diary-enabled", "자동 일기", { desc: "아래 조건을 채우면 하루 한 번 알아서 씁니다", tip: "접속 시간이 0이면 대화 횟수만 봅니다." })}
                ${row("최소 대화", rangeControl("stvp-auto-diary-min-chats", { min: 1, max: 20, unit: "번" }))}
                ${row("최소 접속 시간", numberControl("stvp-auto-diary-minutes", { min: 0, unit: "분" }))}
            </div>` })}
        ${card({ icon: "fa-clock-rotate-left", tint: "neutral", title: "대화 기록",
            tip: `펫은 <b>자기가 참여한 대화만</b> 기억합니다.<br>직접 대화는 <b id="stvp-direct-memory-summary">최근 30건</b>, 펫끼리 대화는 <b id="stvp-pair-memory-summary">최근 15건</b>을 참고합니다. AI 탭 › 기억에서 바꿀 수 있습니다.<br>알림 기록은 대화에 참고하지 않습니다.`, body:
            `<div class="stvp-inline">
                ${selectControl("stvp-log-filter", [["all", "전체"], ["direct", "직접 대화"], ["interPet", "펫끼리 대화"], ["house", "펫하우스 대화"], ["notification", "알림"], ["chat", "이 채팅방 반응"]], 'aria-label="기록 종류"')}
                <button type="button" class="stvp-btn stvp-btn-icon" id="stvp-log-refresh" title="새로고침" aria-label="새로고침"><i class="fa-solid fa-arrows-rotate"></i></button>
            </div>
            <div id="stvp-log-viewer" class="stvp-log-viewer"></div>
            <div class="stvp-pager" id="stvp-log-pagination" style="display:none;">
                <button type="button" class="stvp-btn stvp-btn-icon" id="stvp-log-prev" title="이전 페이지" aria-label="이전 페이지"><i class="fa-solid fa-chevron-left"></i></button>
                <span id="stvp-log-page-info">1 / 1</span>
                <button type="button" class="stvp-btn stvp-btn-icon" id="stvp-log-next" title="다음 페이지" aria-label="다음 페이지"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
            ${subFold("기록 지우기", `<div class="stvp-btn-grid">
                ${button("stvp-log-clear-direct", "직접 대화", { icon: "fa-trash-can", tone: "danger-ghost" })}
                ${button("stvp-log-clear-chat", "이 채팅방 반응", { icon: "fa-trash-can", tone: "danger-ghost" })}
                ${button("stvp-log-clear-notification", "알림", { icon: "fa-trash-can", tone: "danger-ghost" })}
                ${button("stvp-log-clear-all", "전부", { icon: "fa-trash-can", tone: "danger" })}
            </div>`)}` })}
    </div>`;
}

function dataTab(backupCategories) {
    return `<div class="stvp-tab-content" data-tab="data" role="tabpanel">
        ${card({ id: "stvp-storage-card", icon: "fa-hard-drive", tint: "data", title: "저장 공간",
            chip: `<button type="button" class="stvp-btn stvp-btn-ghost stvp-btn-icon stvp-usage-refresh" id="stvp-usage-refresh" title="다시 계산" aria-label="다시 계산"><i class="fa-solid fa-arrows-rotate"></i></button>`,
            tip: "사이펫 데이터는 실리태번 사용자 폴더의 user/files 안에 saipet_로 시작하는 파일로 저장됩니다. 대부분은 이미지입니다.", body:
            `<div class="stvp-save-state" id="stvp-save-state" role="status"><span class="stvp-dot"></span><span></span></div>
            <div class="stvp-usage" id="stvp-usage" hidden>
                <div class="stvp-usage-total"><strong id="stvp-usage-total"></strong><small id="stvp-usage-quota"></small></div>
                <div class="stvp-usage-bar" id="stvp-usage-bar" aria-hidden="true"></div>
                <ul class="stvp-usage-legend" id="stvp-usage-legend"></ul>
            </div>
            <p class="stvp-hint" id="stvp-usage-note"></p>` })}
        ${card({ icon: "fa-box-archive", tint: "data", title: "백업", body:
            `<p class="stvp-hint">개인 메모와 AI 기록까지 담는 개인용 백업입니다. 다른 사람과 나눌 때는 펫 탭 › 프리셋 › 내보내기를 사용하십시오.</p>
            <div id="stvp-backup-categories" class="stvp-check-grid">${backupCategories.map(id =>
                `<label class="stvp-check"><input type="checkbox" data-category="${id}" checked><span>${escapeHtml(BACKUP_LABELS[id] || id)}</span></label>`).join("")}</div>
            <div class="stvp-btn-row">
                ${button("stvp-backup-select-all", "모두 선택", { icon: "fa-check-double" })}
                ${button("stvp-backup-export", "백업 파일 받기", { icon: "fa-download", tone: "primary" })}
            </div>
            ${subFold("백업에서 복원", `
                <label class="stvp-file"><input type="file" id="stvp-backup-file" accept=".json,.zip"><span><i class="fa-solid fa-file-zipper"></i> 백업 파일 고르기</span></label>
                ${row("복원 방식", selectControl("stvp-backup-mode", [["merge", "지금 내용과 합치기"], ["replace", "고른 항목 덮어쓰기"]]))}
                ${button("stvp-backup-preview", "무엇이 바뀌는지 미리보기", { icon: "fa-eye", tone: "block" })}
                <div id="stvp-backup-preview-result" class="stvp-data-result" role="status"></div>
                ${button("stvp-backup-restore", "미리본 대로 복원", { icon: "fa-rotate-left", tone: "primary", attrs: "disabled" })}`)}
            ${subFold("복원하기 전으로 되돌리기", `
                <div class="stvp-inline">${button("stvp-history-refresh", "기록 불러오기", { icon: "fa-list" })}${selectControl("stvp-history-select", "", 'aria-label="되돌릴 시점"')}</div>
                ${button("stvp-history-restore", "고른 시점으로 되돌리기", { icon: "fa-clock-rotate-left", tone: "block" })}`)}` })}
        ${card({ icon: "fa-images", tint: "data", title: "이미지 정리",
            tip: "사용 중인 이미지는 건드리지 않습니다.<br>새로 올린 이미지는 24시간 동안 보호되고, 정리한 이미지는 7일 동안 휴지통에서 되살릴 수 있습니다.", body:
            `${button("stvp-image-scan", "안 쓰는 이미지 찾기", { icon: "fa-magnifying-glass", tone: "block" })}
            <div id="stvp-image-used-summary" class="stvp-used-summary" hidden></div>
            <div id="stvp-image-unused-list" class="stvp-data-result stvp-image-list" role="status"></div>
            ${button("stvp-image-cleanup", "고른 이미지 휴지통으로", { icon: "fa-trash-can", tone: "block", attrs: "disabled" })}
            ${subFold("이미지 휴지통", `
                ${button("stvp-image-trash-refresh", "휴지통 열기", { icon: "fa-trash-arrow-up", tone: "block" })}
                <div id="stvp-image-trash-list" class="stvp-data-result stvp-image-list"></div>
                <div class="stvp-btn-row">
                    ${button("stvp-image-trash-select-all", "모두 선택", { icon: "fa-check-double" })}
                    ${button("stvp-image-trash-restore", "되살리기", { icon: "fa-rotate-left" })}
                    ${button("stvp-image-trash-purge", "7일 지난 것 영구 삭제", { icon: "fa-fire", tone: "danger" })}
                </div>`)}` })}
        ${fold({ id: "stvp-reset-drawer", icon: "fa-triangle-exclamation", tint: "danger", title: "초기화", cls: "stvp-danger-zone", body:
            row("범위", selectControl("stvp-reset-scope", [["settings", "설정만 (프리셋·기록 유지)"], ["presets", "프리셋 보관함만"], ["all", "전부 (모든 데이터)"]], 'aria-label="초기화 범위"'), { stack: true })
            + button("stvp-reset-all", "선택한 범위 초기화", { icon: "fa-triangle-exclamation", tone: "danger", attrs: 'title="되돌릴 수 없습니다"' }) })}
    </div>`;
}

export function settingsMarkup({ profileOptions, backupCategories }) {
    return `
    <div id="saipet-settings" class="extension_settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><i class="fa-solid fa-paw"></i> 사이펫</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="stvp-panel">
                    ${hero()}
                    ${tabs()}
                    ${petTab()}
                    ${displayTab()}
                    ${aiTab(profileOptions)}
                    ${lifeTab()}
                    ${dataTab(backupCategories)}
                </div>
            </div>
        </div>
    </div>`;
}

