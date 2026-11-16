'use strict';
// R4 standalone: same routes and same /calcio-editor prefix as MAIN R4.
// No SQLite writes; all revisions stored in the add-on hash-chain journal.
const http=require('node:http');const path=require('node:path');const cp=require('node:child_process');
const ROOT=path.resolve(process.env.BETTINGAPP_ROOT||path.resolve(__dirname,'..','..'));
const HOST='127.0.0.1',PORT=3190,BASE='/calcio-editor';
process.env.PORT=String(PORT); // Port is scoped to this standalone process.
const service=require('./main-router-r3.cjs');
const registry={handlers:new Map(),middlewares:[]};
const expressShim={Router:()=>({
 get:(route,handler)=>registry.handlers.set('GET '+route,handler),
 post:(route,handler)=>registry.handlers.set('POST '+route,handler),
 use:handler=>registry.middlewares.push(handler)
})};
service.createRouter(expressShim,{root:ROOT});
function wrapped(res){let status=200,headers={};const api={
 status(n){status=n;return api},set(x){Object.assign(headers,x);return api},
 type(mime){headers['Content-Type']=({html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',javascript:'application/javascript; charset=utf-8'}[mime]||mime);return api},
 json(x){if(res.writableEnded)return api;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(x));return api},
 send(x){if(res.writableEnded)return api;res.writeHead(status,headers);res.end(x);return api},
 sendStatus(n){if(res.writableEnded)return api;res.writeHead(n,headers);res.end();return api}
 };return api;
}
const server=http.createServer(async(req,res)=>{
 try{
  const uri=new URL(req.url,'http://127.0.0.1:'+PORT);
  let pathname=uri.pathname;if(pathname===BASE)pathname='/';else if(pathname.startsWith(BASE+'/'))pathname=pathname.slice(BASE.length); // Prefix matches all HTML/JS/API paths.
  const dynamic=/^\/prompts\/(calcio|tennis)$/.exec(pathname);const route=dynamic?'/prompts/:sport':pathname;
  const handler=registry.handlers.get(req.method+' '+route);
  if(!handler)return wrapped(res).status(404).json({error:'ROTTA_EDITOR_NON_TROVATA:'+route});
  let data='';if(req.method==='POST')for await(const chunk of req){data+=chunk;if(data.length>180000)return wrapped(res).status(413).json({error:'PAYLOAD_TROPPO_GRANDE'});}
  req.body={};if(data){try{req.body=JSON.parse(data);}catch{return wrapped(res).status(400).json({error:'JSON_NON_VALIDO'});}}
  req.query=Object.fromEntries(uri.searchParams.entries());req.params=dynamic?{sport:dynamic[1]}:{};
  const reply=wrapped(res);let i=0;const next=()=>{if(i<registry.middlewares.length)registry.middlewares[i++](req,reply,next);else handler(req,reply);};next();
 }catch(e){if(!res.writableEnded)wrapped(res).status(500).json({error:'EDITOR_HTTP_ERROR:'+String(e.message||e).slice(0,160)});}
});
if(require.main===module){server.listen(PORT,HOST,()=>{
 const url='http://127.0.0.1:'+PORT+BASE+'/';console.log('EDITOR_CALCIO_R4_READY='+url+' ROOT='+ROOT);
 if(process.platform==='win32'&&process.env.EDITOR_NO_BROWSER!=='1'){
  try{const child=cp.spawn('cmd.exe',['/d','/c','start','','"'+url+'"'],{detached:true,stdio:'ignore',windowsHide:true});child.unref();}catch(e){console.warn('APRI_MANUALMENTE='+url+' ERR='+e.message);}
 }
 });server.on('error',e=>{console.error('EDITOR_CALCIO_ERROR='+e.message);process.exitCode=1;});}
module.exports={server};
