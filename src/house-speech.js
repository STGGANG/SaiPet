import { spriteRect } from "./social-scenes.js";
import { setGestureText } from "./ui-kit.js";

const GENERATING_TEXT = "대화 준비 중…";
const THEME_PROPERTIES = ["--spc-bubble-bg", "--bubble-bg-color", "--spc-bubble-text", "--spc-accent", "--spc-font"];

const greetingLines = lines => (Array.isArray(lines) ? lines : []).filter(line => typeof line === "string" && line.trim()).map(line => line.trim());
/** Everyone waves in turn; one resident with custom greeting lines may add one of them. Never a stock line, never the API. */
export function planHouseGreeting(residents, random = Math.random) {
    if (!residents.length) return null;
    const waves = residents.map(({ id }, index) => ({ id, delay: Math.round(350 + index * 260 + random() * 180) }));
    const speakers = residents.map(resident => ({ id: resident.id, lines: greetingLines(resident.lines) })).filter(resident => resident.lines.length);
    const speaker = speakers[Math.floor(random() * speakers.length)];
    const text = speaker?.lines[Math.floor(random() * speaker.lines.length)];
    const speech = speaker ? { id: speaker.id, text, delay: waves.at(-1).delay + 1400, duration: Math.max(3000, Math.min(8000, Array.from(text).length * 130 + 1800)) } : null;
    return { waves, speech };
}

/** What the box under the room shows: nothing when idle, a neutral notice while generating, else the latest line. */
export function subtitleState(status) {
    if (!status.active) return null;
    const line = status.lines.at(-1);
    if (status.phase === "generating" || !line) return { generating: true, text: GENERATING_TEXT };
    return { slot: line.actor.slot, name: line.actor.name, text: line.text };
}

/** A resident's pose from the conversation status: thinking only while a reply is being generated for them,
 * the mood of their latest line once anyone speaks, otherwise idle. Idle again when the conversation ends. */
export function residentState(status, slot) {
    if (!status.active) return { mood: "idle", thinking: false };
    if (status.phase === "generating" && status.actors.some(actor => actor.slot === slot)) return { mood: "thinking", thinking: true };
    const line = status.lines.findLast(line => line.actor.slot === slot);
    return { mood: line?.mood || "idle", thinking: false };
}

const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
/** Boxes for the bubbles of one render, in speaker order. Each goes above its speaker's head when that fits, otherwise below,
 * and slides sideways (tail still on the speaker) when that keeps it off other residents' heads and earlier bubbles. */
export function planBubbleLayout(room, speakers, heads = [], { margin = 14, gap = 12, tailInset = 16 } = {}) {
    const placed = [];
    return speakers.map(({ art, width, height }) => {
        const below = art.top - height - gap < room.top + margin && art.bottom + height + gap < room.bottom - margin;
        const top = Math.max(room.top + margin, Math.min(room.bottom - margin - height, below ? art.bottom + gap : art.top - height - gap));
        const centered = Math.max(room.left + margin, Math.min(room.right - margin - width, art.cx - width / 2));
        const minLeft = Math.max(room.left + margin, art.cx - width + tailInset), maxLeft = Math.min(room.right - margin - width, art.cx - tailInset);
        const obstacles = heads.filter(head => head !== art).map(head => ({ left: head.left, right: head.right, top: head.top, bottom: head.top + head.height * .45 }));
        let best = { left: centered, cost: Infinity };
        for (let shift = 0; shift <= width && best.cost; shift += 8) {
            for (const left of shift ? [centered - shift, centered + shift] : [centered]) {
                if (left < minLeft - .5 || left > maxLeft + .5) continue;
                const box = { left, right: left + width, top, bottom: top + height };
                const cost = obstacles.reduce((sum, head) => sum + overlap(box, head), 0) * 4 + placed.reduce((sum, other) => sum + overlap(box, other), 0) + shift * .5;
                if (cost < best.cost) best = { left, cost };
            }
        }
        const left = best.left;
        placed.push({ left, right: left + width, top, bottom: top + height });
        return { left, top, below, tailLeft: Math.max(tailInset, Math.min(width - tailInset, art.cx - left)) };
    });
}

function copyBubbleTheme(from, to) {
    to.dataset.design = from.dataset.design || "simple";
    if (from.hasAttribute("data-custom-font")) to.setAttribute("data-custom-font", ""); else to.removeAttribute("data-custom-font");
    for (const name of THEME_PROPERTIES) {
        const value = from.style.getPropertyValue(name);
        if (value) to.style.setProperty(name, value); else to.style.removeProperty(name);
    }
}
function clearBubbleTheme(node) {
    delete node.dataset.design; node.removeAttribute("data-custom-font");
    for (const name of THEME_PROPERTIES) node.style.removeProperty(name);
}

export function createHouseSpeech({ getPopup, getStatus, isLocked, isPhone, getMaxWidth, stopMovement, setMood }) {
    let frame = null, subtitleKey = "";
    const petNodes = () => new Map([...getPopup().querySelectorAll(".stvp-house-pet")].map(node => [node.dataset.pet, node]));

    function render() {
        const popup = getPopup();
        if (!popup) return;
        const status = getStatus();
        if (status.active) stopMovement();
        popup.querySelectorAll(".stvp-house-pet").forEach(node => {
            const { mood, thinking } = residentState(status, node.dataset.pet);
            node.classList.toggle("stvp-house-thinking", thinking);
            setMood(node, mood);
        });
        const pets = petNodes();
        const subtitle = subtitleState(status);
        showSubtitle(subtitle && { ...subtitle, theme: subtitle.slot ? pets.get(subtitle.slot) : null });
        clearBubbles();
        if (!isLocked() || isPhone()) return;
        for (const line of status.lines) {
            const node = pets.get(line.actor.slot);
            if (node) appendBubble(node, line.text);
        }
        if (status.active && status.phase === "generating") {
            for (const actor of status.actors) {
                const node = pets.get(actor.slot);
                if (node) appendBubble(node, null);
            }
        }
        queueLayout();
    }

    function bubbleLayer() { return getPopup()?.querySelector("#stvp-house-bubbles"); }
    function clearBubbles() { bubbleLayer()?.replaceChildren(); }

    /** Bubbles live in their own layer above every furniture depth; later speakers stack on top. */
    function appendBubble(node, message) {
        const layer = bubbleLayer();
        if (!layer) return null;
        const host = document.createElement("div");
        host.className = "stvp-house-balloon";
        host.dataset.pet = node.dataset.pet;
        copyBubbleTheme(node, host);
        host.style.zIndex = String(layer.childElementCount + 1);
        const bubble = document.createElement("div");
        bubble.className = "st-pet-bubble stvp-house-dialogue-bubble show";
        const text = document.createElement("span");
        text.className = "st-pet-bubble-text";
        if (message === null) {
            bubble.classList.add("stvp-house-generating");
            bubble.setAttribute("aria-label", "응답 생성 중");
            for (let i = 0; i < 3; i++) {
                const dot = document.createElement("span");
                dot.className = "stvp-house-thinking-dot";
                dot.style.animationDelay = i * .18 + "s";
                text.append(dot);
            }
        } else setGestureText(text, message);
        bubble.append(text);
        host.append(bubble);
        layer.append(host);
        bubble.addEventListener("pointerdown", event => event.stopPropagation());
        bubble.addEventListener("click", event => {
            event.stopPropagation();
            host.style.zIndex = String(layer.childElementCount + 1);
        });
        return host;
    }

    // A single layout after speech, drag or resize; no permanent geometry polling.
    function queueLayout() {
        const popup = getPopup();
        if (!popup || frame !== null) return;
        frame = requestAnimationFrame(() => { frame = null; layoutBubbles(); });
    }
    function layoutBubbles() {
        const layer = bubbleLayer();
        if (!layer?.childElementCount) return;
        const room = layer.getBoundingClientRect(), margin = 14;
        const pets = petNodes();
        const hosts = [...layer.children].filter(host => pets.has(host.dataset.pet));
        const maxWidth = Math.max(40, Math.min(Number(getMaxWidth()) || 360, 240, room.width - margin * 2)) + "px";
        const maxHeight = Math.max(30, Math.min(130, room.height - margin * 2)) + "px";
        for (const host of hosts) { const bubble = host.firstElementChild; bubble.style.maxWidth = maxWidth; bubble.style.maxHeight = maxHeight; }
        const arts = new Map([...pets].map(([slot, node]) => [slot, spriteRect(node)]));
        const speakers = hosts.map(host => ({ art: arts.get(host.dataset.pet), width: host.offsetWidth, height: host.offsetHeight }));
        const boxes = planBubbleLayout(room, speakers, [...arts.values()], { margin });
        hosts.forEach((host, index) => {
            const { left, top, below, tailLeft } = boxes[index];
            host.firstElementChild.classList.toggle("below", below);
            host.style.left = left - room.left + "px"; host.style.top = top - room.top + "px";
            host.style.setProperty("--tail-left", tailLeft + "px");
        });
    }

    function showSubtitle(view) {
        const box = getPopup()?.querySelector("#stvp-house-dialogue-live");
        if (!box) return;
        box.hidden = !view;
        if (!view) { subtitleKey = ""; return; }
        const key = `${view.slot || ""}\n${view.text}`;
        if (key === subtitleKey) return;
        const before = subtitleKey ? box.offsetHeight : 0;
        subtitleKey = key;
        box.classList.toggle("stvp-house-subtitle-neutral", !view.theme);
        if (view.theme) copyBubbleTheme(view.theme, box); else clearBubbleTheme(box);
        box.querySelector(".stvp-house-subtitle-name").textContent = view.name || "";
        setGestureText(box.querySelector(".stvp-house-subtitle-text"), view.text);
        box.scrollTop = 0;
        box.classList.remove("stvp-house-subtitle-switch");
        void box.offsetWidth;
        box.classList.add("stvp-house-subtitle-switch");
        settleHeight(box, before);
    }

    // The box follows its text (one to four lines); a changed line glides to the new height instead of jumping.
    function settleHeight(box, before) {
        box.getAnimations?.().forEach(animation => { if (animation.id === "stvp-subtitle-height") animation.cancel(); });
        const after = box.offsetHeight;
        if (!before || before === after || !box.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        box.animate([{ height: before + "px" }, { height: after + "px" }], { id: "stvp-subtitle-height", duration: 180, easing: "ease-out" });
    }

    /** A short local line: a bubble on desktop, the subtitle box on phones. The next conversation render replaces it. */
    function say(node, { name, text, duration }) {
        if (!isLocked() || getStatus().active) return () => {};
        let hide;
        if (isPhone()) {
            showSubtitle({ slot: node.dataset.pet, name, text, theme: node });
            hide = () => { if (!getStatus().active) showSubtitle(null); };
        } else {
            [...bubbleLayer()?.children || []].filter(host => host.dataset.pet === node.dataset.pet).forEach(host => host.remove());
            const host = appendBubble(node, text);
            host?.firstElementChild.classList.add("stvp-house-greeting");
            queueLayout();
            hide = () => host?.remove();
        }
        const timer = setTimeout(hide, duration);
        return () => { clearTimeout(timer); hide(); };
    }

    function clear() {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null; subtitleKey = "";
    }
    return { render, queueLayout, clear, say };
}
