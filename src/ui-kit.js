export function escapeHtml(text) {
    if (text === null || text === undefined) return "";
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Spoken text as HTML: everything escaped, then each single-line *gesture* wrapped in <em>. No other markup. */
export function gestureHtml(text) {
    return escapeHtml(text).replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");
}
export function setGestureText(element, text) {
    element.innerHTML = gestureHtml(text);
}

const MOOD_EMOJI = {
    happy: "😊", sad: "😢", excited: "🤩", surprised: "😲", nervous: "😰", confident: "😎",
    shy: "😳", angry: "😡", thinking: "🤔", sleeping: "😴", idle: "😐",
};
export const moodEmoji = mood => (Object.hasOwn(MOOD_EMOJI, mood) ? MOOD_EMOJI[mood] : "🐾");

export function tip(html) {
    return `<span class="stvp-tip"><button type="button" class="stvp-tip-btn" aria-label="도움말" aria-expanded="false"><i class="fa-solid fa-circle-info"></i></button><span class="stvp-tip-body" role="note" hidden>${html}</span></span>`;
}

const textBlock = (label, { desc = "", tip: help = "", forId = "" } = {}) => {
    const tag = forId ? `label for="${forId}"` : "span";
    return `<${tag} class="stvp-row-text"><span class="stvp-row-title">${label}${help ? tip(help) : ""}</span>${desc ? `<small class="stvp-row-desc">${desc}</small>` : ""}</${tag.split(" ")[0]}>`;
};

export function row(label, control, options = {}) {
    const attrs = options.attrs ? ` ${options.attrs}` : "";
    const cls = options.stack ? " stvp-row-stack" : "";
    return `<div class="stvp-row${cls}"${attrs}>${textBlock(label, options)}<div class="stvp-row-ctrl">${control}</div></div>`;
}

/** A multi-line field with a button that opens it in a large editor (see text-expand.js). */
export function expandableTextarea(id, { rows = 4, placeholder = "", title = "" } = {}) {
    return `<div class="stvp-expandable"><textarea id="${id}" class="stvp-input" rows="${rows}" placeholder="${escapeHtml(placeholder)}"></textarea><button type="button" class="stvp-expand-btn" data-expand="${id}" data-expand-title="${escapeHtml(title)}" title="크게 보기" aria-label="${escapeHtml(title)} 크게 보기"><i class="fa-solid fa-up-right-and-down-left-from-center"></i></button></div>`;
}

/** Two short rows that share one line when the panel is wide enough. */
export const rowPair = (first, second) => `<div class="stvp-row-pair">${first}${second}</div>`;

export function switchRow(id, label, options = {}) {
    return row(label, `<input type="checkbox" class="stvp-switch" id="${id}">`, { ...options, forId: id });
}

export function rangeControl(id, { min, max, step = 1, unit = "" }) {
    return `<span class="stvp-range"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}"><output id="${id}-label"></output>${unit ? `<span class="stvp-unit">${unit}</span>` : ""}</span>`;
}

export function numberControl(id, { min, max, step = 1, unit = "", attrs = "" }) {
    const limits = `${min !== undefined ? ` min="${min}"` : ""}${max !== undefined ? ` max="${max}"` : ""}`;
    return `<span class="stvp-number"><input type="number" id="${id}" class="stvp-input"${limits} step="${step}"${attrs ? " " + attrs : ""}>${unit ? `<span class="stvp-unit">${unit}</span>` : ""}</span>`;
}

export function selectControl(id, options, attrs = "") {
    const html = Array.isArray(options) ? options.map(([value, label]) => `<option value="${value}">${label}</option>`).join("") : options;
    return `<select id="${id}" class="stvp-input"${attrs ? " " + attrs : ""}>${html}</select>`;
}

function head(icon, tint, title, help, extra = "") {
    return `<span class="stvp-icon" data-tint="${tint}"><i class="fa-solid ${icon}"></i></span><h5>${title}</h5>${extra}${help ? tip(help) : ""}`;
}

export function card({ id = "", icon, tint = "neutral", title, tip: help = "", chip = "", body, cls = "", attrs = "" }) {
    return `<section class="stvp-card ${cls}"${id ? ` id="${id}"` : ""}${attrs ? " " + attrs : ""}>
        <header class="stvp-card-head">${head(icon, tint, title, help, chip)}</header>
        <div class="stvp-card-body">${body}</div>
    </section>`;
}

export function fold({ id = "", icon, tint = "neutral", title, titleId = "", tip: help = "", chip = "", body, open = false, cls = "", attrs = "" }) {
    const heading = titleId ? `<span id="${titleId}">${title}</span>` : title;
    return `<details class="stvp-card stvp-fold ${cls}"${id ? ` id="${id}"` : ""}${open ? " open" : ""}${attrs ? " " + attrs : ""}>
        <summary class="stvp-card-head">${head(icon, tint, heading, help, chip)}<i class="fa-solid fa-chevron-down stvp-fold-mark" aria-hidden="true"></i></summary>
        <div class="stvp-card-body">${body}</div>
    </details>`;
}

export function subFold(title, body, { id = "", open = false } = {}) {
    return `<details class="stvp-subfold"${id ? ` id="${id}"` : ""}${open ? " open" : ""}><summary>${title}</summary><div class="stvp-subfold-body">${body}</div></details>`;
}

export const subhead = (title, help = "") => `<div class="stvp-subhead">${title}${help ? tip(help) : ""}</div>`;
export const chip = (text, tone = "neutral") => `<span class="stvp-chip" data-tone="${tone}">${text}</span>`;
export const scopeNote = (icon, text) => `<p class="stvp-scope-note"><i class="fa-solid ${icon}"></i><span>${text}</span></p>`;
export const button = (id, label, { icon = "", tone = "", attrs = "" } = {}) =>
    `<button type="button" class="stvp-btn${tone ? " stvp-btn-" + tone : ""}"${id ? ` id="${id}"` : ""}${attrs ? " " + attrs : ""}>${icon ? `<i class="fa-solid ${icon}"></i>` : ""}${label ? `<span>${label}</span>` : ""}</button>`;

let openTip = null;
function closeTip() {
    if (!openTip) return;
    openTip.setAttribute("aria-expanded", "false");
    openTip.nextElementSibling.hidden = true;
    openTip = null;
}

let dismissBound = false;
export function bindTips(root) {
    if (!dismissBound) {
        dismissBound = true;
        document.addEventListener("pointerdown", event => {
            if (openTip && !event.target.closest?.(".stvp-tip")) closeTip();
        }, true);
        document.addEventListener("keydown", event => { if (event.key === "Escape") closeTip(); });
    }
    root.addEventListener("click", event => {
        const btn = event.target.closest?.(".stvp-tip-btn");
        if (!btn || !root.contains(btn)) return;
        event.preventDefault();
        event.stopPropagation();
        const wasOpen = btn === openTip;
        closeTip();
        if (wasOpen) return;
        btn.setAttribute("aria-expanded", "true");
        btn.nextElementSibling.hidden = false;
        openTip = btn;
    });
}
