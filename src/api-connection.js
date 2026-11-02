/** Connection-only fields: never import another extension's roleplay prompt into SaiPet. */
export function connectionOverrides(profile, context = {}) {
    const current = context.chatCompletionSettings || {};
    const source = profile
        ? context.CONNECT_API_MAP?.[profile.api]?.source || profile.api
        : current.chat_completion_source;
    if (source !== "vertexai") return {};
    const preset = profile?.preset ? context.getPresetManager?.("openai")?.getCompletionPresetByName?.(profile.preset) || {} : {};
    const value = key => profile?.[key] ?? preset[key] ?? current[key];
    const auth = value("vertexai_auth_mode") || "express";
    if (!["express", "full"].includes(auth)) throw new Error("Vertex AI 인증 방식을 확인해 주십시오.");
    // Same region as the chosen profile (its API URL) or the current connection; global only when none is set.
    const region = (profile ? profile["api-url"] || value("vertexai_region") : current.vertexai_region) || "global";
    return {
        vertexai_region: region,
        vertexai_auth_mode: auth,
        vertexai_express_project_id: value("vertexai_express_project_id") || "",
        use_sysprompt: true,
        responseMimeType: "application/json",
    };
}
