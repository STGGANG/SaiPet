/** Short compositor-only gestures. They never change position, size or user flip. */
export function playGesture(element, kind, { height = 18, direction = 1, repeats = 1, duration, delay = 0 } = {}) {
    if (!element?.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return null;
    const rest = { translate: "0 0", rotate: "0deg", scale: "1 1" };
    const frames = kind === "hop" ? [
        { ...rest, offset: 0 },
        { ...rest, scale: "1.04 .94", offset: .16 },
        { ...rest, translate: `0 -${height}px`, scale: ".98 1.02", offset: .48 },
        { ...rest, scale: "1.05 .93", offset: .82 },
        { ...rest, offset: 1 },
    ] : kind === "walk" ? [
        { ...rest, rotate: "-3deg" }, { ...rest, translate: "0 -5px", rotate: "3deg" }, { ...rest, rotate: "-3deg" },
    ] : kind === "sway" ? [
        rest, { ...rest, translate: `${direction * 5}px -2px`, rotate: `${direction * 9}deg` },
        rest, { ...rest, translate: `${-direction * 5}px -2px`, rotate: `${-direction * 9}deg` }, rest,
    ] : kind === "lean" ? [
        rest, { ...rest, rotate: `${direction * 10}deg`, offset: .35 },
        { ...rest, rotate: `${direction * 10}deg`, offset: .72 }, rest,
    ] : [rest, { ...rest, translate: "0 5px", scale: "1.02 .96" }, rest];
    return element.animate(frames, { duration: duration ?? (kind === "walk" ? 380 : kind === "sway" ? 1100 : 700), delay, iterations: repeats, easing: "ease-in-out" });
}

export function stopWalkHop(node) {
    node?._saipetWalkHop?.cancel();
    if (node) node._saipetWalkHop = null;
}

/** Called once per walk, never polled. At most one little hop per 45 seconds. */
export function maybeWalkHop(node, { enabled = true, random = Math.random, now = Date.now() } = {}) {
    if (!enabled || !node?.isConnected || node._saipetWalkHop || now - (node._saipetLastHop ?? -Infinity) < 45000
        || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || random() >= .28) return false;
    const art = node.querySelector(".st-pet-sprite, .stvp-house-pet-art");
    if (!art) return false;
    const rect = art.getBoundingClientRect();
    const height = Math.min(36, Math.max(14, rect.height * .14), Math.max(0, rect.top - 4));
    if (height < 4) return false;
    const animation = playGesture(art, "hop", { height, duration: 720, delay: 650 + random() * 550 });
    if (!animation) return false;
    node._saipetWalkHop = animation; node._saipetLastHop = now;
    animation.finished.then(() => { if (node._saipetWalkHop === animation) node._saipetWalkHop = null; }).catch(() => {});
    return true;
}
