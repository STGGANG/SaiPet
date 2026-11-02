/** Floral greenhouse room; each furniture piece is a separate transparent image. */
const assets = [
    ["sofa", "세이지 꽃잎 소파", 29, "rest", "solid"],
    ["counter", "스캘럽 카페 카운터", 27, "relax", "solid"],
    ["coffee-table", "버터 라운드 테이블", 20, "relax", "solid"],
    ["lounge-chair", "튤립 등받이 의자", 12, "rest", "solid"],
    ["wall-shelf", "꽃과 허브 벽 선반", 21, "view", "wall"],
    ["pendant-light", "튤립 펜던트 조명", 10, "admire", "wall"],
    ["rug", "플라워 오벌 러그", 38, "play", "rug"],
    ["tree", "아이보리 고무나무 화분", 14, "view", "solid"],
    ["monstera", "버터 몬스테라 화분", 13, "view", "solid"],
    ["hanging-plant", "아이비 행잉 화분", 12, "view", "wall"],
    ["flower-vase", "튤립 피처 화병", 7, "admire", "surface"],
    ["book-cup", "꽃받침 커피와 책", 10, "read", "surface"],
    ["espresso-machine", "그린 에스프레소 머신", 13, "relax", "surface"],
    ["herb-stand", "두 단 허브 스탠드", 12, "view", "solid"],
    ["stool", "데이지 쿠션 스툴", 10, "rest", "solid"],
];
export const GARDEN_FURNITURE = Object.fromEntries(assets.map(([name,label,width,reaction,placement]) => ["garden-floral-" + name, {
    label, width, reaction, placement, theme: "greenhouse", order: placement === "solid" ? 12 : 2,
    image: "greenhouse-floral/" + name + ".webp", thumbnail: "greenhouse-floral/thumbs/" + name + ".webp",
}]));
const layout = [
    ["rug", 32, 66, 39], ["wall-shelf", 10, 5, 23], ["pendant-light", 45, 0, 12],
    ["hanging-plant", 81, 1, 13], ["tree", 84, 21, 14],
    ["sofa", 58, 28, 30], ["counter", 2.5, 37.5, 27],
    ["coffee-table", 42, 55, 20], ["lounge-chair", 33, 50, 12],
    ["lounge-chair", 60, 51, 12, "right"],
    ["espresso-machine", 6, 22.5, 12], ["flower-vase", 21, 26.5, 7],
    ["book-cup", 46.5, 52.5, 9], ["stool", 10.5, 54.5, 10],
];
export const GARDEN_THEME = {
    label: "온실 가든 카페", description: "튤립 · 꽃잎 가구 · 아치형 온실", aspectRatio: 1.55,
    wallpaper: "builtin:greenhouse-floral/wallpaper.webp", floor: "builtin:greenhouse-floral/floor.webp",
    furniture: layout.map(([name,x,y,width,suffix],order) => ({ id: "garden-floral-default-"+name+(suffix ? "-"+suffix : ""), type: "garden-floral-"+name, x,y,width,order,flipped:suffix === "right" })),
};
