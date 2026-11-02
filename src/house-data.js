import { THEMED_FURNITURE } from "./house-themes.js";
export const FURNITURE = THEMED_FURNITURE;
export const AVAILABLE_FURNITURE = Object.fromEntries(Object.entries(FURNITURE).filter(([, info]) => info.theme));
export const FURNITURE_REACTIONS = {
    none: { label: "반응 없음", icons: [] },
    rest: { label: "쉬기", icons: ["relaxed", "moon"] },
    read: { label: "독서", icons: ["book", "glasses"] },
    play: { label: "놀기", icons: ["music", "game"] },
    relax: { label: "여유 즐기기", icons: ["coffee", "tea"] },
    view: { label: "구경하기", icons: ["sun", "leaf"] },
    admire: { label: "감상하기", icons: ["sparkle", "smile"] },
};
export function furnitureInfo(item) {
    if (!item || typeof item !== "object") return null;
    if (item.type === "custom" && typeof item.image === "string" && item.image) {
        return { label: item.label || "내 가구", image: item.image, width: 22, reaction: item.reaction || "admire", custom: true };
    }
    return Object.hasOwn(FURNITURE, item.type) ? FURNITURE[item.type] : null;
}
export function orderedFurniture(items) {
    return items.filter(item => furnitureInfo(item)).map((item, index) => ({ item, index }))
        .sort((a, b) => (Number.isFinite(a.item.order) ? a.item.order : FURNITURE[a.item.type]?.order ?? 12)
            - (Number.isFinite(b.item.order) ? b.item.order : FURNITURE[b.item.type]?.order ?? 12) || a.index - b.index)
        .map(({ item }) => item);
}
/** Room data stays inside the server-backed house object. Snapshots never nest. */
export function roomSnapshot(room) {
    return structuredClone({
        wallpaper: room.wallpaper || null, floor: room.floor || null,
        aspectRatio: Number.isFinite(room.aspectRatio) && room.aspectRatio >= 1 && room.aspectRatio <= 2 ? room.aspectRatio : null,
        furniture: room.furniture || [], occupants: room.occupants || ["primary"], petPositions: room.petPositions || {},
    });
}
export function applyRoomSnapshot(room, snapshot) {
    if (!snapshot || !Array.isArray(snapshot.furniture) || !Array.isArray(snapshot.occupants)) throw new Error("잘못된 방 배치입니다.");
    Object.assign(room, roomSnapshot(snapshot));
}
export function furnitureReaction(item) {
    const key = item.reaction ?? furnitureInfo(item)?.reaction ?? "none";
    return FURNITURE_REACTIONS[key] || FURNITURE_REACTIONS.none;
}
