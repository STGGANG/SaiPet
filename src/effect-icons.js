/** Semantic effect keys → Font Awesome icon + color, shared by particles, emotes and furniture reactions. */
const PINK = "#EE7C9E", BUTTER = "#F2B544", LAVENDER = "#a78bfa", ACCENT = "var(--spc-accent, #7c9bff)";
export const EFFECT_ICONS = {
    heart: { icon: "fa-heart", color: PINK },
    heartSoft: { icon: "fa-heart", color: "#f6afc6" },
    heartGold: { icon: "fa-heart", color: BUTTER },
    love: { icon: "fa-heart", color: PINK },
    sparkle: { icon: "fa-star", color: BUTTER },
    moon: { icon: "fa-moon", color: LAVENDER },
    dream: { icon: "fa-cloud-moon", color: LAVENDER },
    thought: { icon: "fa-cloud", color: LAVENDER },
    bolt: { icon: "fa-bolt", color: BUTTER },
    wave: { icon: "fa-hand", color: ACCENT },
    look: { icon: "fa-eye", color: ACCENT },
    question: { icon: "fa-question", color: ACCENT },
    exclaim: { icon: "fa-exclamation", color: ACCENT },
    music: { icon: "fa-music", color: ACCENT },
    steps: { icon: "fa-shoe-prints", color: ACCENT },
    smile: { icon: "fa-face-smile", color: PINK },
    relaxed: { icon: "fa-face-smile-beam", color: PINK },
    smirk: { icon: "fa-face-grin-wink", color: BUTTER },
    cheer: { icon: "fa-hands-clapping", color: BUTTER },
    party: { icon: "fa-wand-magic-sparkles", color: PINK },
    book: { icon: "fa-book-open", color: "#6c8ec7" },
    glasses: { icon: "fa-glasses", color: "#6c8ec7" },
    game: { icon: "fa-gamepad", color: "#7c9bff" },
    coffee: { icon: "fa-mug-hot", color: "#b0845a" },
    tea: { icon: "fa-mug-saucer", color: "#8ba88b" },
    sun: { icon: "fa-cloud-sun", color: BUTTER },
    leaf: { icon: "fa-leaf", color: "#7fb77e" },
};

export function effectIcon(key, className = "") {
    const entry = EFFECT_ICONS[key] || EFFECT_ICONS.sparkle;
    const icon = document.createElement("i");
    icon.className = `fa-solid ${entry.icon} saipet-effect-icon${className ? " " + className : ""}`;
    icon.style.color = entry.color;
    icon.setAttribute("aria-hidden", "true");
    return icon;
}
