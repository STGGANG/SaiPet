import { characterId } from "./character-identity.js";

const str = value => typeof value === "string" ? value : "";
const values = obj => Object.values(obj || {}).flat().filter(e => e && typeof e === "object");
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const pad = n => String(n).padStart(2,'0');
const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
const shortTime = timestamp => { const d=new Date(timestamp); return `${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const timeAware = settings => settings.api?.timeAware !== false;
/** Conversational tasks where a hungry character may plausibly mention it. */
const FULLNESS_TASKS = new Set(['direct', 'dual', 'observer', 'pair']);
/** Locale-neutral current time line, e.g. "2026-10-22 (Wed) 19:08"; empty when time awareness is off. */
export const dateTimeLine = (settings, now) => timeAware(settings) ? `Local date and time: ${dateKey(now)} (${DAYS[now.getDay()]}) ${pad(now.getHours())}:${pad(now.getMinutes())}` : '';
/** Two direct replies to the same user message (dual direct talk), as the log viewer pairs them. */
export const dualPair = (entry, next) => entry?.mode === "dual" && next?.mode === "dual" && next.userText === entry.userText && Math.abs(next.timestamp - entry.timestamp) < 15000;
function dataFor(settings, id) { return id === "secondary" ? settings.multiPet?.secondPetData : settings; }
function profile(settings, id) {
    const p=dataFor(settings,id)?.personality || {};
    return { id:characterId(settings,id), name:p.name || (id === "secondary" ? "캐릭터 2" : "캐릭터"),
        personality:str(p.prompt), userRelation:str(p.userRelation), culturalBackground:str(p.culturalBackground) };
}
function messageTime(entry) {
    const raw=entry.send_date;
    const time=typeof raw==='number' ? raw : /^\d+$/.test(str(raw)) ? Number(raw) : Date.parse(str(raw));
    return Number.isFinite(time) && time>0 ? time : NaN;
}
function chatLines(context, count) {
    const now=Date.now();
    let previous=0;
    return (context.chat || []).filter(e=>e && !e.is_system && str(e.mes).trim()).slice(-count).map((e,i,all)=>{
        const time=messageTime(e);
        // Chat order wins over odd stored dates; undated lines are placed just before now.
        previous=Math.max(Number.isFinite(time) ? time : now-(all.length-i)*1000, previous+1);
        return {timestamp:previous, text:`${i===all.length-1?'[Latest message] ':''}${e.name || (e.is_user?context.name1:context.name2) || 'Character'}: ${str(e.mes)}`};
    });
}
function chatCharacter(context) {
    let card=context.characters?.[context.characterId] || context.characterData;
    if (context.groupId != null) {
        const last=[...(context.chat || [])].reverse().find(e=>!e.is_system && !e.is_user && str(e.mes).trim());
        const candidates=(context.characters || []).filter(c=>last?.original_avatar ? c.avatar===last.original_avatar : c.name===last?.name);
        if(candidates.length!==1) throw new Error("속마음을 쓸 채팅 캐릭터를 확실하게 구분할 수 없습니다.");
        card=candidates[0];
    }
    if (!card) throw new Error("속마음 모드는 선택된 채팅 캐릭터가 필요합니다.");
    const data=card.data || card;
    return {id:'chat:'+String(card.avatar || context.characterId || data.name),name:data.name || card.name || context.name2 || 'Character',identitySource:'chat_character',
        personality:[str(data.description || card.description),str(data.personality || card.personality),str(data.scenario || card.scenario)].filter(Boolean).join('\n')};
}
function memoLabel(memo, today, aware) {
    if(memo.recurDays?.length) return ` (every ${[...memo.recurDays].sort().map(d=>DAYS[d]).join(', ')})`;
    if(!memo.date) return '';
    if(!aware) return ` (for ${memo.date})`;
    const days=Math.round((new Date(memo.date+'T00:00:00')-today)/86400000);
    const relative=days===0 ? 'today' : days===1 ? 'tomorrow' : days===-1 ? 'yesterday' : days>0 ? `in ${days} days` : `${-days} days ago`;
    return ` (for ${memo.date}, ${relative})`;
}
function notes(settings, ids, now) {
    const today=new Date(now);today.setHours(0,0,0,0);
    const aware=timeAware(settings);
    return ids.map((id,index)=>{
        const memos=dataFor(settings,id)?.personality?.personalMemos || [];
        const lines=memos.filter(m=>{
            if(m.recurDays?.length) return m.recurDays.includes(today.getDay());
            if(!m.date) return true;
            return Math.abs(new Date(m.date+'T00:00:00')-today)<=2*86400000;
        }).map(m=>`[${str(m.tag)}] ${str(m.content)}${memoLabel(m,today,aware)}`);
        return lines.length?`Speaker ${index===0?'A':'B'} notes:\n${lines.join('\n')}`:'';
    }).filter(Boolean).join('\n');
}
export function buildAIInput(settings, context, task, petIds, request, now = new Date()) {
    const characters=task==='inner'?[chatCharacter(context)]:petIds.map(id=>profile(settings,id));
    const ids=new Set(petIds.map(id=>characterId(settings,id)));
    const aware=timeAware(settings);
    const stamp=(label,timestamp)=>`[${label}${aware && timestamp>0 ? ' '+shortTime(timestamp) : ''}]`;
    const logs=settings.conversationLog || {};
    const speaker=e=>e.speaker || e.petName || 'Character';
    const direct=[], ownDirect=values(logs.directLogs).filter(e=>ids.has(e.characterId));
    for(let i=0;i<ownDirect.length;i++) {
        const entry=ownDirect[i], both=dualPair(entry,ownDirect[i+1]);
        const [first,second]=both ? (entry.timestamp<=ownDirect[i+1].timestamp ? [entry,ownDirect[i+1]] : [ownDirect[i+1],entry]) : [entry];
        direct.push({participantIds:both ? [first.characterId,second.characterId] : [first.characterId],timestamp:first.timestamp,
            text:`${stamp(both?'Direct · both':'Direct',first.timestamp)} User: ${str(first.userText)} / ${speaker(first)}: ${str(first.petResponse)}${both?` / ${speaker(second)}: ${str(second.petResponse)}`:''}`});
        if(both) i++;
    }
    const pair=values(logs.interPetLogs).filter(e=>ids.has(e.petAId)||ids.has(e.petBId)||e.lines?.some(line=>ids.has(line.characterId))).map(e=>({petAId:e.petAId,petBId:e.petBId,participantIds:e.lines?.map(line=>line.characterId) || [e.petAId,e.petBId],timestamp:e.timestamp,text:`${stamp(e.source === 'house' ? 'House conversation' : 'Pair',e.timestamp)} ${str(e.userText) ? `User: ${str(e.userText)} / ` : ''}${e.lines ? e.lines.map(line=>`${line.name}: ${line.text}`).join(' / ') : `${e.petAName}: ${e.petAText} / ${e.petBName}: ${e.petBText}`}`}));
    const chatLogs=logs.chatLogs?.[context.chatId] || [];
    // Inner thoughts belong to the chat character, never to a widget pet's memory.
    const observer=chatLogs.filter(e=>ids.has(e.characterId) && e.mode!=='inner').map(e=>({timestamp:e.timestamp,text:`${stamp('Past observation',e.timestamp)} ${e.petName}: ${e.petResponse}`}));
    const inner=chatLogs.filter(e=>e.mode==='inner' && e.subjectId===characters[0].id).map(e=>({timestamp:e.timestamp,text:`${stamp('Past inner thought',e.timestamp)} ${characters[0].name}: ${e.petResponse}`}));
    const notification=(logs.notificationLogs || []).filter(e=>ids.has(e.characterId)).map(e=>({timestamp:e.timestamp,text:`${stamp('Delivered reminder',e.timestamp)} Reminder: ${str(e.message)} / ${speaker(e)}: ${str(e.petResponse)}`}));
    const limitRecords = (entries, count) => {
        const sorted = [...entries].sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
        return count === 0 ? sorted : sorted.slice(0, count);
    };
    const directCount = settings.api?.directMemoryCount ?? 30, pairCount = settings.api?.pairMemoryCount ?? 15;
    const directSelected = new Set(), pairSelected = new Set();
    // Each participating character gets its own allowance; a shared entry appears once.
    for (const id of ids) {
        limitRecords(direct.filter(e => e.participantIds.includes(id)), directCount).forEach(e => directSelected.add(e));
        limitRecords(pair.filter(e => e.participantIds.includes(id)), pairCount).forEach(e => pairSelected.add(e));
    }
    const history = task==='inner' ? limitRecords(inner, directCount) : task==='observer' ? limitRecords(observer, directCount)
        : ['pair','housePair','houseTalk'].includes(task) ? [...pairSelected] : [...directSelected, ...pairSelected];
    const today=new Date(now);today.setHours(0,0,0,0);
    const recordId=characterId(settings,petIds[0]);
    const writing=task==='dream'?'Dream':'Diary';
    const previous=(settings.petJournal?.[task==='dream'?'dreams':'diaries']?.[recordId] || []).map(e=>({timestamp:e.timestamp,
        text:`[${writing}${aware && e.timestamp>0 ? ' '+dateKey(new Date(e.timestamp)) : ''}]${str(e.title).trim() ? ` Title: ${str(e.title).trim()} /` : ''} ${str(e.content)}`}));
    const historySources = {
        recentDialogue: history,
        chatScene: chatLines(context, Math.min(21, Math.max(2, (settings.api?.historyCount || 6) + 1))),
        previousWriting: limitRecords(previous, 5),
        todayEvents: [...directSelected, ...pairSelected, ...notification].filter(e => e.timestamp >= today.getTime()),
    };
    for (const entries of Object.values(historySources)) entries.sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0));
    const persona=context.name1 || 'User';
    const addressLines=petIds.map((id,i)=>{
        const p=dataFor(settings,id)?.personality || {};
        return `User information for speaker ${i===0?'A':'B'}: address the user as ${str(p.ownerName) || '주인님'}${str(p.ownerPersona) ? '\n'+str(p.ownerPersona) : ''}`;
    }).join('\n');
    const hunger=id=>{const h=id==='secondary'?(settings.multiPet?.secondPetCondition?.hunger ?? 100):(settings.condition?.hunger ?? 100);return h<=10?'very hungry':h<=30?'hungry':'';};
    const hungerLines=FULLNESS_TASKS.has(task) ? petIds.map((id,i)=>{const word=hunger(id);return word && `Speaker ${i===0?'A':'B'} is ${word}.`;}).filter(Boolean) : [];
    const sources={
        // Only the observer sees a chat log where the user's lines carry the persona name.
        userPersona:task==='inner'
            ? `In this chat the user plays the persona "${persona}". A knows the user only through that persona and the chat.`
            : task==='observer' ? `${addressLines}\nIn the chat scene, lines labeled "${persona}" are the user's, written through their roleplay persona.` : addressLines,
        pairRelationship:str(settings.multiPet?.petRelation),
        currentContext:[dateTimeLine(settings,now),...hungerLines,hungerLines.length ? 'Mention hunger only when it comes up naturally.' : ''].filter(Boolean).join('\n'),
        memories:notes(settings,petIds,now),
        ...Object.fromEntries(Object.entries(historySources).map(([key, entries]) => [key, entries.map(e => e.text).join('\n')])),
    };
    return {task,characters,request,language:settings.speechLanguage || 'ko',timeAware:aware,sources,historySources};
}

/** Read relevant entries; the complete request budget preserves these supplied facts. */
export async function collectWorldInfo(context, scene, enabled) {
    if(!enabled || typeof context.loadWorldInfo!=='function') return '';
    const card=context.characters?.[context.characterId];
    const books=[...new Set([card?.data?.extensions?.world,context.chatMetadata?.world_info].filter(Boolean))];
    const found=[];const haystack=str(scene).toLowerCase();
    for(const book of books) {
        const data=await context.loadWorldInfo(book);
        for(const entry of Object.values(data?.entries || {})) {
            if(entry.disable || !str(entry.content)) continue;
            const keys=Array.isArray(entry.key)?entry.key:[];
            if(!entry.constant && !keys.some(key=>str(key).trim() && haystack.includes(str(key).toLowerCase()))) continue;
            found.push(`${entry.comment || keys.join(', ')}: ${entry.content}`);
        }
    }
    return found.join('\n');
}
