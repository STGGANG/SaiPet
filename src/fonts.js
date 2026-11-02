// Preset keys are stored in user data; keep them stable when changing URLs.
const FONT_SOURCES = {
    Paperlogy: "https://cdn.jsdelivr.net/gh/projectnoonnu/2408-3@1.0/Paperlogy-4Regular.woff2",
    Ridibatang: "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_twelve@1.0/RIDIBatang.woff",
    BookkMyungjo: "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2302@1.0/BookkMyungjo-Lt.woff2",
    OngleipKonkon: "https://cdn.jsdelivr.net/gh/projectnoonnu/2412-1@1.0/Ownglyph_corncorn-Rg.woff2",
    OmuDaye: "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2304-01@1.0/omyu_pretty.woff2",
    SchoolSafetyWing: "https://cdn.jsdelivr.net/gh/projectnoonnu/2511-1@1.0/HakgyoansimNalgaeR.woff2",
    SchoolSafetyPictureDiary: "https://cdn.jsdelivr.net/gh/projectnoonnu/2408-5@1.0/HakgyoansimGeurimilgiTTF-R.woff2",
    IsYun: "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2202-2@1.0/LeeSeoyun.woff",
    NationalParkKomi: "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2201-2@1.0/KNPSKkomi-Regular00.woff",
    ImHyeMin: "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2106@1.1/IM_Hyemin-Regular.woff2",
    RoundedFixedsys: "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_six@1.2/DungGeunMo.woff",
    ThinRounded: "https://cdn.jsdelivr.net/gh/projectnoonnu/2511-1@1.0/ThinDungGeunMo.woff2",
    Mulmaru: "https://mushsooni.github.io/Mulmaru.ttf",
};

// Japanese faces are huge; Google Fonts splits them by unicode-range so only shown glyphs download.
const STYLESHEET_FONTS = {
    MPlusRounded: { family: "M PLUS Rounded 1c", href: "https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500&display=swap" },
};

const UI_FONT = { family: "Pretendard Variable", href: "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" };
const UI_FALLBACK = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const pending = new Map();

function addStylesheet({ family, href }) {
    if (document.querySelector(`link[data-saipet-font="${family}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.saipetFont = family;
    document.head.append(link);
}

/** Linked from script rather than @import in style.css, so the extension styles never wait for it. */
export const loadInterfaceFont = () => addStylesheet(UI_FONT);

function loadStylesheetFont({ family, href }) {
    addStylesheet({ family, href });
    return new Promise(resolve => {
        const link = document.querySelector(`link[data-saipet-font="${family}"]`);
        const check = () => document.fonts.load(`500 16px "${family}"`, "あ").then(faces => resolve(faces.length > 0), () => resolve(false));
        if (link.sheet) check();
        else {
            link.addEventListener("load", check, { once: true });
            link.addEventListener("error", () => resolve(false), { once: true });
        }
    });
}

function ensureFont(key) {
    if (!globalThis.FontFace || !document.fonts || !(FONT_SOURCES[key] || STYLESHEET_FONTS[key])) return Promise.resolve(false);
    if (!pending.has(key)) {
        if (STYLESHEET_FONTS[key]) {
            pending.set(key, loadStylesheetFont(STYLESHEET_FONTS[key]));
        } else {
            const face = new FontFace(`SaiPet-${key}`, `url("${FONT_SOURCES[key]}")`, { display: "swap" });
            document.fonts.add(face);
            pending.set(key, face.load().then(() => true).catch(() => {
                document.fonts.delete(face);
                console.warn(`[SaiPet] 글꼴을 불러오지 못했습니다: ${key}`);
                return false;
            }));
        }
    }
    return pending.get(key);
}

export function applyFont(node, key) {
    const family = STYLESHEET_FONTS[key]?.family || (FONT_SOURCES[key] && `SaiPet-${key}`);
    if (family) {
        node.setAttribute("data-custom-font", "");
        node.style.setProperty("--spc-font", `"${family}", ${UI_FALLBACK}`);
        return ensureFont(key);
    }
    node.removeAttribute?.("data-custom-font");
    node.style.removeProperty?.("--spc-font");
    return Promise.resolve(false);
}
