/** Snapshot geometry once per gesture. Pointer frames only write a compositor translation. */
export function beginDragMotion(node, bounds, margin = 0) {
    const rect = node.getBoundingClientRect();
    const minX = bounds.minX + margin, minY = bounds.minY + margin;
    const maxX = Math.max(minX, bounds.maxX - rect.width - margin);
    const maxY = Math.max(minY, bounds.maxY - rect.height - margin);
    let x = rect.left, y = rect.top;
    node.style.willChange = 'translate';
    return {
        move(nextX, nextY) {
            x = Math.max(minX, Math.min(nextX, maxX)); y = Math.max(minY, Math.min(nextY, maxY));
            node.style.translate = `${x - rect.left}px ${y - rect.top}px`;
        },
        finish() {
            node.style.left = `${x}px`; node.style.top = `${y}px`;
            node.style.right = 'auto'; node.style.bottom = 'auto';
            node.style.translate = ''; node.style.willChange = '';
            return { left: x, top: y };
        },
    };
}
