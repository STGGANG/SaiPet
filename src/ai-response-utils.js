export function responseText(result) {
    if (typeof result === "string") return result;
    if (typeof result?.content === "string") return result.content;
    throw new TypeError("AI 응답에서 텍스트를 찾지 못했습니다.");
}
