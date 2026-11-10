/* English C1: experimental, serverless Yandex Disk sync. No OAuth tokens in persistent storage. */
const API='https://cloud-api.yandex.net/v1/disk';
const META='english-c1-yandex-client-id';
const BRIDGE='english-c1-yandex-bridge-url';
const DEV='english-c1-yandex-device-id';
const PKCE='english-c1-oauth-pkce';
const textSafe=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
function validate(s){return !!s&&s.version===1&&Array.isArray(s.cards)&&Array.isArray(s.history)&&!!s.progress&&typeof s.progress==='object'&&s.cards.length<10000&&s.history.length<500000&&s.cards.every(c=>typeof c.id==='string'&&typeof c.term==='string'&&c.term.length<3000)}
function b64url(a){return btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')}
async function hash(s){return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))))}
function eventId(h){return h.eventId||[h.id,h.dir,h.rating,h.at].join('~')}
function replay(events,oldProgress,idMap){
 const out={};let DAY=86400000;
 for(const ev of events){if(!idMap.has(ev.id)||!Number.isFinite(Number(ev.at)))continue;
  const k=ev.id+':'+ev.dir,prev=out[k],r=Number(ev.rating),t=Number(ev.at);
  if(!Number.isInteger(r)||r<0||r>3)continue;
  let ease=prev?.ease??2.5,streak=(prev?.streak??0)+1,days=0,lapses=prev?.lapses??0;
  if(r===0){streak=0;ease=Math.max(1.3,ease-0.2);lapses++;}
  else{if(r===1)ease=Math.max(1.3,ease-.15);if(r===3)ease=Math.min(3.2,ease+.15);
   if(streak===1)days=r===1?1:r===2?1:3;
   else if(streak===2)days=r===1?2:r===2?3:6;
   else days=Math.max(1,Math.round((prev?.interval||1)*ease*(r===1?.55:r===3?1.3:1)));
   days=Math.min(days,365);
  }
  const d=new Date(t);d.setHours(0,0,0,0);
  out[k]={interval:days,due:r===0?t+600000:d.getTime()+days*DAY+43200000,streak,ease,lapses,lastReviewed:t,lastRating:r,reviewCount:(prev?.reviewCount||0)+1};
 }
 for(const [k,p] of Object.entries(oldProgress))if(!out[k]&&idMap.has(k.split(':')[0]))out[k]=p;
 return out;
}
/* Merge by expression, and by event identity. Device-specific cloud files prevent two devices overwriting each other. */
export function mergeSnapshots(snapshots){
 const sources=snapshots.filter(validate);if(!sources.length)throw new Error('Нет корректных данных для объединения.');
 const cards=new Map(), aliases=new Map(), events=new Map(), oldProgress={};
 for(const s of sources){for(const c of s.cards){const n=normalize(c.term);if(!n)continue;
  if(!cards.has(n))cards.set(n,{...c,examples:Array.isArray(c.examples)?c.examples:[]});
  else{const prev=cards.get(n);for(const f of ['definition','ipa','ru','note','deck'])if((!prev[f]||String(prev[f]).length<String(c[f]||'').length)&&c[f])prev[f]=c[f];if((c.examples||[]).length>(prev.examples||[]).length)prev.examples=c.examples;}
  aliases.set(c.id,n);
 }}
 const byN=new Map([...cards.entries()].map(([n,c])=>[n,c.id]));
 for(const s of sources){const localAliases=new Map(s.cards.map(c=>[c.id,normalize(c.term)]));
  for(const [k,p] of Object.entries(s.progress)){const match=/^(.*):([01])$/.exec(k);if(!match)continue;const canonical=byN.get(localAliases.get(match[1]));if(!canonical)continue;const key=canonical+':'+match[2];if(!oldProgress[key]||(p?.lastReviewed||0)>(oldProgress[key]?.lastReviewed||0))oldProgress[key]=p;}
  for(const h of s.history){const canonical=byN.get(localAliases.get(h.id));if(!canonical||![0,1].includes(Number(h.dir)))continue;
   const evt={...h,id:canonical};const uid=eventId(evt);if(!events.has(uid))events.set(uid,evt);
  }
 }
 const history=[...events.values()].sort((a,b)=>(a.at||0)-(b.at||0)||eventId(a).localeCompare(eventId(b)));
 const current=sources[0];return {...current,cards:[...cards.values()],history,progress:replay(history,oldProgress,new Map([...cards.values()].map(c=>[c.id,c]))),version:1};
}
export function createYandexSync({getState,applyState,onChanged}){
 let token=null,busy=false,lastMessage='Отключено',status='off',nextTimer=null;
 const deviceId=(()=>{let x=localStorage.getItem(DEV);if(!x){x=crypto.randomUUID();localStorage.setItem(DEV,x)}return x})();
 const filename=`english-c1-sync-${deviceId}.json`;
 const clientId=()=>localStorage.getItem(META)||'';
 const bridgeUrl=()=>localStorage.getItem(BRIDGE)||'';
 function validBridge(raw){try{const u=new URL(raw);return u.protocol==='https:'&&u.hostname.endsWith('.workers.dev')&&!u.username&&!u.password&&!u.port&&u.pathname==='/' }catch{return false}}
 function panel(){return `<section class="panel"><h3>Яндекс Диск · синхронизация (тестовая версия)</h3><p class="mini muted">Папка приложения на Диске. Каждое устройство хранит отдельный файл: это защищает от перезаписи чужих ответов. Токен доступа хранится только до закрытия вкладки.</p>
 <label class="fieldlabel">Client ID приложения Яндекс OAuth<input id="yaClientId" class="field" autocomplete="off" spellcheck="false" value="${textSafe(clientId())}" placeholder="Вставь только Client ID — не секретный ключ"></label>
 <label class="fieldlabel">Адрес защищённого обработчика Cloudflare Workers<input id="yaBridgeUrl" class="field" autocomplete="off" spellcheck="false" value="${textSafe(bridgeUrl())}" placeholder="https://english-c1-sync.имя.workers.dev/"></label>
 <div class="actions"><button class="secondary" data-yasave>Сохранить ID</button><button class="primary" data-yalogin>${token?'Подключено':'Войти через Яндекс'}</button><button class="secondary" data-yasync ${token&&!busy?'':'disabled'}>Синхронизировать</button></div>
 <p id="yaStatus" class="notice" role="status">${textSafe(lastMessage)}</p>
 <p class="mini muted">Яндекс OAuth с PKCE. Токен остаётся в браузере; обработчик получает только временные URL загрузки/скачивания файлов. Для работы необходим бесплатный Cloudflare Worker. История не публикуется в GitHub.</p>
 <button class="ghost" data-yadisconnect>Отключить сессию</button></section>`}
 function show(msg){lastMessage=msg;const node=document.querySelector('#yaStatus');if(node)node.textContent=msg;}
 function dirty(){if(!token||busy)return;clearTimeout(nextTimer);nextTimer=setTimeout(()=>sync().catch(()=>{}),12000)}
 async function login(){
  const cid=clientId();if(!cid)throw new Error('Сначала введи и сохрани Client ID.');
  if(!globalThis.crypto?.subtle)throw new Error('Нужен HTTPS для PKCE.');
  const rand=new Uint8Array(48);crypto.getRandomValues(rand);const verifier=b64url(rand);
  const challenge=await hash(verifier),state=b64url(crypto.getRandomValues(new Uint8Array(24)));
  const redirect=location.origin+location.pathname;sessionStorage.setItem(PKCE,JSON.stringify({verifier,state,redirect,clientId:cid,at:Date.now()}));
  const u=new URL('https://oauth.yandex.ru/authorize');u.search=new URLSearchParams({response_type:'code',client_id:cid,redirect_uri:redirect,scope:'cloud_api:disk.app_folder',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
  location.assign(u.toString());
 }
 async function callback(){
  const qs=new URLSearchParams(location.search);if(!qs.has('code')&&!qs.has('error'))return false;
  const stored=sessionStorage.getItem(PKCE);sessionStorage.removeItem(PKCE);
  const redirect=location.origin+location.pathname;history.replaceState(null,'',redirect+location.hash);
  if(qs.has('error')){show('Яндекс отклонил вход: '+qs.get('error'));return true;}
  if(!stored){show('Истекло состояние авторизации. Нажми «Войти через Яндекс» ещё раз.');return true;}
  const x=JSON.parse(stored);if(x.state!==qs.get('state')||Date.now()-x.at>600000){show('Проверка OAuth state не прошла. Повтори вход.');return true;}
  const body=new URLSearchParams({grant_type:'authorization_code',code:qs.get('code'),client_id:x.clientId,code_verifier:x.verifier});
  try{
   const r=await fetch('https://oauth.yandex.ru/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,cache:'no-store'});
   if(!r.ok)throw new Error('OAuth HTTP '+r.status);
   const data=await r.json();if(!data.access_token)throw new Error('Нет access_token');token=data.access_token;status='online';show('Яндекс подключён. Нажми «Синхронизировать».');return true;
  }catch(e){show('Не удалось обменять код на токен. Возможна блокировка CORS: '+e.message);return true}
 }
 async function api(url,options={}){const r=await fetch(url,{...options,headers:{Authorization:`OAuth ${token}`,...(options.headers||{})},cache:'no-store'});if(!r.ok){let details='';try{details=(await r.text()).slice(0,180)}catch{};throw new Error('API '+r.status+' '+details)}return r.json()}
 const resource=(path)=>API+'/resources?'+new URLSearchParams({path});
 async function list(){try{const r=await api(resource('app:/')+'&limit=1000');return (r._embedded?.items||[]).filter(f=>f.type==='file'&&/^english-c1-sync-[a-f0-9-]+\.json$/.test(f.name)).slice(0,200)}catch(e){if(/API 404/.test(e.message))return [];throw e}}
 async function transfer(operation,url,content){
  const address=bridgeUrl();if(!validBridge(address))throw new Error('Укажи адрес Cloudflare Worker в настройках и нажми «Сохранить».');
  const response=await fetch(address,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,url,...(operation==='upload'?{content}:{})}),cache:'no-store'});
  if(!response.ok)throw new Error('Обработчик загрузки: HTTP '+response.status);
  return operation==='download'?response.json():null;
 }
 async function download(name){const meta=await api(API+'/resources/download?'+new URLSearchParams({path:'app:/'+name}));const result=await transfer('download',meta.href);if(!validate(result))throw new Error('Повреждена копия '+name);return result;}
 async function upload(s){const meta=await api(API+'/resources/upload?'+new URLSearchParams({path:'app:/'+filename,overwrite:'true'}));await transfer('upload',meta.href,s)}
 async function sync(){if(!token||busy)return;busy=true;show('Синхронизация…');
 try{const listFiles=await list();const remote=[];for(const item of listFiles)remote.push(await download(item.name));
  const local=getState();const merged=mergeSnapshots([local,...remote]);
  // Store merged history locally BEFORE uploading. A failed network write never deletes local reviews.
  applyState(merged);await upload(merged);status='online';show(`Синхронизировано: ${merged.cards.length} выражений, ${merged.history.length} ответов, ${remote.length} удалённых копий. ${new Date().toLocaleTimeString('ru-RU')}`);
 }catch(e){status='error';show('Синхронизация не выполнена; локальная база сохранена. '+e.message)}finally{busy=false}}
 document.addEventListener('click',e=>{const b=e.target.closest('[data-yasave],[data-yalogin],[data-yasync],[data-yadisconnect]');if(!b)return;
  if(b.hasAttribute('data-yasave')){const v=(document.querySelector('#yaClientId')?.value||'').trim();const u=(document.querySelector('#yaBridgeUrl')?.value||'').trim();if(!/^[a-zA-Z0-9_-]{8,160}$/.test(v)){show('Неверный Client ID');return}if(!validBridge(u)){show('Введи полный адрес HTTPS Cloudflare Worker, оканчивающийся на workers.dev/');return}localStorage.setItem(META,v);localStorage.setItem(BRIDGE,u);show('Настройки подключения сохранены.');}
  if(b.hasAttribute('data-yalogin'))login().catch(e=>show(e.message));
  if(b.hasAttribute('data-yasync'))sync();
  if(b.hasAttribute('data-yadisconnect')){token=null;clearTimeout(nextTimer);status='off';show('Отключено. Данные на устройстве не удалены.');}
 });
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&token)sync()});
 setInterval(()=>{if(token&&!document.hidden)sync()},120000);
 return {panel,dirty,callback,sync};
}
