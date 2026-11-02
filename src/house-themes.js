import { ILLUSTRATED_FURNITURE, ILLUSTRATED_THEMES, SLEEPING_CAT_FURNITURE } from "./house-illustrated-themes.js";
import { GARDEN_FURNITURE, GARDEN_THEME } from "./house-garden-theme.js";
import { INDUSTRIAL_FURNITURE, INDUSTRIAL_THEME } from "./house-industrial-theme.js";

export const THEMED_FURNITURE = {
    ...GARDEN_FURNITURE, ...ILLUSTRATED_FURNITURE, ...INDUSTRIAL_FURNITURE, ...SLEEPING_CAT_FURNITURE,
};
export const HOUSE_THEMES = {
    ...ILLUSTRATED_THEMES,
    industrial: INDUSTRIAL_THEME,
    greenhouse: {
        ...GARDEN_THEME,
        furniture: [...GARDEN_THEME.furniture, {
            id: "sleeping-cat-default-greenhouse", type: "sleeping-cat-greenhouse", x: 16, y: 81, width: 9, order: 30, flipped: false,
        }],
    },
};

/** Keep the current residents when replacing only the room's decoration. */
export function themeRoomSnapshot(themeId, room = {}) {
    const theme = Object.hasOwn(HOUSE_THEMES, themeId) ? HOUSE_THEMES[themeId] : null;
    if (!theme) throw new Error("알 수 없는 방 테마입니다.");
    return structuredClone({
        wallpaper: theme.wallpaper, floor: theme.floor, aspectRatio: theme.aspectRatio,
        furniture: theme.furniture, occupants: room.occupants || ["primary"], petPositions: room.petPositions || {},
    });
}

const builtInSurfaces = new Set(Object.values(HOUSE_THEMES).flatMap(theme => [theme.wallpaper, theme.floor]));
export function resolveHouseSurface(source, extensionBasePath) {
    if (typeof source !== "string" || !source) return "";
    if (source.startsWith("builtin:")) {
        return builtInSurfaces.has(source) ? extensionBasePath + "images/house/" + source.slice(8) : "";
    }
    return source;
}
