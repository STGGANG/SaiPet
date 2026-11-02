import { applyFont } from "./fonts.js";
import { playGesture } from "./motion-effects.js";
import { effectIcon } from "./effect-icons.js";
/** API-free scenes shared by the screen and room. All effects are cancellable. */
export const SCENE_DURATION = 8800;
export const SCENES = {
    greet: "다가가 인사하기", stroll: "나란히 산책", follow: "졸졸 따라가기",
    celebrate: "신나서 콩콩", lean: "다정하게 기대기", comfort: "토닥토닥 위로",
    challenge: "장난스러운 기싸움", dance: "둘이서 리듬 타기", peek: "다가갔다 장난치기", hopTogether: "점프 따라 하기",
};
export const RELATIONS = {
    friends: { name: "친구", icon: "sparkle", actions: ["greet", "stroll", "follow", "celebrate", "dance", "peek", "hopTogether"] },
    lovers: { name: "연인", icon: "love", actions: ["lean", "stroll", "follow", "celebrate", "comfort", "dance", "peek"] },
    family: { name: "가족", icon: "heartGold", actions: ["greet", "stroll", "comfort", "celebrate", "dance", "peek", "hopTogether"] },
    rivals: { name: "라이벌", icon: "bolt", actions: ["challenge", "follow", "celebrate", "peek", "hopTogether"] },
    neutral: { name: "아는 사이", icon: "wave", actions: ["greet", "stroll", "celebrate", "hopTogether"] },
};
export function chooseScene(relation, previous, random = Math.random) {
    const pool = (RELATIONS[relation] || RELATIONS.friends).actions.filter(action => action !== previous);
    return pool[Math.floor(random() * pool.length)];
}
// Account for object-fit space without fetching images or reading pixels.
export function spriteRect(node) {
    const image = node.querySelector(".st-pet-sprite img, .stvp-house-pet-art img");
    const element = image || node.querySelector(".st-pet-sprite, .stvp-house-pet-art") || node;
    const rect = element.getBoundingClientRect();
    const ratio = image?.naturalWidth / image?.naturalHeight;
    const width = ratio > 0 ? Math.min(rect.width, rect.height * ratio) : rect.width;
    const height = ratio > 0 ? Math.min(rect.height, rect.width / ratio) : rect.height;
    const left = rect.left + (rect.width - width) / 2;
    const top = rect.top + rect.height - height;
    return { left, top, width, height, right: left + width, bottom: top + height, cx: left + width / 2 };
}
export function areNeighbors(a, b) {
    const gap = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
    return gap <= Math.max(45, Math.min(a.width, b.width) * .75)
        && Math.abs(a.bottom - b.bottom) <= Math.max(45, Math.min(a.height, b.height) * .35);
}
export function pairSeparation(a, b) {
    return (a.width + b.width) * (Math.min(a.width, b.width) < 90 ? .43 : .36) + 4;
}
/** Ordinary walking pace: one normal step (maxStep) takes 2.5s; never a quick slide, never a long trek. */
export function walkDuration(distance, maxStep = 250) {
    return Math.round(Math.min(6500, Math.max(1200, distance / maxStep * 2500)));
}
/** Which screen pet can stroll over to stand beside the other without leaving the screen,
 * breaking the walk-direction rule or going farther than maxDistance. Null means skip this round. */
export function planApproach(pets, { mode = "nearby", bounds, maxStep = 250, maxDistance = Infinity, random = Math.random }) {
    if (areNeighbors(pets[0].art, pets[1].art)) return null;
    const candidates = [];
    for (const index of [0, 1]) {
        const { art: me, box } = pets[index], other = pets[1 - index].art;
        const sign = other.cx >= me.cx ? 1 : -1;
        let cx = mode === "vertical" ? me.cx : other.cx - sign * pairSeparation(me, other);
        let feet = mode === "horizontal" ? me.bottom : other.bottom;
        cx = Math.max(bounds.left + (me.cx - box.left), Math.min(bounds.right - (box.right - me.cx), cx));
        feet = Math.max(bounds.top + (me.bottom - box.top), Math.min(bounds.bottom - (box.bottom - me.bottom), feet));
        const target = { ...me, left: cx - me.width / 2, right: cx + me.width / 2, cx, top: feet - me.height, bottom: feet };
        const overlap = Math.min(target.right, other.right) - Math.max(target.left, other.left);
        if (!areNeighbors(target, other) || overlap > Math.min(me.width, other.width) * .45) continue;
        const distance = Math.hypot(target.left - me.left, target.top - me.top);
        if (distance < 12 || distance > maxDistance) continue;
        candidates.push({ walker: index, cx, feet, distance, duration: walkDuration(distance, maxStep) });
    }
    return candidates[Math.floor(random() * candidates.length)] || null;
}

export function applyEmoteTheme(node, settings = {}) {
    node.dataset.design = settings.design || "simple";
    applyFont(node, settings.font);
    node.style.setProperty("--spc-bubble-bg", settings.backgroundColor || "#ffffff");
    node.style.setProperty("--bubble-bg-color", settings.backgroundColor || "#ffffff");
    node.style.setProperty("--spc-bubble-text", settings.textColor || "#4a4f5e");
    node.style.setProperty("--spc-accent", settings.accentColor || "#7c9bff");
}

export function showEmote(node, key, settings) {
    if (settings) applyEmoteTheme(node, settings);
    let bubble = node.querySelector(".stvp-social-bubble");
    if (!bubble) {
        bubble = document.createElement("span");
        bubble.className = "st-pet-bubble stvp-social-bubble show";
        bubble.setAttribute("aria-hidden", "true");
        const content = document.createElement("span"); content.className = "st-pet-bubble-text";
        bubble.append(content); node.append(bubble);
    }
    bubble.dataset.emote = key;
    bubble.querySelector(".st-pet-bubble-text").replaceChildren(effectIcon(key));
    const art = spriteRect(node), box = node.getBoundingClientRect();
    bubble.style.left = `${art.cx - box.left}px`;
    bubble.style.top = `${Math.max(8 - box.top, art.top - box.top - (bubble.offsetHeight || 48) - 12)}px`;
    return bubble;
}

/** Actors supply screen-pixel moveTo(cx, feet, ms), face(left), stop and reset. */
export function playPairScene(actors, { action, relation = "friends", canMove = true, valid = () => true, done = () => {} }) {
    const timers = new Set(), animations = new Set();
    let ended = false;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const cancel = () => {
        if (ended) return;
        ended = true;
        timers.forEach(clearTimeout); timers.clear();
        animations.forEach(animation => animation.cancel()); animations.clear();
        actors.forEach(actor => {
            actor.stop(); actor.reset();
            actor.node.querySelector(".stvp-social-bubble")?.remove();
            actor.node.classList.remove("saipet-social-active");
            delete actor.node.dataset.socialAction;
        });
        done();
    };
    const later = (ms, fn) => {
        const timer = setTimeout(() => {
            timers.delete(timer);
            if (ended) return;
            if (!valid() || actors.some(a => !a.node.isConnected)) { cancel(); return; }
            fn();
        }, ms);
        timers.add(timer);
    };
    const emote = (index, key) => {
        const actor = actors[index];
        showEmote(actor.node, key, actor.speechBubble);
    };
    const gesture = (index, kind, repeats = 1, options = {}) => {
        if (kind === "walk" && actors[index].walk) { actors[index].walk(repeats * 400); return; }
        const element = actors[index].node.querySelector(".st-pet-sprite, .stvp-house-pet-art");
        const rect = spriteRect(actors[index].node);
        const facing = rect.cx < spriteRect(actors[1 - index].node).cx ? 1 : -1;
        const animation = playGesture(element, kind, {
            height: Math.min(28, Math.max(12, rect.height * .12), Math.max(0, rect.top - 4)),
            direction: facing, repeats, ...options,
        });
        if (!animation) return;
        animations.add(animation);
        animation.finished.then(() => animations.delete(animation)).catch(() => {});
    };
    const faceEachOther = () => {
        const left = spriteRect(actors[0].node).cx < spriteRect(actors[1].node).cx;
        actors[0].face(!left); actors[1].face(left);
    };
    const a = spriteRect(actors[0].node), b = spriteRect(actors[1].node);
    const direction = a.cx <= b.cx ? 1 : -1;
    const separation = pairSeparation(a, b);
    const center = (a.cx + b.cx) / 2, feet = Math.max(a.bottom, b.bottom);
    const moving = canMove && !reduced;
    const symbol = (RELATIONS[relation] || RELATIONS.friends).icon;
    actors.forEach(actor => { actor.stop(); actor.node.classList.add("saipet-social-active"); actor.node.dataset.socialAction = action; });
    faceEachOther(); emote(0, action === "challenge" ? "bolt" : "look");
    later(450, () => { emote(1, "question"); });
    if (moving) {
        actors[0].moveTo(center - direction * separation / 2, feet, 1200);
        actors[1].moveTo(center + direction * separation / 2, feet, 1200);
        gesture(0, "walk", 3); gesture(1, "walk", 3);
    }
    later(1450, () => {
        faceEachOther();
        const anchors = actors.map(actor => spriteRect(actor.node));
        // Small coordinated steps, always relative to the settled pair position.
        const step = (index, offset, ms = 600) => {
            if (!moving) return;
            actors[index].moveTo(anchors[index].cx + direction * offset, anchors[index].bottom, ms);
        };
        const together = () => { gesture(0, "hop"); gesture(1, "hop"); };
        if (action === "stroll" || action === "follow") {
            emote(0, "music"); emote(1, action === "follow" ? "steps" : "music");
            if (moving) {
                const leftRoom = Math.min(...actors.map(actor => spriteRect(actor.node).left - actor.bounds().left));
                const rightRoom = Math.min(...actors.map(actor => actor.bounds().right - spriteRect(actor.node).right));
                const sign = rightRoom >= leftRoom ? 1 : -1;
                const distance = Math.min(120, Math.max(0, leftRoom, rightRoom) * .7);
                const leader = anchors[0].cx * sign > anchors[1].cx * sign ? 0 : 1;
                actors.forEach((actor, i) => {
                    actor.face(sign < 0);
                    const walk = () => { actor.moveTo(anchors[i].cx + sign * distance, anchors[i].bottom, 2400); gesture(i, "walk", 6); };
                    if (action === "follow" && i !== leader) later(380, walk); else walk();
                });
                later(2950, () => { faceEachOther(); emote(0, "smile"); emote(1, symbol); together(); });
            } else { gesture(0, "sway", 2); gesture(1, "sway", 2); }
        } else if (action === "celebrate" || action === "hopTogether") {
            emote(0, action === "celebrate" ? "cheer" : "sparkle"); gesture(0, "hop");
            later(750, () => { emote(1, "exclaim"); gesture(1, "hop"); });
            later(1750, () => { emote(0, "party"); emote(1, symbol); gesture(0, "hop", 2); gesture(1, "hop", 2); });
            later(3400, () => { gesture(0, "sway"); gesture(1, "sway"); });
        } else if (action === "dance") {
            emote(0, "music"); emote(1, "music");
            gesture(0, "sway", 3, { direction }); gesture(1, "sway", 3, { direction });
            later(3550, together);
        } else if (action === "lean" || action === "comfort") {
            emote(0, action === "lean" ? "heart" : "thought"); emote(1, action === "lean" ? "relaxed" : "heartGold");
            step(0, 10); gesture(0, "lean", 1, { duration: 1700 });
            later(900, () => { gesture(1, "lean", 1, { duration: 1700 }); emote(1, symbol); });
            later(2800, () => { emote(0, "relaxed"); gesture(0, "sway"); gesture(1, "sway"); });
        } else if (action === "challenge" || action === "peek") {
            emote(0, "smirk"); emote(1, "question"); step(0, 16); gesture(0, "lean");
            later(700, () => { step(1, 14); gesture(1, "hop"); emote(1, "exclaim"); });
            later(1600, () => { step(1, -8); step(0, -14); emote(1, action === "challenge" ? "bolt" : "smirk"); gesture(0, "hop"); });
            later(2700, () => { step(0, 0); step(1, 0); emote(0, "sparkle"); emote(1, "sparkle"); });
            later(3550, together);
        } else {
            emote(0, "wave"); emote(1, "smile"); gesture(0, "sway");
            later(1150, () => { emote(1, "wave"); gesture(1, "sway"); });
            later(2500, () => { emote(0, symbol); emote(1, "sparkle"); together(); });
        }
    });
    later(6400, () => { faceEachOther(); emote(0, symbol); emote(1, relation === "lovers" ? "love" : "sparkle"); });
    later(SCENE_DURATION, cancel);
    return cancel;
}
