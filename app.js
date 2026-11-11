import {mergeBackups} from './backup-merge.js';
const STORAGE_KEY='english-c1-study-v1';
const DAY=86400000;
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const now=()=>Date.now();
const dayStart=(t=now())=>{const d=new Date(t);d.setHours(0,0,0,0);return d.getTime()};
const dateText=t=>new Date(t).toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
const directionLabel=d=>d===0?'Определение → фраза':'Фраза → значение';
let seed=[],state=null,view='home',session=null,filterDeck='Все',filterText='',editId=null,editReturn='browse';
const defaultState=()=>({version:1,cards:[],progress:{},history:[],preferences:{dailyNew:5,dailyReview:25},createdAt:now()});
function persist(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}
function key(id,dir){return `${id}:${dir}`}
function progress(id,dir){return state.progress[key(id,dir)]||null}
function allItems(){return state.cards.flatMap(c=>[0,1].map(dir=>({card:c,dir,p:progress(c.id,dir)})))}
function dueItems(){const t=now();return allItems().filter(x=>x.p && x.p.due<=t).sort((a,b)=>a.p.due-b.p.due)}
function unseenItems(){return allItems().filter(x=>!x.p)}
function unready(c,dir){return dir===0&&!c.definition}
function estimateInterval(p,r){
  // Transparent, conservative SM-2-inspired scheduler. Not official FSRS.
  if(r===0)return {due:now()+10*60000,interval:0,streak:0,ease:Math.max(1.3,(p?.ease??2.5)-.2),lapses:(p?.lapses??0)+1};
  let streak=(p?.streak??0)+1;
  let ease=p?.ease??2.5;
  if(r===1)ease=Math.max(1.3,ease-.15);
  if(r===3)ease=Math.min(3.2,ease+.15);
  let days;
  if(streak===1)days=r===1?1:r===2?1:3;
  else if(streak===2)days=r===1?2:r===2?3:6;
  else days=Math.max(1,Math.round((p?.interval||1)*ease*(r===1?.55:r===3?1.3:1)));
  days=Math.min(days,365);
  return {due:dayStart(now())+days*DAY+12*3600000,interval:days,streak,ease,lapses:p?.lapses??0};
}
function schedule(c,dir,r){const id=key(c.id,dir),old=progress(c.id,dir),next=estimateInterval(old,r);state.progress[id]={...next,lastReviewed:now(),lastRating:r,reviewCount:(old?.reviewCount??0)+1};state.history.push({eventId:crypto.randomUUID(),id:c.id,dir,rating:r,at:now(),nextDue:next.due});persist()}
function getCounts(){const d=dueItems(),u=unseenItems();return {due:d.length,new:u.length,studied:allItems().length-u.length}}
function normTerm(s){return String(s||'').normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim()}
function nav(){return `<nav class="nav"><div class="navinner"><button data-view="home" class="${view==='home'?'active':''}">⌂ Главная</button><button data-view="browse" class="${view==='browse'?'active':''}">▤ Словарь</button><button data-view="settings" class="${view==='settings'?'active':''}">⚙ Настройки</button></div></nav>`}
function shell(content){$('#app').innerHTML=`<main class="wrap"><div class="top"><div class="logo"><span class="star">✦</span>English C1</div><span class="pill">Личное обучение</span></div>${content}</main>${nav()}`}
function filteredItems(){return allItems().filter(x=>filterDeck==='Все'||x.card.deck===filterDeck)}
function home(){const c=getCounts(),decks=[...new Set(state.cards.map(x=>x.deck))],studied=new Set(state.history.map(x=>x.id)).size;
  shell(`<section class="panel hero"><h1>Твоя практика английского</h1><p class="muted">Двусторонние карточки · интервальные повторения · офлайн</p></section>
  <section class="panel"><div class="counts"><div class="metric"><strong>${c.due}</strong><span>К повторению</span></div><div class="metric"><strong>${c.new}</strong><span>Не изучено, сторон</span></div><div class="metric"><strong>${studied}</strong><span>Выражений изучалось</span></div></div><br><div class="actions"><button class="primary" data-start="all">Начать занятие</button><button class="secondary" data-view="browse">Словарь</button></div><p class="notice">Новое: до ${state.preferences.dailyNew} выражений за занятие (каждое в двух направлениях). Повторение ранее изученного — в первую очередь. Два направления выражения не показываются подряд.</p></section>
  <div class="sectionrow"><h2>Тематические колоды</h2><span class="small muted">${decks.length}</span></div><section class="panel">${decks.map(d=>`<div class="deckrow"><div><div class="deckname">${esc(d)}</div><div class="muted small">${state.cards.filter(x=>x.deck===d).length} выражений</div></div><button class="secondary" data-deck="${esc(d)}">Учить</button></div>`).join('')}</section>
  <section class="panel"><b>Резервная копия</b><p class="mini muted">Экспортируй JSON, загрузи его в чат для объединения с прогрессом другого устройства или сохрани в приватном GitHub. В «Настройках» можно безопасно объединить файлы.</p><button class="secondary" data-export>Скачать резервную копию</button></section>`)}
// Keep two directions of the same expression apart by at least six OTHER unique expressions.
// When the selected deck is too small, leave the other direction for a future session.
function spaceDirections(items,minOtherExpressions=6){
 const first=[],second=[],seen=new Set();
 for(const item of items){
  if(seen.has(item.card.id))second.push(item);
  else{seen.add(item.card.id);first.push(item)}
 }
 // With fewer than seven distinct expressions there cannot be six intervening
 // expressions: leave the reverse side due/unseen for a later session.
 if(seen.size<=minOtherExpressions)return first;
 // The matching order keeps at least (unique expressions - 1) intervening cards.
 return [...first,...second];
}
function chooseSession(deck='Все'){
 let items=allItems().filter(x=>deck==='Все'||x.card.deck===deck),t=now();
 // Short decks: wait at least 15 minutes between opposite directions even across lessons.
 if(new Set(items.map(x=>x.card.id)).size<7){
  items=items.filter(x=>{
   const opposite=progress(x.card.id,1-x.dir);
   return !opposite?.lastReviewed||t-opposite.lastReviewed>=15*60000;
  });
 }
 let due=items.filter(x=>x.p&&x.p.due<=t).sort((a,b)=>a.p.due-b.p.due).slice(0,state.preferences.dailyReview);
 let newExpr=[],seen=new Set();
 for(const x of items.filter(x=>!x.p)){if(newExpr.length>=state.preferences.dailyNew)break;if(seen.has(x.card.id))continue;seen.add(x.card.id);newExpr.push(x.card)}
 let fresh=newExpr.flatMap(c=>[0,1].filter(dir=>!progress(c.id,dir)).map(dir=>({card:c,dir,p:null})));
 let queue=spaceDirections([...due,...fresh]);
 if(!queue.length){session=null;view='empty';render();return}
 session={queue,index:0,revealed:false,retrain:false,sessionHistory:[],deck};view='study';render();
}
function study(){const x=session.queue[session.index],c=x.card,p=progress(c.id,x.dir);const front=x.dir===0?(c.definition||`Переведи на английский: ${c.ru}`):c.term;
 const incomplete=x.dir===0&&!c.definition;
 let back=x.dir===0?`<h2>${esc(c.term)}</h2><div class="ipa">${esc(c.ipa)}</div><div class="definition">${esc(c.definition||c.ru)}</div>`:`<h2>${esc(c.term)}</h2><div class="ipa">${esc(c.ipa)}</div><div class="definition">${esc(c.definition||c.ru)}</div>`;
 if(c.examples?.length)back+=`<div class="examples">${c.examples.slice(0,2).map(e=>`<div>${esc(e)}</div>`).join('')}</div>`;
 if(c.note)back+=`<div class="note">${esc(c.note)}</div>`;
 back+=`<div class="translation">🇷🇺 ${esc(c.ru)}</div>`;
 shell(`<div class="sessionhead"><span class="pill">${esc(c.deck)}</span><span class="muted small">${session.index+1} / ${session.queue.length}</span></div><div class="progress"><div style="width:${(session.index/session.queue.length)*100}%"></div></div>
 ${session.retrain?`<div class="info"><b>Повторное изучение</b><div class="mini">Прочитай объяснение и примеры. Затем оцени повторную попытку.</div></div>`:''}
 <section class="flash" data-flip><div class="kind">${session.revealed?'BACK · ANSWER':x.dir===0?'FRONT · DEFINITION → EXPRESSION':'FRONT · EXPRESSION → MEANING'}</div>${session.revealed?back:`<div class="definition">${esc(front)}</div><div class="fliphelp">Вспомни мысленно или вслух, затем открой ответ</div>`}${incomplete&&!session.revealed?'<div class="notice">Для этой записи английское определение пока не заполнено; использован перевод.</div>':''}</section>
 ${session.revealed?`<div class="rategrid">${['Снова','Трудно','Хорошо','Легко'].map((n,i)=>`<button class="rate ${['again','hard','good','easy'][i]}" data-rate="${i}">${n}<span class="days">${i===0?'10 мин':i===1?'раньше':i===2?'обычно':'позже'}</span></button>`).join('')}</div>`:`<button class="primary wide" data-flip>Показать ответ</button>`}
 <div class="actions"><button class="secondary wide" data-edit-current>✎ Редактировать карточку</button></div>
  <p class="notice" style="text-align:center">${directionLabel(x.dir)} · прогресс сохраняется на устройстве</p>
 <button class="ghost wide" data-end>Закончить занятие</button>`)}
function rate(r){const x=session.queue[session.index];schedule(x.card,x.dir,r);session.sessionHistory.push({term:x.card.term,dir:x.dir,rating:r});
 // A failed answer is due again after ten minutes, not immediately in this lesson.
 session.index++;session.revealed=false;session.retrain=session.index<session.queue.length&&session.queue[session.index].p!==null&&session.sessionHistory.some(v=>v.term===session.queue[session.index].card.term&&v.dir===session.queue[session.index].dir&&v.rating===0);
 if(session.index>=session.queue.length)view='summary';render();}
function summary(){const h=session?.sessionHistory??[];shell(`<section class="panel"><h1>Занятие завершено</h1><p class="muted">${h.length} ответов · ${new Set(h.map(x=>x.term)).size} выражений</p><div class="counts">${[{r:0,n:'Снова'},{r:2,n:'Хорошо'},{r:3,n:'Легко'}].map(y=>`<div class="metric"><strong>${h.filter(x=>x.rating===y.r).length}</strong><span>${y.n}</span></div>`).join('')}</div></section><section class="panel"><h3>Итоги по карточкам</h3>${h.map(x=>`<div class="deckrow"><span>${esc(x.term)}<br><small class="muted">${directionLabel(x.dir)}</small></span><b>${['Снова','Трудно','Хорошо','Легко'][x.rating]}</b></div>`).join('')}</section><button class="primary wide" data-view="home">На главную</button>`)}
function browse(){const decks=['Все',...new Set(state.cards.map(x=>x.deck))],cards=state.cards.filter(c=>(filterDeck==='Все'||c.deck===filterDeck)&&`${c.term} ${c.ru} ${c.definition}`.toLowerCase().includes(filterText.toLowerCase()));
 shell(`<section class="panel"><h1>Словарь</h1><p class="muted">${state.cards.length} уникальных выражений</p><div class="toolbar"><input id="searchTerm" placeholder="Поиск по фразам" value="${esc(filterText)}"><select id="deckSelect">${decks.map(d=>`<option ${d===filterDeck?'selected':''}>${esc(d)}</option>`).join('')}</select></div><br><div class="actions"><button class="primary" data-add>+ Новое выражение</button><button class="secondary" data-view="cardimport">↓ Импорт из ChatGPT</button></div><div id="listCards">${cards.map(c=>cardRow(c)).join('')}</div></section>`)}
function cardRow(c){return `<div class="listcard"><div class="term">${esc(c.term)}</div><small>${esc(c.deck)} · ${esc(c.ru)}</small><br><button class="ghost" data-edit="${c.id}" style="min-height:34px;padding:6px 10px;margin-top:8px">Редактировать</button></div>`}
function cardImport(){shell(`<section class="panel"><h1>Импорт карточек из ChatGPT</h1><p class="muted mini">Вставь JSON-карточку, которую я подготовлю в чате, или выбери скачанный JSON-файл. Не нужно менять код сайта или обновлять GitHub Pages.</p>
<form id="cardsImportForm" class="formgrid"><label class="fieldlabel">JSON с одной или несколькими карточками<textarea id="cardsImportText" class="field" rows="8" placeholder='{"cards":[{"term":"to ...","definition":"To ...","ipa":"/.../","examples":["..."],"ru":"...","deck":"Повседневные"}]}'></textarea></label><button class="primary" type="submit">Добавить карточки</button></form>
<div class="sectionrow"><span class="muted small">Или импортировать файл</span></div><input type="file" id="cardsImportFile" accept=".json,application/json" class="field" aria-label="Выбрать файл с карточками">
<div id="cardsImportResult" class="banner" role="status">Одинаковые выражения не дублируются. Уже изученные карточки сохраняют историю и расписание повторений.</div>
<div class="actions"><button class="secondary" data-template>Скачать шаблон JSON</button><button class="ghost" data-view="browse">К словарю</button></div></section>`)}
function parseCardsImport(data){
 const source=Array.isArray(data)?data:Array.isArray(data?.cards)?data.cards:(data&&typeof data==='object'&&data.term?[data]:null);
 if(!source||source.length<1||source.length>200)throw Error('Нужен объект карточки, массив карточек или объект {"cards":[...]}, от 1 до 200 записей.');
 return source.map((x,i)=>{
   if(!x||typeof x!=='object'||Array.isArray(x))throw Error(`Запись ${i+1}: неверный формат.`);
   const term=String(x.term||x.expression||'').trim(),definition=String(x.definition||'').trim(),ipa=String(x.ipa||'').trim(),ru=String(x.ru||x.translation||'').trim(),deck=String(x.deck||'Повседневные').trim(),note=String(x.note||x.notes||'').trim();
   let examples=Array.isArray(x.examples)?x.examples:(x.example?[x.example]:[]);
   if(!term||!definition||!ipa||!ru)throw Error(`Запись ${i+1}: обязательны term, definition, ipa, ru.`);
   if(!Array.isArray(examples)||!examples.length||examples.some(e=>typeof e!=='string'||!e.trim()))throw Error(`Запись ${i+1}: укажи как минимум один пример на английском в examples.`);
   if([term,definition,ipa,ru,deck,note].some(t=>t.length>3000))throw Error(`Запись ${i+1}: слишком длинное поле.`);
   return {term,definition,ipa,ru,deck:deck||'Повседневные',examples:examples.slice(0,2).map(e=>e.trim()),note,source:'chatgpt-import'};
 });
}
function importCardsPayload(data){
 const input=parseCardsImport(data);
 const unique=new Map();for(const c of input)if(!unique.has(normTerm(c.term)))unique.set(normTerm(c.term),c);
 let added=0,already=0,enriched=0;
 for(const c of unique.values()){
   const existing=state.cards.find(x=>normTerm(x.term)===normTerm(c.term));
   if(existing){
     already++;let changed=false;
     for(const field of ['definition','ipa','ru','note'])if(!existing[field]&&c[field]){existing[field]=c[field];changed=true}
     if((!existing.examples||!existing.examples.length)&&c.examples.length){existing.examples=c.examples;changed=true}
     if(changed)enriched++;
   }else {state.cards.push({id:crypto.randomUUID(),...c});added++}
 }
 persist();return {added,already,enriched,duplicates:input.length-unique.size};
}
function showImportResult(message,error=false){const el=$('#cardsImportResult');if(!el)return;el.textContent=message;el.style.background=error?'#51313c':'#253b4c'}
function importCardsText(value){try{const result=importCardsPayload(JSON.parse(value));showImportResult(`Готово! Добавлено: ${result.added}. Уже были в словаре: ${result.already}. Дополнено незаполненных записей: ${result.enriched}. Повторы в импорте: ${result.duplicates}. История повторений сохранена.`);$('#cardsImportText').value=''}catch(e){showImportResult('Ошибка импорта: '+e.message,true)}}
function saveJSONFile(data,filename){const content=JSON.stringify(data,null,2),blob=new Blob([content],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function downloadImportTemplate(){saveJSONFile({cards:[{term:'to ...',ipa:'/…/',definition:'To ...',examples:['She ...','They ...'],ru:'Перевод',note:'Usage: ...',deck:'Повседневные'}]},'english-c1-import-template.json')}
function editCard(){const c=editId?state.cards.find(x=>x.id===editId):null;const formField=(label,name,value,textarea=false)=>`<label class="fieldlabel">${label}${textarea?`<textarea class="field" name="${name}">${esc(value||'')}</textarea>`:`<input class="field" name="${name}" value="${esc(value||'')}">`}</label>`;
 shell(`<section class="panel"><h1>${c?'Редактирование':'Новая карточка'}</h1><form id="cardForm" class="formgrid">${formField('Выражение','term',c?.term)}${formField('Британская IPA','ipa',c?.ipa)}${formField('Перевод','ru',c?.ru)}${formField('English definition (without the expression)','definition',c?.definition,true)}${formField('Example 1','ex1',c?.examples?.[0])}${formField('Example 2','ex2',c?.examples?.[1])}${formField('Usage notes','note',c?.note,true)}${formField('Колода','deck',c?.deck||'Повседневные')}<button class="primary" type="submit">Сохранить</button><button class="secondary" type="button" data-cancel-edit>Отмена</button></form></section>`)}
function saveCard(form){
 const f=new FormData(form),term=String(f.get('term')||'').trim();
 if(!term)return alert('Укажи выражение');
 const duplicate=state.cards.find(x=>normTerm(x.term)===normTerm(term)&&x.id!==editId);
 if(duplicate)return alert('Такое выражение уже есть в словаре');
 const previous=editId?state.cards.find(x=>x.id===editId):null;
 const c={
  ...(previous||{}),id:editId||crypto.randomUUID(),
  term,ipa:String(f.get('ipa')||'').trim(),ru:String(f.get('ru')||'').trim(),
  definition:String(f.get('definition')||'').trim(),
  examples:[f.get('ex1'),f.get('ex2')].map(String).map(x=>x.trim()).filter(Boolean),
  note:String(f.get('note')||'').trim(),
  deck:String(f.get('deck')||'Повседневные').trim()||'Повседневные',
  source:previous?.source||'custom',editedLocallyAt:now()
 };
 if(editId){
  const index=state.cards.findIndex(x=>x.id===editId);
  if(index<0)return alert('Карточка больше не найдена');
  state.cards[index]=c;
  // Active study queue holds card object references; replace them as well.
  if(session)for(const item of session.queue)if(item.card.id===editId)item.card=c;
 }else state.cards.push(c);
 persist();editId=null;
 view=editReturn==='study'&&session?'study':'browse';
 editReturn='browse';render();
}
function openCardEditor(id,returnTo='browse'){
 if(!state.cards.some(c=>c.id===id))return alert('Карточка не найдена');
 editId=id;editReturn=returnTo;view='edit';render();
}
function cancelCardEditor(){
 editId=null;view=editReturn==='study'&&session?'study':'browse';
 editReturn='browse';render();
}
function exportBackup(){saveJSONFile({...state,exportedAt:new Date().toISOString(),format:'english-c1-backup'},`english-c1-backup-${new Date().toISOString().slice(0,10)}.json`)}
function settings(){shell(`<section class="panel"><h1>Настройки</h1><p class="muted">Прогресс хранится на этом устройстве. Для переноса между телефоном и компьютером используй JSON-копии и их безопасное объединение.</p><div class="formgrid"><label class="fieldlabel">Новых выражений за занятие<input class="field" id="dailyNew" inputmode="numeric" type="number" min="1" max="30" value="${state.preferences.dailyNew}"></label><label class="fieldlabel">Повторений за занятие<input class="field" id="dailyReview" inputmode="numeric" type="number" min="1" max="100" value="${state.preferences.dailyReview}"></label><button class="primary" data-save-settings>Сохранить настройки</button></div></section>
 <section class="panel"><h3>Прогресс между устройствами · GitHub + ChatGPT</h3><p class="mini muted">1. На каждом устройстве нажми «Экспорт JSON». 2. Пришли обе копии в чат ChatGPT для объединения и хранения в приватном репозитории GitHub. 3. Скачай общий JSON из чата. 4. На каждом устройстве нажми «Объединить JSON» и выбери этот файл.</p><p class="mini muted">Объединение добавляет недостающие ответы и карточки, не стирает новые результаты на устройстве. Прямой автоматической синхронизации без участия чата пока нет.</p><div class="actions"><button class="secondary" data-export>Экспорт JSON</button><button class="secondary" data-import>Объединить JSON</button></div><input type="file" id="backupInput" accept="application/json,.json" hidden><p class="notice warning">Перед импортом автоматически скачивается резервная копия текущей локальной базы. Храни её до проверки результата.</p></section>
 <section class="panel"><h3>О расписании</h3><p class="mini muted">Используется открытый адаптивный интервальный алгоритм, вдохновлённый SM-2. Это не официальная реализация FSRS. Направления карточки планируются независимо. При оценке «Снова» повтор назначается примерно через 10 минут, но не вставляется сразу в этот урок. Два направления одного выражения разделяются минимум шестью другими уникальными выражениями; если колода короткая, второе направление остаётся для следующего занятия и доступно не ранее чем через 15 минут после первого.</p></section>`)}
function empty(){shell(`<section class="panel empty"><h2>На сегодня всё!</h2><p>Для выбранной колоды нет карточек к повторению или новых сторон.</p><button class="primary" data-view="home">На главную</button></section>`)}
function render(){if(view==='home')home();else if(view==='study')study();else if(view==='summary')summary();else if(view==='browse')browse();else if(view==='settings')settings();else if(view==='edit')editCard();else if(view==='cardimport')cardImport();else empty()}
function importBackup(file){
 if(!file)return;
 file.text().then(text=>{
  let incoming;try{incoming=JSON.parse(text)}catch{throw Error('Файл не является корректным JSON.')}
  const result=mergeBackups(state,incoming);
  if(!confirm('Объединить с текущим прогрессом? Новых выражений: '+result.addedCards+', новых ответов: '+result.addedAnswers+'. Перед объединением будет скачана локальная резервная копия.'))return;
  exportBackup();
  state=result.state;persist();view='home';render();
  alert('Готово. Словарь: '+state.cards.length+' выражений; история: '+state.history.length+' ответов. Текущая история сохранена.');
 }).catch(e=>alert('Ошибка объединения: '+e.message));
}
document.addEventListener('click',e=>{const el=e.target.closest('[data-view],[data-deck],[data-start],[data-flip],[data-rate],[data-end],[data-add],[data-edit],[data-edit-current],[data-cancel-edit],[data-export],[data-import],[data-template],[data-save-settings]');if(!el)return;if(el.hasAttribute('data-view')){view=el.dataset.view;session=null;render()}else if(el.hasAttribute('data-deck'))chooseSession(el.dataset.deck);else if(el.hasAttribute('data-start'))chooseSession();else if(el.hasAttribute('data-flip')){if(session){session.revealed=!session.revealed;render()}}else if(el.hasAttribute('data-rate'))rate(Number(el.dataset.rate));else if(el.hasAttribute('data-end')){view='summary';render()}else if(el.hasAttribute('data-add')){editId=null;editReturn='browse';view='edit';render()}else if(el.hasAttribute('data-edit'))openCardEditor(el.dataset.edit);else if(el.hasAttribute('data-edit-current')){if(session)openCardEditor(session.queue[session.index].card.id,'study')}else if(el.hasAttribute('data-cancel-edit'))cancelCardEditor();else if(el.hasAttribute('data-export'))exportBackup();else if(el.hasAttribute('data-import'))$('#backupInput')?.click();else if(el.hasAttribute('data-template'))downloadImportTemplate();else if(el.hasAttribute('data-save-settings')){state.preferences.dailyNew=Math.max(1,Math.min(30,Number($('#dailyNew').value)||5));state.preferences.dailyReview=Math.max(1,Math.min(100,Number($('#dailyReview').value)||25));persist();render()}});
document.addEventListener('submit',e=>{if(e.target.id==='cardForm'){e.preventDefault();saveCard(e.target)}else if(e.target.id==='cardsImportForm'){e.preventDefault();importCardsText($('#cardsImportText').value)}});
document.addEventListener('change',e=>{if(e.target.id==='backupInput')importBackup(e.target.files[0]);if(e.target.id==='cardsImportFile'){const file=e.target.files[0];if(file)file.text().then(importCardsText).catch(err=>showImportResult('Не удалось прочитать файл.',true))}if(e.target.id==='deckSelect'){filterDeck=e.target.value;render()}});
document.addEventListener('input',e=>{if(e.target.id==='searchTerm'){filterText=e.target.value;$('#listCards').innerHTML=state.cards.filter(c=>(filterDeck==='Все'||c.deck===filterDeck)&&`${c.term} ${c.ru} ${c.definition}`.toLowerCase().includes(filterText.toLowerCase())).map(cardRow).join('')}});
// Fetch the public catalogue freshly; merge by stable id/normalized term without touching review progress.
let catalogueCheckAt=0,catalogueCheckRunning=false;
async function refreshCatalogue(){
  if(!state||catalogueCheckRunning||Date.now()-catalogueCheckAt<30000)return;
  catalogueCheckAt=Date.now();catalogueCheckRunning=true;
  try{
    const response=await fetch('./cards.json?refresh='+Date.now(),{cache:'no-store'});
    if(!response.ok)throw Error('Catalogue HTTP '+response.status);
    const incoming=await response.json();
    if(!Array.isArray(incoming))throw Error('Unexpected catalogue format');
    const ids=new Set(state.cards.map(c=>c.id));
    const terms=new Set(state.cards.map(c=>normTerm(c.term)));
    let added=0;
    for(const card of incoming){
      if(!card||!card.id||!card.term||ids.has(card.id)||terms.has(normTerm(card.term)))continue;
      state.cards.push(card);ids.add(card.id);terms.add(normTerm(card.term));added++;
    }
    if(added){persist();render()}
  }catch(error){console.warn('Catalogue refresh unavailable; local progress remains intact',error)}
  finally{catalogueCheckRunning=false}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshCatalogue()});
window.addEventListener('focus',()=>refreshCatalogue());
(async function init(){try{const r=await fetch('./cards.json?refresh='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('cards.json');seed=await r.json();let saved;try{saved=JSON.parse(localStorage.getItem(STORAGE_KEY))}catch{}state=saved?.version===1&&Array.isArray(saved.cards)?saved:defaultState();if(!saved){state.cards=seed;persist()}else{const ids=new Set(state.cards.map(c=>c.id));for(const c of seed)if(!ids.has(c.id)&&!state.cards.some(x=>x.term.toLowerCase()===c.term.toLowerCase()))state.cards.push(c);persist()}render();if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{})}catch(e){$('#app').innerHTML=`<div class="wrap panel"><h2>Не удалось загрузить приложение</h2><p>Открой его через локальный HTTP-сервер или опубликованный HTTPS-сайт, а не напрямую как файл.</p><code>${esc(e.message)}</code></div>`}})();
