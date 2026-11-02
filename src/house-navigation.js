/** Small floor planner. Geometry is cached by the room, never read during a walk. */
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function furniturePlacement(item, info = {}) {
    if (["solid", "wall", "rug", "surface"].includes(item.placement)) return item.placement;
    if (info.placement) return info.placement;
    const type = item.type || "";
    if (/rug|carpet/.test(type)) return "rug";
    if (/window|wall-art|wall-shelf|pendant|hanging/.test(type)) return "wall";
    if (/book-cup|vase|table-lamp|espresso|ceramic|tea-set|perfume/.test(type)) return "surface";
    return "solid";
}

export function floorGeometry(item, info, rect) {
    const placement = furniturePlacement(item, info);
    // These are the base on the floor, not the full (often tall) image rectangle.
    const base = info.footprint || (/sofa|bed|counter|sideboard/.test(item.type) ? [.06, .53, .94, .97]
        : /table|desk|chair|stool|ottoman/.test(item.type) ? [.12, .57, .88, .97]
        : [.2, .76, .8, .97]);
    const footprint = {
        left: rect.left + rect.width * (item.flipped ? 1 - base[2] : base[0]),
        right: rect.left + rect.width * (item.flipped ? 1 - base[0] : base[2]),
        top: rect.top + rect.height * base[1], bottom: rect.top + rect.height * base[3],
    };
    return { id: item.id, placement, rect, footprint, depth: footprint.bottom, blocks: placement === "solid" };
}

export function depthLayer(feet, height, order = 0) {
    return 100 + Math.round(clamp(feet / Math.max(1, height), 0, 1) * 1000) * 64 + clamp(order, 0, 59);
}

/** Keep feet clear of the illustrated skirting, including small mobile rooms. */
export function petFloorBounds(roomWidth, roomHeight, petWidth, petHeight) {
    const bottom = Math.max(0, roomHeight - 22);
    const wallClearance = Math.max(12, roomHeight * .05, petHeight * .08);
    return {
        left: Math.min(roomWidth / 2, petWidth / 2 + 5),
        right: Math.max(roomWidth / 2, roomWidth - petWidth / 2 - 5),
        top: Math.min(bottom, Math.max(roomHeight * .44 + wallClearance, petHeight + 5)),
        bottom,
    };
}

export function furnitureLayer(object, roomHeight) {
    const manual = object.item?.layerZ;
    if (Number.isFinite(manual)) return clamp(Math.round(manual), 2, 65000);
    if (object.placement === "rug") return 2;
    if (object.placement === "wall") return 4;
    return depthLayer(object.depth, roomHeight, object.order);
}

/** Reassign existing depth slots, so manual order survives a geometry refresh/resize.
 * Coordinates and collision footprints remain unchanged; automatic sort clears layerZ.
 */
export function moveFurnitureLayer(objects, id, targetIndex) {
    const ordered = [...objects].sort((a, b) => a.z - b.z || a.order - b.order);
    const index = ordered.findIndex(object => object.item.id === id);
    if (index < 0 || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= ordered.length || index === targetIndex) return false;
    let previous = 1;
    const slots = ordered.map(object => previous = Math.max(previous + 1, Math.min(64940, object.z)));
    ordered.splice(targetIndex, 0, ordered.splice(index, 1)[0]);
    ordered.forEach((object, i) => { object.item.order = i; object.item.layerZ = slots[i]; });
    return true;
}

/** Inflate the furniture bases by the pet's foot/body clearance, then route around them. */
export function createFloorPlanner(bounds, furniture, padding = { x: 8, y: 5 }, step = 14) {
    const obstacles = furniture.filter(o => o.blocks).map(({ footprint: r }) => ({
        left: r.left - padding.x, right: r.right + padding.x,
        top: r.top - padding.y, bottom: r.bottom + padding.y,
    }));
    const inside = p => p.x >= bounds.left && p.x <= bounds.right && p.y >= bounds.top && p.y <= bounds.bottom;
    const free = p => inside(p) && !obstacles.some(r => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom);
    const constrain = p => ({ x: clamp(p.x, bounds.left, bounds.right), y: clamp(p.y, bounds.top, bounds.bottom) });
    const clear = (a, b) => {
        if (!free(a) || !free(b)) return false;
        // Slab intersection also rejects diagonal corner cutting.
        return !obstacles.some(r => {
            let low = 0, high = 1;
            for (const [key, min, max] of [["x", r.left, r.right], ["y", r.top, r.bottom]]) {
                const d = b[key] - a[key];
                if (Math.abs(d) < 1e-8) { if (a[key] < min || a[key] > max) return false; }
                else { const v1 = (min - a[key]) / d, v2 = (max - a[key]) / d;
                    low = Math.max(low, Math.min(v1, v2)); high = Math.min(high, Math.max(v1, v2)); }
                if (low > high) return false;
            }
            return true;
        });
    };
    const cols = Math.max(1, Math.ceil((bounds.right - bounds.left) / step));
    const rows = Math.max(1, Math.ceil((bounds.bottom - bounds.top) / step));
    const cells = [];
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) {
        const p = { x: bounds.left + x * (bounds.right - bounds.left) / cols, y: bounds.top + y * (bounds.bottom - bounds.top) / rows };
        cells.push({ ...p, col: x, row: y, index: cells.length, free: free(p) });
    }
    const available = cells.filter(c => c.free);
    const closest = (p, visible = false) => {
        let best = null, cost = Infinity;
        for (const c of available) { const d = distance(p, c); if (d < cost && (!visible || clear(p, c))) { best = c; cost = d; } }
        return best;
    };
    const nearest = p => { const q = constrain(p); return free(q) ? q : closest(q); };
    const route = (start, requested) => {
        if (!free(start)) return [];
        const target = nearest(requested);
        if (!target) return [];
        if (clear(start, target)) return [{ ...start }, { x: target.x, y: target.y }];
        const first = closest(start, true), last = closest(target, true);
        if (!first || !last) return [];
        const open = new Set([first.index]), closed = new Set(), costs = new Map([[first.index, 0]]), parents = new Map();
        while (open.size) {
            let index, best = Infinity;
            for (const i of open) { const score = costs.get(i) + distance(cells[i], last); if (score < best) { best = score; index = i; } }
            const node = cells[index]; open.delete(index);
            if (index === last.index) {
                const path = [{ x: target.x, y: target.y }];
                for (let i = index; i != null; i = parents.get(i)) path.unshift({ x: cells[i].x, y: cells[i].y });
                path.unshift({ ...start });
                const simple = [path[0]];
                for (let i = 0; i < path.length - 1;) {
                    let next = path.length - 1; while (next > i + 1 && !clear(path[i], path[next])) next--;
                    simple.push(path[next]); i = next;
                }
                return simple;
            }
            closed.add(index);
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                const x = node.col + dx, y = node.row + dy;
                if (x < 0 || y < 0 || x > cols || y > rows) continue;
                const n = cells[y * (cols + 1) + x];
                if (!n.free || closed.has(n.index) || !clear(node, n)) continue;
                const cost = costs.get(index) + distance(node, n);
                if (cost >= (costs.get(n.index) ?? Infinity)) continue;
                costs.set(n.index, cost); parents.set(n.index, index); open.add(n.index);
            }
        }
        return []; // A sealed-off area is not reachable; never teleport through it.
    };
    return { free, clear, nearest, route, available, bounds, obstacles };
}

export function pathLength(path) { return path.slice(1).reduce((sum, p, i) => sum + distance(path[i], p), 0); }
export function pointOnPath(path, progress) {
    const total = pathLength(path); let remaining = clamp(progress, 0, 1) * total;
    for (let i = 1; i < path.length; i++) {
        const d = distance(path[i - 1], path[i]);
        if (remaining <= d && d) { const t = remaining / d; return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, y: path[i - 1].y + (path[i].y - path[i - 1].y) * t }; }
        remaining -= d;
    }
    return path.at(-1);
}
