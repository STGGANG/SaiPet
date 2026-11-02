const MOODS = Object.freeze(["idle","happy","sad","excited","surprised","nervous","confident","shy","angry","thinking"]);
const LIMITS = Object.freeze({speech:{text:250,aside:0,title:0,afterWake:0},dream:{text:500,aside:100,title:60,afterWake:250},diary:{text:2000,aside:100,title:0,afterWake:0}});

const EXTRA_FIELDS=["aside","title","afterWake"];
/** Optional fields the task actually fills; the others are neither shown nor required. */
const usedFields=caps=>EXTRA_FIELDS.filter(key=>caps[key]>0);

export function contract(kind, speakers, locale = "en") {
    const caps=LIMITS[kind];
    if (!caps) throw new Error("Unknown response kind");
    const extras=usedFields(caps);
    const shape={kind,entries:speakers.map(speaker=>({speaker,text:"...",mood:"idle",...Object.fromEntries(extras.map(key=>[key,"..."]))}))};
    const limits=locale==="ko"
        ? [`text는 최대 ${caps.text}자입니다.`, caps.aside && `aside는 최대 ${caps.aside}자의 비어 있지 않은 문자열입니다.`, caps.title && `title과 afterWake는 비어 있지 않아야 하며 각각 최대 ${caps.title}자, ${caps.afterWake}자입니다.`]
        : [`text must not exceed ${caps.text} characters.`, caps.aside && `aside must be a non-empty string of at most ${caps.aside} characters.`, caps.title && `title and afterWake must be non-empty, at most ${caps.title} and ${caps.afterWake} characters respectively.`];
    const explanation=locale==="ko"
        ? `## 고정 출력 규약\n- JSON 객체 하나만 반환합니다. 앞뒤 설명·코드 블록·XML을 붙이지 않습니다.\n- 아래 구조와 키를 정확히 사용합니다. kind는 ${kind}입니다.\n- entries에는 ${speakers.join(", ")} 각각을 이 순서대로 정확히 한 번씩 넣습니다. speaker는 이름이 아닌 고정 표식입니다.\n- text에는 해당 작업의 실제 내용만 넣습니다. 화자 이름표·메타데이터를 붙이지 않습니다. 빈 문자열은 허용하지 않습니다.\n- mood는 다음 중 하나입니다: ${MOODS.join(", ")}. 캐릭터의 표정만 정합니다.\n- ${limits.filter(Boolean).join(" ")}\n- 문자열 속 따옴표·역슬래시·개행은 JSON 규칙에 따라 이스케이프합니다. 별도 필드는 추가하지 않습니다.\n- 답하기 전에 화자·작업·JSON 유효성을 속으로 확인합니다.`
        : `## Fixed output contract\n- Return exactly one JSON object. No preface, commentary, code fences, or XML.\n- Use exactly the structure and keys below; kind is ${kind}.\n- Include exactly one entry per speaker, in this order: ${speakers.join(", ")}. speaker is a fixed label, not a character name.\n- text contains only the task's actual content, without speaker labels or metadata. It must not be empty.\n- mood must be one of: ${MOODS.join(", ")}. It only selects the character's facial expression.\n- ${limits.filter(Boolean).join(" ")}\n- Escape quotes, backslashes, and line breaks inside strings according to JSON syntax. Add no other fields.\n- Before replying, silently confirm the speaker, the task, and that the JSON is valid.`;
    return explanation+"\n\n"+JSON.stringify(shape,null,2);
}

const isObject=value=>Boolean(value) && typeof value==="object" && !Array.isArray(value);
const clip=(value,cap)=>{const chars=Array.from(value);return chars.length>cap ? chars.slice(0,cap).join("").trim() : value;};

/** First balanced top-level {...} in text, honouring JSON strings. */
function firstObject(text) {
    const start=text.indexOf("{");
    if (start<0) return null;
    let depth=0, inString=false;
    for (let i=start;i<text.length;i++) {
        const ch=text[i];
        if (inString) { if (ch==="\\") i++; else if (ch==='"') inString=false; }
        else if (ch==='"') inString=true;
        else if (ch==="{") depth++;
        else if (ch==="}" && --depth===0) return text.slice(start,i+1);
    }
    return null;
}

function parseJSON(raw) {
    let text=raw.replace(/^﻿/,"").replace(/<think>[\s\S]*?<\/think>/gi,"").trim();
    const fence=text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fence) text=fence[1].trim();
    try { return JSON.parse(text); } catch { /* not pure JSON: take the first object */ }
    const object=firstObject(text);
    return object===null ? undefined : JSON.parse(object);
}

/** Validate the whole response before any speech or log is committed. Formatting
 * near-misses are repaired and unknown keys ignored; speakers, kind, moods and
 * required content are not guessed. Fields the task does not use come back as "". */
export function parseStructuredResponse(raw,{kind,speakers}) {
    const fail=error=>({ok:false,error});
    if (typeof raw!=="string" || raw.length>50000) return fail("invalid_text");
    const caps=LIMITS[kind];
    if (!caps || !Array.isArray(speakers) || !speakers.length || speakers.some(s=>!['A','B','C','D'].includes(s)) || new Set(speakers).size!==speakers.length) return fail("invalid_contract");
    let value;
    try { value=parseJSON(raw); } catch { return fail("invalid_json"); }
    if (value===undefined) return fail("invalid_json");
    if (!isObject(value) || value.kind!==kind || !Array.isArray(value.entries)) return fail("invalid_envelope");
    if (value.entries.length!==speakers.length) return fail("missing_or_extra_speaker");
    const entries=new Map();
    for (const entry of value.entries) {
        if (!isObject(entry) || !speakers.includes(entry.speaker) || entries.has(entry.speaker)) return fail("invalid_speaker");
        const mood=typeof entry.mood==="string" ? entry.mood.trim().toLowerCase() : entry.mood;
        if (typeof entry.text!=="string" || !entry.text.trim() || !MOODS.includes(mood)) return fail("invalid_fields");
        const fields={text:clip(entry.text.trim(),caps.text)};
        for (const key of EXTRA_FIELDS) {
            if (!caps[key]) { fields[key]=""; continue; }
            if (typeof entry[key]!=="string" || !entry[key].trim()) return fail(key==="aside" ? "invalid_fields" : "invalid_dream_fields");
            fields[key]=clip(entry[key].trim(),caps[key]);
        }
        if (/\[MOOD:|\[SLEEP_TALK:/i.test(fields.text+fields.aside)) return fail("mixed_legacy_format");
        entries.set(entry.speaker,{speaker:entry.speaker,mood,...fields});
    }
    return {ok:true,kind,entries:speakers.map(s=>entries.get(s))};
}
