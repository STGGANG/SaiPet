export const SHARED_FILE_LIMIT = 96 * 1024 * 1024;
export const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function fillDefaults(target, defaults) {
    if (!isRecord(target)) target = {};
    for (const [key, value] of Object.entries(defaults)) {
        if (["__proto__", "constructor", "prototype"].includes(key)) continue;
        if (isRecord(value)) {
            // An empty record default is a free-form map with no keys to fill in. A list
            // stored there is an older layout (pre-v1 logs) that a later migration lifts.
            if (Array.isArray(target[key]) && Object.keys(value).length === 0) continue;
            target[key] = fillDefaults(target[key], value);
        }
        else if (Array.isArray(value)) { if (!Array.isArray(target[key])) target[key] = structuredClone(value); }
        else if (target[key] === undefined || (value !== null && typeof target[key] !== typeof value)) target[key] = value;
    }
    return target;
}

export function validatePreset(preset) {
    if (!isRecord(preset) || !isRecord(preset.appearance) || !isRecord(preset.personality) || !isRecord(preset.customSpeeches)) throw new Error("프리셋의 외형·성격·대사 형식이 올바르지 않습니다.");
    for (const values of Object.values(preset.customSpeeches)) if (!Array.isArray(values) || values.some(v => typeof v !== "string")) throw new Error("커스텀 대사는 문장 목록이어야 합니다.");
    if (preset.appearance.customSprites != null && !isRecord(preset.appearance.customSprites)) throw new Error("이미지 목록 형식이 올바르지 않습니다.");
    for (const value of Object.values(preset.appearance.customSprites || {})) if (value != null && typeof value !== "string") throw new Error("이미지 주소 형식이 올바르지 않습니다.");
    if (preset.walk != null) {
        if (!isRecord(preset.walk)) throw new Error("걷기 설정 형식이 올바르지 않습니다.");
        for (const key of ["walkSprite", "walkSprite2"]) if (preset.walk[key] != null && typeof preset.walk[key] !== "string") throw new Error("걷기 이미지 주소 형식이 올바르지 않습니다.");
        if (preset.walk.animationMode != null && !["motion", "frames"].includes(preset.walk.animationMode)) throw new Error("걷기 표시 방식이 올바르지 않습니다.");
    }
    return preset;
}
