const assets = [
    ["sofa", "워싱 올리브 소파", 32, "rest", "solid"],
    ["bed", "파이프 프레임 침대", 25, "rest", "solid"],
    ["coffee-table", "리클레임 우드 테이블", 24, "relax", "solid"],
    ["desk", "스틸 우드 작업 책상", 24, "read", "solid"],
    ["chair", "블랙 프레임 체어", 12, "rest", "solid"],
    ["locker", "빈티지 메탈 락커", 14, "admire", "solid"],
    ["bookshelf", "철제 오픈 선반", 17, "read", "solid"],
    ["floor-lamp", "워크숍 플로어 조명", 9, "relax", "solid"],
    ["rug", "워싱 빈티지 러그", 40, "play", "rug"],
    ["window", "스틸 격자 창문", 28, "view", "wall"],
    ["plant", "메탈 플랜터 고무나무", 11, "view", "solid"],
    ["wall-art", "테이프 포스터 콜라주", 13, "admire", "wall"],
    ["record-player", "빈티지 턴테이블", 11, "relax", "surface"],
    ["mug-books", "에나멜 머그와 책", 8, "read", "surface"],
    ["cat-house", "우드 크레이트 숨숨집", 12, "play", "solid"]
];
export const INDUSTRIAL_FURNITURE = Object.fromEntries(assets.map(([id, label, width, reaction, placement]) =>
    ["industrial-" + id, {
        label, width, reaction, placement, theme: "industrial", order: placement === "solid" ? 12 : 2,
        image: "industrial-grunge/" + id + ".webp", thumbnail: "industrial-grunge/thumbs/" + id + ".webp",
    }]
));
const layout = [
    ["rug", 27.1, 64, 44],
    ["window", 31.1, 8.2, 30.8],
    ["wall-art", 65, 10.1, 12],
    ["bookshelf", 2.3, 3.5, 16],
    ["locker", 80, 9.1, 10],
    ["bed", 72.2, 53, 26],
    ["sofa", 32.1, 39.2, 34],
    ["floor-lamp", 27.2, 34.5, 6.9],
    ["desk", 3.7, 61.5, 25],
    ["chair", 7.4, 68.8, 9],
    ["coffee-table", 37.6, 69, 24],
    ["record-player", 49.7, 61.8, 9],
    ["mug-books", 13.1, 59.5, 8],
    ["cat-house", 18.6, 32.7, 12],
    ["plant", 89.1, 35.3, 9.9],
];
export const INDUSTRIAL_THEME = {
    label: "인더스트리얼 로프트", description: "콘크리트 · 워싱 올리브 · 빈티지 스틸 · 그런지",
    wallpaper: "builtin:industrial-grunge/wallpaper.webp", floor: "builtin:industrial-grunge/floor.webp", aspectRatio: 1.55,
    furniture: [
        ...layout.map(([id, x, y, width], order) => ({
            id: "industrial-default-" + id, type: "industrial-" + id, x, y, width, order, flipped: false,
        })),
        { id: "sleeping-cat-default-industrial", type: "sleeping-cat-industrial", x: 67.8, y: 41.3, width: 9, order: 30, flipped: false },
    ],
};
