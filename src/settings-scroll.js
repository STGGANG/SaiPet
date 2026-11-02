/** Native selects may restore focus after change/paint; preserve the enclosing scroll
 * positions briefly, including the document. Never fight wheel/touch/Tab navigation. */
export function preserveSettingsScroll(root) {
    let pending = null, timers = [], restoring = false;
    const cancel = () => { timers.forEach(clearTimeout); timers = []; pending = null; };
    const capture = target => {
        const nodes = new Set([document.scrollingElement]);
        for (let node = target.parentElement; node; node = node.parentElement) nodes.add(node);
        return [...nodes].filter(Boolean).map(node => [node, node.scrollLeft, node.scrollTop]);
    };
    const restore = () => {
        if (!pending || restoring) return;
        restoring = true;
        for (const [node, x, y] of pending.positions) {
            if (node.scrollLeft !== x) node.scrollLeft = x;
            if (node.scrollTop !== y) node.scrollTop = y;
        }
        restoring = false;
    };
    const begin = target => {
        cancel(); pending = { target, positions: capture(target) };
        target.focus({ preventScroll: true });
    };
    root.addEventListener('pointerdown', event => {
        if (event.target.matches('select')) begin(event.target); else cancel();
    }, true);
    root.addEventListener('keydown', event => {
        if (['Tab', 'Escape', 'PageDown', 'PageUp'].includes(event.key)) { cancel(); return; }
        if (event.target.matches('select') && !pending) begin(event.target);
    }, true);
    root.addEventListener('change', event => {
        if (pending?.target !== event.target) return;
        restore(); queueMicrotask(restore);
        // Also cover delayed native picker focus and the first webfont paint.
        for (const delay of [0, 50, 150, 350]) timers.push(setTimeout(restore, delay));
        timers.push(setTimeout(cancel, 450));
    }, true);
    document.addEventListener('scroll', restore, true);
    document.addEventListener('wheel', cancel, { passive: true, capture: true });
    document.addEventListener('touchmove', cancel, { passive: true, capture: true });
    document.addEventListener('pointerdown', event => { if (!root.contains(event.target)) cancel(); }, true);
}
