import { buildPromptRequest, PROMPT_SOURCES } from './prompts/builder.js';

const positive = (...values) => values.map(Number).find(n => Number.isSafeInteger(n) && n > 0);
export function resolveTokenLimits(api, context, profile, currentAPI = 'openai', currentOutput) {
    const kind = profile ? context.CONNECT_API_MAP?.[profile.api]?.selected || 'openai' : currentAPI;
    const preset = profile?.preset ? context.getPresetManager?.(kind)?.getCompletionPresetByName?.(profile.preset) : null;
    if (profile?.preset && !preset) throw new Error('선택한 연결 프로필의 API 프리셋을 찾을 수 없습니다.');
    const current = kind === 'openai' ? context.chatCompletionSettings || {} : context.textCompletionSettings || {};
    const source = preset || current;
    const output = positive(api.maxTokens, source.openai_max_tokens, source.genamt, source.max_tokens, current.openai_max_tokens, current.genamt, currentOutput);
    if (!output) throw new Error('출력 토큰을 입력하거나 API 프리셋의 응답 길이를 설정해 주십시오.');
    const contextSize = positive(source.openai_max_context, source.max_length, source.max_context, current.openai_max_context, context.maxContext);
    const input = positive(api.maxInputTokens) || (contextSize ? contextSize - output : 0);
    if (input <= 0) throw new Error('입력 토큰 한도를 확인해 주십시오. 프리셋 컨텍스트는 출력 토큰보다 커야 합니다.');
    return { output, input };
}

/** Last resort when no tokenizer is reachable: ~3 ASCII characters or one other
 * character (Korean, CJK, emoji) per token, which stays on the safe side. */
export function estimateTokens(text) {
    let ascii = 0, total = 0;
    for (const ch of text) { total++; if (ch.charCodeAt(0) < 128) ascii++; }
    return Math.ceil(ascii * 0.35 + (total - ascii));
}

/** Remove whole oldest history entries. Instructions, profiles, notes and the current
 * request are never truncated. If they alone do not fit, fail before sending. The chat
 * scene is dropped after every memory source, and its newest line is never dropped. */
export async function fitPromptToBudget(input, limit, tokenCounter) {
    const mutable = structuredClone(input);
    mutable.historySources = Object.fromEntries(Object.entries(mutable.historySources || {}).filter(([key]) => PROMPT_SOURCES[input.task]?.includes(key)));
    const rank = key => key === 'chatScene' ? 1 : 0;
    const all = Object.entries(mutable.historySources).flatMap(([key, entries]) =>
        entries.map((entry, index) => ({ key, index, ...entry }))).sort((a,b) => rank(a.key) - rank(b.key) || (a.timestamp || 0) - (b.timestamp || 0));
    const latestLine = all.findLast(e => e.key === 'chatScene');
    const records = all.filter(e => e !== latestLine);
    const count = async built => {
        const text = built.messages.map(m => m.role + '\n' + m.content).join('\n');
        let n;
        try { n = tokenCounter ? await tokenCounter(text) : undefined; } catch { /* estimate below */ }
        if (!Number.isFinite(n) || n <= 0) n = estimateTokens(text);
        return Math.ceil(n) + 128; // message framing / text-completion instruct wrapper reserve
    };
    function build(drop) {
        const removed = new Set(records.slice(0, drop).map(e => `${e.key}:${e.index}`));
        for (const [key, entries] of Object.entries(mutable.historySources)) {
            mutable.sources[key] = entries.filter((_, i) => !removed.has(`${key}:${i}`)).map(e => e.text).join('\n');
        }
        return buildPromptRequest(mutable);
    }
    let built = build(0), tokens = await count(built);
    if (tokens <= limit) return { ...built, inputTokens: tokens, removedHistory: 0 };
    const essential = build(records.length), essentialTokens = await count(essential);
    if (essentialTokens > limit) throw new Error(`기본 지시문·캐릭터 설정·현재 요청에 약 ${essentialTokens} 토큰이 필요합니다. 입력 한도(${limit})를 늘려 주십시오. 중요한 내용은 잘라내지 않았습니다.`);
    let low = 1, high = records.length;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (await count(build(mid)) <= limit) high = mid; else low = mid + 1;
    }
    built = build(low); tokens = await count(built);
    return { ...built, inputTokens: tokens, removedHistory: low };
}

/** A prompt whose doubled estimate still fits `limit` skips the exact (often networked) count. */
export function tokenCounterFor(context, profile, limit = 0) {
    const exact = exactTokenCounter(context, profile);
    if (!exact) return null;
    return text => {
        const estimate = estimateTokens(text);
        return estimate * 2 + 128 <= limit ? estimate : exact(text);
    };
}

/** ST's local tokenizer endpoint can measure a connection profile without switching
 * the user's active API. Other models use ST's current-API counter, then the estimate. */
function exactTokenCounter(context, profile) {
    const current = typeof context.getTokenCountAsync === 'function' ? text => context.getTokenCountAsync(text) : null;
    if (!profile || !context.getRequestHeaders || !profile.model) return current;
    const model = profile.model.toLowerCase();
    const tokenizer = /gemini|gemma/.test(model) ? 'gemini' : /claude/.test(model) ? 'claude'
        : /(^|\/)(gpt-|o[134](?:-|$))/.test(model) ? profile.model : null;
    if (!tokenizer) return current;
    return async text => {
        const response = await fetch(`/api/tokenizers/openai/count?model=${encodeURIComponent(tokenizer)}`, {
            method: 'POST', headers: context.getRequestHeaders(),
            body: JSON.stringify([{ role: 'user', content: text }]), signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error('Tokenizer unavailable');
        const value = await response.json();
        // Gemini/Claude's bundled tokenizer is approximate; leave a margin.
        return Number(value.token_count) * (/gemini|claude/.test(tokenizer) ? 1.1 : 1);
    };
}
