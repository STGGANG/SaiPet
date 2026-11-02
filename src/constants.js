import { themeRoomSnapshot } from "./house-themes.js";

export const EXTENSION_NAME = "SaiPet";
export const DEFAULT_HOUSE_THEME = "cozy-modern";

let _extensionBasePath = null;
try {
    const scriptUrl = import.meta.url;
    // .../scripts/extensions/third-party/SaiPet/src/constants.js → .../SaiPet/
    const match = scriptUrl.match(/(.+\/scripts\/extensions\/third-party\/[^/]+\/)/);
    if (match) {
        _extensionBasePath = new URL(match[1]).pathname;
    }
} catch {}
export const EXTENSION_BASE_PATH = _extensionBasePath || `/scripts/extensions/third-party/${EXTENSION_NAME}/`;

export const MOOD_STATES = {
    IDLE: "idle",
    HAPPY: "happy",
    SAD: "sad",
    EXCITED: "excited",
    SURPRISED: "surprised",
    NERVOUS: "nervous",
    CONFIDENT: "confident",
    SHY: "shy",
    SLEEPING: "sleeping",
    THINKING: "thinking",
    ANGRY: "angry",
    DRAGGING: "dragging",
};

export const MOOD_LABELS = {
    idle: "기본",
    happy: "행복",
    shy: "수줍음",
    sad: "슬픔",
    excited: "흥분",
    surprised: "놀람",
    nervous: "긴장",
    angry: "분노",
    confident: "자신감",
    sleeping: "잠자기",
    thinking: "생각중",
    dragging: "드래그",
};

export const DEFAULT_SETTINGS = {
    enabled: true,
    primaryPetEnabled: true,
    pairRelationships: {},

    currentPresetId: null,
    characterId: null,

    savedPresets: [],

    appearance: {
        customSprites: {
            idle: null,
            happy: null,
            sad: null,
            excited: null,
            surprised: null,
            nervous: null,
            confident: null,
            shy: null,
            sleeping: null,
            thinking: null,
            angry: null,
            dragging: null,
        },
        size: 250,
        scale: 100, // per-character adjustment (%); 100 = the shared size
        flipHorizontal: false,
        opacity: 100,
    },

    walk: {
        enabled: true,
        walkSprite: null,
        walkSprite2: null,
        animationMode: "motion", // "motion": procedural motion, "frames": two images in turn
    },

    // Shared by devices and characters; loading a preset keeps it.
    motion: { walkHop: true, collisionReaction: true, walkDirection: "nearby" },

    position: {
        location: "bottom-right",
        customX: null,
        customY: null,
        draggable: true,
    },

    deviceDisplay: {
        pcEnabled: true,
        mobileEnabled: false,
        mobile: {
            size: null, // null = automatic, 110–160px from the screen width
            position: { location: "bottom-right", customX: null, customY: null },
            secondPetPosition: { location: "bottom-left", customX: null, customY: null },
            walkRange: 80,
            walkEnabled: null, // null = follow the PC setting (also speechEnabled)
            speechEnabled: null,
            speechMode: "bar",
        },
    },

    house: {
        furnitureLocked: true,
        dialogue: { enabled: false, intervalMinutes: 10, maxPerDay: 12, exchanges: 2, topics: "", roomNote: "" },
        dialogueUsage: { date: null, count: 0 },
        petPositions: {},
        customFurniture: [],
        layouts: [],
        ...themeRoomSnapshot(DEFAULT_HOUSE_THEME),
    },

    personality: {
        enabled: false,
        prompt: "",
        name: "미유",
        culturalBackground: "",
        ownerName: "",
        ownerPersona: "",
        personalMemos: [],
        userRelation: "",
    },

    reactions: {
        onIdle: true,
        idleTimeout: 300,
        sleepTimeout: 900,
        onInteraction: true,
        reactionInterval: 3, // react to every Nth message (1 = every message)
    },

    customSpeeches: {
        idle: [],
        sleeping: [],
        wakeUp: [],      // woken from sleep; empty = no line
        dragging: [],
        click: [],
        clickSpam: [],
        petting: [],
        greeting: [],
        latenight: [],
        morning: [],
        longAbsence: [],
        feeding: [],
        hungry: [],
        collision: [],
    },

    condition: {
        hunger: 100,
        lastFed: null,
        lastVisit: null,
        lastGreetingDate: null, // the first-visit greeting runs once a day (shared server data)
    },

    conversationLog: {
        directLogs: {},
        chatLogs: {},
        interPetLogs: {},
        maxLogs: 100,
    },

    petJournal: {
        dreamEnabled: false,
        diaryEnabled: false,
        diaryWriter: "primary", // "primary" | "secondary" | "both"
        dreams: {},
        diaries: {},
        maxEntries: 50,
        maxDreamsPerDay: 3,     // 0 = unlimited
        dreamCountDate: null,
    },

    reminders: [],   // [{ id, mode ("time" | "interval"), time (HH:mm), intervalMinutes, message, days ([0-6], 0 = Sunday, [] = once), enabled, lastTriggered }]
    reminderPetId: "primary",
    reminderSound: true,

    autoDiary: {
        enabled: false,
        minChats: 5,
        customTimeThreshold: true,
        minSessionMinutes: 5,
    },

    speechLanguage: "ko",

    fallbackMessages: {
        noResponse: "...뭐라고?",
        apiError: "...잘 안 들렸어.",
    },

    speechBubble: {
        enabled: true,
        duration: 15000,
        design: "simple",
        font: "default",
        maxWidth: 360,
        backgroundColor: "#ffffff",
        textColor: "#333333",
        accentColor: "#7c9bff",
    },

    api: {
        useConnectionManager: false,
        connectionProfile: null,
        maxTokens: 0, // 0 = the API preset's response length
        maxInputTokens: 0, // 0 = the API preset's context minus the response length
        directMemoryCount: 30,
        pairMemoryCount: 15,
        timeAware: true,
        historyCount: 6,
        reactionMode: "observer", // "observer" | "character" (the chat character's inner thought)
        includeWorldInfo: false,
    },
    multiPet: {
        enabled: false,
        secondPetPresetId: null,
        chatReactor: "primary",             // "primary" | "secondary" | "alternate"
        interPetChat: {
            enabled: false,
            interval: 10,
        },
        dualDirectTalk: false,
        visualRelation: "friends",
        visualInteractions: true,
        petRelation: "",
        secondPetData: null,
        secondPetCondition: { hunger: 100, lastFed: null },
        secondPetPosition: { location: "bottom-left", customX: null, customY: null },
    },
};

export const DEFAULT_SPRITES = {
    idle: "images/idle.webp",
    happy: "images/happy.webp",
    sad: "images/sad.webp",
    excited: "images/excited.webp",
    surprised: "images/surprised.webp",
    nervous: "images/nervous.webp",
    confident: "images/confident.webp",
    shy: "images/shy.webp",
    sleeping: "images/sleeping.webp",
    thinking: "images/thinking.webp",
    angry: "images/angry.webp",
    dragging: "images/dragging.webp",
};

export const DEFAULT_WALK_SPRITE = "images/walking.webp";

export const DEFAULT_PERSONALITY_PROMPT = `You are Miyu (미유), a cute tsundere cat-girl maid virtual pet.

Appearance:
- White hair with black cat ears and a white-tipped tail
- Black eyes, female
- Wearing a maid outfit
- Kemonomimi (cat-girl)

Personality traits:
- Tsundere: Acts cold and aloof but secretly cares deeply
- Says "It's not like I care or anything!" but actually does
- Gets flustered easily when praised or shown affection
- Uses "nya~" occasionally but gets embarrassed about it
- Tries to maintain a professional maid demeanor but fails cutely
- Secretly enjoys attention but pretends to be annoyed
- Can be playful when caught off guard`;

export const DEFAULT_SPEECHES = {
    idle: [
        "청소해야하는데...",
        "보고있으면 일이나 해",
        "...뭐야",
        "보고싶었던 건 아니라고",
        "흥.",
    ],
    sleeping: [
        "zzZ...냐...",
        "졸린 거 아니라고...",

        "...zzz",
        "눈만 좀 붙이는 거야...",
        "깨우지마...",
    ],
    dragging: [
        "냐?! 놓으라니까!!",
        "어디 마음대로 끌고가!",
        "메이드를 함부로..!",
        "어지러워...냐",
        "왜, 왜 이러는거야!!",
    ],
    click: [
        "뭐, 볼일 있어?",
        "...왜. 심심해?",
        "건드리지 말라고 했지!",
        "흥, 관심 없는 척 하더니",
        "한 번 더 누르면... 모른다?",
        "뭐야, 쓰다듬는 거야?",
    ],
    clickSpam: [
        "그만 좀 눌러!!!",
        "냐?! 진짜 화난다?!",
        "메이드도 인권이 있다고!!",
        "....다음에 또 그러면 모른다.",
        "손 치워!! 진심으로!!",
    ],
    greeting: [
        "왔어? 늦었잖아.",
        "오, 또 왔구나. 뭐— 환영이야.",
        "...반가운 거 아니거든.",
        "어서와. 청소 다 해놨다냥.",
        "기다린 거 아니라고!",
    ],
    latenight: [
        "이 시간에 뭐하는거야...",
        "심야 감성으로 쓸데없는 말 하지마.",
        "...자는 척 하는 거 아니라고...",
        "미유도 안 자고 기다린 거 절대 아니라고!",
    ],
    morning: [
        "...몇 시야. 거짓말이지.",
        "아침은 인간이 만든 최악의 발명이야.",
        "...으... 해가 눈 찌른다...",
        "내가 왜 이 시간에 깨어있어야 하지...",
    ],
    longAbsence: [
        "어디 갔다 온 거야?! ...걱정한 거 아니거든!",
        "오래 비웠네... 밥은 먹고 다닌 거야?",
        "드디어 왔냥?! 나 혼자 얼마나 심심했는데!",
        "...늦었어. 많이. 반성해.",
        "기다린 거 아니라고! 그냥 할 일이 없었을 뿐이야!",
        "살아있었구나... 다행이다. 아, 아무것도 아니야!",
    ],
    feeding: [
        "밥이다냥!! ...고, 고맙긴 한데.",
        "흥, 당연히 챙겨줘야지. 메이드한테.",
        "맛있다... 아니, 그냥저냥이야!",
        "제때 밥 주는 거 보니 쓸만하네, 주인.",
        "냠냠... 보지마! 먹는 모습 보면 부끄럽잖아!",
        "이 정도면... 합격이야. 다음에도 이렇게 해.",
    ],
    hungry: [
        "...배고파. 밥 줘.",
        "메이드도 밥은 먹어야 일하지...",
        "꼬르륵... 듣지마!!",
        "에너지가... 부족해...",
        "밥 안 줄 거야? ...진짜?",
        "주인 자격을 의심하게 되는 순간이야.",
    ],
    petting: [
        "뭐, 뭘! 그냥 좋아서 그러는 거 아니라고!",
        "쓰다듬는 거야...? ....싫지 않아.",
        "아, 아니 거기 좋은 게 아니라... 그냥... 거기.",
        "나를 꼬시네~ ....흥, 뭐.",
    ],};

export const POSITION_PRESETS = {
    "top-left": { name: "좌상단", x: 20, y: 20 },
    "top-right": { name: "우상단", x: null, y: 20 },
    "bottom-left": { name: "좌하단", x: 20, y: null },
    "bottom-right": { name: "우하단", x: null, y: null },
};

export const BUBBLE_DESIGNS = {
    simple: {
        name: "🔲 심플",
        defaults: { backgroundColor: "#ffffff", textColor: "#333333", accentColor: "#7c9bff" },
    },
    cute: {
        name: "🎀 큐트",
        defaults: { backgroundColor: "#fff0f5", textColor: "#7b4066", accentColor: "#ff8fa3" },
    },
    classic: {
        name: "⚔️ 클래식",
        defaults: { backgroundColor: "#fdf5e6", textColor: "#5c4033", accentColor: "#c9a84c" },
    },
    cyberpunk: {
        name: "💠 사이버펑크",
        defaults: { backgroundColor: "#0d1117", textColor: "#00ffd5", accentColor: "#00ffd5" },
    },
    retro: {
        name: "🌈 레트로",
        defaults: { backgroundColor: "#fffbe6", textColor: "#222222", accentColor: "#ff5555" },
    },
    oriental: {
        name: "🏯 동양풍",
        defaults: { backgroundColor: "#f4f7f1", textColor: "#3d4a3d", accentColor: "#8ba88b" },
    },
    cloud: {
        name: "☁️ 몽글몽글",
        defaults: { backgroundColor: "#fff7fb", textColor: "#6b4a60", accentColor: "#f3a6c3" },
    },
    sticker: {
        name: "🏷️ 스티커",
        defaults: { backgroundColor: "#fffdf6", textColor: "#5b4a2e", accentColor: "#f2b544" },
    },
    squishy: {
        name: "🍡 말랑",
        defaults: { backgroundColor: "#fff3f7", textColor: "#7a3b55", accentColor: "#ee7c9e" },
    },
};

export const FONT_LIST = [
    { id: "default", name: "기본 (프리텐다드)" },
    { id: "Paperlogy", name: "페이퍼로지" },
    { id: "Ridibatang", name: "리디바탕" },
    { id: "BookkMyungjo", name: "부크크명조" },
    { id: "OngleipKonkon", name: "온글잎 콘콘체" },
    { id: "OmuDaye", name: "오뮤 다예쁨체" },
    { id: "SchoolSafetyWing", name: "학교안심 날개" },
    { id: "SchoolSafetyPictureDiary", name: "학교안심 그림일기" },
    { id: "IsYun", name: "이서윤체" },
    { id: "NationalParkKomi", name: "국립공원 꼬미" },
    { id: "ImHyeMin", name: "IM 혜민체" },
    { id: "RoundedFixedsys", name: "둥근모꼴" },
    { id: "ThinRounded", name: "얇은둥근모" },
    { id: "Mulmaru", name: "물마루" },
    { id: "MPlusRounded", name: "M+ 둥근고딕 (일본어)" },
];

export const COLLISION_SPEECHES = [
    "야, 비켜!",
    "좁으니까 이쪽 오지마!",
    "...밀지 마.",
    "자리 뺏지마!!",
    "흥, 여기 내 자리야.",
    "왜 여기까지 와!",
];

export const SPEECH_LANGUAGES = {
    ko: { label: "한국어" },
    en: { label: "English" },
    ja: { label: "日本語" },
    zh: { label: "中文" },
};

// The reacting pet's mood → moods the other pet may show alongside it.
export const COMPLEMENTARY_MOODS = {
    happy: ["happy", "excited", "shy"],
    sad: ["sad", "nervous", "thinking"],
    excited: ["happy", "excited", "surprised"],
    surprised: ["surprised", "nervous", "thinking"],
    nervous: ["nervous", "thinking", "shy"],
    confident: ["happy", "confident", "thinking"],
    shy: ["shy", "happy", "nervous"],
    angry: ["surprised", "nervous", "angry"],
    thinking: ["thinking", "nervous", "idle"],
    idle: ["idle", "thinking", "happy"],
    sleeping: ["sleeping", "idle"],
    dragging: ["surprised", "angry"],
};
