import { stopWalkVisual } from "./walking.js";
import { stopWalkHop } from "./motion-effects.js";

export function stopMotion(element, freeze = true) {
    stopWalkHop(element);
    stopWalkVisual(element);
    const animation = element?._saipetMotion;
    if (!animation) return;
    const rect = freeze ? element.getBoundingClientRect() : null;
    animation.cancel();
    element._saipetMotion = null;
    if (rect) {
        element.style.left = rect.left + "px"; element.style.top = rect.top + "px";
        element.style.right = "auto"; element.style.bottom = "auto";
    }
}
/** Move the outer container on the compositor; sprite animations stay independent. */
export function moveElement(element, x, y, duration = 2500) {
    const before = element.getBoundingClientRect();
    stopMotion(element, false);
    element.style.left = x + "px"; element.style.top = y + "px";
    element.style.right = "auto"; element.style.bottom = "auto";
    if (!duration || !element.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        element.dispatchEvent?.(new Event("saipet-positioned"));
        return;
    }
    const animation = element.animate([
        { transform: "translate(" + (before.left - x) + "px," + (before.top - y) + "px)" },
        { transform: "translate(0px,0px)" },
    ], { duration, easing: "ease-in-out" });
    element._saipetMotion = animation;
    animation.finished.then(() => {
        if (element._saipetMotion === animation) {
            element._saipetMotion = null;
            element.dispatchEvent?.(new Event("saipet-positioned"));
        }
    }).catch(() => {});
}

