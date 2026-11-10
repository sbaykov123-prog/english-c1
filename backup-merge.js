// Safely combine English C1 version-1 backups from different devices.
// All data stays in the browser; no network requests or credentials.
const norm=x=>String(x||'').normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
export function validBackup(s){
 return !!s&&s.version===1&&Array.isArray(s.cards)&&s.cards.length<=10000&&
  s.cards.every(c=>c&&typeof c.id==='string'&&typeof c.term==='string'&&c.id.length<200&&c.term.length<500)&&
  Array.isArray(s.history)&&s.history.length<=250000&&s.progress&&typeof s.progress==='object'&&!Array.isArray(s.progress);
}
function replay(history,cards,existing){
 const known=new Set(cards.map(c=>c.id)),out={};
 const sorted=[...history].sort((a,b)=>a.at-b.at||(a.eventId||'').localeCompare(b.eventId||''));
 const DAY=86400000;
 for(const h of sorted){
  if(!known.has(h.id)||![0,1].includes(h.dir)||![0,1,2,3].includes(h.rating)||!Number.isFinite(h.at))continue;
  const k=h.id+':'+h.dir,p=out[k],r=h.rating;
  let ease=p?.ease??2.5,streak=(p?.streak??0)+1,interval=0,lapses=p?.lapses??0;
  if(r===0){streak=0;ease=Math.max(1.3,ease-.2);lapses++}
  else{
   if(r===1)ease=Math.max(1.3,ease-.15);
   if(r===3)ease=Math.min(3.2,ease+.15);
   if(streak===1)interval=r===1?1:r===2?1:3;
   else if(streak===2)interval=r===1?2:r===2?3:6;
   else interval=Math.min(365,Math.max(1,Math.round((p?.interval||1)*ease*(r===1?.55:r===3?1.3:1))));
  }
  const start=new Date(h.at);start.setHours(0,0,0,0);
  const due=r===0?h.at+600000:start.getTime()+interval*DAY+43200000;
  out[k]={due,interval,streak,ease,lapses,lastReviewed:h.at,lastRating:r,reviewCount:(p?.reviewCount??0)+1};
 }
 // Preserve older backups whose progress records lack matching events.
 for(const [k,p] of Object.entries(existing)){
  if(!p||typeof p!=='object')continue;
  if(!out[k]||(Number(p.lastReviewed)||0)>(Number(out[k].lastReviewed)||0))out[k]=p;
 }
 return out;
}
export function mergeBackups(local,remote){
 if(!validBackup(local)||!validBackup(remote))throw Error('Неверный формат резервной копии English C1.');
 const cards=new Map(),idToTerm=new Map();
 for(const snapshot of [local,remote]){
  for(const card of snapshot.cards){
   const term=norm(card.term);
   if(!term)continue;
   if(!cards.has(term))cards.set(term,{...card,examples:Array.isArray(card.examples)?card.examples:[]});
   else {
    const target=cards.get(term);
    for(const field of ['definition','ipa','ru','note','deck'])if(!target[field]&&card[field])target[field]=card[field];
    if((card.examples||[]).length>(target.examples||[]).length)target.examples=card.examples;
   }
   idToTerm.set(card.id,term);
  }
 }
 const canonicalIds=new Map([...cards].map(([term,card])=>[term,card.id]));
 const eventMap=new Map(),oldProgress={};
 for(const snapshot of [local,remote]){
  for(const [key,value] of Object.entries(snapshot.progress)){
   const match=/^(.*):([01])$/.exec(key);if(!match)continue;
   const term=idToTerm.get(match[1]),id=canonicalIds.get(term);if(!id)continue;
   const canonical=id+':'+match[2];
   if(!oldProgress[canonical]||(Number(value?.lastReviewed)||0)>(Number(oldProgress[canonical]?.lastReviewed)||0))oldProgress[canonical]=value;
  }
  for(const h of snapshot.history){
   if(!h||typeof h!=='object')continue;
   const id=canonicalIds.get(idToTerm.get(h.id)),dir=Number(h.dir),rating=Number(h.rating),at=Number(h.at);
   if(!id||![0,1].includes(dir)||![0,1,2,3].includes(rating)||!Number.isFinite(at)||at<=0)continue;
   const uid=typeof h.eventId==='string'&&h.eventId.length>0?h.eventId:`${id}:${dir}:${rating}:${at}`;
   if(!eventMap.has(uid))eventMap.set(uid,{...h,id,dir,rating,at,eventId:uid});
  }
 }
 const history=[...eventMap.values()].sort((a,b)=>a.at-b.at||a.eventId.localeCompare(b.eventId));
 const allCards=[...cards.values()];
 const merged={...local,cards:allCards,history,progress:replay(history,allCards,oldProgress)};
 return {state:merged,addedCards:Math.max(0,allCards.length-local.cards.length),addedAnswers:Math.max(0,history.length-local.history.length)};
}
