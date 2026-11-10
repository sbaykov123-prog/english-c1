// English C1: narrowly scoped bridge for Yandex Disk temporary transfer links.
// No account tokens, passwords or permanent data are stored by this Worker.
const ORIGIN = 'https://sbaykov123-prog.github.io';
const ALLOWED = new Set([
  'downloader.disk.yandex.ru',
  'downloader.disk.yandex.net',
  'uploader.disk.yandex.ru',
  'uploader.disk.yandex.net',
]);
const cors = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Vary': 'Origin',
  'Cache-Control': 'no-store',
};
function response(body,status=200){return new Response(body,{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}})}
export default {
 async fetch(req) {
  const origin=req.headers.get('Origin');
  if(origin!==ORIGIN)return new Response('Forbidden origin',{status:403});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return response(JSON.stringify({error:'Method not allowed'}),405);
  try{
   const payload=await req.text();
   if(payload.length>8_000_000)return response(JSON.stringify({error:'Payload too large'}),413);
   const {operation,url,content}=JSON.parse(payload);
   if(operation!=='download'&&operation!=='upload')return response(JSON.stringify({error:'Invalid operation'}),400);
   const u=new URL(url);
   if(u.protocol!=='https:'||u.username||u.password||u.port||!ALLOWED.has(u.hostname)||u.pathname.startsWith('//'))return response(JSON.stringify({error:'Invalid Yandex transfer URL'}),400);
   if(operation==='download'&&!u.hostname.startsWith('downloader.'))return response(JSON.stringify({error:'Wrong transfer host'}),400);
   if(operation==='upload'&&!u.hostname.startsWith('uploader.'))return response(JSON.stringify({error:'Wrong transfer host'}),400);
   if(operation==='upload'&&(!content||typeof content!=='object'))return response(JSON.stringify({error:'Missing upload content'}),400);
   const upstream=await fetch(u.toString(),{
    method:operation==='download'?'GET':'PUT',
    headers:operation==='upload'?{'Content-Type':'application/json'}:{},
    body:operation==='upload'?JSON.stringify(content):undefined,
    redirect:'manual',
   });
   if(upstream.status>=300&&upstream.status<400)return response(JSON.stringify({error:'Unexpected redirect; transfer not followed'}),502);
   return new Response(upstream.body,{status:upstream.status,headers:{...cors,'Content-Type':operation==='download'?'application/json; charset=utf-8':'text/plain; charset=utf-8'}});
  }catch(e){return response(JSON.stringify({error:'Bridge request failed'}),502)}
 }
};
