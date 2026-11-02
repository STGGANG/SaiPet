const SCOPES = ['settings', 'records', 'presetsRecords', 'all'];

function clearRecords(next) {
    // Conversation logs (house talks included) and the journal; memos, reminders and journal options stay.
    Object.assign(next.conversationLog ||= {}, { directLogs: {}, chatLogs: {}, interPetLogs: {}, notificationLogs: [] });
    Object.assign(next.petJournal ||= {}, { dreams: {}, diaries: {}, lastDiaryDates: {}, dreamCounts: {}, dreamCountDate: null });
    delete next.petJournal.lastDiaryDate;
    delete next.petJournal.dreamCountToday;
}

function clearPresets(next) {
    next.savedPresets = [];
    // Active characters keep their images and identities, but no longer claim a link to a removed preset.
    next.currentPresetId = null;
    if (next.multiPet) next.multiPet.secondPetPresetId = null;
}

/** Pure reset projections: callers persist atomically and refresh the runtime. */
export function settingsAfterReset(current, defaults, scope) {
    if (!SCOPES.includes(scope)) throw new Error('알 수 없는 초기화 범위입니다.');
    if (scope === 'all') return structuredClone(defaults);
    if (scope !== 'settings') {
        const next = structuredClone(current);
        clearRecords(next);
        if (scope === 'presetsRecords') clearPresets(next);
        return next;
    }
    const next = structuredClone(defaults);
    const keep = (from, to, keys) => { for (const key of keys) if (Object.hasOwn(from || {}, key)) to[key] = structuredClone(from[key]); };
    // Reset common options only. Preserve personal content and unsaved character edits.
    keep(current, next, ['savedPresets', 'currentPresetId', 'characterId', 'customSpeeches', 'fallbackMessages', 'pairRelationships', 'reminders', 'house']);
    keep(current.appearance, next.appearance, ['customSprites', 'scale', 'flipHorizontal']);
    keep(current.walk, next.walk, ['animationMode', 'walkSprite', 'walkSprite2']);
    keep(current.speechBubble, next.speechBubble, ['design', 'font', 'backgroundColor', 'textColor', 'accentColor']);
    keep(current.personality, next.personality, Object.keys(current.personality || {}).filter(key => key !== 'enabled'));
    keep(current.multiPet, next.multiPet, ['secondPetData', 'secondPetPresetId']);
    keep(current.conversationLog, next.conversationLog, ['identityVersion', 'directLogs', 'chatLogs', 'interPetLogs', 'notificationLogs']);
    keep(current.petJournal, next.petJournal, ['identityVersion', 'dreams', 'diaries', 'lastDiaryDate', 'lastDiaryDates', 'dreamCounts', 'dreamCountToday', 'dreamCountDate']);
    return next;
}
