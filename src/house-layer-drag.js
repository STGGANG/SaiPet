/** Pointer-based layer sorting also works on touch screens. Only the handle
 * captures gestures; the rest of the list remains available for scrolling.
 */
export function beginLayerDrag({ event, handle, row, list, activeDrags, commit }) {
    event.preventDefault(); event.stopPropagation();
    const pointerId = event.pointerId, bounds = list.getBoundingClientRect();
    const rows = [...list.children], others = rows.filter(node => node !== row);
    const centers = others.map(node => {
        const rect = node.getBoundingClientRect();
        return (rect.top + rect.bottom) / 2 - bounds.top + list.scrollTop;
    });
    let latest = event, frame = null, started = false, finished = false;
    let target = rows.indexOf(row);
    const clearMarks = () => rows.forEach(node => node.classList.remove("drop-before", "drop-after"));
    const update = () => {
        frame = null;
        if (!started || finished) return;
        const edge = 24;
        const speed = latest.clientY < bounds.top + edge ? -6 : latest.clientY > bounds.bottom - edge ? 6 : 0;
        if (speed) list.scrollTop += speed;
        const y = latest.clientY - bounds.top + list.scrollTop;
        target = centers.filter(center => center < y).length;
        clearMarks();
        if (others[target]) others[target].classList.add("drop-before");
        else others.at(-1)?.classList.add("drop-after");
        if (speed) frame = requestAnimationFrame(update);
    };
    const move = next => {
        if (next.pointerId !== pointerId) return;
        latest = next;
        if (!started && Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) >= 4) {
            started = true; row.classList.add("is-dragging");
        }
        if (frame === null) frame = requestAnimationFrame(update);
    };
    const finish = next => {
        if (finished || (next?.pointerId != null && next.pointerId !== pointerId)) return;
        if (frame !== null) cancelAnimationFrame(frame);
        if (next?.type === "pointerup") { latest = next; update(); }
        finished = true;
        if (frame !== null) cancelAnimationFrame(frame);
        handle.removeEventListener("pointermove", move);
        for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) handle.removeEventListener(name, finish);
        document.removeEventListener("keydown", onKey, true);
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
        activeDrags.delete(finish); row.classList.remove("is-dragging"); clearMarks();
        if (started && next?.type === "pointerup" && next.clientX >= bounds.left && next.clientX <= bounds.right
            && next.clientY >= bounds.top && next.clientY <= bounds.bottom) commit(target);
    };
    const onKey = key => {
        if (key.key !== "Escape") return;
        key.preventDefault(); key.stopImmediatePropagation(); finish();
    };
    handle.setPointerCapture(pointerId);
    handle.addEventListener("pointermove", move);
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) handle.addEventListener(name, finish);
    document.addEventListener("keydown", onKey, true);
    activeDrags.add(finish);
}
