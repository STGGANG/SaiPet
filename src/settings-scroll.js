/** Hold the settings drawer still while a select or slider is in use. Selects may restore focus after
 * change/paint; a slider change is followed (~1.5 s later, after SillyTavern's debounced save) by other
 * extensions re-rendering in the same drawer. Never fight wheel, touch scrolling, the scrollbar or Tab. */
const GUARDED = 'select, input[type="range"]';
const SELECT_HOLD = [0, 50, 150, 350];
// Covers SillyTavern's 1 s save debounce plus the request and other extensions' re-render.
const RANGE_HOLD = [0, 50, 150, 350, 700, 1200, 1700, 2200];

export function preserveSettingsScroll(root) {
    let pending = null, timers = [], restoring = false, unpinned = [], held = false;
    // Scroll anchoring in the host's scroll box can jump when anything else changes height, and any
    // scroll closes an open native picker; switch anchoring off only while a control is in use.
    const pinAnchors = target => {
        for (let node = target.parentElement; node; node = node.parentElement) {
            if (node.scrollHeight <= node.clientHeight) continue;
            unpinned.push([node, node.style.overflowAnchor]);
            node.style.overflowAnchor = 'none';
        }
    };
    const unpinAnchors = () => { for (const [node, value] of unpinned) node.style.overflowAnchor = value; unpinned = []; };
    const cancel = () => { timers.forEach(clearTimeout); timers = []; pending = null; unpinAnchors(); };
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
    const isRange = () => pending?.target.matches('input[type="range"]');
    const begin = target => {
        cancel(); pending = { target, positions: capture(target), settled: false }; pinAnchors(target);
        // A select is focused natively; refocusing it from script can reopen the picker on iOS.
        if (target.type === 'range') target.focus({ preventScroll: true });
    };
    const settle = () => {
        if (!pending) return;
        timers.forEach(clearTimeout); timers = [];
        pending.settled = true;
        restore(); queueMicrotask(restore);
        const hold = isRange() ? RANGE_HOLD : SELECT_HOLD;
        for (const delay of hold) timers.push(setTimeout(restore, delay));
        timers.push(setTimeout(cancel, hold.at(-1) + 300));
    };
    root.addEventListener('pointerdown', event => {
        if (event.target.matches(GUARDED)) { held = true; begin(event.target); } else cancel();
    }, true);
    root.addEventListener('keydown', event => {
        if (['Tab', 'Escape', 'PageDown', 'PageUp'].includes(event.key)) { cancel(); return; }
        if (event.target.matches(GUARDED) && !pending) begin(event.target);
    }, true);
    root.addEventListener('input', event => { if (pending?.target === event.target && isRange()) restore(); }, true);
    root.addEventListener('change', event => { if (pending?.target === event.target) settle(); }, true);
    // A picker closed without a choice never fires change. (WebKit also blurs a slider mid-drag, so only selects.)
    root.addEventListener('focusout', event => { if (pending?.target === event.target && !pending.settled && !isRange()) cancel(); }, true);
    document.addEventListener('pointerup', () => { held = false; if (isRange() && !pending.settled) settle(); }, true);
    // While a picker is open, writing scrollTop would itself close it; selects are restored after change.
    document.addEventListener('scroll', () => { if (pending && (isRange() || pending.settled)) restore(); }, true);
    document.addEventListener('wheel', cancel, { passive: true, capture: true });
    // A finger sliding along a slider is the drag itself; any other touch movement is the user scrolling.
    document.addEventListener('touchmove', () => { if (!held) cancel(); }, { passive: true, capture: true });
    document.addEventListener('pointerdown', event => { if (!root.contains(event.target)) cancel(); }, true);
}
