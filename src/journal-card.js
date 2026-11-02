import { state } from "./state.js";
import { characterData } from "./character-identity.js";
import { idleSprite } from "./sprite-paths.js";

const SCALE = 2;
const TITLE_TOP = 108;
const BODY_MIN_TOP = 210;
const WIDTH = 600;
const FONT = '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const COLORS = {
    cover: "#f3a6bd", coverDeep: "#df86a2", paper: "#fffaf3", ink: "#4b3a35", muted: "#8f7b72", faint: "#bba79c",
    rule: "#f1e3d6", dream: "#8a6fd1", dreamSoft: "#efe8fc", diary: "#d0637f", diarySoft: "#fde7ee", wake: "#fff3dc",
};

function wrap(ctx, text, maxWidth) {
    const lines = [];
    for (const paragraph of String(text).split("\n")) {
        let line = "";
        for (const char of Array.from(paragraph)) {
            const next = line + char;
            if (ctx.measureText(next).width <= maxWidth || !line) { line = next; continue; }
            const space = line.lastIndexOf(" ");
            if (space > 0 && char !== " ") {
                lines.push(line.slice(0, space));
                line = line.slice(space + 1) + char;
            } else {
                lines.push(line);
                line = char === " " ? "" : char;
            }
        }
        lines.push(line);
    }
    return lines;
}

function roundRect(ctx, x, y, w, h, r, fill) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
    ctx.fillStyle = fill;
    ctx.fill();
}

function loadImage(src) {
    return new Promise(resolve => {
        if (!src) return resolve(null);
        const image = new Image();
        if (/^https?:/i.test(src) && !src.startsWith(location.origin)) image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = src;
    });
}

function layout(ctx, entry) {
    const dream = entry.type === "dream";
    const date = new Date(entry.timestamp);
    const inner = WIDTH - 96;
    const textWidth = inner - 150;
    ctx.font = `800 26px ${FONT}`;
    const title = dream ? (entry.title?.trim() || "이름 없는 꿈") : date.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" });
    const titleLines = wrap(ctx, title, textWidth);
    ctx.font = `400 19px ${FONT}`;
    const bodyLines = wrap(ctx, entry.content, inner);
    const talkLines = dream && entry.sleepTalk ? wrap(ctx, `“${entry.sleepTalk}”`, inner - 40) : [];
    const note = dream ? entry.afterWake?.trim() : entry.comment?.trim() && `“${entry.comment.trim()}”`;
    const wakeLines = note ? wrap(ctx, note, inner - 32) : [];
    const meta = dream
        ? date.toLocaleString("ko-KR", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : date.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
    let height = Math.max(TITLE_TOP + titleLines.length * 36 + 20, BODY_MIN_TOP) + bodyLines.length * 34 + 16;
    if (talkLines.length) height += 34 + talkLines.length * 28 + 16;
    if (wakeLines.length) height += 40 + wakeLines.length * 30 + 16;
    return { dream, title, titleLines, bodyLines, talkLines, wakeLines, meta, height: height + 70, inner };
}

async function draw(entry, withPhoto) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const plan = layout(ctx, entry);
    canvas.width = WIDTH * SCALE;
    canvas.height = plan.height * SCALE;
    ctx.scale(SCALE, SCALE);
    ctx.textBaseline = "top";

    roundRect(ctx, 0, 0, WIDTH, plan.height, 32, COLORS.coverDeep);
    roundRect(ctx, 4, 4, WIDTH - 8, plan.height - 8, 28, COLORS.cover);
    roundRect(ctx, 18, 18, WIDTH - 36, plan.height - 36, 22, COLORS.paper);

    const x = 48;
    let y = 60;
    const kind = plan.dream ? "꿈" : "일기";
    ctx.font = `800 15px ${FONT}`;
    const pillWidth = ctx.measureText(kind).width + 26;
    roundRect(ctx, x, y, pillWidth, 28, 14, plan.dream ? COLORS.dreamSoft : COLORS.diarySoft);
    ctx.fillStyle = plan.dream ? COLORS.dream : COLORS.diary;
    ctx.fillText(kind, x + 13, y + 6);
    ctx.font = `400 14px ${FONT}`;
    ctx.fillStyle = COLORS.faint;
    ctx.fillText(plan.meta, x + pillWidth + 10, y + 7);

    if (withPhoto) {
        const character = characterData(state.settings, entry.characterId) || (entry.characterId === "pet:default" ? {} : null);
        const image = character ? await loadImage(idleSprite(character)) : null;
        ctx.save();
        ctx.translate(WIDTH - 140, 64);
        ctx.rotate(0.05);
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "rgba(75, 58, 53, 0.12)";
        ctx.shadowOffsetY = 3;
        ctx.fillRect(0, 0, 104, 128);
        ctx.shadowColor = "transparent";
        ctx.fillStyle = plan.dream ? COLORS.dreamSoft : COLORS.diarySoft;
        ctx.fillRect(7, 7, 90, 90);
        if (image) {
            const ratio = Math.min(90 / image.width, 90 / image.height);
            const w = image.width * ratio, h = image.height * ratio;
            ctx.drawImage(image, 7 + (90 - w) / 2, 97 - h, w, h);
        }
        ctx.font = `400 12px ${FONT}`;
        ctx.fillStyle = COLORS.muted;
        ctx.textAlign = "center";
        ctx.fillText(String(entry.petName || "").slice(0, 12), 52, 104);
        ctx.textAlign = "left";
        ctx.fillStyle = plan.dream ? "rgba(167, 140, 230, 0.5)" : "rgba(246, 195, 90, 0.6)";
        ctx.rotate(-0.08);
        ctx.fillRect(28, -10, 50, 18);
        ctx.restore();
    }

    y = TITLE_TOP;
    ctx.font = `800 26px ${FONT}`;
    for (const line of plan.titleLines) {
        const width = ctx.measureText(line).width;
        ctx.fillStyle = plan.dream ? "rgba(167, 140, 230, 0.3)" : "rgba(246, 195, 90, 0.38)";
        ctx.fillRect(x - 2, y + 17, width + 4, 14);
        ctx.fillStyle = COLORS.ink;
        ctx.fillText(line, x, y);
        y += 36;
    }
    y = Math.max(y + 20, BODY_MIN_TOP);

    ctx.font = `400 19px ${FONT}`;
    for (const line of plan.bodyLines) {
        ctx.fillStyle = COLORS.rule;
        ctx.fillRect(x, y + 32, plan.inner, 1.5);
        ctx.fillStyle = COLORS.ink;
        ctx.fillText(line, x, y + 6);
        y += 34;
    }
    y += 16;

    if (plan.talkLines.length) {
        const h = 34 + plan.talkLines.length * 28;
        roundRect(ctx, x, y, plan.inner, h, 16, COLORS.dreamSoft);
        ctx.font = `800 13px ${FONT}`;
        ctx.fillStyle = COLORS.dream;
        ctx.fillText("잠꼬대", x + 18, y + 12);
        ctx.font = `400 17px ${FONT}`;
        ctx.fillStyle = "#5f4aa0";
        plan.talkLines.forEach((line, i) => ctx.fillText(line, x + 18, y + 34 + i * 28));
        y += h + 16;
    }
    if (plan.wakeLines.length) {
        const h = 40 + plan.wakeLines.length * 30;
        roundRect(ctx, x, y, plan.inner, h, 16, plan.dream ? COLORS.wake : COLORS.diarySoft);
        ctx.font = `800 13px ${FONT}`;
        ctx.fillStyle = plan.dream ? "#b07d1f" : COLORS.diary;
        ctx.fillText(plan.dream ? "깨어난 뒤" : "마무리 한마디", x + 16, y + 14);
        ctx.font = `400 17px ${FONT}`;
        ctx.fillStyle = COLORS.ink;
        plan.wakeLines.forEach((line, i) => ctx.fillText(line, x + 16, y + 38 + i * 30));
        y += h + 16;
    }

    ctx.font = `600 13px ${FONT}`;
    ctx.fillStyle = COLORS.faint;
    ctx.textAlign = "center";
    ctx.fillText(`♥  ${entry.petName || ""}의 ${plan.dream ? "꿈" : "일기"} · 사이펫  ♥`, WIDTH / 2, plan.height - 50);
    return canvas;
}

const toBlob = canvas => new Promise((resolve, reject) => {
    try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("이미지를 만들지 못했습니다.")), "image/png"); }
    catch (error) { reject(error); }
});

export async function saveEntryImage(entry, button) {
    button.disabled = true;
    try {
        await document.fonts?.load(`800 26px ${FONT}`).catch(() => {});
        let blob;
        try { blob = await toBlob(await draw(entry, true)); }
        catch { blob = await toBlob(await draw(entry, false)); }
        const date = new Date(entry.timestamp);
        const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `saipet-${entry.type === "dream" ? "dream" : "diary"}-${stamp}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
        alert(`이미지로 저장하지 못했습니다: ${error.message}`);
    } finally {
        button.disabled = false;
    }
}
