const MISSING = Symbol("missing");

function same(a, b) {
    if (a === MISSING || b === MISSING) return a === b;
    return JSON.stringify(a) === JSON.stringify(b);
}

function isRecord(value) {
    return value !== MISSING && value !== null && typeof value === "object" && !Array.isArray(value);
}

function arrayKey(values) {
    const items = values.flat().filter(value => value !== MISSING);
    if (items.length === 0 || !items.every(isRecord)) return null;
    const uniqueWithinEachList = key => values.every(list => {
        const ids = list.map(item => String(item[key]));
        return ids.length === new Set(ids).size;
    });
    if (items.every(item => item.id !== undefined && item.id !== null) && uniqueWithinEachList("id")) return "id";
    const timestamped = items.every(item => item.timestamp !== undefined && item.timestamp !== null);
    if (timestamped && uniqueWithinEachList("timestamp")) return "timestamp";
    // Log entries written in one tick can share a timestamp; they are append-only, so content identifies them.
    return timestamped ? CONTENT : null;
}

const CONTENT = Symbol("content");

function toMap(items, key, path) {
    const map = new Map();
    const seen = new Map();
    for (const item of items) {
        let id;
        if (key === CONTENT) {
            const json = JSON.stringify(item);
            const n = (seen.get(json) || 0) + 1;
            seen.set(json, n);
            id = `${json}#${n}`;
        } else {
            id = String(item[key]);
            if (map.has(id)) throw new Error(`중복된 ${key} 때문에 자동 병합할 수 없습니다: ${path}`);
        }
        map.set(id, item);
    }
    return map;
}

// Room layout and pet positions are cosmetic and change on every drag; the latest device wins.
const LAST_WRITER_WINS = /^data\.(house|houseData)(\.|\[|$)/;

function mergeValue(base, local, remote, path) {
    if (same(local, base)) return remote;
    if (same(remote, base) || same(local, remote)) return local;

    if (isRecord(local) && isRecord(remote) && (isRecord(base) || base === MISSING)) {
        const before = isRecord(base) ? base : {};
        const merged = {};
        const keys = new Set([...Object.keys(before), ...Object.keys(local), ...Object.keys(remote)]);
        for (const key of keys) {
            const child = mergeValue(
                Object.hasOwn(before, key) ? before[key] : MISSING,
                Object.hasOwn(local, key) ? local[key] : MISSING,
                Object.hasOwn(remote, key) ? remote[key] : MISSING,
                `${path}.${key}`,
            );
            if (child !== MISSING) merged[key] = child;
        }
        return merged;
    }

    if (Array.isArray(local) && Array.isArray(remote) && (Array.isArray(base) || base === MISSING)) {
        const before = Array.isArray(base) ? base : [];
        const key = arrayKey([before, local, remote]);
        if (key) {
            const baseMap = toMap(before, key, path);
            const localMap = toMap(local, key, path);
            const remoteMap = toMap(remote, key, path);
            const keys = new Set([...remoteMap.keys(), ...localMap.keys(), ...baseMap.keys()]);
            const merged = [];
            for (const id of keys) {
                const item = mergeValue(
                    baseMap.has(id) ? baseMap.get(id) : MISSING,
                    localMap.has(id) ? localMap.get(id) : MISSING,
                    remoteMap.has(id) ? remoteMap.get(id) : MISSING,
                    `${path}[${id}]`,
                );
                if (item !== MISSING) merged.push(item);
            }
            return merged;
        }

        // Concurrent additions to a plain list can be combined when both kept
        // the shared prefix. Reordering or editing the same item needs a reload.
        const keptPrefix = list => list.length >= before.length
            && before.every((value, i) => same(value, list[i]));
        if (keptPrefix(local) && keptPrefix(remote)) {
            const result = [...before, ...remote.slice(before.length)];
            for (const item of local.slice(before.length)) {
                if (!result.some(existing => same(existing, item))) result.push(item);
            }
            return result;
        }
    }

    if (LAST_WRITER_WINS.test(path)) return local;
    throw new Error(`두 기기에서 같은 항목을 동시에 수정했습니다: ${path}`);
}

export function mergeServerData(base, local, remote) {
    return mergeValue(base ?? {}, local ?? {}, remote ?? {}, "data");
}
