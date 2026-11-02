const collections = [
    {
        id: "cozy-modern",
        label: "코지 모던",
        description: "밝은 우드 · 버터 크림 · 세이지 · 코랄",
        folder: "cozy-illustrated",
        prefix: "cozy-ill",
        items: [
            ["sofa","둥근 크림 소파",32,"rest"],
            ["bed","세이지 우드 침대",25,"rest"],
            ["coffee-table","버터 라운드 테이블",23,"relax"],
            ["desk","라운드 작업 책상",24,"read"],
            ["chair","세이지 우드 의자",12,"rest"],
            ["bookshelf","우드 오픈 책장",16,"read"],
            ["sideboard","크림 수납장",24,"admire"],
            ["floor-lamp","버터 플로어 조명",10,"relax"],
            ["rug","세이지 타원 러그",38,"play"],
            ["window","린넨 커튼 창문",27,"view"],
            ["plant","코랄 화분 식물",11,"view"],
            ["flower-vase","튤립 크림 화병",6,"admire"],
            ["tea-tray","머그와 작은 트레이",8,"relax"],
            ["wall-art","작은 보태니컬 액자",8,"admire"],
            ["cat-house","고양이 아치 숨숨집",12,"play"]
        ],
        layout: [
            ["rug",29,65,42],
            ["window",24.4,2.4,27],
            ["wall-art",84.1,9.6,8],
            ["bookshelf",9.5,20.5,16],
            ["sideboard",49.9,31.7,23],
            ["flower-vase",65.5,19.5,6],
            ["bed",75,28.9,25],
            ["floor-lamp",26.9,31.9,10],
            ["sofa",34.4,46.2,33],
            ["desk",1.6,53.5,24],
            ["chair",7.4,63.7,12],
            ["coffee-table",38.6,71,24.3],
            ["tea-tray",47.1,68,7.9],
            ["cat-house",73.8,58.9,11.9],
            ["plant",0.1,27.7,11]
        ],
        cat: [84.8,75.8,9],
    },
    {
        id: "penthouse",
        label: "미드나잇 펜트하우스",
        description: "쿨그레이 · 더스티 블루 · 모던 호텔",
        folder: "midnight-illustrated",
        prefix: "midnight-ill",
        items: [
            ["sofa","펄 모듈 소파",32,"rest"],
            ["bed","블루그레이 플랫폼 침대",25,"rest"],
            ["coffee-table","그래파이트 라운드 테이블",23,"relax"],
            ["lounge-chair","더스티 블루 라운지 체어",16,"rest"],
            ["sideboard","슬레이트 수납장",24,"read"],
            ["floor-lamp","실버 아크 조명",10,"relax"],
            ["rug","쿨그레이 오벌 러그",38,"play"],
            ["plant","슬레이트 화분 나무",11,"view"],
            ["wall-art","블루 추상 액자",10,"admire"],
            ["book-cup","미드나잇 커피 스테이션",17,"relax"],
            ["vase","실버 가지 화병",6,"admire"],
            ["table-lamp","화이트 오브 조명",7,"relax"],
            ["desk","쿨그레이 작업 데스크",24,"read"],
            ["ottoman","인디고 낮은 스툴",11,"rest"],
            ["cat-house","그레이 아치 고양이 하우스",12,"play"]
        ],
        layout: [
            ["rug",31.3,65.6,42],
            ["wall-art",14.5,8.7,10],
            ["sideboard",50,32.1,24.1],
            ["vase",64,17.2,6],
            ["bed",74.8,33.1,25],
            ["floor-lamp",68.4,24.9,10],
            ["sofa",35.4,55.9,33],
            ["desk",0.8,25.1,23.9],
            ["lounge-chair",4.1,37.3,16],
            ["coffee-table",39.3,75.9,24],
            ["book-cup",28.6,22.1,17],
            ["cat-house",23.8,59.4,11],
            ["plant",1.9,70.3,11],
            ["table-lamp",53,19.1,7]
        ],
        cat: [75.5,70.9,9],
    },
    {
        id: "princess",
        label: "로즈 리본 룸",
        description: "로즈핑크 · 아이보리 · 작은 리본 포인트",
        folder: "ribbon-illustrated",
        prefix: "ribbon-ill",
        items: [
            ["bed","리본 캐노피 침대",28,"rest"],
            ["sofa","로즈 스캘럽 소파",28,"rest"],
            ["vanity","리본 거울 화장대",21,"admire"],
            ["chair","꽃잎 쿠션 의자",12,"rest"],
            ["wardrobe","아이보리 리본 옷장",17,"admire"],
            ["side-table","스캘럽 사이드 테이블",11,"relax"],
            ["rug","로즈 플라워 러그",38,"play"],
            ["floor-lamp","리본 플로어 조명",10,"relax"],
            ["window","로즈 커튼 창문",25,"view"],
            ["bookshelf","리본 작은 책장",14,"read"],
            ["flower-vase","작은 장미 화병",6,"admire"],
            ["tea-tray","딸기 티타임 트레이",8,"relax"],
            ["wall-art","리본 꽃 액자",8,"admire"],
            ["cushion","꽃 리본 쿠션",8,"rest"],
            ["cat-house","로즈 고양이 숨숨집",12,"play"]
        ],
        layout: [
            ["rug",29.4,65.4,42],
            ["window",30.4,1.1,27],
            ["wall-art",7.5,4.7,8],
            ["bookshelf",36.9,22.3,14],
            ["wardrobe",83,10,17],
            ["bed",56.4,9.6,28],
            ["vanity",0.2,12.5,22.9],
            ["flower-vase",11.5,22.4,6],
            ["sofa",36.6,52.3,29],
            ["floor-lamp",21.7,13.4,10],
            ["chair",5.6,37.5,12],
            ["side-table",44.8,69.2,12],
            ["tea-tray",46.7,67.5,7.9],
            ["cushion",79.1,65.3,7],
            ["cat-house",15.6,68.1,12]
        ],
        cat: [78.3,59.6,9],
    }
];

const placement = id => id === "rug" ? "rug" : ["window", "wall-art"].includes(id) ? "wall"
    : ["flower-vase", "vase", "tea-tray", "table-lamp", "cushion"].includes(id) ? "surface" : "solid";
export const ILLUSTRATED_FURNITURE = Object.fromEntries(collections.flatMap(theme =>
    theme.items.map(([id, label, width, reaction]) => [theme.prefix + "-" + id, {
        label, width, reaction, placement: placement(id), theme: theme.id,
        order: placement(id) === "solid" ? 12 : 2,
        image: theme.folder + "/" + id + ".webp",
        thumbnail: theme.folder + "/thumbs/" + id + ".webp",
    }])
));
export const SLEEPING_CAT_FURNITURE = Object.fromEntries(["cozy-modern", "penthouse", "princess", "greenhouse", "industrial"].map(theme =>
    ["sleeping-cat-" + theme, {
        label: "자고 있는 고양이", width: 9, reaction: "view", placement: "solid", theme, order: 12,
        image: "shared-illustrated/sleeping-cat.webp", thumbnail: "shared-illustrated/thumbs/sleeping-cat.webp",
    }]
));
export const ILLUSTRATED_THEMES = Object.fromEntries(collections.map(theme => [theme.id, {
    label: theme.label, description: theme.description, aspectRatio: 1.55,
    wallpaper: "builtin:" + theme.folder + "/wallpaper.webp", floor: "builtin:" + theme.folder + "/floor.webp",
    furniture: [
        ...theme.layout.map(([id, x, y, width], order) => ({
            id: theme.prefix + "-default-" + id, type: theme.prefix + "-" + id, x, y, width, order, flipped: false,
        })),
        { id: "sleeping-cat-default-" + theme.id, type: "sleeping-cat-" + theme.id, x: theme.cat[0], y: theme.cat[1], width: theme.cat[2], order: 30, flipped: false },
    ],
}]));
