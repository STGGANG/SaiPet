// Pure prompt assembly shared by the runtime and review documents.
import { modules, tasks } from './modules.js';
import { contract } from './response-format.js';
export { modules, tasks };
// Length is budgeted at the complete-request level; identity/instructions are never sliced.
export const PROMPT_SOURCES = {
 direct:['userPersona','currentContext','memories','recentDialogue'],
 dual:['userPersona','pairRelationship','currentContext','memories','recentDialogue'],
 observer:['userPersona','currentContext','chatScene','worldInfo','recentDialogue'],
 inner:['userPersona','chatScene','worldInfo','recentDialogue'],
 pair:['pairRelationship','currentContext','memories','recentDialogue'],
 housePair:['pairRelationship','currentContext','roomContext','houseTopics','memories','recentDialogue'],
 houseTalk:['userPersona','pairRelationship','currentContext','roomContext','memories','recentDialogue'],
 dream:['currentContext','memories','todayEvents','previousWriting'],
 diary:['userPersona','currentContext','memories','todayEvents','previousWriting'],
 reminder:['userPersona','currentContext'],
};
export const HOUSE_TASKS=new Set(['housePair','houseTalk']);
// Application framing for this request goes to <situation>; quoted material stays in <reference>.
const SITUATION_SOURCES=new Set(['userPersona','currentContext','roomContext','houseTopics']);
// Dated records; the continuity module only makes sense when a task sends some.
const RECORD_SOURCES=['recentDialogue','previousWriting','todayEvents'];
export const sendsRecords=task=>(PROMPT_SOURCES[task] || []).some(key=>RECORD_SOURCES.includes(key));
const tags={roomContext:'room_context',houseTopics:'topic_notes',userPersona:'user_persona',pairRelationship:'pair_relationship',currentContext:'current_context',memories:'relevant_memories',worldInfo:'world_info',chatScene:'chat_scene',recentDialogue:'recent_dialogue',previousWriting:'previous_writing',todayEvents:'today_events'};
const languages={ko:['Korean','한국어'],en:['English','영어'],ja:['Japanese','일본어'],zh:['Chinese','중국어']};
const nonempty=value=>typeof value==='string' && value.trim().length>0;
// Text content only (no user text ever lands in an attribute), so quotes stay readable.
const escapeXML=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const block=(tag,content)=>`<${tag}>\n${content}\n</${tag}>`;

/** `locale=ko` is a translation preview only; runtime uses en. */
export function buildPromptRequest(input,{locale='en'}={}) {
    if(!['en','ko'].includes(locale)) throw new Error('Unsupported prompt locale');
    const {task,characters,language='ko',timeAware=false,sources={}}=input;
    const spec=tasks[task];
    if(!spec || !languages[language]) throw new Error('Unknown task or output language');
    if(!Array.isArray(characters) || (HOUSE_TASKS.has(task) ? characters.length<1 || characters.length>4 : characters.length!==spec.count)) throw new Error('Wrong character count');
    if(characters.some(c=>!nonempty(c.id)||!nonempty(c.name))) throw new Error('A stable local ID and display name are required');
    if(new Set(characters.map(c=>c.id)).size!==characters.length) throw new Error('Duplicate character IDs');
    if(task==='inner' && characters[0].identitySource!=='chat_character') throw new Error('Inner voice requires an explicit chat-character identity');
    const speakers=characters.map((_,i)=>String.fromCharCode(65+i));
    const source=value=>nonempty(value) ? escapeXML(value.trim()) : '';
    // Never trim the immediate request/reminder silently: its negations and dates matter.
    if(!nonempty(input.request)) throw new Error('Request is empty');
    const identities=characters.map((c,i)=>{
        const ko=locale==='ko';
        const identity=[ko?'## 정체성':'## Identity',`- ${ko?'이름':'Name'}: ${source(c.name)}`,`- ${ko?'정체성 출처':'Identity source'}: ${task==='inner'?(ko?'선택된 채팅 캐릭터':'selected chat character'):(ko?'동반 캐릭터':'companion character')}`];
        const parts=[block('identity',identity.join('\n'))];
        // No fallback, name heuristic or accidental Miyu inheritance.
        if(nonempty(c.culturalBackground)) parts.push(block('cultural_background', source(c.culturalBackground)));
        if(nonempty(c.personality)) parts.push(block('personality',source(c.personality)));
        if(task!=='inner' && nonempty(c.userRelation)) parts.push(block('user_relationship',source(c.userRelation)));
        return `<character speaker="${speakers[i]}">\n${parts.join('\n\n')}\n</character>`;
    });
    const references=[block('characters',identities.join('\n\n'))],situation=[];
    for(const key of PROMPT_SOURCES[task]) if(nonempty(sources[key])) (SITUATION_SOURCES.has(key)?situation:references).push(block(tags[key],source(sources[key])));
    const selected=['role','source_rules','character_performance','content_guidance'];
    if(characters.some(c => nonempty(c.culturalBackground))) selected.push('cultural_continuity');
    if(sendsRecords(task)) selected.push('continuity');
    const system=selected.map(key=>block(key,modules[key][locale]+(key==='continuity' && timeAware?'\n'+modules.continuity.timeAware[locale]:'')));
    system.push(block('task',spec[locale]));
    const lang=languages[language][locale==='ko'?1:0];
    const fields={speech:['text','text'],dream:['text, aside, title, and afterWake','text·aside·title·afterWake'],diary:['text and aside','text와 aside']}[spec.kind];
    const length={speech:['Use 1–3 short sentences per speaker.','화자마다 1~3문장으로 짧게 씁니다.'],
        dream:['Use 3–5 sentences for the dream, one short sleep utterance, a short title, and 1–3 sentences for the waking scene or thought.','꿈은 3~5문장, 잠꼬대는 짧은 한마디, 제목은 짧은 한 구절, 깨어난 뒤 장면이나 생각은 1~3문장입니다.'],
        diary:['Aim for 5–10 sentences in the diary and one brief closing remark.','일기는 5~10문장을 목표로 하고, 완료 소감은 짧은 한마디입니다.']}[spec.kind];
    system.push(block('language_and_length', locale==='ko'
        ? `## 언어와 분량\n- ${fields[1]}는 ${lang}로 씁니다. JSON 키·speaker·kind·mood 값은 규약의 영어 표기를 유지합니다. 고유명사와 자연스러운 외래어는 허용합니다. 출력 언어 때문에 인물의 국적이나 배경을 바꾸지 않습니다.\n- ${length[1]}\n- output_format의 글자 수 상한 안에서 씁니다. 핵심 사실을 빼지 말고 표현을 줄입니다.`
        : `## Language and length\n- Write ${fields[0]} in ${lang}. Keep JSON keys and speaker, kind, and mood values exactly as specified in English. Proper names and natural loanwords are fine. The output language does not change a character's nationality or setting.\n- ${length[0]}\n- Stay within the character limits in output_format; shorten the wording rather than dropping key facts.`));
    system.push(block('output_format',contract(spec.kind,speakers,locale)));
    const user=[block('reference',references.join('\n\n')),...(situation.length?[block('situation',situation.join('\n\n'))]:[]),block('current_request',escapeXML(input.request.trim())),block('final',locale==='ko'?'위 참고 자료·상황·현재 요청을 사용해 선택된 작업을 지금 수행합니다. output_format의 JSON 객체만 반환합니다.':'Perform the selected task now using the reference, situation, and current request. Return only the JSON object required by output_format.')];
    return {
        messages:[{role:'system',content:system.join('\n\n')},{role:'user',content:user.join('\n\n')}],
        // Metadata below is application-side only. IDs are not sent to the model.
        expected:{kind:spec.kind,speakers},
        speakerMap:Object.fromEntries(characters.map((c,i)=>[speakers[i],c.id])),
        modules:[...selected,'task:'+task,'language_and_length','output_format'],
    };
}
