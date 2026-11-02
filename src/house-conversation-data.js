import { characterId } from "./character-identity.js";
import { HOUSE_THEMES } from "./house-themes.js";
import { furnitureInfo } from "./house-data.js";
import { buildAIInput, dateTimeLine } from "./ai-context.js";

export function houseDialogueSettings(settings) {
    const value = settings.house?.dialogue || {};
    const number = (key, fallback, min, max = Number.MAX_SAFE_INTEGER) => Number.isFinite(Number(value[key])) ? Math.max(min, Math.min(max, Number(value[key]))) : fallback;
    return { enabled: value.enabled === true, intervalMinutes: number("intervalMinutes", 10, .25),
        maxPerDay: Math.floor(number("maxPerDay", 12, 0)), exchanges: Math.floor(number("exchanges", 2, 1, 10)),
        topics: typeof value.topics === "string" ? value.topics : "", roomNote: typeof value.roomNote === "string" ? value.roomNote : "" };
}
export function houseActors(settings) {
    const found = new Set(), actors = [];
    for (const slot of settings.house?.occupants || []) {
        const data = slot === "primary" ? settings : slot === "secondary" ? settings.multiPet?.secondPetData
            : settings.savedPresets?.find(p => slot === "preset:" + p.id);
        if (!data) continue;
        const id = slot.startsWith("preset:") ? "pet:" + slot.slice(7) : characterId(settings, slot);
        if (found.has(id)) continue;
        found.add(id); actors.push({ slot, id, name: data.personality?.name || data.name || "캐릭터", data });
    }
    return actors;
}
export function houseRoomContext(settings) {
    const room = settings.house || {}, config = houseDialogueSettings(settings);
    const themes = new Set(), items = room.furniture || [];
    let mixed = !items.length;
    for (const item of items) {
        const theme = furnitureInfo(item)?.theme;
        if (!theme || item.type === "custom") mixed = true;
        else themes.add(theme);
    }
    const theme = themes.size === 1 ? HOUSE_THEMES[[...themes][0]] : null;
    if (!theme || themes.size !== 1 || room.wallpaper !== theme.wallpaper || room.floor !== theme.floor) mixed = true;
    const label = mixed ? "한 방" : theme.label;
    const text = (mixed ? "The room combines furnishings or custom decor; no single style or venue is established, so do not invent one." : `Room atmosphere: ${theme.label}. ${theme.description || ""}.`)
        + (config.roomNote.trim() ? `\nUser-provided room setting: ${config.roomNote.trim()}` : "");
    return { label, text };
}
export function housePairInputSettings(settings, actors) {
    const [a, b] = actors;
    const relationKey = JSON.stringify(actors.map(actor => actor.id).sort());
    const currentPair = JSON.stringify([characterId(settings), characterId(settings, "secondary")].sort());
    const relation = relationKey === currentPair ? settings.multiPet?.petRelation : settings.pairRelationships?.[relationKey]?.petRelation;
    return { ...settings, characterId: a.id.slice(4), personality: a.data.personality,
        multiPet: { ...settings.multiPet, petRelation: relation || "", secondPetPresetId: b.id.slice(4), secondPetData: { ...b.data, characterId: b.id.slice(4) } } };
}
export function houseDailyCount(settings, date) {
    const usage = settings.house?.dialogueUsage;
    return usage?.date === date ? Math.max(0, Number(usage.count) || 0) : 0;
}

const str = value => typeof value === "string" ? value : "";
/** Every resident has an explicit identity; desktop visibility never assigns speakers.
 * `addressee` (a resident's name, or "all") marks a message from the user for the houseTalk task. */
export function buildHouseAIInput(settings, context, actors, request, { task = "housePair", addressee = null, now = new Date() } = {}) {
    const individual = actors.map(actor => buildAIInput({ ...settings, characterId: actor.id.slice(4), personality: actor.data.personality }, context, task, ["primary"], request));
    const input = individual[0];
    input.characters = individual.map((part,i) => ({ ...part.characters[0], name: actors[i].name }));
    const letter = i => String.fromCharCode(65 + i);
    const userPersona = actors.map((actor, i) => {
        const p = actor.data.personality || {};
        return `User information for speaker ${letter(i)} (${actor.name}): address the user as ${str(p.ownerName) || "주인님"}${str(p.ownerPersona) ? "\n" + str(p.ownerPersona) : ""}`;
    }).join("\n") + "\nThe user is the real person using the application, present with the residents; chat characters and roleplay personas are separate.";
    const addressed = addressee === null ? "" : addressee === "all" ? "The user is speaking to everyone in the room." : `The user is speaking to ${addressee} (speaker A).`;
    const relationships = [];
    for (let i = 0; i < actors.length; i++) for (let j = i + 1; j < actors.length; j++) {
        const relation = housePairInputSettings(settings, [actors[i], actors[j]]).multiPet.petRelation;
        if (relation) relationships.push(`${actors[i].name} / ${actors[j].name}: ${relation}`);
    }
    const history = new Map();
    for (const part of individual) for (const record of part.historySources.recentDialogue) history.set(JSON.stringify(record), record);
    input.historySources = { recentDialogue: [...history.values()].sort((a,b) => a.timestamp - b.timestamp) };
    input.sources = { userPersona, pairRelationship: relationships.join("\n"), currentContext: [dateTimeLine(settings, now), addressed].filter(Boolean).join("\n"),
        memories: individual.map((part,i) => part.sources.memories ? `Speaker ${letter(i)} (${actors[i].name}):\n${part.sources.memories.replace(/^Speaker A notes:\n/, '')}` : '').filter(Boolean).join("\n"),
        recentDialogue: input.historySources.recentDialogue.map(e => e.text).join("\n"),
        roomContext: houseRoomContext(settings).text, houseTopics: houseDialogueSettings(settings).topics };
    return input;
}
export function houseDialogueScope(settings) {
    return JSON.stringify({ config: houseDialogueSettings(settings), room: houseRoomContext(settings),
        actors: houseActors(settings).map(a => ({ id: a.id, slot: a.slot, personality: a.data.personality })), relationships: settings.pairRelationships, relation: settings.multiPet?.petRelation });
}
