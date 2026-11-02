/** A chat change away and back must also invalidate the old request. */
export function captureChatScope(context, epoch = 0) {
    return {
        epoch,
        chatId: context?.chatId ?? null,
        characterId: context?.characterId ?? null,
        groupId: context?.groupId ?? null,
    };
}

export function matchesChatScope(scope, context, epoch = 0) {
    const current = captureChatScope(context, epoch);
    return Object.keys(current).every(key => current[key] === scope[key]);
}
