export const WALK_DIRECTIONS = ['nearby', 'horizontal', 'vertical', 'screen'];
export function walkDirection(settings) {
    return WALK_DIRECTIONS.includes(settings.motion?.walkDirection) ? settings.motion.walkDirection : 'nearby';
}
/** Phones wander only a little; 0 means stay put. */
export function mobileWalkRange(raw) {
    const selected = raw == null ? NaN : Number(raw);
    return Number.isFinite(selected) ? Math.max(0, Math.min(160, selected)) : 80;
}
/** This limits automatic travel; the user can still drag to a new starting position. */
export function constrainWalkTarget(mode, current, target) {
    return {x:mode === 'vertical' ? current.x : target.x, y:mode === 'horizontal' ? current.y : target.y};
}
export function chooseWalkTarget({mode, current, origin, bounds, range, maxStep = 250}, random = Math.random) {
    let target;
    if (mode === 'screen') {
        target = {x:bounds.minX + random() * (bounds.maxX - bounds.minX), y:bounds.minY + random() * (bounds.maxY - bounds.minY)};
        // Wander across the whole screen over time without racing across it in one step.
        const distance = Math.hypot(target.x - current.x, target.y - current.y);
        if (distance > maxStep) target = {x:current.x + (target.x-current.x)*maxStep/distance, y:current.y + (target.y-current.y)*maxStep/distance};
    } else {
        target = {x:origin.x + (random()-.5)*2*range, y:origin.y + (random()-.5)*2*range*(mode === 'vertical' ? 1 : .3)};
    }
    target = constrainWalkTarget(mode,current,target);
    return {x:Math.max(bounds.minX,Math.min(bounds.maxX,target.x)), y:Math.max(bounds.minY,Math.min(bounds.maxY,target.y))};
}
/** One switch for both pets; on phones a set mobile override wins. */
export function walkingEnabled(settings, isMobile) {
    const mobile = isMobile ? settings.deviceDisplay?.mobile?.walkEnabled : null;
    return Boolean(mobile ?? settings.walk?.enabled);
}
