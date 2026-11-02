/** Read about three full-width characters per second, with fixed pauses. */
export function mobileReadingPlan(distance, fontSize = 14) {
    const speed = Math.max(36, Math.min(60, (Number(fontSize) || 14) * 3));
    const hold = 3200, endHold = 1800, travel = Math.max(0, distance) / speed * 1000;
    return { speed, hold, travel, endHold, duration: hold + travel + endHold };
}
