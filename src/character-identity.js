/** Record ownership is independent of display names. */
export function characterId(settings, petId = "primary") {
    const id = petId === "secondary"
        ? settings.multiPet?.secondPetData?.characterId || settings.multiPet?.secondPetPresetId || "secondary"
        : settings.characterId || settings.currentPresetId || "default";
    return "pet:" + id;
}
export function characterName(settings, petId = "primary") {
    return petId === "secondary" ? settings.multiPet?.secondPetData?.personality?.name || "펫2" : settings.personality?.name || "미유";
}
export function pairId(settings) {
    return "pair:" + JSON.stringify([characterId(settings), characterId(settings, "secondary")].sort());
}
export function characterData(settings, id) {
    if (id === characterId(settings)) return settings;
    if (id === characterId(settings, "secondary")) return settings.multiPet?.secondPetData || null;
    return settings.savedPresets?.find(p => "pet:" + p.id === id) || null;
}
export function characterLabel(settings, id, fallback = "이전 캐릭터") {
    const data = characterData(settings, id);
    if (!data) return fallback;
    return data.personality?.name || (data === settings || data === settings.multiPet?.secondPetData ? fallback : data.name || fallback);
}
/** Two pets on screen never share an identity: that would merge their histories and break pair requests.
 * v1 kept the last saved preset as current even after the pet was edited back by hand,
 * so when only the second pet still matches that preset, it keeps the preset. */
function separateSlotIdentities(settings) {
    const second = settings.multiPet?.secondPetData;
    if (!second || second.characterId !== settings.characterId) return;
    const sourceName = settings.savedPresets?.find(p => p.id === second.characterId)?.personality?.name;
    if (sourceName && sourceName === second.personality?.name && sourceName !== settings.personality?.name) {
        if (settings.currentPresetId === second.characterId) settings.currentPresetId = null;
        settings.characterId = "default";
    } else second.characterId += "#secondary";
}

/** Never guess which character owns an ambiguous legacy name. */
export function migrateCharacterHistory(settings) {
    settings.characterId ||= settings.currentPresetId || "default";
    if (settings.multiPet?.secondPetData) settings.multiPet.secondPetData.characterId ||= settings.multiPet.secondPetPresetId || "secondary";
    separateSlotIdentities(settings);
    if (settings.conversationLog?.identityVersion === 1 && settings.petJournal?.identityVersion === 1) return;
    const names = new Map();
    const add = (name, id) => { if (!name) return; if (!names.has(name)) names.set(name, new Set()); names.get(name).add(id); };
    add(settings.personality?.name, characterId(settings));
    if (settings.multiPet?.secondPetData) add(settings.multiPet.secondPetData.personality?.name, characterId(settings, "secondary"));
    for (const preset of settings.savedPresets || []) add(preset.personality?.name, "pet:" + preset.id);
    // A saved copy that isn't on screen doesn't make the running pet's history ambiguous;
    // two pets on screen with the same name still do.
    const active = new Set([characterId(settings), ...(settings.multiPet?.secondPetData ? [characterId(settings, "secondary")] : [])]);
    const resolve = name => {
        const ids = [...(names.get(name) || [])];
        if (ids.length === 1) return ids[0];
        const onScreen = ids.filter(id => active.has(id));
        return onScreen.length === 1 ? onScreen[0] : null;
    };
    // Chat reactions from v1.0–1.1 carry no name; they can only be attributed when one character is known.
    const known = new Set([...names.values()].flatMap(ids => [...ids]));
    const soleId = known.size === 1 ? [...known][0] : null;
    const log = settings.conversationLog;
    if (log && log.identityVersion !== 1) {
        if (Array.isArray(log.directLogs)) log.directLogs = { legacy: log.directLogs };
        if (Array.isArray(log.interPetLogs)) log.interPetLogs = { legacy: log.interPetLogs };
        for (const [key, entries] of Object.entries(log.directLogs || {})) for (const e of entries) e.characterId ??= resolve(e.speaker || key) || "legacy:" + (e.speaker || key);
        for (const entries of Object.values(log.interPetLogs || {})) for (const e of entries) {
            e.petAId ??= resolve(e.petAName) || "legacy:" + (e.petAName || "A");
            e.petBId ??= resolve(e.petBName) || "legacy:" + (e.petBName || "B");
        }
        for (const entries of [...Object.values(log.chatLogs || {}), log.notificationLogs || []]) for (const e of entries) e.characterId ??= resolve(e.petName) || (!e.petName && soleId) || "legacy:" + (e.petName || "이름 없음");
        log.identityVersion = 1;
    }
    const journal = settings.petJournal;
    if (journal && journal.identityVersion !== 1) {
        for (const type of ["dreams", "diaries"]) {
            const next = {};
            for (const [name, entries] of Object.entries(journal[type] || {})) {
                const id = name.startsWith("pet:") ? name : resolve(name) || "legacy:" + name;
                (next[id] ||= []).push(...entries.map(e => ({ ...e, characterId: e.characterId || id, petName: e.petName || name })));
            }
            journal[type] = next;
        }
        const counts = {};
        for (const [name, count] of Object.entries(journal.dreamCounts || {})) counts[name.startsWith("pet:") ? name : resolve(name) || "legacy:" + name] = count;
        journal.dreamCounts = counts;
        const dates = journal.lastDiaryDates || {};
        if (dates.primary || journal.lastDiaryDate) dates[characterId(settings)] ||= dates.primary || journal.lastDiaryDate;
        if (dates.secondary) dates[characterId(settings, "secondary")] ||= dates.secondary;
        delete dates.primary; delete dates.secondary;
        journal.lastDiaryDates = dates;
        journal.identityVersion = 1;
    }
}

