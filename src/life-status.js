/** One small activity button; listeners open the relevant existing popup. */
const activities = new Map();
let button = null;
export function refreshLifeStatus() {
    const visible = [...activities.entries()].filter(([, a]) => a.event !== "stvp-open-house" || !document.querySelector(".stvp-house-modal"));
    if (!visible.length) { button?.remove(); button = null; return; }
    if (!button) {
        button = document.createElement("button"); button.type = "button"; button.id = "saipet-life-status";
        button.setAttribute("aria-live", "polite"); document.body.append(button);
    }
    const [key, current] = visible[0];
    button.textContent = current.label + (visible.length > 1 ? ` · +${visible.length - 1}` : "");
    button.title = visible.map(([, a]) => a.label).join("\n") + "\n눌러서 열기";
    button.onclick = () => {
        document.dispatchEvent(new CustomEvent(current.event));
        if (current.once && activities.get(key) === current) { activities.delete(key); refreshLifeStatus(); }
    };
}
/** `once`: a notice that disappears as soon as it is opened. */
export function beginLifeActivity(key, label, event, { once = false } = {}) {
    const activity = { label, event, once }; activities.set(key, activity); refreshLifeStatus();
    return () => { if (activities.get(key) === activity) activities.delete(key); refreshLifeStatus(); };
}
export function clearLifeActivities() { activities.clear(); refreshLifeStatus(); }
